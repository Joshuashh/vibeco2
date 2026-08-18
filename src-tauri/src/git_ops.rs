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

pub fn render_preview(root: &Path, chat_id: &str) -> Result<MergeOutcome, String> {
    let chat_path = merge_paths::chat_worktree_path(root, chat_id);
    if !chat_path.exists() {
        return Err(format!("no worktree for chat {chat_id} — call ensure_chat_worktree first"));
    }

    // Commit whatever's currently in the chat's worktree, if anything changed.
    run_git(&chat_path, &["add", "-A"])?;
    let status = run_git(&chat_path, &["status", "--porcelain"])?;
    if !String::from_utf8_lossy(&status.stdout).trim().is_empty() {
        let message = format!("chat/{chat_id}: render preview");
        let commit = run_git(&chat_path, &["commit", "-m", &message])?;
        if !commit.status.success() {
            return Err(format!("git commit failed: {}", String::from_utf8_lossy(&commit.stderr)));
        }
    }

    let branch = merge_paths::chat_branch_name(chat_id);
    let push = run_git(&chat_path, &["push", "-u", "origin", &branch])?;
    if !push.status.success() {
        return Err(format!("git push failed: {}", String::from_utf8_lossy(&push.stderr)));
    }

    let team_path = ensure_team_worktree(root)?;

    // Pick up anyone else's already-pushed merges before adding ours.
    let fetch = run_git(&team_path, &["fetch", "origin", TEAM_BRANCH])?;
    if !fetch.status.success() {
        return Err(format!("git fetch failed: {}", String::from_utf8_lossy(&fetch.stderr)));
    }
    let ff = run_git(&team_path, &["merge", "--ff-only", &format!("origin/{TEAM_BRANCH}")])?;
    if !ff.status.success() {
        return Err(format!(
            "failed to fast-forward team branch: {}",
            String::from_utf8_lossy(&ff.stderr)
        ));
    }

    let merge = run_git(&team_path, &["merge", "--no-edit", &branch])?;
    if !merge.status.success() {
        let conflicted = run_git(&team_path, &["diff", "--name-only", "--diff-filter=U"])?;
        let files: Vec<String> = String::from_utf8_lossy(&conflicted.stdout)
            .lines()
            .map(|s| s.to_string())
            .collect();
        run_git(&team_path, &["merge", "--abort"])?;
        return Ok(MergeOutcome::Conflict { files });
    }

    let push_team = run_git(&team_path, &["push", "origin", TEAM_BRANCH])?;
    if !push_team.status.success() {
        return Err(format!("git push (team) failed: {}", String::from_utf8_lossy(&push_team.stderr)));
    }

    Ok(MergeOutcome::Clean)
}

pub fn promote_to_main(root: &Path) -> Result<(), String> {
    let fetch = run_git(root, &["fetch", "origin", TEAM_BRANCH])?;
    if !fetch.status.success() {
        return Err(format!("git fetch failed: {}", String::from_utf8_lossy(&fetch.stderr)));
    }
    // `main` only ever advances by fast-forward through this path — git
    // itself refuses the push if that's not possible, which is exactly the
    // safety net we want if that invariant is ever violated by mistake.
    let push = run_git(root, &["push", "origin", &format!("origin/{TEAM_BRANCH}:main")])?;
    if !push.status.success() {
        return Err(format!(
            "promotion failed (main may have moved — pull and retry): {}",
            String::from_utf8_lossy(&push.stderr)
        ));
    }
    Ok(())
}
