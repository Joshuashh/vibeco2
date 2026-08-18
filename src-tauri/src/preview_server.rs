use std::path::Path;
use std::process::{Child, Command};
use std::sync::Mutex;

pub const TEAM_PREVIEW_PORT: u16 = 5180;

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
        let child = Command::new("npm")
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
