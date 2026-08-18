use crate::merge_paths::{self, TEAM_BRANCH};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

#[derive(Debug, PartialEq)]
pub enum MergeOutcome {
    Clean,
    Conflict { files: Vec<String> },
}

pub fn repo_root() -> Result<PathBuf, String> {
    let output = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    if !output.status.success() {
        return Err("not inside a git repository".to_string());
    }
    let path = String::from_utf8(output.stdout).map_err(|e| e.to_string())?;
    Ok(PathBuf::from(path.trim()))
}

fn run_git(dir: &Path, args: &[&str]) -> Result<Output, String> {
    Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .map_err(|e| format!("failed to run `git {}`: {e}", args.join(" ")))
}

fn branch_exists(root: &Path, branch: &str) -> bool {
    run_git(root, &["rev-parse", "--verify", "--quiet", branch])
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn ensure_chat_worktree(root: &Path, chat_id: &str) -> Result<PathBuf, String> {
    let path = merge_paths::chat_worktree_path(root, chat_id);
    if path.exists() {
        return Ok(path);
    }
    let branch = merge_paths::chat_branch_name(chat_id);
    let path_str = path.to_string_lossy().to_string();
    let output = if branch_exists(root, &branch) {
        run_git(root, &["worktree", "add", &path_str, &branch])?
    } else {
        run_git(root, &["worktree", "add", "-b", &branch, &path_str, "main"])?
    };
    if !output.status.success() {
        return Err(format!("git worktree add failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    Ok(path)
}

pub fn remove_chat_worktree(root: &Path, chat_id: &str) -> Result<(), String> {
    let path = merge_paths::chat_worktree_path(root, chat_id);
    if !path.exists() {
        return Ok(());
    }
    let path_str = path.to_string_lossy().to_string();
    let output = run_git(root, &["worktree", "remove", "--force", &path_str])?;
    if !output.status.success() {
        return Err(format!("git worktree remove failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    Ok(())
}

pub fn ensure_team_worktree(root: &Path) -> Result<PathBuf, String> {
    let path = merge_paths::team_worktree_path(root);
    if path.exists() {
        return Ok(path);
    }
    let path_str = path.to_string_lossy().to_string();
    let output = if branch_exists(root, TEAM_BRANCH) {
        run_git(root, &["worktree", "add", &path_str, TEAM_BRANCH])?
    } else {
        run_git(root, &["worktree", "add", "-b", TEAM_BRANCH, &path_str, "main"])?
    };
    if !output.status.success() {
        return Err(format!("git worktree add failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    Ok(path)
}
