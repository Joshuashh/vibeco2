# Vibeco2 — Decisions Log

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
