use crate::merge_paths::{self, TEAM_BRANCH};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::Mutex;

#[derive(Debug, PartialEq)]
pub enum MergeOutcome {
    Clean,
    Conflict { files: Vec<String> },
}

// Set once per project selection (see open_project_repo / lib.rs's
// open_project_repo command) so every existing repo_root() call site below
// stays a zero-arg call instead of threading a repo path through every
// Tauri command.
static ACTIVE_REPO: Mutex<Option<PathBuf>> = Mutex::new(None);

fn git_toplevel(dir: &Path) -> Result<PathBuf, String> {
    let output = Command::new("git")
        .current_dir(dir)
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    if !output.status.success() {
        return Err(format!("{} is not inside a git repository", dir.display()));
    }
    let path = String::from_utf8(output.stdout).map_err(|e| e.to_string())?;
    Ok(PathBuf::from(path.trim()))
}

/// Makes `local_root` the active project repo for all subsequent
/// repo_root() calls — cloning `repo_url` into it first if nothing's there
/// yet. Relies on the same local git credentials (SSH key / credential
/// helper) a manual `git clone`/`git push` would use; there's no separate
/// GitHub auth in this app.
pub fn open_project_repo(local_root: &Path, repo_url: &str) -> Result<(), String> {
    let root = if local_root.exists() {
        git_toplevel(local_root)?
    } else {
        let parent = local_root.parent().ok_or("invalid project repo path")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let clone = Command::new("git")
            .args(["clone", repo_url, &local_root.to_string_lossy()])
            .output()
            .map_err(|e| format!("failed to run git clone: {e}"))?;
        if !clone.status.success() {
            return Err(format!("git clone failed: {}", String::from_utf8_lossy(&clone.stderr)));
        }
        local_root.to_path_buf()
    };
    *ACTIVE_REPO.lock().unwrap() = Some(root);
    Ok(())
}

pub fn repo_root() -> Result<PathBuf, String> {
    if let Some(root) = ACTIVE_REPO.lock().unwrap().clone() {
        return Ok(root);
    }
    // Fallback for pre-project-selection callers (none exist today, but
    // keeps behavior sane rather than erroring outright).
    git_toplevel(&std::env::current_dir().map_err(|e| e.to_string())?)
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
    if path.exists() {
        let path_str = path.to_string_lossy().to_string();
        let output = run_git(root, &["worktree", "remove", "--force", &path_str])?;
        if !output.status.success() {
            return Err(format!("git worktree remove failed: {}", String::from_utf8_lossy(&output.stderr)));
        }
    }
    let branch = merge_paths::chat_branch_name(chat_id);
    if branch_exists(root, &branch) {
        let output = run_git(root, &["branch", "-D", &branch])?;
        if !output.status.success() {
            return Err(format!("git branch delete failed: {}", String::from_utf8_lossy(&output.stderr)));
        }
    }
    Ok(())
}

/// Removes any chat worktree/branch left behind for a chat that no longer
/// exists on the frontend's known list — e.g. a prior `remove_chat_worktree`
/// call never completed because the app quit mid-delete, or ran offline.
/// Never touches the `team` worktree or any id still in `known_chat_ids`.
/// Best-effort per entry: one awkward leftover shouldn't block the sweep.
pub fn prune_orphaned_chat_worktrees(root: &Path, known_chat_ids: &[String]) -> Result<(), String> {
    let worktrees_root = merge_paths::worktrees_root(root);
    if !worktrees_root.exists() {
        return Ok(());
    }
    let entries = std::fs::read_dir(&worktrees_root).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name == TEAM_BRANCH || known_chat_ids.iter().any(|id| id == &name) {
            continue;
        }
        let _ = remove_chat_worktree(root, &name);
    }
    Ok(())
}

pub fn ensure_team_worktree(root: &Path) -> Result<PathBuf, String> {
    let path = merge_paths::team_worktree_path(root);
    if path.exists() {
        return Ok(path);
    }
    // Best-effort: pick up an already-pushed team branch from origin before
    // deciding there isn't one yet — otherwise a second machine would branch
    // a fresh, divergent `team` off `main` instead of tracking the real one.
    let _ = run_git(root, &["fetch", "origin", TEAM_BRANCH]);
    let path_str = path.to_string_lossy().to_string();
    let remote_branch = format!("origin/{TEAM_BRANCH}");
    let output = if branch_exists(root, TEAM_BRANCH) {
        run_git(root, &["worktree", "add", &path_str, TEAM_BRANCH])?
    } else if branch_exists(root, &remote_branch) {
        run_git(root, &["worktree", "add", "-b", TEAM_BRANCH, &path_str, &remote_branch])?
    } else {
        run_git(root, &["worktree", "add", "-b", TEAM_BRANCH, &path_str, "main"])?
    };
    if !output.status.success() {
        return Err(format!("git worktree add failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    Ok(path)
}

/// True if deleting this chat's worktree right now would discard work that
/// never made it into `team` — either uncommitted changes, or committed work
/// on the chat branch that was never rendered. Used to gate chat deletion
/// with a warning instead of silently `git worktree remove --force`-ing
/// something like a scope doc that only ever existed on disk in this chat.
pub fn chat_has_unmerged_work(root: &Path, chat_id: &str) -> Result<bool, String> {
    let chat_path = merge_paths::chat_worktree_path(root, chat_id);
    if !chat_path.exists() {
        return Ok(false);
    }

    let status = run_git(&chat_path, &["status", "--porcelain"])?;
    if !String::from_utf8_lossy(&status.stdout).trim().is_empty() {
        return Ok(true);
    }

    let branch = merge_paths::chat_branch_name(chat_id);
    if !branch_exists(root, &branch) {
        return Ok(false);
    }
    // Compare against whatever `team` we know about — local first, then the
    // remote copy, falling back to `main` if `team` doesn't exist yet at all
    // (nothing has ever been rendered, so any commit here is unmerged).
    let team_ref = if branch_exists(root, TEAM_BRANCH) {
        TEAM_BRANCH.to_string()
    } else if branch_exists(root, &format!("origin/{TEAM_BRANCH}")) {
        format!("origin/{TEAM_BRANCH}")
    } else {
        "main".to_string()
    };

    let count = run_git(root, &["rev-list", "--count", &format!("{team_ref}..{branch}")])?;
    if !count.status.success() {
        return Ok(false);
    }
    let unmerged: u32 = String::from_utf8_lossy(&count.stdout).trim().parse().unwrap_or(0);
    Ok(unmerged > 0)
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

    // Two chats can render at once, both racing to push `team`. Git's own
    // fast-forward check is the real lock — whichever push loses just needs
    // to resync and retry rather than surface a raw error, so retry a few
    // times against a fresh `origin/team` instead of failing on the first loss.
    const MAX_ATTEMPTS: u32 = 5;
    for attempt in 1..=MAX_ATTEMPTS {
        // Pick up anyone else's already-pushed merges before adding ours.
        // `reset --hard` (not `merge --ff-only`) because a losing retry's
        // local `team` branch has a merge commit that never made it to
        // origin — this worktree only ever holds merges it's about to push
        // below, never independent work of its own, so discarding it is safe.
        let fetch = run_git(&team_path, &["fetch", "origin", TEAM_BRANCH])?;
        if !fetch.status.success() {
            return Err(format!("git fetch failed: {}", String::from_utf8_lossy(&fetch.stderr)));
        }
        let sync = run_git(&team_path, &["reset", "--hard", &format!("origin/{TEAM_BRANCH}")])?;
        if !sync.status.success() {
            return Err(format!("failed to sync team branch: {}", String::from_utf8_lossy(&sync.stderr)));
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
        if push_team.status.success() {
            return Ok(MergeOutcome::Clean);
        }
        if attempt == MAX_ATTEMPTS {
            return Err(format!(
                "git push (team) failed after {MAX_ATTEMPTS} attempts — repeatedly lost the race to another render, try again: {}",
                String::from_utf8_lossy(&push_team.stderr)
            ));
        }
    }
    unreachable!("loop above always returns by the final attempt")
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
    // The remote `main` is now current; also advance the local `main` ref in
    // *this* checkout (`root`) so `ensure_chat_worktree` branches new chats
    // off what was just promoted instead of an increasingly stale snapshot.
    // Best-effort — the promotion itself already succeeded above.
    advance_local_main(root);
    Ok(())
}

fn advance_local_main(root: &Path) {
    let Ok(fetch_main) = run_git(root, &["fetch", "origin", "main"]) else { return };
    if !fetch_main.status.success() {
        return;
    }
    let on_main = run_git(root, &["symbolic-ref", "--short", "-q", "HEAD"])
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "main")
        .unwrap_or(false);
    if on_main {
        // Fast-forwards the working tree too, not just the ref.
        let _ = run_git(root, &["merge", "--ff-only", "origin/main"]);
    } else {
        // `main` isn't checked out here, so moving the ref directly is safe.
        let _ = run_git(root, &["update-ref", "refs/heads/main", "origin/main"]);
    }
}
