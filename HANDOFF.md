# Hand-off — Vibeco2

## What happened this session

A long multi-topic session (Josh + Ben cross-machine testing). All work is
committed and pushed to `main` (commits `431bf24`, `23ba30d`, `56d04f9`).
Start a fresh session for the next round — this one has drifted well past
"one session ≈ one task."

### 1. Multiplayer sync fixes (the original ask: "we can't see each other's
   cursors/messages properly")

- **Live cursors** (`LiveCursors.tsx`, `CanvasView.tsx`): were positioned in
  raw screen pixels, so they were wrong across different zoom levels/window
  sizes and bled across tabs. Now canvas cursors use React Flow's
  screen↔flow coordinate conversion (content-relative, zoom-independent);
  chat/preview cursors are stored as fractions of the container; a cursor
  only renders when the viewer is on the same tab as the sender.
- **Chat messages never synced at all** — root cause: `saveChatMessages` in
  `persistChat.ts` was defined but never called anywhere. Nothing was ever
  written to the `messages` table, so the realtime subscription had nothing
  to broadcast. Fixed by calling it on send and on `turn_complete`.
- **Root blocker during testing:** the `josh@josh.com` test account had
  never successfully signed in (checked directly via the Supabase MCP
  against project `febfuemspzwslaujdtwc` — `messages` table had 0 rows
  ever). If this happens again, check `auth.users.last_sign_in_at` before
  assuming a code bug.
- **Live streaming**: assistant turns now broadcast over a Liveblocks room-
  event channel (`useBroadcastEvent`/`useEventListener` in `lib/liveblocks.ts`)
  as they generate, not just once saved. This introduced a duplicate-message
  bug (two channels — Liveblocks broadcast + Postgres realtime echo — could
  race and both append the same message) — fixed by removing the redundant
  Postgres `messages` INSERT subscription entirely; the broadcast is now the
  only live-sync channel, reload still backfills from Postgres.
- **Split view** had no way to pick the right pane's chat (auto-followed
  whichever teammate had a chat claimed). Both panes now have a dropdown in
  their header (`ChatView.tsx`/`ChatPane.tsx`) to pick any chat directly.
- **Commit-hash footer** (bottom-left, `App.tsx` + `vite.config.ts`) so both
  people can eyeball whether they're on the same build — `package.json`'s
  version never changes per-commit so wasn't useful for this.

### 2. Feature requests (all in commit `56d04f9`)

- Input box: starts at 50px, grows to 10 lines, then scrolls (`InputBar.tsx`).
- Model/effort/permission-mode pickers are wired to the real `claude` CLI now
  (`lib/prefs.tsx` — localStorage-backed shared preference; Rust side:
  `start_session` in `lib.rs` / `build_args` in `claude_process.rs` take
  `model`/`permission_mode`/`effort` instead of hardcoded `sonnet`/
  `acceptEdits`). The "more models" legacy list (Opus 4.7 etc.) has **no
  verified CLI model ID** — it sends a best-effort slug and will surface as a
  normal "couldn't start session" error if wrong. Worth checking with Josh
  before relying on those.
- New chats auto-title from the first message (`lib/chatTitle.ts`).
- Fixed a Tailwind v4 gotcha: bare `border` utility has no default color (v3
  behavior changed), so it was inheriting the light popover-foreground text
  color → white stroke around the chat dropdown/delete dialog. Fixed in
  `components/ui/dropdown-menu.tsx` and `alert-dialog.tsx` by adding explicit
  `border-border`. **Grep for other bare `border` in `ui/*.tsx` before adding
  new shadcn components** — same bug will recur.
- Sidebar: drag-and-drop reorder, named groups, and a real Archive section
  replacing the disabled "Skills" placeholder (`0008_chat_organization.sql`
  — `sort_order`/`group_name`/`archived_at` columns, applied directly via
  Supabase MCP to `febfuemspzwslaujdtwc`). Canvas chat cards can archive too.
  Drag-and-drop reordering uses fractional `sort_order` (`lib/reorder.ts`),
  not full renumbering.
- Canvas: two-finger scroll pans, pinch zooms, both work even with the
  pointer over a chat card (`nowheel` removed from the message-list/log
  panels — **trade-off**: can no longer scroll those with a plain mouse
  wheel while hovering them on the canvas; open the chat to scroll history).
  Reset-zoom-to-100% button added next to the canvas toolbar.

## Current state

- `main` is pushed and clean; `npx tsc --noEmit`, `npx vitest run` (65/65),
  and `cargo test`/`cargo build` all pass as of this commit.
- Dev app was last verified running via `npm run tauri dev` — no console
  errors on load. Feature testing (drag-drop, groups, archive, gestures,
  model picker actually reaching Claude) has **not** been manually verified
  in a live signed-in session this round — worth a pass next session.

## Next steps / open threads

1. Verify the new sidebar features (reorder/groups/archive) and canvas
   gestures with a real signed-in session.
2. Verify model/effort/permission selection actually changes Claude's
   behavior end-to-end (the CLI flags are real and tested at the
   `build_args` level, but not exercised through a live `claude` process
   this session).
3. Decide whether the "more models" legacy list needs real CLI model IDs
   or should be trimmed to just the four current models.
4. `Button`'s `variant="outline"` (`ui/button.tsx`) has the same
   bare-`border` bug but is currently unused anywhere — leave as-is unless
   someone adds a caller, then fix it the same way.
