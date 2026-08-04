mod claude_binary;
mod claude_process;
mod stream_parser;

use std::io::BufRead;
use tauri::{AppHandle, Emitter};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn start_session(app: AppHandle, prompt: String, working_directory: String) -> Result<(), String> {
    let claude_path =
        claude_binary::resolve_claude_binary().ok_or_else(|| "claude binary not found".to_string())?;

    let config = claude_process::SpawnConfig {
        prompt,
        model: "sonnet".to_string(),
        working_directory: std::path::PathBuf::from(working_directory),
        resume_session_id: None,
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
                        let _ = app.emit("claude-event", &event);
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, start_session])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
