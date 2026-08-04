use std::path::PathBuf;
use std::process::Command;

/// Resolves the path to the `claude` CLI binary.
/// GUI apps on macOS launch with a minimal PATH, so we check common
/// install locations first, then fall back to the user's login shell
/// (`which claude` under `sh -lic`) which picks up nvm/homebrew/etc shims.
pub fn resolve_claude_binary() -> Option<PathBuf> {
    let common_paths = ["/usr/local/bin/claude", "/opt/homebrew/bin/claude"];
    for path in common_paths {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    let output = Command::new("sh").arg("-lic").arg("which claude").output().ok()?;

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
}
