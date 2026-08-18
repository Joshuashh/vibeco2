use std::path::Path;
use std::process::{Child, Command};
use std::sync::Mutex;

pub const TEAM_PREVIEW_PORT: u16 = 5180;

/// Resolves the path to the `npm` binary.
/// GUI apps on macOS launch with a minimal PATH, so we check common
/// install locations first, then fall back to the user's actual login
/// shell (`which npm` under `<$SHELL> -lic`) which picks up
/// nvm/homebrew/etc shims. Mirrors `claude_binary::resolve_claude_binary`.
fn resolve_npm_binary() -> Option<std::path::PathBuf> {
    let common_paths = ["/usr/local/bin/npm", "/opt/homebrew/bin/npm"];
    for path in common_paths {
        let candidate = std::path::PathBuf::from(path);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = Command::new(shell).arg("-lic").arg("which npm").output().ok()?;

    if !output.status.success() {
        return None;
    }

    let path_str = String::from_utf8(output.stdout).ok()?;
    let trimmed = path_str.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(std::path::PathBuf::from(trimmed))
}

/// One long-lived `npm run dev` process against the team worktree, kept
/// alive for the app's lifetime rather than restarted per Render Preview
/// press — Vite's own file watcher picks up merge results and hot-reloads.
pub struct TeamPreviewServer {
    child: Mutex<Option<Child>>,
}

impl TeamPreviewServer {
    pub fn new() -> Self {
        Self { child: Mutex::new(None) }
    }

    /// Starts the server if it isn't already running. Safe to call
    /// repeatedly — a no-op once a live child is tracked.
    pub fn ensure_running(&self, team_worktree: &Path) -> Result<(), String> {
        let mut guard = self.child.lock().map_err(|_| "preview server lock poisoned".to_string())?;
        if let Some(child) = guard.as_mut() {
            if matches!(child.try_wait(), Ok(None)) {
                return Ok(());
            }
        }
        let npm_path = resolve_npm_binary().ok_or_else(|| "npm binary not found".to_string())?;
        let child = Command::new(npm_path)
            .args(["run", "dev", "--", "--port", &TEAM_PREVIEW_PORT.to_string(), "--strictPort"])
            .current_dir(team_worktree)
            .spawn()
            .map_err(|e| format!("failed to start team preview server: {e}"))?;
        *guard = Some(child);
        Ok(())
    }
}

impl Default for TeamPreviewServer {
    fn default() -> Self {
        Self::new()
    }
}
