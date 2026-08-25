use std::collections::HashMap;
use std::net::TcpStream;
use std::path::Path;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const TEAM_PREVIEW_PORT: u16 = 5180;
const CHAT_PREVIEW_PORT_BASE: u16 = 5181;

/// A spawned process succeeding just means the OS started it — the dev
/// server (or static file server) can still take a moment to actually bind
/// its port. Without this, the frontend flips to "ready" and the preview
/// iframe loads immediately, often racing a server that isn't listening
/// yet; iframes don't retry a failed load, so that shows as a permanently
/// blank preview even though everything actually worked a moment later.
fn wait_for_port_open(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

/// Resolves the path to a named binary. GUI apps on macOS launch with a
/// minimal PATH, so common install locations are checked first, then it
/// falls back to the user's actual login shell (`which <name>` under
/// `<$SHELL> -lic`) which picks up nvm/homebrew/pyenv/etc shims. Mirrors
/// `claude_binary::resolve_claude_binary`.
fn resolve_binary(name: &str, common_paths: &[&str]) -> Option<std::path::PathBuf> {
    for path in common_paths {
        let candidate = std::path::PathBuf::from(path);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = Command::new(shell).arg("-lic").arg(format!("which {name}")).output().ok()?;

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

fn resolve_npm_binary() -> Option<std::path::PathBuf> {
    resolve_binary("npm", &["/usr/local/bin/npm", "/opt/homebrew/bin/npm"])
}

fn resolve_python_binary() -> Option<std::path::PathBuf> {
    resolve_binary("python3", &["/usr/bin/python3", "/usr/local/bin/python3", "/opt/homebrew/bin/python3"])
}

/// A chat isn't necessarily an npm project — plain static HTML/CSS/JS with
/// no `package.json` has nothing for `npm run dev` to run, which previously
/// meant the Preview tab could never show it at all (Claude would open the
/// file directly in the system browser instead, since that was the only way
/// to actually show its own work). Serve the worktree as static files in
/// that case instead, via Python's stdlib server — already on every Mac, no
/// new dependency, no need to guess at a framework.
/// `http.server` only auto-serves a file named exactly `index.html` at `/` —
/// anything else (e.g. a page named `padel.html`) makes it fall back to a
/// raw directory listing instead of rendering the page. Finds whatever `.html`
/// file should stand in for `index.html` so the caller can route `/` to it.
/// `None` means no rewrite is needed (either `index.html` already exists, or
/// there's nothing to serve at all).
fn find_html_entry(worktree: &Path) -> Option<String> {
    if worktree.join("index.html").exists() {
        return None;
    }
    let mut htmls: Vec<String> = std::fs::read_dir(worktree)
        .ok()?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.ends_with(".html").then_some(name)
        })
        .collect();
    htmls.sort();
    htmls.into_iter().next()
}

fn spawn_dev_server(worktree: &Path, port: u16) -> Result<Child, String> {
    if worktree.join("package.json").exists() {
        let npm_path = resolve_npm_binary().ok_or_else(|| "npm binary not found".to_string())?;
        Command::new(npm_path)
            .args(["run", "dev", "--", "--port", &port.to_string(), "--strictPort"])
            .current_dir(worktree)
            .spawn()
            .map_err(|e| format!("failed to start preview server: {e}"))
    } else {
        let python_path = resolve_python_binary().ok_or_else(|| "python3 binary not found".to_string())?;
        match find_html_entry(worktree) {
            Some(entry) => {
                // Redirect "/" to the actual entry file instead of letting
                // http.server list the directory.
                let script = format!(
                    r#"
import http.server, socketserver
ENTRY = {entry:?}
class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/":
            self.send_response(302)
            self.send_header("Location", "/" + ENTRY)
            self.end_headers()
            return
        super().do_GET()
class Server(socketserver.TCPServer):
    allow_reuse_address = True
with Server(("127.0.0.1", {port}), Handler) as httpd:
    httpd.serve_forever()
"#
                );
                Command::new(python_path)
                    .args(["-c", &script])
                    .current_dir(worktree)
                    .spawn()
                    .map_err(|e| format!("failed to start static preview server: {e}"))
            }
            None => Command::new(python_path)
                .args(["-m", "http.server", &port.to_string(), "--bind", "127.0.0.1"])
                .current_dir(worktree)
                .spawn()
                .map_err(|e| format!("failed to start static preview server: {e}")),
        }
    }
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
        *guard = Some(spawn_dev_server(team_worktree, TEAM_PREVIEW_PORT)?);
        if !wait_for_port_open(TEAM_PREVIEW_PORT, Duration::from_secs(15)) {
            return Err("preview server started but never opened its port".to_string());
        }
        Ok(())
    }

    /// Hard restart: kill the tracked dev server and spawn a fresh one, even
    /// if the current child still looks alive (unlike ensure_running, which
    /// no-ops in that case). For the Preview window's "hard restart" action —
    /// forces a clean server against the latest team worktree when a stale or
    /// wedged Vite process is showing outdated content. `wait()` after `kill`
    /// reaps the child and lets it release TEAM_PREVIEW_PORT before the new
    /// one tries to bind it (strictPort would otherwise fail the respawn).
    pub fn restart(&self, team_worktree: &Path) -> Result<(), String> {
        let mut guard = self.child.lock().map_err(|_| "preview server lock poisoned".to_string())?;
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        *guard = Some(spawn_dev_server(team_worktree, TEAM_PREVIEW_PORT)?);
        if !wait_for_port_open(TEAM_PREVIEW_PORT, Duration::from_secs(15)) {
            return Err("preview server restarted but never opened its port".to_string());
        }
        Ok(())
    }

    /// Kills the tracked `npm run dev` child, if any. Called on app exit so
    /// it doesn't orphan a process holding `TEAM_PREVIEW_PORT` after the
    /// window closes (previously nothing ever stopped it).
    pub fn shutdown(&self) {
        let Ok(mut guard) = self.child.lock() else { return };
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
        }
    }
}

impl Default for TeamPreviewServer {
    fn default() -> Self {
        Self::new()
    }
}

/// One `npm run dev` process per chat, so a chat can be previewed on its own
/// worktree without merging into `team` first. Each chat gets its own port,
/// assigned once and reused for the life of the app (never reclaimed across
/// chats — a handful of concurrent chats is the expected scale here).
pub struct ChatPreviewServers {
    children: Mutex<HashMap<String, (Child, u16)>>,
    next_port: AtomicU16,
}

impl ChatPreviewServers {
    pub fn new() -> Self {
        Self { children: Mutex::new(HashMap::new()), next_port: AtomicU16::new(CHAT_PREVIEW_PORT_BASE) }
    }

    /// Starts (or reuses) this chat's dev server, returning the port it's
    /// listening on.
    pub fn ensure_running(&self, chat_id: &str, chat_worktree: &Path) -> Result<u16, String> {
        let mut guard = self.children.lock().map_err(|_| "chat preview servers lock poisoned".to_string())?;
        if let Some((child, port)) = guard.get_mut(chat_id) {
            if matches!(child.try_wait(), Ok(None)) {
                return Ok(*port);
            }
        }
        let port = self.next_port.fetch_add(1, Ordering::SeqCst);
        let child = spawn_dev_server(chat_worktree, port)?;
        guard.insert(chat_id.to_string(), (child, port));
        if !wait_for_port_open(port, Duration::from_secs(15)) {
            return Err("preview server started but never opened its port".to_string());
        }
        Ok(port)
    }

    /// Kills and forgets this chat's dev server, if one is running. Called
    /// when the chat's preview panel is closed, so idle chats don't keep an
    /// `npm run dev` process alive indefinitely in the background.
    pub fn stop(&self, chat_id: &str) {
        let Ok(mut guard) = self.children.lock() else { return };
        if let Some((mut child, _)) = guard.remove(chat_id) {
            let _ = child.kill();
        }
    }

    /// Kills every tracked child. Called on app exit, mirroring
    /// `TeamPreviewServer::shutdown`.
    pub fn shutdown_all(&self) {
        let Ok(mut guard) = self.children.lock() else { return };
        for (_, (mut child, _)) in guard.drain() {
            let _ = child.kill();
        }
    }
}

impl Default for ChatPreviewServers {
    fn default() -> Self {
        Self::new()
    }
}
