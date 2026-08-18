mod claude_binary;
mod claude_process;
mod git_ops;
mod merge_paths;
mod preview_server;
mod stream_parser;

use serde::Serialize;
use std::io::BufRead;
use tauri::{AppHandle, Emitter};

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
    chat_id: String,
    prompt: String,
    working_directory: String,
    resume_session_id: Option<String>,
) -> Result<(), String> {
    let claude_path =
        claude_binary::resolve_claude_binary().ok_or_else(|| "claude binary not found".to_string())?;

    let config = claude_process::SpawnConfig {
        prompt,
        model: "sonnet".to_string(),
        working_directory: std::path::PathBuf::from(working_directory),
        resume_session_id,
    };

    let session = claude_process::spawn_session(&claude_path, &config)?;
    let mut reader = claude_process::reader_for(&session)?;

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
        // Keep the child alive in this closure until the reader loop ends,
        // otherwise it drops (and the process is killed) as soon as spawn_session returns.
        drop(session);
    });

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(preview_server::TeamPreviewServer::new())
        .invoke_handler(tauri::generate_handler![
            greet,
            start_session,
            ensure_chat_worktree,
            remove_chat_worktree,
            render_preview,
            promote_to_main
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
