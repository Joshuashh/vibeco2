# Hand-off — Vibeco2

## What happened this session
Implemented auth end to end per `docs/superpowers/specs/2026-08-04-auth-design.md` and
`docs/superpowers/plans/2026-08-04-auth.md`: Supabase email/password sign-in, a login screen
gating the chat UI, sign-out, and RLS enabling owner-only access on `chats`/`messages` (ownership
via `chats.user_id`, `messages` scoped through its `chat_id` FK). Verified interactively in the
built `.app`: sign-in shows the login screen → chat UI, sign-out returns to login and stays signed
out, sign-in again + quit + relaunch stays signed in (session persistence works). Also verified via
`curl` that an unauthenticated request with only the anon key gets `[]` from both tables — RLS is
actually enforced, not just configured. One snag along the way: `open`-ing the `.app` after a
rebuild reused an already-running stale process instead of picking up the new build — killing the
old process (`ps aux | grep tauri-app`) before relaunch fixed it; worth remembering next time a
rebuilt `.app` doesn't seem to reflect code changes.

## Current state
- **Working, tested, single-user chat app with auth.** All tests pass: `cargo test` (Rust, unaffected
  this session), 9 `vitest` (5 prior + 4 new auth tests), clean `tsc --noEmit`.
- Migration `0002_auth_rls.sql` applied to the real Supabase project (`febfuemspzwslaujdtwc`,
  "Vibeco 2"): wiped prior ownerless test rows, added `chats.user_id` (`default auth.uid()`),
  enabled RLS with owner-only select/insert/update/delete policies on both tables.
- Supabase advisor confirms the prior "RLS disabled" findings are gone (one unrelated warning
  remains: leaked-password-protection, not in scope here).
- Your Supabase Auth account exists (created manually via the dashboard, auto-confirmed).
- 15+ commits on `main`, no feature branch used so far, still no git remote configured
  (local-only by choice, consistent with prior sessions).
- To relaunch the app for manual testing: `pkill -f tauri-app` (or check `ps aux | grep tauri-app`
  and `kill` the PID) if a stale build is still running, then `npm run tauri build -- --debug`
  (needs `export PATH="$HOME/.cargo/bin:$PATH"` if `cargo` isn't already on PATH) followed by
  `open src-tauri/target/debug/bundle/macos/tauri-app.app`.

## Known gaps / open items
- **No password-reset flow, no in-app sign-up, no multi-user/room model** — all explicitly out of
  scope per the auth design doc, deferred to whichever plan adds multiplayer rooms (spec.md §6).
- **Type drift risk**: `ClaudeEvent` is still hand-mirrored between Rust and TypeScript, unaffected
  by this session's changes — still worth watching if either side is extended.
- **Out of scope so far** (per spec.md): Canvas view, human-chat column, tools/logs column,
  Liveblocks multiplayer wiring, Main Agent orchestration, cost/budget alerts.

## Liveblocks foundation (this session)
Implemented per `docs/superpowers/specs/2026-08-05-liveblocks-foundation-design.md` and
`docs/superpowers/plans/2026-08-05-liveblocks-foundation.md`: a Supabase Edge Function
(`liveblocks-auth`, deployed to project `febfuemspzwslaujdtwc` with `verify_jwt: false` since the
function does its own Supabase JWT verification) mints Liveblocks tokens for one fixed global
room (`vibeco2-global`), and the client renders a `PresenceBar` via `useOthers`/`useSelf`. Verified
with two independent browser sessions (a normal window + an incognito window — plain second tabs
share `localStorage` and end up signed into the same account, so that's the only way to get two
independent sessions without two machines): both emails show up in presence, and closing one drops
it from the other's list within a few seconds.

One real snag: the first deploy had `verify_jwt: true`, which rejects any request lacking an
`Authorization` header — including the browser's CORS preflight `OPTIONS` request, which never
carries one. Had to redeploy with `verify_jwt: false` (safe here since the function verifies the
real Supabase session itself via `supabase.auth.getUser`). Also hit one credential mixup (a
non-`sk_`-prefixed value got set as `LIVEBLOCKS_SECRET_KEY` at first) — the giveaway was
`event loop error: ... Secret keys must start with 'sk_'` in the function's dashboard logs tab
(`supabase functions logs` isn't a subcommand in this CLI version — use the dashboard instead:
`https://supabase.com/dashboard/project/febfuemspzwslaujdtwc/functions/liveblocks-auth/logs`).

**Out of scope so far, still per spec.md**: live cursors over an actual shared surface (waits for
Canvas), canvas card drag/position sync, human-to-human chat delivery, streamed AI conversation
content, any workspace/multi-room model, any `chats`/`messages` RLS change.

## Next steps — not chosen yet, pick one for the next session
1. **Canvas view** (spec §2.2) — the pannable/zoomable card-and-frame UI. Now that Liveblocks
   presence exists, this is what live cursors would attach to. Needs a React Flow/tldraw-style
   library decision first.
2. **Canvas card sync + human chat + streamed AI content** (spec §3) — layer onto the Liveblocks
   foundation now that it exists; likely follows naturally once Canvas view exists.
3. **Main Agent orchestration** (spec §4) — GitHub Actions-triggered merge coordination; probably
   the largest, most independent piece, could be its own multi-session effort.
4. Multi-user auth (rooms/membership) would need to precede any of the above if more than one
   person is going to actually use this beyond ad-hoc test accounts — currently still single-tier,
   no invite/role model.

To resume: paste this file plus `spec.md` into a fresh session, and decide which of the above to
brainstorm first.
