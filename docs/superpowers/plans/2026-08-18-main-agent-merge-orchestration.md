# Main Agent Merge Orchestration (Lite) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every chat its own git worktree/branch, a manual "Render Preview" action that merges a chat's work into a shared `team` branch and reflects it in a live dev-server preview, and an explicit "Promote to main" action — all driven by plain `git` subprocess calls from the existing Tauri backend, with no GitHub Actions, no auto-merge, and no automated test gate.

**Architecture:** Three new Rust modules (`merge_paths.rs` for pure path/branch-name logic, `git_ops.rs` for the actual `git` subprocess calls, `preview_server.rs` for a long-lived `npm run dev` child process) exposed as four new Tauri commands. The frontend calls these commands and writes the result to the already-existing `merge_events` Supabase table, which the already-built `MainAgentInstrument` component already renders — no new UI surface for status, just new buttons that produce real data.

**Tech Stack:** Rust (`std::process::Command`, Tauri commands/managed state), TypeScript/React (existing `invoke`/Supabase patterns), plain `git` CLI (no `gh`, no GitHub API).

---

## Before you start

Read `docs/superpowers/specs/2026-08-18-main-agent-merge-orchestration-design.md` in full — this plan implements it section by section. One deliberate refinement on top of the spec: §2 says worktrees are "created lazily on that chat's first Render Preview or Commit action." In this plan, the chat worktree is instead created on that chat's **first message send** (Task 9) — before the `claude` CLI process for that chat ever spawns. This is necessary, not optional: every chat today runs with `workingDirectory: "."` (the shared main checkout), so if worktree creation waited until an explicit Commit/Preview action, all of a chat's actual file edits up to that point would already have happened in the wrong (shared) directory. Creating it on first send is still "lazy" in the sense the spec cares about (a chat that's created but never used never gets one) while actually fixing the bug the spec's own §2 describes.

## Task 1: `merge_events` insert policy

**Files:**
- Create: `supabase/migrations/0006_merge_events_insert.sql`

- [ ] **Step 1: Write the migration**

```sql
-- merge_events was read-only from the app (migration 0004) pending this
-- orchestration work. Same open-to-authenticated pattern as every other
-- table in this project (see decisions.md — no roles table exists).
create policy "merge_events_insert_all" on merge_events
  for insert to authenticated with check (true);
```

- [ ] **Step 2: Apply it to the live Supabase project**

`supabase db push` does not work in this project (see `decisions.md`) — every prior migration was applied via the Supabase MCP server's `apply_migration` tool instead. Call it with:
- `project_id`: `febfuemspzwslaujdtwc`
- `name`: `merge_events_insert`
- `query`: the SQL from Step 1

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0006_merge_events_insert.sql
git commit -m "feat: allow authenticated inserts on merge_events"
```

## Task 2: Pure path/branch-name helpers

**Files:**
- Create: `src-tauri/src/merge_paths.rs`
- Modify: `src-tauri/src/lib.rs:1-3` (add `mod merge_paths;`)

- [ ] **Step 1: Write the module with its own tests**

```rust
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
```

- [ ] **Step 2: Register the module**

In `src-tauri/src/lib.rs`, change:

```rust
mod claude_binary;
mod claude_process;
mod stream_parser;
```

to:

```rust
mod claude_binary;
mod claude_process;
mod merge_paths;
mod stream_parser;
```

- [ ] **Step 3: Run the tests**

Run: `cd src-tauri && cargo test merge_paths`
Expected: 3 tests pass (`chat_branch_name_is_namespaced`, `chat_worktree_path_is_a_sibling_of_repo_root`, `team_worktree_path_is_named_team`)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/merge_paths.rs src-tauri/src/lib.rs
git commit -m "feat: add worktree/branch path helpers"
```

## Task 3: Worktree management (`git_ops.rs`, part 1)

**Files:**
- Create: `src-tauri/src/git_ops.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod git_ops;`)

- [ ] **Step 1: Write the module**

```rust
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
    let output = run_git(root, &["worktree", "add", "-b", &branch, &path_str, "main"])?;
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
```

No unit tests in this file — like `claude_process.rs` (the codebase's existing precedent for subprocess-heavy code), this is pure IO orchestration around `git`, not logic to assert on in isolation. It's verified in Task 12's end-to-end check instead.

- [ ] **Step 2: Register the module**

In `src-tauri/src/lib.rs`, add `mod git_ops;` alongside the other `mod` lines.

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: succeeds (warnings about unused functions are fine — they're wired up in Task 7)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/git_ops.rs src-tauri/src/lib.rs
git commit -m "feat: add chat/team worktree management"
```

## Task 4: Render preview merge (`git_ops.rs`, part 2)

**Files:**
- Modify: `src-tauri/src/git_ops.rs`

- [ ] **Step 1: Add `render_preview` below `ensure_team_worktree`**

```rust
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
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: succeeds

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/git_ops.rs
git commit -m "feat: merge chat branches into team on render preview"
```

## Task 5: Promotion to `main` (`git_ops.rs`, part 3)

**Files:**
- Modify: `src-tauri/src/git_ops.rs`

- [ ] **Step 1: Add `promote_to_main`**

```rust
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
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: succeeds

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/git_ops.rs
git commit -m "feat: fast-forward main from team on promotion"
```

## Task 6: Team preview dev server

**Files:**
- Create: `src-tauri/src/preview_server.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod preview_server;`)

- [ ] **Step 1: Write the module**

```rust
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
```

No unit tests — same subprocess-management precedent as Task 3.

- [ ] **Step 2: Register the module**

In `src-tauri/src/lib.rs`, add `mod preview_server;` alongside the other `mod` lines.

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: succeeds

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/preview_server.rs src-tauri/src/lib.rs
git commit -m "feat: add long-lived team preview dev server"
```

## Task 7: Wire the Tauri commands

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the four new commands**

In `src-tauri/src/lib.rs`, after the existing `start_session` function and before `#[cfg_attr(mobile, tauri::mobile_entry_point)]`, add:

```rust
#[tauri::command]
fn ensure_chat_worktree(chat_id: String) -> Result<String, String> {
    let root = git_ops::repo_root()?;
    let path = git_ops::ensure_chat_worktree(&root, &chat_id)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn remove_chat_worktree(chat_id: String) -> Result<(), String> {
    let root = git_ops::repo_root()?;
    git_ops::remove_chat_worktree(&root, &chat_id)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
enum RenderPreviewResult {
    Clean,
    Conflict { files: Vec<String> },
}

#[tauri::command]
fn render_preview(
    state: tauri::State<preview_server::TeamPreviewServer>,
    chat_id: String,
) -> Result<RenderPreviewResult, String> {
    let root = git_ops::repo_root()?;
    let outcome = git_ops::render_preview(&root, &chat_id)?;
    if let git_ops::MergeOutcome::Clean = outcome {
        let team_path = merge_paths::team_worktree_path(&root);
        state.ensure_running(&team_path)?;
    }
    Ok(match outcome {
        git_ops::MergeOutcome::Clean => RenderPreviewResult::Clean,
        git_ops::MergeOutcome::Conflict { files } => RenderPreviewResult::Conflict { files },
    })
}

#[tauri::command]
fn promote_to_main() -> Result<(), String> {
    let root = git_ops::repo_root()?;
    git_ops::promote_to_main(&root)
}
```

- [ ] **Step 2: Register the commands and the managed state**

Change:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, start_session])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

to:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(preview_server::TeamPreviewServer::new())
        .invoke_handler(tauri::generate_handler![
            greet,
            start_session,
            ensure_chat_worktree,
            remove_chat_worktree,
            render_preview,
            promote_to_main
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Run the full Rust test suite**

Run: `cd src-tauri && cargo test`
Expected: all tests pass (the existing `claude_binary`/`claude_process`/`lib` tests plus the new `merge_paths` tests from Task 2)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: expose worktree/render-preview/promote as Tauri commands"
```

## Task 8: `insertMergeEvent` helper

**Files:**
- Modify: `src/lib/mergeEvents.ts`

- [ ] **Step 1: Add the function**

At the end of `src/lib/mergeEvents.ts`, add:

```ts
export async function insertMergeEvent(
  chatId: string | null,
  status: MergeEvent["status"],
  detail: string | null
): Promise<void> {
  const { error } = await supabase.from("merge_events").insert({ chat_id: chatId, status, detail });
  if (error) throw new Error(`failed to record merge event: ${error.message}`);
}
```

No new test for this one — it's a thin Supabase wrapper with no logic to assert on in isolation, same as this file's own existing `fetchMergeEvents` (which also has no test; only the pure `countByStatus`/`latestStatusByChat` functions do).

- [ ] **Step 2: Run the existing test file to make sure nothing broke**

Run: `npx vitest run src/lib/mergeEvents.test.ts`
Expected: all existing tests still pass

- [ ] **Step 3: Commit**

```bash
git add src/lib/mergeEvents.ts
git commit -m "feat: add insertMergeEvent helper"
```

## Task 9: Per-chat worktree wiring in `App.tsx`

This is the task that actually fixes the shared-`workingDirectory` bug (`src/App.tsx:126` currently hardcodes `"."` for every chat).

**Files:**
- Modify: `src/App.tsx:105-135` (`handleSend`)
- Modify: `src/App.tsx:144-147` (`handleDelete`)

- [ ] **Step 1: Update `handleSend` to resolve a per-chat worktree before starting the session**

Replace the existing `handleSend` (currently `src/App.tsx:105-135`):

```tsx
  const handleSend = useCallback(
    (chatId: string, prompt: string) => {
      updateMyPresence({ claimedChatId: chatId });
      setChatStates((prev) => {
        const withUserMessage = addUserMessage(prev, chatId, prompt);
        return {
          ...withUserMessage,
          [chatId]: { ...withUserMessage[chatId], streaming: true },
        };
      });
      const chat = chats.find((c) => c.id === chatId);
      // Native `--resume` only works for whoever's machine/account created the
      // session (see decisions.md). A different claimant gets a fresh session
      // primed with the stored transcript instead, so Claude isn't blind to
      // what already happened.
      const isOwner = !chat?.claude_session_id || chat.claude_session_owner === session.user.id;
      const priorMessages = chatStates[chatId]?.messages ?? [];
      const effectivePrompt = isOwner ? prompt : `${buildTranscriptPreamble(priorMessages)}\n\n${prompt}`;
      invoke("start_session", {
        chatId,
        prompt: effectivePrompt,
        workingDirectory: ".",
        resumeSessionId: isOwner ? chat?.claude_session_id ?? null : null,
      }).catch((err) => {
        console.error("start_session failed", err);
        const detail = err instanceof Error ? err.message : String(err);
        setChatStates((prev) => setSessionError(prev, chatId, `Couldn't start the Claude session: ${detail}`));
      });
    },
    [chats, chatStates, updateMyPresence, session.user.id]
  );
```

with:

```tsx
  const handleSend = useCallback(
    (chatId: string, prompt: string) => {
      updateMyPresence({ claimedChatId: chatId });
      setChatStates((prev) => {
        const withUserMessage = addUserMessage(prev, chatId, prompt);
        return {
          ...withUserMessage,
          [chatId]: { ...withUserMessage[chatId], streaming: true },
        };
      });
      const chat = chats.find((c) => c.id === chatId);
      // Native `--resume` only works for whoever's machine/account created the
      // session (see decisions.md). A different claimant gets a fresh session
      // primed with the stored transcript instead, so Claude isn't blind to
      // what already happened.
      const isOwner = !chat?.claude_session_id || chat.claude_session_owner === session.user.id;
      const priorMessages = chatStates[chatId]?.messages ?? [];
      const effectivePrompt = isOwner ? prompt : `${buildTranscriptPreamble(priorMessages)}\n\n${prompt}`;
      // Every chat gets its own git worktree so concurrent chats never edit
      // the same working directory (see docs/superpowers/specs/2026-08-18-
      // main-agent-merge-orchestration-design.md §2). Falls back to the repo
      // root if worktree creation fails, rather than blocking the send.
      invoke<string>("ensure_chat_worktree", { chatId })
        .catch((err) => {
          console.error("ensure_chat_worktree failed, falling back to repo root", err);
          return ".";
        })
        .then((workingDirectory) =>
          invoke("start_session", {
            chatId,
            prompt: effectivePrompt,
            workingDirectory,
            resumeSessionId: isOwner ? chat?.claude_session_id ?? null : null,
          })
        )
        .catch((err) => {
          console.error("start_session failed", err);
          const detail = err instanceof Error ? err.message : String(err);
          setChatStates((prev) => setSessionError(prev, chatId, `Couldn't start the Claude session: ${detail}`));
        });
    },
    [chats, chatStates, updateMyPresence, session.user.id]
  );
```

- [ ] **Step 2: Clean up the chat's worktree on delete**

Replace the existing `handleDelete` (currently `src/App.tsx:144-147`):

```tsx
  const handleDelete = useCallback((chatId: string) => {
    deleteChat(chatId).catch((err) => console.error("failed to delete chat", err));
    setChats((prev) => prev.filter((c) => c.id !== chatId));
  }, []);
```

with:

```tsx
  const handleDelete = useCallback((chatId: string) => {
    deleteChat(chatId).catch((err) => console.error("failed to delete chat", err));
    invoke("remove_chat_worktree", { chatId }).catch((err) =>
      console.error("failed to remove chat worktree", err)
    );
    setChats((prev) => prev.filter((c) => c.id !== chatId));
  }, []);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "fix: give every chat its own git worktree instead of a shared one"
```

## Task 10: Render Preview button

**Files:**
- Create: `src/components/RenderPreviewButton.tsx`
- Modify: `src/components/InputBar.tsx`
- Modify: `src/components/ChatCard.tsx:109`
- Modify: `src/components/ChatPane.tsx:36`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { insertMergeEvent } from "../lib/mergeEvents";

type RenderPreviewResult = { status: "Clean" } | { status: "Conflict"; files: string[] };

export function RenderPreviewButton({ chatId }: { chatId: string }) {
  const [state, setState] = useState<"idle" | "running" | "conflict">("idle");

  async function press() {
    setState("running");
    try {
      const result = await invoke<RenderPreviewResult>("render_preview", { chatId });
      if (result.status === "Clean") {
        await insertMergeEvent(chatId, "held", null);
        setState("idle");
      } else {
        await insertMergeEvent(chatId, "conflict", result.files.join(", "));
        setState("conflict");
      }
    } catch (err) {
      console.error("render_preview failed", err);
      setState("idle");
    }
  }

  return (
    <button
      type="button"
      className={`pill${state === "conflict" ? " pill-warn" : ""}`}
      onClick={press}
      disabled={state === "running"}
    >
      {state === "running" ? "Rendering…" : state === "conflict" ? "Conflict" : "Render Preview"}
    </button>
  );
}
```

- [ ] **Step 2: Wire it into `InputBar`**

In `src/components/InputBar.tsx`, add the import:

```tsx
import { RenderPreviewButton } from "./RenderPreviewButton";
```

Change the function signature from:

```tsx
export function InputBar({ onSend, disabled }: { onSend: (prompt: string) => void; disabled: boolean }) {
```

to:

```tsx
export function InputBar({
  chatId,
  onSend,
  disabled,
}: {
  chatId: string;
  onSend: (prompt: string) => void;
  disabled: boolean;
}) {
```

Change the top row from:

```tsx
      <div className="input-toprow">
        <LocationPill />
        <DirectoryPill workingDirectory="." />
      </div>
```

to:

```tsx
      <div className="input-toprow">
        <LocationPill />
        <DirectoryPill workingDirectory="." />
        <span className="input-spacer" />
        <RenderPreviewButton chatId={chatId} />
      </div>
```

- [ ] **Step 3: Pass `chatId` from both call sites**

In `src/components/ChatCard.tsx:109`, change:

```tsx
        <InputBar onSend={(prompt) => onSend(chat.id, prompt)} disabled={claimedByOther || state.streaming} />
```

to:

```tsx
        <InputBar chatId={chat.id} onSend={(prompt) => onSend(chat.id, prompt)} disabled={claimedByOther || state.streaming} />
```

In `src/components/ChatPane.tsx:36`, change:

```tsx
      <InputBar onSend={onSend} disabled={disabled} />
```

to:

```tsx
      <InputBar chatId={chat.id} onSend={onSend} disabled={disabled} />
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/components/RenderPreviewButton.tsx src/components/InputBar.tsx src/components/ChatCard.tsx src/components/ChatPane.tsx
git commit -m "feat: add Render Preview button to the chat input bar"
```

## Task 11: Promote button and a real preview URL

**Files:**
- Modify: `src/components/MainAgentInstrument.tsx`

- [ ] **Step 1: Replace the file's contents**

Replace all of `src/components/MainAgentInstrument.tsx` with:

```tsx
import { useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { invoke } from "@tauri-apps/api/core";
import type { MergeEvent } from "../lib/mergeEvents";
import { countByStatus, insertMergeEvent } from "../lib/mergeEvents";

export interface MainAgentInstrumentData {
  mergeEvents: MergeEvent[];
  refreshKey: number;
  [key: string]: unknown;
}

export type MainAgentInstrumentNode = Node<MainAgentInstrumentData, "mainAgentInstrument">;

// The team-branch dev server preview_server.rs keeps running for the app's
// lifetime, always on this fixed port (see src-tauri/src/preview_server.rs).
const TEAM_PREVIEW_URL = "http://localhost:5180";

export function MainAgentInstrument({ data }: NodeProps<MainAgentInstrumentNode>) {
  const [logOpen, setLogOpen] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const counts = countByStatus(data.mergeEvents);

  async function promote() {
    setPromoting(true);
    try {
      await invoke("promote_to_main");
      await insertMergeEvent(null, "merged", "promoted team → main");
    } catch (err) {
      console.error("promote_to_main failed", err);
    } finally {
      setPromoting(false);
    }
  }

  return (
    <div className="main-agent-instrument">
      <div className="build-preview-panel">
        <div className="build-preview-header">
          BUILD · PREVIEW
          <button type="button" className="pill" onClick={promote} disabled={promoting}>
            {promoting ? "Promoting…" : "Promote to main"}
          </button>
        </div>
        <iframe
          key={data.refreshKey}
          className="build-preview-frame"
          src={TEAM_PREVIEW_URL}
          title="Live team preview"
        />
      </div>
      <div className="main-agent-bar" onClick={() => setLogOpen((open) => !open)}>
        <span className="main-agent-label">⬡ MAIN AGENT</span>
        <span className="main-agent-count main-agent-count-merged">{counts.merged} merged</span>
        <span className="main-agent-count main-agent-count-held">{counts.held} held</span>
        <span className="main-agent-count main-agent-count-conflict">{counts.conflict} conflict</span>
      </div>
      {logOpen && (
        <div className="main-agent-log">
          {data.mergeEvents.length === 0 && <div className="main-agent-log-empty">No merge activity yet.</div>}
          {data.mergeEvents.map((event) => (
            <div key={event.id} className={`main-agent-log-row main-agent-log-row-${event.status}`}>
              <span>{event.status}</span>
              <span>{event.detail ?? event.chat_id ?? "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

This drops the old `VITE_BUILD_PREVIEW_URL` env-var indirection (it pointed at nothing configured — the "no same-origin fallback" comment in the prior version — and `data.refreshKey` no longer needs a "not configured" branch since the URL is now always real) in favor of the fixed, always-live team preview server from Task 6.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/MainAgentInstrument.tsx
git commit -m "feat: point build preview at the team branch, add Promote button"
```

## Task 12: End-to-end verification

Not automatable — this is the manual check that stands in for the automated test/build gate this design deliberately doesn't have (per the spec, verification here means a human looking at the real thing). Run through this on the actual built app with a real Supabase session, using two chats to simulate two people.

- [ ] **Step 1: Full test suite one more time**

```bash
cd src-tauri && cargo test && cd .. && npx vitest run && npx tsc --noEmit
```

Expected: everything green.

- [ ] **Step 2: Launch the app**

```bash
npx tauri dev
```

- [ ] **Step 3: Clean-merge path**

Create a chat, send a message that asks Claude to make a small, harmless edit (e.g. add a comment to a file). Once it finishes, press **Render Preview**. Confirm:
- A `merge_events` row appears with `status: held` (visible in the Main Agent log).
- `http://localhost:5180` is serving and reflects the change (open it directly in a browser, or check the canvas preview panel).

- [ ] **Step 4: Promote path**

Press **Promote to main** on the Main Agent instrument. Confirm:
- A `merge_events` row appears with `status: merged`.
- `git log main` (in the real repo, not a worktree) shows the promoted commit.

- [ ] **Step 5: Conflict path**

Create two chats. In both, ask Claude to edit the *same line* of the same file in conflicting ways. Render Preview the first — it should go clean. Render Preview the second — confirm:
- The command returns a conflict result (no crash, no partial state).
- A `merge_events` row appears with `status: conflict` and a non-empty file list in `detail`.
- The team worktree (`../vibeco-worktrees/team`, relative to the real repo) is left in a clean, non-conflicted state (`git status` there shows nothing in progress) — i.e. the abort in `render_preview` actually ran.

- [ ] **Step 6: Concurrent chats don't collide**

Confirm two chats now have separate directories under `../vibeco-worktrees/` (one per chat, per Task 9) rather than both editing the same shared checkout.

## Self-review notes

- **Spec coverage**: §2 (worktree-per-chat) → Tasks 2, 3, 9. §3 (branch model) → Task 2 (`TEAM_BRANCH`), Task 3. §4 (Render Preview) → Tasks 4, 10. §5 (conflict handling, minus the LLM explanation) → Task 4's `MergeOutcome::Conflict` path, Task 10. §6 (shared preview) → Tasks 6, 11. §7 (promotion) → Tasks 5, 11. §8 (data model) → Task 1, Task 8.
- **Explicitly not covered by this plan** (matches the spec's own §9/§10 — these were left undecided or explicitly out of scope, not omitted by oversight): the one-shot LLM conflict explanation (§5's "this is where the LLM is invoked" — the spec itself says the exact prompt/scope/billing isn't decided yet, so nothing here invents it), whether a `team` conflict should block only the offending chat's preview instead of everyone's, and worktree/branch cleanup after a chat's work is promoted. A conflict in this plan's version surfaces as a file list in `merge_events` and the chat's own Render Preview button turning into a visible "Conflict" state — a person resolves it by hand, same outcome the spec describes minus the AI explanation layer. Worth a small follow-up plan once this base mechanism has been used for real.
- **Type consistency checked**: `git_ops::MergeOutcome` (Task 3/4) and `RenderPreviewResult` (Task 7) both have exactly `Clean` / `Conflict { files: Vec<String> }`; the frontend's `RenderPreviewResult` type in `RenderPreviewButton.tsx` (Task 10) matches the `#[serde(rename_all = "camelCase", tag = "status")]` shape (`{ status: "Clean" }` / `{ status: "Conflict", files: [...] }`).
- **No placeholders**: every step above has complete code, not a description of code.
