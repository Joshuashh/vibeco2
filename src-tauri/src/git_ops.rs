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

fn current_origin_url(dir: &Path) -> Option<String> {
    let output = run_git(dir, &["remote", "get-url", "origin"]).ok()?;
    if !output.status.success() {
        return None;
    }
    let url = String::from_utf8(output.stdout).ok()?;
    Some(url.trim().to_string())
}

/// Makes `local_root` the active project repo for all subsequent
/// repo_root() calls — cloning `repo_url` into it first if nothing's there
/// yet. Relies on the same local git credentials (SSH key / credential
/// helper) a manual `git clone`/`git push` would use; there's no separate
/// GitHub auth in this app.
pub fn open_project_repo(local_root: &Path, repo_url: &str) -> Result<(), String> {
    // A project id's local clone can end up pointed at a different repo
    // entirely (the user edited the project's GitHub URL) — `remote set-url`
    // alone leaves every file, branch, and worktree on disk as the *old*
    // repo's content, which nothing downstream can reconcile with the new
    // one. Detect the mismatch and start over clean rather than mixing two
    // repos' history under one project id. Also self-heals a corrupted or
    // half-cloned directory, since an unreadable origin counts as a mismatch.
    if local_root.exists() && current_origin_url(local_root).as_deref() != Some(repo_url) {
        std::fs::remove_dir_all(local_root).map_err(|e| e.to_string())?;
        let worktrees = merge_paths::worktrees_root(local_root);
        if worktrees.exists() {
            std::fs::remove_dir_all(&worktrees).map_err(|e| e.to_string())?;
        }
    }

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
            let stderr = String::from_utf8_lossy(&clone.stderr);
            // Teammates clone with their own git credentials, so a private
            // repo they haven't been given access to fails here — say so
            // rather than just dumping git's "Permission denied (publickey)".
            let denied = stderr.contains("Permission denied")
                || stderr.contains("not found")
                || stderr.contains("Could not read from remote");
            let hint = if denied {
                "\n\nIf this repo is private, ask its owner to add you as a collaborator on GitHub, and check your SSH key / gh auth is set up."
            } else {
                ""
            };
            return Err(format!("git clone failed: {stderr}{hint}"));
        }
        local_root.to_path_buf()
    };
    // A brand-new GitHub repo with nothing pushed yet clones down with no
    // commits at all -- there's no branch for a chat worktree to base off
    // of, which is what actually produced "invalid reference: main"
    // (default_branch() has nothing to resolve when no ref exists anywhere).
    // Plain git, not the GitHub API, fixes this the same way for any host:
    // give the repo one real commit and push it before anything else runs.
    if is_repo_empty(&root) {
        bootstrap_empty_repo(&root)?;
    }
    *ACTIVE_REPO.lock().unwrap() = Some(root);
    Ok(())
}

fn is_repo_empty(root: &Path) -> bool {
    run_git(root, &["rev-parse", "--verify", "-q", "HEAD"])
        .map(|o| !o.status.success())
        .unwrap_or(true)
}

// Filename must match claude_process::PREVIEW_TRACKER_FILENAME — that's the
// name Claude is told to reference in a <script> tag, this is the name the
// file actually gets written under.
const PREVIEW_TRACKER_FILENAME: &str = "vibeco-preview-tracker.js";

// Reports the page currently showing inside the preview iframe back to the
// app via postMessage — the iframe is cross-origin (different port) from
// the app's own UI, so there's no other way for the app to know which page
// of a multi-page/SPA project is on screen right now, which is what lets
// the Preview panel scope pinned comments to the page they were left on.
const PREVIEW_TRACKER_SCRIPT: &str = r#"(function () {
  function report() {
    try {
      window.parent.postMessage({ type: "vibeco-preview-path", path: location.pathname }, "*");
    } catch (e) {}
  }
  report();
  window.addEventListener("popstate", report);
  var origPushState = history.pushState;
  history.pushState = function () {
    origPushState.apply(this, arguments);
    report();
  };
  var origReplaceState = history.replaceState;
  history.replaceState = function () {
    origReplaceState.apply(this, arguments);
    report();
  };
  // "Hard reset" from the Preview window: the app is cross-origin from this
  // page so it can't clear our storage directly, but it can postMessage us to
  // do it. Wiping localStorage/sessionStorage and reloading makes the page
  // behave like a brand-new first visit (e.g. a one-time onboarding modal
  // gated on a localStorage flag shows again), which a dev-server restart
  // alone never does.
  window.addEventListener("message", function (e) {
    if (!e.data || e.data.type !== "vibeco-reset-storage") return;
    try { localStorage.clear(); } catch (err) {}
    try { sessionStorage.clear(); } catch (err) {}
    location.reload();
  });
})();
"#;

/// Writes the current preview-tracker script into `dir`, overwriting any
/// older copy. Used both when bootstrapping a fresh repo and by the Preview
/// window's hard reset — an existing project whose committed tracker predates
/// a script change (e.g. before the reset-storage handler existed) still gets
/// the latest served once the dev server restarts against the refreshed file.
pub fn write_preview_tracker(dir: &Path) -> Result<(), String> {
    std::fs::write(dir.join(PREVIEW_TRACKER_FILENAME), PREVIEW_TRACKER_SCRIPT).map_err(|e| e.to_string())
}

/// Creates and pushes the initial commit on whatever branch a fresh clone's
/// HEAD already points to (git decides that name via the remote's reported
/// default, or the local `init.defaultBranch` config if the remote has no
/// opinion either -- not hardcoded here). The only content seeded is the
/// preview-tracking script -- no project structure is invented; a chat's
/// own first message is what actually builds the project.
fn bootstrap_empty_repo(root: &Path) -> Result<(), String> {
    let branch = run_git(root, &["symbolic-ref", "--short", "HEAD"])
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "main".to_string());

    write_preview_tracker(root)?;
    let add = run_git(root, &["add", PREVIEW_TRACKER_FILENAME])?;
    if !add.status.success() {
        return Err(format!("git add failed: {}", String::from_utf8_lossy(&add.stderr)));
    }
    let commit = run_git(root, &["commit", "-m", "Initial commit"])?;
    if !commit.status.success() {
        return Err(format!("failed to create initial commit: {}", String::from_utf8_lossy(&commit.stderr)));
    }
    let push = run_git(root, &["push", "-u", "origin", &branch])?;
    if !push.status.success() {
        return Err(format!("failed to push initial commit: {}", String::from_utf8_lossy(&push.stderr)));
    }
    // A truly empty remote has no default-branch opinion for `clone` to pick
    // up as origin/HEAD -- set it now that one exists, so default_branch()
    // resolves normally on every call after this one.
    let _ = run_git(root, &["remote", "set-head", "origin", &branch]);
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

/// Whether `branch` exists on `origin` right now, per the remote itself —
/// not this checkout's possibly-stale `origin/<branch>` tracking ref, which
/// only reflects the last fetch and doesn't exist at all until one succeeds.
fn remote_branch_exists(root: &Path, branch: &str) -> bool {
    run_git(root, &["ls-remote", "--exit-code", "origin", &format!("refs/heads/{branch}")])
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// The project repo's actual default branch — not assumed to be literally
/// "main". A `git clone` sets `refs/remotes/origin/HEAD` as a symref to
/// whatever the remote's default branch really is (main, master, trunk,
/// whatever), so that's the source of truth. Falls back to checking for a
/// local `main` or `master`, then to "main" as a last resort, so worktree
/// creation still does *something* sane if that lookup ever fails.
fn default_branch(root: &Path) -> String {
    if let Ok(output) = run_git(root, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]) {
        if output.status.success() {
            let full = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if let Some(name) = full.strip_prefix("origin/") {
                if !name.is_empty() {
                    return name.to_string();
                }
            }
        }
    }
    if branch_exists(root, "main") {
        "main".to_string()
    } else if branch_exists(root, "master") {
        "master".to_string()
    } else {
        "main".to_string()
    }
}

/// Where `branch` is currently checked out, if any worktree has it — git
/// refuses to `worktree add` a branch that's already checked out elsewhere,
/// so callers use this to relocate instead of failing. Needed because
/// `merge_paths::worktrees_root`'s layout has changed before (shared folder
/// -> per-project folder) and could again; an existing chat's worktree can
/// end up at a path this app no longer computes for it.
fn find_worktree_for_branch(root: &Path, branch: &str) -> Option<PathBuf> {
    let output = run_git(root, &["worktree", "list", "--porcelain"]).ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let target = format!("refs/heads/{branch}");
    let mut current_path: Option<PathBuf> = None;
    for line in text.lines() {
        if let Some(p) = line.strip_prefix("worktree ") {
            current_path = Some(PathBuf::from(p));
        } else if let Some(b) = line.strip_prefix("branch ") {
            if b == target {
                return current_path;
            }
        } else if line.is_empty() {
            current_path = None;
        }
    }
    None
}

/// `git worktree add <path> <branch>` for a branch that already has a
/// worktree — relocates the existing worktree to `path` if it's not there
/// already, rather than erroring, since the caller's expected path for a
/// branch can change (see `find_worktree_for_branch`) even though the
/// worktree itself is still perfectly usable.
fn add_or_relocate_worktree(root: &Path, path: &Path, branch: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if let Some(existing) = find_worktree_for_branch(root, branch) {
        if existing == path {
            return Ok(());
        }
        let mv = run_git(root, &["worktree", "move", &existing.to_string_lossy(), &path.to_string_lossy()])?;
        if !mv.status.success() {
            return Err(format!("git worktree move failed: {}", String::from_utf8_lossy(&mv.stderr)));
        }
        return Ok(());
    }
    let output = run_git(root, &["worktree", "add", &path.to_string_lossy(), branch])?;
    if !output.status.success() {
        return Err(format!("git worktree add failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    Ok(())
}

pub fn ensure_chat_worktree(root: &Path, chat_id: &str) -> Result<PathBuf, String> {
    let path = merge_paths::chat_worktree_path(root, chat_id);
    if path.exists() {
        return Ok(path);
    }
    let branch = merge_paths::chat_branch_name(chat_id);
    if branch_exists(root, &branch) {
        add_or_relocate_worktree(root, &path, &branch)?;
    } else {
        let path_str = path.to_string_lossy().to_string();
        let output = run_git(root, &["worktree", "add", "-b", &branch, &path_str, &default_branch(root)])?;
        if !output.status.success() {
            return Err(format!("git worktree add failed: {}", String::from_utf8_lossy(&output.stderr)));
        }
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
    let remote_branch = format!("origin/{TEAM_BRANCH}");
    if branch_exists(root, TEAM_BRANCH) {
        add_or_relocate_worktree(root, &path, TEAM_BRANCH)?;
    } else {
        let path_str = path.to_string_lossy().to_string();
        let output = if branch_exists(root, &remote_branch) {
            run_git(root, &["worktree", "add", "-b", TEAM_BRANCH, &path_str, &remote_branch])?
        } else {
            run_git(root, &["worktree", "add", "-b", TEAM_BRANCH, &path_str, &default_branch(root)])?
        };
        if !output.status.success() {
            return Err(format!("git worktree add failed: {}", String::from_utf8_lossy(&output.stderr)));
        }
    }
    Ok(path)
}

/// Whatever `team` we know about right now — local first, then the remote
/// copy, falling back to the repo's actual default branch if `team` doesn't
/// exist yet at all.
fn team_ref(root: &Path) -> String {
    if branch_exists(root, TEAM_BRANCH) {
        TEAM_BRANCH.to_string()
    } else if branch_exists(root, &format!("origin/{TEAM_BRANCH}")) {
        format!("origin/{TEAM_BRANCH}")
    } else {
        default_branch(root)
    }
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
    let count = run_git(root, &["rev-list", "--count", &format!("{}..{branch}", team_ref(root))])?;
    if !count.status.success() {
        // This check exists specifically to gate a destructive delete — a
        // command failure here must not read as "confirmed nothing to lose".
        return Err(format!("git rev-list failed: {}", String::from_utf8_lossy(&count.stderr)));
    }
    let unmerged: u32 = String::from_utf8_lossy(&count.stdout).trim().parse().unwrap_or(0);
    Ok(unmerged > 0)
}

/// Commits whatever's currently in the chat's worktree (if anything changed)
/// and pushes the chat branch to origin. This is the "add to queue" half of
/// what used to be a single `render_preview` call — it deliberately stops
/// here and does not touch `team`, so queueing a change no longer ships it;
/// only `merge_chat_into_team` (called at publish time) does that.
pub fn commit_and_push_chat_branch(root: &Path, chat_id: &str) -> Result<(), String> {
    let chat_path = ensure_chat_worktree(root, chat_id)?;

    run_git(&chat_path, &["add", "-A"])?;
    let status = run_git(&chat_path, &["status", "--porcelain"])?;
    if !String::from_utf8_lossy(&status.stdout).trim().is_empty() {
        let message = format!("chat/{chat_id}: queue for publish");
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
    Ok(())
}

// Capped so a genuinely huge diff (a big refactor, a lockfile churn) doesn't
// blow up the summarization prompt — a truncated diff still gives Claude
// enough to describe the shape of the change, just not every last line.
const MAX_DIFF_CHARS: usize = 20_000;

/// Everything currently on the chat branch that isn't in `team` yet, as a
/// unified diff — i.e. what this chat would actually add if merged right
/// now. Used to feed the AI queue-summary; deliberately diffs against
/// `team`'s current state (not a separately tracked "last queued" marker),
/// so the diff naturally shrinks to just the new work once a prior queue of
/// this same chat actually gets published and `team` moves forward.
pub fn diff_since_team(root: &Path, chat_id: &str) -> Result<String, String> {
    let chat_path = ensure_chat_worktree(root, chat_id)?;
    let branch = merge_paths::chat_branch_name(chat_id);
    let diff = run_git(&chat_path, &["diff", &format!("{}...{branch}", team_ref(root))])?;
    if !diff.status.success() {
        return Err(format!("git diff failed: {}", String::from_utf8_lossy(&diff.stderr)));
    }
    let text = String::from_utf8_lossy(&diff.stdout).into_owned();
    Ok(if text.len() > MAX_DIFF_CHARS {
        format!("{}\n… (diff truncated, {} chars total)", &text[..MAX_DIFF_CHARS], text.len())
    } else {
        text
    })
}

/// Merges an already-queued (committed + pushed) chat branch into `team` and
/// pushes it — the "publish" half of what used to be a single
/// `render_preview` call. Assumes `commit_and_push_chat_branch` already ran
/// for this chat; does not commit or push the chat branch itself.
pub fn merge_chat_into_team(root: &Path, chat_id: &str) -> Result<MergeOutcome, String> {
    let branch = merge_paths::chat_branch_name(chat_id);
    let team_path = ensure_team_worktree(root)?;

    // Two chats can render at once, both racing to push `team`. Git's own
    // fast-forward check is the real lock — whichever push loses just needs
    // to resync and retry rather than surface a raw error, so retry a few
    // times against a fresh `origin/team` instead of failing on the first loss.
    const MAX_ATTEMPTS: u32 = 5;
    for attempt in 1..=MAX_ATTEMPTS {
        // Pick up anyone else's already-pushed merges before adding ours —
        // but only if `team` has actually reached origin yet. The very first
        // merge for a brand-new project hasn't pushed it there yet (only
        // created locally, by ensure_team_worktree above), and `git fetch` of
        // a ref the remote has never heard of is a hard error, not "nothing
        // to fetch". `reset --hard` (not `merge --ff-only`) because a losing
        // retry's local `team` branch has a merge commit that never made it
        // to origin — this worktree only ever holds merges it's about to
        // push below, never independent work of its own, so discarding it is
        // safe.
        if remote_branch_exists(&team_path, TEAM_BRANCH) {
            let fetch = run_git(&team_path, &["fetch", "origin", TEAM_BRANCH])?;
            if !fetch.status.success() {
                return Err(format!("git fetch failed: {}", String::from_utf8_lossy(&fetch.stderr)));
            }
            let sync = run_git(&team_path, &["reset", "--hard", &format!("origin/{TEAM_BRANCH}")])?;
            if !sync.status.success() {
                return Err(format!("failed to sync team branch: {}", String::from_utf8_lossy(&sync.stderr)));
            }
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

        let push_team = run_git(&team_path, &["push", "-u", "origin", TEAM_BRANCH])?;
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

/// "Resolve" step for a conflicted queue item: merges `team`'s current state
/// into the chat's own branch, in its own worktree, so any real conflict
/// lands as ordinary conflict markers in that chat's files — the same place
/// the chat's agent (or the user) already edits — instead of just being
/// reported. If `team` has moved on since the conflict was first reported
/// and now merges cleanly, commits and pushes immediately: nothing further
/// to fix.
pub fn start_conflict_resolution(root: &Path, chat_id: &str) -> Result<MergeOutcome, String> {
    let chat_path = ensure_chat_worktree(root, chat_id)?;
    let team = team_ref(&chat_path);
    if remote_branch_exists(&chat_path, TEAM_BRANCH) {
        let _ = run_git(&chat_path, &["fetch", "origin", TEAM_BRANCH]);
    }
    let merge = run_git(&chat_path, &["merge", "--no-edit", &team])?;
    if merge.status.success() {
        let branch = merge_paths::chat_branch_name(chat_id);
        let push = run_git(&chat_path, &["push", "-u", "origin", &branch])?;
        if !push.status.success() {
            return Err(format!("git push failed: {}", String::from_utf8_lossy(&push.stderr)));
        }
        return Ok(MergeOutcome::Clean);
    }
    let conflicted = run_git(&chat_path, &["diff", "--name-only", "--diff-filter=U"])?;
    let files: Vec<String> = String::from_utf8_lossy(&conflicted.stdout)
        .lines()
        .map(|s| s.to_string())
        .collect();
    Ok(MergeOutcome::Conflict { files })
}

/// "Check" step: called after the user (or the chat's agent) has fixed the
/// conflict markers left by `start_conflict_resolution` and saved the
/// files. Still-unmerged paths are reported the same way as before;
/// otherwise the in-progress merge commit is finished and pushed, so the
/// queue item can go back to "queued" and the normal publish button takes
/// over from there.
pub fn check_conflict_resolution(root: &Path, chat_id: &str) -> Result<MergeOutcome, String> {
    let chat_path = ensure_chat_worktree(root, chat_id)?;
    let merge_head = run_git(&chat_path, &["rev-parse", "-q", "--verify", "MERGE_HEAD"])?;
    if !merge_head.status.success() {
        return Err("No resolution in progress for this chat — click Resolve first.".to_string());
    }
    let conflicted = run_git(&chat_path, &["diff", "--name-only", "--diff-filter=U"])?;
    let files: Vec<String> = String::from_utf8_lossy(&conflicted.stdout)
        .lines()
        .map(|s| s.to_string())
        .collect();
    if !files.is_empty() {
        return Ok(MergeOutcome::Conflict { files });
    }
    run_git(&chat_path, &["add", "-A"])?;
    let commit = run_git(&chat_path, &["commit", "--no-edit"])?;
    if !commit.status.success() {
        return Err(format!("git commit failed: {}", String::from_utf8_lossy(&commit.stderr)));
    }
    let branch = merge_paths::chat_branch_name(chat_id);
    let push = run_git(&chat_path, &["push", "-u", "origin", &branch])?;
    if !push.status.success() {
        return Err(format!("git push failed: {}", String::from_utf8_lossy(&push.stderr)));
    }
    Ok(MergeOutcome::Clean)
}

/// True if `origin/team` has commits this machine's local team worktree
/// doesn't have yet — e.g. a teammate merged on their machine and pushed.
/// `git fetch` alone doesn't touch the worktree's files, so this is safe to
/// poll from the Preview tab without disturbing whatever's currently
/// rendering there.
pub fn team_preview_has_update(root: &Path) -> Result<bool, String> {
    let team_path = ensure_team_worktree(root)?;
    if !remote_branch_exists(&team_path, TEAM_BRANCH) {
        return Ok(false);
    }
    let fetch = run_git(&team_path, &["fetch", "origin", TEAM_BRANCH])?;
    if !fetch.status.success() {
        return Err(format!("git fetch failed: {}", String::from_utf8_lossy(&fetch.stderr)));
    }
    let local = run_git(&team_path, &["rev-parse", TEAM_BRANCH])?;
    let remote = run_git(&team_path, &["rev-parse", &format!("origin/{TEAM_BRANCH}")])?;
    Ok(String::from_utf8_lossy(&local.stdout).trim() != String::from_utf8_lossy(&remote.stdout).trim())
}

/// Fast-forwards this machine's local team worktree to match `origin/team`.
/// Safe as a hard reset (not a merge) for the same reason merge_chat_into_team's
/// own resync is: this worktree only ever holds merges that already made it
/// to origin, never independent local work. The already-running team preview
/// server (see preview_server.rs) is a long-lived `npm run dev` watching this
/// directory — Vite's own file watcher picks up the changed files and
/// hot-reloads on its own; the frontend still bumps the iframe's key for a
/// hard reload afterward since HMR doesn't always re-render everything a
/// fresh load would.
pub fn pull_team_preview_update(root: &Path) -> Result<(), String> {
    let team_path = ensure_team_worktree(root)?;
    let fetch = run_git(&team_path, &["fetch", "origin", TEAM_BRANCH])?;
    if !fetch.status.success() {
        return Err(format!("git fetch failed: {}", String::from_utf8_lossy(&fetch.stderr)));
    }
    let sync = run_git(&team_path, &["reset", "--hard", &format!("origin/{TEAM_BRANCH}")])?;
    if !sync.status.success() {
        return Err(format!("failed to sync team branch: {}", String::from_utf8_lossy(&sync.stderr)));
    }
    Ok(())
}

pub fn promote_to_main(root: &Path) -> Result<(), String> {
    let fetch = run_git(root, &["fetch", "origin", TEAM_BRANCH])?;
    if !fetch.status.success() {
        return Err(format!("git fetch failed: {}", String::from_utf8_lossy(&fetch.stderr)));
    }
    let main = default_branch(root);
    // `main` only ever advances by fast-forward through this path — git
    // itself refuses the push if that's not possible, which is exactly the
    // safety net we want if that invariant is ever violated by mistake.
    let push = run_git(root, &["push", "origin", &format!("origin/{TEAM_BRANCH}:{main}")])?;
    if !push.status.success() {
        return Err(format!(
            "promotion failed ({main} may have moved — pull and retry): {}",
            String::from_utf8_lossy(&push.stderr)
        ));
    }
    // The remote `main` is now current; also advance the local `main` ref in
    // *this* checkout (`root`) so `ensure_chat_worktree` branches new chats
    // off what was just promoted instead of an increasingly stale snapshot.
    // Best-effort — the promotion itself already succeeded above.
    advance_local_main(root, &main);
    Ok(())
}

/// The current `origin/team` and `origin/<default>` commit SHAs, after a
/// best-effort fetch. The Preview tab's promote gate uses these to tell
/// whether team is ahead of main at all, and to bind approvals to the exact
/// commit being promoted (a later merge into team moves the sha and
/// invalidates prior approvals). Fetch-only — never touches worktree files.
pub fn team_and_main_shas(root: &Path) -> Result<(String, String), String> {
    let team_path = ensure_team_worktree(root)?;
    let main = default_branch(root);
    // Offline shouldn't hard-fail the gate — fall back to local refs below.
    let _ = run_git(&team_path, &["fetch", "origin", TEAM_BRANCH, &main]);

    let team_sha = rev_parse(&team_path, &format!("origin/{TEAM_BRANCH}"))
        .or_else(|| rev_parse(&team_path, TEAM_BRANCH))
        .unwrap_or_default();
    let main_sha = rev_parse(&team_path, &format!("origin/{main}"))
        .or_else(|| rev_parse(&team_path, &main))
        .unwrap_or_default();
    Ok((team_sha, main_sha))
}

fn rev_parse(dir: &Path, rev: &str) -> Option<String> {
    let out = run_git(dir, &["rev-parse", "--verify", "--quiet", rev]).ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}

fn advance_local_main(root: &Path, main: &str) {
    let Ok(fetch_main) = run_git(root, &["fetch", "origin", main]) else { return };
    if !fetch_main.status.success() {
        return;
    }
    let on_main = run_git(root, &["symbolic-ref", "--short", "-q", "HEAD"])
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == main)
        .unwrap_or(false);
    if on_main {
        // Fast-forwards the working tree too, not just the ref.
        let _ = run_git(root, &["merge", "--ff-only", &format!("origin/{main}")]);
    } else {
        // `main` isn't checked out here, so moving the ref directly is safe.
        let _ = run_git(root, &["update-ref", &format!("refs/heads/{main}"), &format!("origin/{main}")]);
    }
}

// The Vibeco2 app's own source checkout — deliberately independent of
// ACTIVE_REPO (whichever *project* repo a user has open for their chats).
// CARGO_MANIFEST_DIR is baked in at compile time (this crate's own
// src-tauri/ dir), so it names the app's real source location regardless of
// what project happens to be active or what the process's cwd is.
fn app_repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri always has a parent directory")
        .to_path_buf()
}

/// True if `origin/main` has commits this checkout doesn't (a plain
/// `git fetch` + `rev-list` — no auth beyond whatever `git pull` would
/// already use locally).
pub fn check_for_app_update() -> Result<bool, String> {
    let root = app_repo_root();
    let fetch = run_git(&root, &["fetch", "origin", "main", "--quiet"])?;
    if !fetch.status.success() {
        return Err(format!("git fetch failed: {}", String::from_utf8_lossy(&fetch.stderr)));
    }
    let behind = run_git(&root, &["rev-list", "--count", "HEAD..origin/main"])?;
    if !behind.status.success() {
        return Err(format!("git rev-list failed: {}", String::from_utf8_lossy(&behind.stderr)));
    }
    let count: u32 = String::from_utf8_lossy(&behind.stdout).trim().parse().unwrap_or(0);
    Ok(count > 0)
}

/// Fast-forwards the app's own checkout to `origin/main`. Left as a plain
/// `git pull` rather than anything fancier — `tauri dev`'s own file
/// watcher picks up the changed files on disk and rebuilds/reloads from
/// there, so this only has to get the source current. Fails (rather than
/// stashing/discarding anything) if local changes conflict, same as running
/// `git pull` by hand would.
pub fn pull_app_update() -> Result<(), String> {
    let root = app_repo_root();
    let pull = run_git(&root, &["pull", "origin", "main", "--ff-only"])?;
    if !pull.status.success() {
        return Err(format!("git pull failed: {}", String::from_utf8_lossy(&pull.stderr)));
    }
    Ok(())
}
