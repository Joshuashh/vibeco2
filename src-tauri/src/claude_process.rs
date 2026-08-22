use portable_pty::{native_pty_system, MasterPty, PtySize};

pub fn open_pty() -> Result<Box<dyn MasterPty + Send>, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 40,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("failed to open pty: {e}"))?;
    disable_echo(&*pair.master)?;
    Ok(pair.master)
}

/// termios ECHO must be cleared on the pty (settable via either end's fd —
/// we use the master's, since portable-pty's SlavePty trait doesn't expose
/// one) or writes to stdin echo back into the stream we're parsing as JSON
/// (see Claude Code GUI decisions.md: "PTY echo disabled").
fn disable_echo(master: &dyn MasterPty) -> Result<(), String> {
    #[cfg(unix)]
    {
        if let Some(fd) = master.as_raw_fd() {
            unsafe {
                let mut term: libc::termios = std::mem::zeroed();
                if libc::tcgetattr(fd, &mut term) != 0 {
                    return Err("tcgetattr failed".into());
                }
                term.c_lflag &= !libc::ECHO;
                if libc::tcsetattr(fd, libc::TCSANOW, &term) != 0 {
                    return Err("tcsetattr failed".into());
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_pty_succeeds() {
        let result = open_pty();
        assert!(result.is_ok(), "expected PTY to open: {:?}", result.err());
    }
}

use std::path::PathBuf;

/// Everything build_args needs to wire a chat's `claude` invocation up to
/// the permission-approval MCP bridge (see permission_bridge.rs). Only used
/// when permission_mode is "manual" — see build_args below.
pub struct PermissionBridgeConfig {
    pub node_path: PathBuf,
    pub script_path: PathBuf,
    pub socket_path: PathBuf,
}

pub struct SpawnConfig {
    pub prompt: String,
    pub model: String,
    pub permission_mode: String,
    pub effort: String,
    pub working_directory: PathBuf,
    pub resume_session_id: Option<String>,
    pub chat_id: String,
    pub permission_bridge: Option<PermissionBridgeConfig>,
}

/// Tool name format for MCP-provided tools is `mcp__<serverName>__<toolName>`
/// — must match the server name used in the --mcp-config JSON below.
const PERMISSION_TOOL_NAME: &str = "mcp__vibeco-permissions__approve_tool_use";

/// Every Vibeco2 chat is scoped to one project's repo. Most projects won't
/// have their own CLAUDE.md telling Claude to notice scope drift, so we
/// inject the check here instead of depending on that.
const SCOPE_GUARDRAIL_PROMPT: &str = "This chat is scoped to one project's repository. If the user's request describes building something unrelated to what this repository already is (e.g. a different app entirely), don't just proceed — say in one line that it looks out of scope for this project and suggest starting a new project for it, then ask if they want to continue here anyway.";

pub fn build_args(config: &SpawnConfig) -> Vec<String> {
    let mut args = vec![
        "--print".to_string(),
        config.prompt.clone(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--include-partial-messages".to_string(),
        "--model".to_string(),
        config.model.clone(),
        "--permission-mode".to_string(),
        config.permission_mode.clone(),
        "--effort".to_string(),
        config.effort.clone(),
        "--append-system-prompt".to_string(),
        SCOPE_GUARDRAIL_PROMPT.to_string(),
    ];
    if let Some(id) = &config.resume_session_id {
        args.push("--resume".to_string());
        args.push(id.clone());
    }
    // "manual" is the only mode that ever needs a real prompt — acceptEdits/
    // bypassPermissions/plan/auto don't stop to ask. Without this, "manual"
    // silently auto-denies every gated tool call instead of asking (see
    // decisions.md's permission-approval-dialog-gap entry).
    if config.permission_mode == "manual" {
        if let Some(bridge) = &config.permission_bridge {
            let mcp_config = serde_json::json!({
                "mcpServers": {
                    "vibeco-permissions": {
                        "command": bridge.node_path.to_string_lossy(),
                        "args": [bridge.script_path.to_string_lossy()],
                        "env": {
                            "VIBECO_PERM_SOCKET": bridge.socket_path.to_string_lossy(),
                            "VIBECO_CHAT_ID": config.chat_id,
                        }
                    }
                }
            });
            args.push("--permission-prompt-tool".to_string());
            args.push(PERMISSION_TOOL_NAME.to_string());
            args.push("--mcp-config".to_string());
            args.push(mcp_config.to_string());
        }
    }
    args
}

#[cfg(test)]
mod spawn_config_tests {
    use super::*;

    #[test]
    fn build_args_includes_stream_json_flags() {
        let config = SpawnConfig {
            prompt: "hello".to_string(),
            model: "sonnet".to_string(),
            permission_mode: "acceptEdits".to_string(),
            effort: "high".to_string(),
            working_directory: PathBuf::from("/tmp"),
            resume_session_id: None,
            chat_id: "chat-1".to_string(),
            permission_bridge: None,
        };
        let args = build_args(&config);
        assert_eq!(args[0], "--print");
        assert_eq!(args[1], "hello");
        assert!(args.contains(&"stream-json".to_string()));
        assert!(args.contains(&"--include-partial-messages".to_string()));
        assert!(!args.contains(&"--resume".to_string()));
    }

    #[test]
    fn build_args_includes_model_permission_and_effort() {
        let config = SpawnConfig {
            prompt: "hello".to_string(),
            model: "opus".to_string(),
            permission_mode: "plan".to_string(),
            effort: "max".to_string(),
            working_directory: PathBuf::from("/tmp"),
            resume_session_id: None,
            chat_id: "chat-1".to_string(),
            permission_bridge: None,
        };
        let args = build_args(&config);
        assert!(args.contains(&"--model".to_string()) && args.contains(&"opus".to_string()));
        assert!(args.contains(&"--permission-mode".to_string()) && args.contains(&"plan".to_string()));
        assert!(args.contains(&"--effort".to_string()) && args.contains(&"max".to_string()));
    }

    #[test]
    fn build_args_includes_resume_when_present() {
        let config = SpawnConfig {
            prompt: "continue".to_string(),
            model: "sonnet".to_string(),
            permission_mode: "acceptEdits".to_string(),
            effort: "high".to_string(),
            working_directory: PathBuf::from("/tmp"),
            resume_session_id: Some("abc-123".to_string()),
            chat_id: "chat-1".to_string(),
            permission_bridge: None,
        };
        let args = build_args(&config);
        assert!(args.contains(&"--resume".to_string()));
        assert!(args.contains(&"abc-123".to_string()));
    }

    #[test]
    fn build_args_adds_permission_prompt_tool_only_in_manual_mode() {
        let bridge = PermissionBridgeConfig {
            node_path: PathBuf::from("/usr/local/bin/node"),
            script_path: PathBuf::from("/tmp/mcp-server.mjs"),
            socket_path: PathBuf::from("/tmp/vibeco.sock"),
        };
        let manual_config = SpawnConfig {
            prompt: "hello".to_string(),
            model: "sonnet".to_string(),
            permission_mode: "manual".to_string(),
            effort: "high".to_string(),
            working_directory: PathBuf::from("/tmp"),
            resume_session_id: None,
            chat_id: "chat-1".to_string(),
            permission_bridge: Some(bridge),
        };
        let args = build_args(&manual_config);
        assert!(args.contains(&"--permission-prompt-tool".to_string()));
        assert!(args.contains(&PERMISSION_TOOL_NAME.to_string()));
        let mcp_config_arg = args
            .iter()
            .position(|a| a == "--mcp-config")
            .map(|i| args[i + 1].clone())
            .expect("--mcp-config should be present");
        assert!(mcp_config_arg.contains("vibeco-permissions"));
        assert!(mcp_config_arg.contains("/tmp/vibeco.sock"));
        assert!(mcp_config_arg.contains("chat-1"));

        let accept_edits_config = SpawnConfig {
            prompt: "hello".to_string(),
            model: "sonnet".to_string(),
            permission_mode: "acceptEdits".to_string(),
            effort: "high".to_string(),
            working_directory: PathBuf::from("/tmp"),
            resume_session_id: None,
            chat_id: "chat-1".to_string(),
            permission_bridge: Some(PermissionBridgeConfig {
                node_path: PathBuf::from("/usr/local/bin/node"),
                script_path: PathBuf::from("/tmp/mcp-server.mjs"),
                socket_path: PathBuf::from("/tmp/vibeco.sock"),
            }),
        };
        let args = build_args(&accept_edits_config);
        assert!(!args.contains(&"--permission-prompt-tool".to_string()));
        assert!(!args.contains(&"--mcp-config".to_string()));
    }
}

use portable_pty::CommandBuilder;
use std::collections::HashMap;
use std::io::BufReader;
use std::sync::Mutex;

pub struct ClaudeSession {
    pub master: Box<dyn MasterPty + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
}

/// Tracks the in-flight child process per chat, so a "Stop" action can kill
/// the right one. Entries are removed once the reader thread hits EOF (see
/// lib.rs::start_session) or when explicitly stopped.
pub struct ActiveSessions(pub Mutex<HashMap<String, Box<dyn portable_pty::Child + Send + Sync>>>);

impl ActiveSessions {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

/// Spawns one `claude` process for one session. Not a singleton — each
/// chat/session in Vibeco2 gets its own ClaudeSession, matching the
/// "one ClaudeProcess per session" lesson from the Swift codebase.
pub fn spawn_session(claude_path: &std::path::Path, config: &SpawnConfig) -> Result<ClaudeSession, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows: 40, cols: 120, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("failed to open pty: {e}"))?;
    disable_echo(&*pair.master)?;

    let mut cmd = CommandBuilder::new(claude_path);
    for arg in build_args(config) {
        cmd.arg(arg);
    }
    cmd.cwd(&config.working_directory);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("failed to spawn claude: {e}"))?;

    Ok(ClaudeSession { master: pair.master, child })
}

pub fn reader_for_master(
    master: &Box<dyn MasterPty + Send>,
) -> Result<BufReader<Box<dyn std::io::Read + Send>>, String> {
    let reader = master
        .try_clone_reader()
        .map_err(|e| format!("failed to clone pty reader: {e}"))?;
    Ok(BufReader::new(reader))
}
