use std::path::{Path, PathBuf};

pub const TEAM_BRANCH: &str = "team";

pub fn chat_branch_name(chat_id: &str) -> String {
    format!("chat/{chat_id}")
}

/// Worktrees live as siblings of the repo root, not inside it — a worktree
/// nested inside the repo it's a worktree of confuses git and this app's own
/// file watching alike.
pub fn worktrees_root(repo_root: &Path) -> PathBuf {
    repo_root.parent().unwrap_or(repo_root).join("vibeco-worktrees")
}

pub fn chat_worktree_path(repo_root: &Path, chat_id: &str) -> PathBuf {
    worktrees_root(repo_root).join(chat_id)
}

pub fn team_worktree_path(repo_root: &Path) -> PathBuf {
    worktrees_root(repo_root).join(TEAM_BRANCH)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_branch_name_is_namespaced() {
        assert_eq!(chat_branch_name("abc123"), "chat/abc123");
    }

    #[test]
    fn chat_worktree_path_is_a_sibling_of_repo_root() {
        let root = Path::new("/Users/josh/Vibeco");
        let path = chat_worktree_path(root, "abc123");
        assert_eq!(path, Path::new("/Users/josh/vibeco-worktrees/abc123"));
    }

    #[test]
    fn team_worktree_path_is_named_team() {
        let root = Path::new("/Users/josh/Vibeco");
        assert_eq!(team_worktree_path(root), Path::new("/Users/josh/vibeco-worktrees/team"));
    }
}
