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

pub struct SpawnConfig {
    pub prompt: String,
    pub model: String,
    pub permission_mode: String,
    pub effort: String,
    pub working_directory: PathBuf,
    pub resume_session_id: Option<String>,
}

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
    ];
    if let Some(id) = &config.resume_session_id {
        args.push("--resume".to_string());
        args.push(id.clone());
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
        };
        let args = build_args(&config);
        assert!(args.contains(&"--resume".to_string()));
        assert!(args.contains(&"abc-123".to_string()));
    }
}

use portable_pty::CommandBuilder;
use std::io::BufReader;

pub struct ClaudeSession {
    pub master: Box<dyn MasterPty + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
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

pub fn reader_for(session: &ClaudeSession) -> Result<BufReader<Box<dyn std::io::Read + Send>>, String> {
    let reader = session
        .master
        .try_clone_reader()
        .map_err(|e| format!("failed to clone pty reader: {e}"))?;
    Ok(BufReader::new(reader))
}
