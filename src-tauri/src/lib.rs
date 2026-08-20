mod claude_binary;
mod claude_process;
mod git_ops;
mod merge_paths;
mod preview_server;
mod stream_parser;

use serde::Serialize;
use std::io::BufRead;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatEvent {
    chat_id: String,
    event: stream_parser::ClaudeEvent,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn start_session(
    app: AppHandle,
    active_sessions: tauri::State<claude_process::ActiveSessions>,
    chat_id: String,
    prompt: String,
    working_directory: String,
    resume_session_id: Option<String>,
    model: String,
    permission_mode: String,
    effort: String,
) -> Result<(), String> {
    let claude_path =
        claude_binary::resolve_claude_binary().ok_or_else(|| "claude binary not found".to_string())?;

    let config = claude_process::SpawnConfig {
        prompt,
        model,
        permission_mode,
        effort,
        working_directory: std::path::PathBuf::from(working_directory),
        resume_session_id,
    };

    let claude_process::ClaudeSession { master, child } = claude_process::spawn_session(&claude_path, &config)?;
    let mut reader = claude_process::reader_for_master(&master)?;

    active_sessions.0.lock().unwrap().insert(chat_id.clone(), child);

    std::thread::spawn(move || {
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => break, // EOF, process exited
                Ok(_) => {
                    let event = stream_parser::parse_line(&line);
                    if event != stream_parser::ClaudeEvent::Ignored {
                        let chat_event = ChatEvent { chat_id: chat_id.clone(), event };
                        let _ = app.emit("claude-event", &chat_event);
                    }
                }
                Err(_) => break,
            }
        }
        // Session ended (naturally or via stop_session) — stop tracking it.
        app.state::<claude_process::ActiveSessions>().0.lock().unwrap().remove(&chat_id);
        // Keep the master alive in this closure until the reader loop ends,
        // otherwise it drops as soon as spawn_session returns.
        drop(master);
    });

    Ok(())
}

#[tauri::command]
fn stop_session(active_sessions: tauri::State<claude_process::ActiveSessions>, chat_id: String) -> Result<(), String> {
    let mut sessions = active_sessions.0.lock().unwrap();
    if let Some(mut child) = sessions.remove(&chat_id) {
        child.kill().map_err(|e| format!("failed to stop session: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
fn ensure_chat_worktree(chat_id: String) -> Result<String, String> {
    let root = git_ops::repo_root()?;
    let path = git_ops::ensure_chat_worktree(&root, &chat_id)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn remove_chat_worktree(chat_id: String) -> Result<(), String> {
    let root = git_ops::repo_root()?;
    git_ops::remove_chat_worktree(&root, &chat_id)
}

#[tauri::command]
fn chat_has_unmerged_work(chat_id: String) -> Result<bool, String> {
    let root = git_ops::repo_root()?;
    git_ops::chat_has_unmerged_work(&root, &chat_id)
}

#[tauri::command]
fn prune_orphaned_chat_worktrees(known_chat_ids: Vec<String>) -> Result<(), String> {
    let root = git_ops::repo_root()?;
    git_ops::prune_orphaned_chat_worktrees(&root, &known_chat_ids)
}

#[derive(Debug, Serialize)]
#[serde(tag = "status")]
enum RenderPreviewResult {
    Clean,
    Conflict { files: Vec<String> },
}

#[tauri::command]
fn render_preview(
    state: tauri::State<preview_server::TeamPreviewServer>,
    chat_id: String,
) -> Result<RenderPreviewResult, String> {
    let root = git_ops::repo_root()?;
    let outcome = git_ops::render_preview(&root, &chat_id)?;
    if let git_ops::MergeOutcome::Clean = outcome {
        let team_path = merge_paths::team_worktree_path(&root);
        state.ensure_running(&team_path)?;
    }
    Ok(match outcome {
        git_ops::MergeOutcome::Clean => RenderPreviewResult::Clean,
        git_ops::MergeOutcome::Conflict { files } => RenderPreviewResult::Conflict { files },
    })
}

#[tauri::command]
fn promote_to_main() -> Result<(), String> {
    let root = git_ops::repo_root()?;
    git_ops::promote_to_main(&root)
}

#[tauri::command]
fn ensure_team_preview_running(state: tauri::State<preview_server::TeamPreviewServer>) -> Result<(), String> {
    let root = git_ops::repo_root()?;
    let team_path = git_ops::ensure_team_worktree(&root)?;
    state.ensure_running(&team_path)
}

#[tauri::command]
fn ensure_chat_preview_running(
    state: tauri::State<preview_server::ChatPreviewServers>,
    chat_id: String,
) -> Result<u16, String> {
    let root = git_ops::repo_root()?;
    let chat_path = git_ops::ensure_chat_worktree(&root, &chat_id)?;
    state.ensure_running(&chat_id, &chat_path)
}

#[tauri::command]
fn stop_chat_preview(state: tauri::State<preview_server::ChatPreviewServers>, chat_id: String) -> Result<(), String> {
    state.stop(&chat_id);
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SlashCommandInfo {
    name: String,
    description: String,
}

/// Reads the `description:` frontmatter field, if any, out of a custom
/// slash-command markdown file (`---\ndescription: ...\n---`).
fn frontmatter_description(content: &str) -> String {
    if !content.starts_with("---") {
        return String::new();
    }
    let mut lines = content.lines();
    lines.next();
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        if let Some(rest) = line.strip_prefix("description:") {
            return rest.trim().trim_matches('"').to_string();
        }
    }
    String::new()
}

fn scan_commands_dir(dir: &std::path::Path, out: &mut Vec<SlashCommandInfo>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else { continue };
        let description = std::fs::read_to_string(&path).map(|c| frontmatter_description(&c)).unwrap_or_default();
        out.push(SlashCommandInfo { name: stem.to_string(), description });
    }
}

/// Custom slash commands the user (or this project) has defined as `.md`
/// files under `~/.claude/commands` and `<repo>/.claude/commands` — the
/// built-in Claude Code commands (`/clear`, `/model`, ...) are a fixed list
/// maintained on the frontend instead, since they don't live on disk.
#[tauri::command]
fn list_custom_slash_commands() -> Result<Vec<SlashCommandInfo>, String> {
    let mut out = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        scan_commands_dir(&std::path::PathBuf::from(home).join(".claude/commands"), &mut out);
    }
    if let Ok(root) = git_ops::repo_root() {
        scan_commands_dir(&root.join(".claude/commands"), &mut out);
    }
    Ok(out)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(preview_server::TeamPreviewServer::new())
        .manage(preview_server::ChatPreviewServers::new())
        .manage(claude_process::ActiveSessions::new())
        .invoke_handler(tauri::generate_handler![
            greet,
            start_session,
            stop_session,
            ensure_chat_worktree,
            remove_chat_worktree,
            chat_has_unmerged_work,
            prune_orphaned_chat_worktrees,
            render_preview,
            promote_to_main,
            ensure_team_preview_running,
            ensure_chat_preview_running,
            stop_chat_preview,
            list_custom_slash_commands
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                app_handle.state::<preview_server::TeamPreviewServer>().shutdown();
                app_handle.state::<preview_server::ChatPreviewServers>().shutdown_all();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_event_serializes_with_camel_case_chat_id() {
        let event = ChatEvent {
            chat_id: "abc".to_string(),
            event: stream_parser::ClaudeEvent::TurnComplete,
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["chatId"], "abc");
        assert_eq!(json["event"]["type"], "turn_complete");
    }
}
