use std::path::{Path, PathBuf};

pub const TEAM_BRANCH: &str = "team";

pub fn chat_branch_name(chat_id: &str) -> String {
    format!("chat/{chat_id}")
}

/// Worktrees live as a sibling of the repo root, not inside it — a worktree
/// nested inside the repo it's a worktree of confuses git and this app's own
/// file watching alike. Named after the repo root's own directory (which is
/// the project id, see lib.rs's open_project_repo) so each project gets its
/// own worktrees folder rather than every project sharing one — otherwise
/// switching a project's repo URL leaves another project's worktrees sitting
/// in the same shared directory with no way to tell them apart.
pub fn worktrees_root(repo_root: &Path) -> PathBuf {
    let parent = repo_root.parent().unwrap_or(repo_root);
    let name = repo_root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    parent.join(format!("{name}-worktrees"))
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
        let root = Path::new("/Users/josh/projects/proj-1");
        let path = chat_worktree_path(root, "abc123");
        assert_eq!(path, Path::new("/Users/josh/projects/proj-1-worktrees/abc123"));
    }

    #[test]
    fn team_worktree_path_is_named_team() {
        let root = Path::new("/Users/josh/projects/proj-1");
        assert_eq!(team_worktree_path(root), Path::new("/Users/josh/projects/proj-1-worktrees/team"));
    }

    #[test]
    fn worktrees_root_is_scoped_per_project() {
        let proj_a = Path::new("/Users/josh/projects/proj-a");
        let proj_b = Path::new("/Users/josh/projects/proj-b");
        assert_ne!(worktrees_root(proj_a), worktrees_root(proj_b));
    }
}
