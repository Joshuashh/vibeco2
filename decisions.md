# Vibeco2 — Decisions Log

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
