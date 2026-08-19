# Vibeco2 — Decisions Log

## Fixed the four merge-orchestration known gaps (2026-08-19 session, continued)

**Context:** user confirmed the concurrent-render-preview concern is mitigated by design already — the button lives once on the shared preview box (`MainAgentInstrument.tsx`), scoped to whichever chat the current user has claimed, not duplicated per chat. But two *different* users can still each have their own chat claimed and press it at the same moment, so the race is cross-client, not fixable by having one button per client. Fixed all four gaps:

- **`promote_to_main` now advances local `main`** (`git_ops.rs`): after the remote push succeeds, best-effort fetch + fast-forward (or `update-ref` if `main` isn't the checked-out branch in the primary checkout) so new chats stop branching off a stale snapshot. Failure here doesn't fail the whole promotion — the important push already happened.
- **`render_preview`'s team-branch push now retries on loss** instead of erroring immediately: git's own fast-forward check is the real lock (two renders can't both win), so a losing push now re-fetches, `reset --hard`s the team worktree to the fresh `origin/team` (safe — that worktree only ever holds merges about to be pushed, never independent work), redoes the merge, and retries, up to 5 attempts. Considered adding a same-process `Mutex` too; skipped as redundant — the client button already disables mid-request, and the real race is cross-process, which only a retry-on-loss (or a real distributed lock) actually addresses.
- **Orphaned worktree sweep** (`prune_orphaned_chat_worktrees`, new Tauri command): chat deletion already called `remove_chat_worktree` (this was already wired, not actually missing), but if that call failed to complete (app quit mid-delete, offline), nothing ever retried it. Now, once at startup after chats load, the app tells the backend the known chat ids and any worktree under `vibeco-worktrees/` not in that list (and not `team`) gets removed.
- **Preview server now shuts down on app exit** (`preview_server.rs`'s new `shutdown()`, called from a `tauri::RunEvent::Exit` handler in `lib.rs`): kills the tracked `npm run dev` child so it can't orphan a process holding port 5180 after the window closes.

**Verified:** `cargo check`, `cargo test` (15 passed), `npx tsc --noEmit` all clean. Not exercised against a real concurrent-render scenario (would need two machines/processes racing on the same repo) — logic reasoning only.

## Hand-off (2026-08-19 session)

**What happened this session:**
- Fixed the canvas drag/resize glitch reported after the merge-orchestration work: root cause was `CanvasView.tsx`'s node-rebuilding effect depending on Liveblocks `self`/`others` presence objects, which change identity on every mouse move (live cursor broadcast) — every pointer move was rebuilding all canvas nodes, resetting `NodeResizer`'s internal drag state mid-gesture. Root-caused by building the real `.app` bundle (the raw `tauri dev` process isn't Launch-Services-registered and can't be driven via screen automation) and temporarily rendering the resize handles visible to confirm hit-testing was fine before finding the actual cause.
- Along the way: fixed a real `dragHandle`/`NodeResizer` conflict and a CSS specificity bug (React Flow's own stylesheet was winning over our resize-handle override, causing a persistent blue highlight).
- Merged the 2026-08-18 merge-orchestration branch to local `main` (worktree-per-chat, `chat → team → main` git plumbing, Render Preview / Promote buttons) — see that session's plan/spec docs.
- Brainstormed a **Preview review page** (live prototype + click-to-pin comments + freehand markup) but paused mid-design at the user's request — written up as `docs/superpowers/specs/2026-08-19-preview-review-page-design.md` for a fresh session to pick up. Not implemented.
- Restructured the top tabs into Plan/Build/Review, then reverted that per feedback ("didn't like this UI at all") back to the original flat toggle — kept only a disabled **Plan** tab ahead of Chat. Toolbar is now Plan | Chat | Canvas | Preview, both disabled, Single/Split back in its original toolbar spot.

**Current state:** working tree clean, all changes committed to local `main`. **30 commits are unpushed to `origin/main`**, spanning this entire session plus the prior merge-orchestration session — nothing has been pushed since before this project's rename to Vibeco.

**Open items:**
- Preview review page — spec written, not planned or implemented. See its own "open questions" section (native screen-capture approach, snapshot-strip placement, image storage).
- The merge-orchestration work's own known gaps are still open (see the 2026-08-18 entries below): `promote_to_main` doesn't advance the local `main` ref, no lock around concurrent Render Preview, no chat-worktree cleanup after promotion, no app-quit cleanup of the preview server.
- The revert of the tab restructure was via `git revert` (clean history, not squashed) — the two Plan/Build/Review commits and their reverts are all still in history if that direction is wanted again later.

**Next steps:**
1. Decide whether to push the 30 local commits to `origin/main` — flagged, not done automatically.
2. Pick up the Preview review page spec in a fresh session, or continue on the merge-orchestration known gaps.


## Known gap: `promote_to_main` doesn't advance the local `main` ref in the primary checkout (2026-08-18)

**What happened:** `promote_to_main` (`src-tauri/src/git_ops.rs`) fast-forwards the *remote* `main` by pushing `origin/team:main`, but never fetches/updates the local `main` ref in the developer's own primary repo checkout. `ensure_chat_worktree` branches new chats off local `main` (`-b <branch> <path> main`), so after a promotion, new chats keep branching off an increasingly stale local `main` until someone manually runs `git pull`/`git fetch` on the primary checkout.

**Why not fixed now:** updating a ref while it may be the currently-checked-out branch in the primary worktree is fiddlier than it looks (`git fetch origin main:main` refuses to update a ref that's checked out elsewhere in some configurations), and this self-heals with a manual pull — accepted as a known limitation for this lite pass rather than risking a blind fix to the primary checkout's HEAD.

**Revisit when:** this starts causing real friction (new chats branching off visibly stale `main` more than once a session), or when the app gains a place to safely run `git fetch` against the primary checkout without disturbing whatever's open there.

## Merge-orchestration leaf components call `lib/*` directly, bypassing the App.tsx callback convention (2026-08-18)

**What happened:** `RenderPreviewButton` (and `MainAgentInstrument`'s Promote button, same pattern) call `invoke()` and `lib/mergeEvents.ts`'s `insertMergeEvent` directly from a deeply-nested leaf component, rather than lifting the action up to an `App.tsx`-owned handler the way `handleDelete`/`handleRename` work for every other chat mutation (`ChatCardMenu`/`Sidebar` only ever call passed-in callbacks).

**Why this is fine here, deliberately:** `merge_events` writes don't need to touch any local React state directly — `App.tsx` already has an open Supabase realtime subscription on `merge_events` INSERTs that echoes the write back into state for `MainAgentInstrument`/`CanvasView` to read. Lifting this to a callback would just add an indirection with no behavioral difference. The convention it diverges from exists to keep chat-scoped state mutations centralized; this isn't one.

**When to keep doing this:** a leaf component may call `lib/*` (Supabase) or `invoke()` directly when the result doesn't need to flow through local component state and there's already a realtime/subscription path that reflects it elsewhere. Anything that needs immediate optimistic UI feedback, or that mutates chat-scoped state other code reads synchronously, should still go through an `App.tsx` callback like the existing convention.

## Hand-off (2026-08-17 session)

**Goal for this session:** get to an MVP for a weekend co-founder test.

**What changed (uncommitted — see "Open items" below):**
- **Real bugs fixed:** native `.app` was silently stale after the redesign commit (rebuilt); `claude` CLI binary lookup failed under GUI launch because it shelled out via `sh` instead of the user's real login shell, missing `~/.local/bin` (`src-tauri/src/claude_binary.rs`); failed `start_session` calls now surface as a message instead of vanishing; canvas cards had two overlapping dot-grid layers (removed the static CSS one, kept React Flow's); card drag was whole-card instead of header-only, with no way to pan without accidentally dragging a card (added Space-to-pan, `src/components/CanvasView.tsx`); a `useLayoutEffect` with no dependency array in the new `Popover` component caused an infinite render loop that blanked the UI on open (fixed with a dependency array + `ResizeObserver`); a global content-box sizing gap meant any `width:100%` + padding element (the input bar in split view) rendered wider than its parent and got clipped — fixed with a global `box-sizing: border-box` reset in `src/App.css`, not a one-off patch.
- **Session ownership vs. shared chats:** `claude_session_owner` column (migration `0005_session_owner.sql`, already applied to the live Supabase project) + transcript-priming handoff in `src/lib/transcript.ts` — see the decision entry below this one for the full rationale.
- **Chat view rebuilt** to match the sibling Claude Code GUI: real sidebar (`src/components/Sidebar.tsx`) with search/rename/delete, resizable via `src/components/ResizeDivider.tsx`, markdown rendering (`react-markdown`, new dependency), auto-scroll, centered/capped message column, per-chat title bar.
- **Split view:** two chat panes side by side (`src/components/ChatPane.tsx`) — your active chat + whichever chat your co-founder currently has claimed (auto-follow, no picker — reasonable only because it's a 2-person team). Single/Split toggle added to the toolbar.
- **Presence & live cursors:** deterministic per-user color (`src/lib/presenceColor.ts`, tested), face-pile avatars top-right, live multiplayer cursors (`src/components/LiveCursors.tsx`), colored claim indicators on canvas cards and chat pane title bars.
- **Real popup menus** (`src/components/Popover.tsx`) replacing the old click-to-cycle model/effort/permission pills — same collision/flip-to-avoid-edges logic as the Swift app's `DropdownMenu.swift`.
- Toolbar redocked as a normal top bar (was a floating overlay); several visual cleanups (removed terminal icon placeholder, some divider lines, cursor styling, chat-view sizes/colors matched to the Swift app's exact point values).
- Dev workflow switched from `tauri build --debug` + relaunch to `npx tauri dev` (hot reload) — much faster iteration; currently running in the background of this session.

**Open items / known gaps:**
- **Nothing is committed.** The entire list above is sitting in the working tree uncommitted (see `git status` — new dependency `react-markdown` in `package.json`/`package-lock.json` too). This is the single most important thing to resolve before anything else.
- Sign-out only lives in the Chat view sidebar now (moved there per explicit request) — **Canvas view currently has no way to sign out.** Deliberately left as-is; revisit when Canvas gets its own overhaul pass.
- `npx tauri dev` is running in this session's background process — it will die when this session ends. Next session needs to run it again for hot reload (or `tauri build --debug` for a real bundle check).
- Manual multi-person verification (two real accounts, claim handoff, split-view auto-follow) hasn't been exercised end-to-end — only single-account testing this session.

**Next steps:**
1. Review the diff and commit (probably worth a few logical commits rather than one giant one — CLI/bug fixes, chat-view redesign, split-view + presence, styling — rather than a single commit).
2. Push — `main` is currently 14 commits ahead of `origin/main` from *before* this session even started, plus everything new.
3. Test the split-view + presence + session-handoff features with an actual second person/account.
4. Canvas-view sign-out gap, if it matters before the co-founder test.

## Session ownership vs. shared chats: transcript-priming for handoff, not shared native resume (2026-08-06)

**The conflict:** chats are a shared, claimable resource (any teammate can pick one up and send the next message — the whole point of the canvas-view multi-chat model). But `claude --resume <session_id>` is not portable — the CLI reads a transcript file that lives on whoever's machine/account created that session. A different person claiming a chat and hitting send would silently fail to resume (or the Rust `invoke` would error) because that session doesn't exist on their machine.

**Decided:** Track a `claude_session_owner` (the Supabase user id) alongside `claude_session_id` on `chats` (migration `0005_session_owner.sql`). On send (`App.tsx` `handleSend`):
- If the sender **is** the owner (or no session exists yet): behave as before — native `--resume`, cheap and perfectly faithful.
- If the sender is **not** the owner: skip `--resume` entirely (`resumeSessionId: null`), and instead prepend a compact serialized transcript of the chat's stored message history (`src/lib/transcript.ts`'s `buildTranscriptPreamble`) ahead of the new prompt, so the fresh CLI session Claude starts under the new claimant's account still has situational awareness of what happened before. Ownership then transfers to whoever's session just started (`updateChatSession` sets both fields together on `session_started`).

**Why this option over the alternatives considered:**
- *Never use native resume, always inject transcript* — rejected: makes even the common case (same person continuing their own chat) pay the reconstruction cost and lose the CLI's native transcript fidelity, for no benefit in that case.
- *Don't attempt context handoff at all* — rejected: defeats the actual point of a shared/claimable chat model; a teammate picking up someone else's in-flight work would have Claude respond as if it had no idea what was being discussed.

**Consequence:** The first message after a handoff costs more tokens (full prior transcript resent as a preamble) and tool-use results are summarized as `[used tool: X]` rather than replayed in full — a deliberate lossy compromise to keep the preamble cheap. Every message after that handoff is a normal, cheap native resume again until the next handoff.

## Realtime/multiplayer backend: Liveblocks, not Supabase Realtime (2026-08-04)

**Decided:** Split the backend — Supabase (Postgres + Auth) for durable state, Liveblocks for the realtime/multiplayer layer (chat delivery, live cursors, canvas card position sync, live-streamed AI conversation content). Supabase remains the persistence/auth layer; it is not being replaced.

**Why:** Multiplayer is the core product driver for Vibeco2 (per user, this session). Compared head-to-head:
- **Liveblocks** is purpose-built for exactly this: Presence/cursors are first-class (`useOthers`, `useMyPresence`, ready-made cursor components), and it ships a CRDT storage layer (`LiveList`/`LiveObject`/`LiveMap`) giving conflict-free simultaneous edits for free — e.g. two people dragging different canvas cards at once, or co-editing text via its Yjs/Tiptap integration. This is the same realtime layer already proven working in the sibling `VibeCo` codebase (`liveblocks.config.ts`, `Cursors.tsx`, presence-based ready-up state), so it's reuse, not a new bet.
- **Supabase Realtime** is general-purpose and lower-level. It has Presence and Broadcast, so cursors/ephemeral sync are technically possible, but there's no CRDT storage layer — concurrent edits (e.g. simultaneous card drags) need hand-rolled conflict resolution, and there are no ready-made cursor/awareness components.

**Rejected alternative:** Supabase Realtime for everything (single vendor, simpler ops). Rejected specifically because multiplayer — not persistence — is the priority, and Supabase's realtime primitives are lower-level than what Liveblocks provides out of the box for exactly the Canvas view's draggable-node use case.

**Consequence:** Two backend vendors instead of one. Supabase Postgres tables (`chats`, `messages`, canvas layout snapshots, merge log) are the durable record; Liveblocks storage/presence is the live/ephemeral layer that (where relevant) gets snapshotted into Supabase on completion (e.g. a finished chat turn persists to `messages`, matching the existing foundation plan's Task 10). Auth/room membership stays on Supabase Auth.

**Supersedes:** `spec.md` §3 previously read "Backend: Supabase (Postgres + Realtime + Auth)" with Realtime doing all multiplayer sync. That line has been updated to reflect this split — see spec.md §3.

**Open follow-up:** The foundation plan (`docs/superpowers/plans/2026-08-04-vibeco2-foundation.md`) only used Supabase for chat persistence and did not touch Realtime, so it is unaffected by this change. A later plan (multiplayer/Canvas phase) needs to add the Liveblocks client, room setup, and Presence/Storage wiring — not yet planned.

## Incident: `create-tauri-app --force` deleted spec.md/HANDOFF.md/decisions.md/docs/ (2026-08-04)

**What happened:** While executing Task 1 of the foundation plan, `npx create-tauri-app@latest . --force` was run to scaffold into this non-empty directory. `--force` did not mean "tolerate extra files" as assumed — it cleared the directory before writing the template, deleting `spec.md`, `HANDOFF.md`, `decisions.md`, and the entire `docs/` folder (including the plan itself). No commit existed yet, so there was no git history to recover from.

**Recovery:** All four files were reconstructed from conversation context (they had been read/written earlier in the same session) rather than from Google Drive Trash, which this Drive-mounted folder syncs to but which wasn't queried successfully through available tooling in time. Content should be identical to the pre-incident versions.

**Why this happened:** `--force`'s actual semantics (wipe-and-recreate) weren't checked before use; `--help` output alone didn't make the destructive behavior obvious ("Force create the directory even if it is not empty").

**Fix going forward:** Never run a scaffolding tool with a force/overwrite flag directly inside a directory containing files worth keeping. Scaffold into a fresh temp directory, then move only the generated files in (or `git init` and commit existing docs *before* running any scaffolder, so there's always a git-recoverable baseline). Foundation plan Task 1 should be treated as amended to scaffold via a temp directory next time this is redone elsewhere.

## `portable-pty` 0.8: disable echo via the master fd, not the slave (2026-08-04)

**What happened:** Task 3 of the foundation plan called `slave.as_raw_fd()` to disable PTY echo via termios, mirroring the Swift codebase's approach of setting termios on the slave fd directly. `portable-pty` 0.8.1's `SlavePty` trait only exposes `spawn_command` — no fd access at all. `MasterPty`, however, does expose `as_raw_fd(&self) -> Option<RawFd>` on unix.

**Fix:** Call `tcgetattr`/`tcsetattr` on the **master** fd instead. This is valid because termios settings on a pty are shared terminal state — configuring them from either end affects the same underlying line discipline. `src-tauri/src/claude_process.rs`'s `disable_echo` now takes `&dyn MasterPty` and is called on `pair.master` right after `openpty()`, before the slave ever spawns a command.

**Consequence:** None functionally — same effect (ECHO cleared before any process touches the pty), just sourced from the master handle since that's what the crate actually exposes.

## Open security gap: RLS disabled on `chats`/`messages` (2026-08-04)

**What happened:** Applied the `0001_chats` migration to the real Supabase project (`febfuemspzwslaujdtwc`, "Vibeco 2"). Supabase's own advisor flagged that both `chats` and `messages` have Row Level Security disabled — with the anon/publishable key embedded client-side (as `src/lib/supabase.ts` does), anyone holding that key can read or write every row in both tables.

**Why not fixed immediately:** Enabling RLS with no policies blocks all access outright, and the right policies depend on auth/room membership — explicitly out of scope for the foundation plan (see plan's "Out of scope" section; spec.md §6 also leaves auth undecided). Writing throwaway policies now would need rewriting once real auth lands.

**Accepted for now, revisit before this app handles anything beyond a single developer's own test data:** this is fine for solo local development against a scratch project, but must not be treated as done — RLS + policies belong in whichever plan adds Supabase Auth and room membership (see spec.md §3, §6).

**Remediation SQL, when ready to add policies:**
```sql
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
```
