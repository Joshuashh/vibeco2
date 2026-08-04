# Hand-off — Vibeco2

## What happened this session
Implemented the full foundation plan (`docs/superpowers/plans/2026-08-04-vibeco2-foundation.md`),
inline, task-by-task, as Sonnet. Also: compared Supabase Realtime vs. Liveblocks for multiplayer
(spec.md §3 updated — Liveblocks now owns realtime/multiplayer, Supabase stays for Postgres/Auth;
see `decisions.md`), and recovered from a mid-session incident where `create-tauri-app --force`
deleted spec.md/HANDOFF.md/decisions.md/docs/ (recovered from conversation context — logged in
`decisions.md`).

## Current state
- **Working, tested, one-person chat app.** Tauri + React scaffold; Rust spawns `claude` over a
  PTY (echo disabled, stream-json flags matching the Swift GUI's proven recipe); stream-json
  lines parse into typed `ClaudeEvent`s emitted to the frontend; React renders streaming
  text/tool-call blocks; completed turns persist to a real Supabase project ("Vibeco 2",
  `febfuemspzwslaujdtwc`) and reload on startup.
- All tests pass: 11 `cargo test`, 5 `vitest`, clean `tsc --noEmit`.
- 11 commits on `main` (no feature branch was used — plan executed inline per user's choice).
  **No git remote configured** — everything is local only, by user's choice this session.
- `.env.local` has real Supabase credentials (URL + publishable key), gitignored via `*.local`.
- Real Supabase project is live with 2 rows in `chats` (created by dev-server test runs), 0 in
  `messages` (no prompt was actually sent through the UI end-to-end — verification was via
  logs + direct Supabase queries, not a live click-through, since the raw dev binary's window
  couldn't be reached by computer-use tooling — see below).

## Known gaps / open items
- **RLS is disabled** on `chats`/`messages` — anyone with the anon key can read/write every
  row. Deliberately deferred (see `decisions.md`) until auth/room membership is designed;
  remediation SQL is logged there.
- **Never verified interactively in the actual window.** I confirmed the build launches cleanly,
  Rust/TS logic is unit-tested, and Supabase persistence round-trips (via direct queries), but no
  one has typed a real prompt into the app and watched it stream. Do this first next session:
  `npm run tauri dev`, type a prompt, confirm streaming text + tool-call rows render, and that a
  `messages` row appears in Supabase after the turn completes.
- **Out of scope for this plan** (per spec.md, unchanged): Canvas view, human-chat column,
  tools/logs column, Liveblocks multiplayer wiring, Main Agent orchestration, cost/budget alerts,
  auth/room membership.
- **Type drift risk**: `ClaudeEvent` is hand-mirrored between Rust (`src-tauri/src/stream_parser.rs`)
  and TypeScript (`src/types/message.ts`) — no codegen. Keep both in sync manually if extended.

## Next steps
1. Live-verify streaming in the actual app window (see above).
2. Decide the next plan: multiplayer/Canvas (needs Liveblocks per the updated spec.md §3), or
   Main Agent orchestration (spec §4), or auth (unblocks RLS).
3. When ready, consider pushing to a GitHub remote — currently local-only by choice.

To resume: paste this file plus `spec.md` into a fresh session.
