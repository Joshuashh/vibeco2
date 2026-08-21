use std::path::PathBuf;
use std::process::Command;

/// Resolves the path to the `claude` CLI binary.
/// GUI apps on macOS launch with a minimal PATH, so we check common
/// install locations first, then fall back to the user's actual login
/// shell (`which claude` under `<$SHELL> -lic`) which picks up
/// nvm/homebrew/`~/.local/bin`/etc shims. This must be the user's real
/// shell (from $SHELL), not a hardcoded `sh` — `sh -lic` does not source
/// `~/.zshrc`, so on a zsh machine any PATH additions made only there
/// (e.g. `~/.local/bin`, where the official installer puts `claude`)
/// are invisible to it.
pub fn resolve_claude_binary() -> Option<PathBuf> {
    let common_paths = ["/usr/local/bin/claude", "/opt/homebrew/bin/claude"];
    for path in common_paths {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = Command::new(shell).arg("-lic").arg("which claude").output().ok()?;

    if !output.status.success() {
        return None;
    }

    let path_str = String::from_utf8(output.stdout).ok()?;
    let trimmed = path_str.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(PathBuf::from(trimmed))
}

/// Same PATH problem as `resolve_claude_binary`, for `node` — needed to run
/// the permission-prompt MCP server script (see permission_bridge.rs).
pub fn resolve_node_binary() -> Option<PathBuf> {
    let common_paths = ["/usr/local/bin/node", "/opt/homebrew/bin/node"];
    for path in common_paths {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = Command::new(shell).arg("-lic").arg("which node").output().ok()?;

    if !output.status.success() {
        return None;
    }

    let path_str = String::from_utf8(output.stdout).ok()?;
    let trimmed = path_str.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(PathBuf::from(trimmed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_finds_something_on_this_dev_machine() {
        // This machine has `claude` installed (required to develop Vibeco2 at all).
        let result = resolve_claude_binary();
        assert!(result.is_some(), "expected to find a claude binary on PATH or in common install dirs");
    }

    #[test]
    fn resolve_node_finds_something_on_this_dev_machine() {
        // This machine has `node` installed (required to run `npm run dev` at all).
        let result = resolve_node_binary();
        assert!(result.is_some(), "expected to find a node binary on PATH or in common install dirs");
    }
}
