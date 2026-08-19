# Preview review page — Design Spec

Date: 2026-08-19
Status: **Paused mid-brainstorm, by request — revisit in a fresh session.** Core direction is agreed (see §1-6 below); the design was not fully walked through the brainstorming skill's remaining steps (final confirmation, spec self-review) before the user asked to pause. Treat this as a strong starting point for the next session, not a finished, implementation-ready spec — confirm it's still current before planning against it.

## 1. What this covers

Wires up the currently-disabled "Preview" tab (`src/components/ViewToggle.tsx` — `<button disabled title="Not yet available">Preview</button>`) into a real page: the live team-branch preview (already built in the 2026-08-18 merge-orchestration work — `src-tauri/src/preview_server.rs`, `TEAM_PREVIEW_URL` in `MainAgentInstrument.tsx`) shown full-bleed, with the ability to review it — mark it up, leave comments — while still being able to interact with it as a real running app.

**Note:** this session also renamed the top-level tabs from Chat/Canvas/Preview to a Plan/Build/Review workflow structure (see decisions.md and the corresponding commit). Under that new structure, this feature is what lives under the **Review** tab. Nothing else about the design below changes because of that rename.

## 2. Two modes: Interact vs. Comment

- **Interact Mode (default):** Exactly today's behavior — the live, current team preview in an iframe, fully clickable/usable as the real running app. No pins, no overlay, no drawing.
- **Comment Mode:** A toggle button switches into review mode. On switch, the app takes a **native screen capture** of the on-screen region the preview panel occupies — not a DOM/JS screenshot. The preview iframe (`localhost:5180`) is a different origin from the app's own webview, so JS cannot read its pixels directly (`html2canvas`-style DOM capture is not viable across that boundary). A native OS-level screen-region capture sidesteps this entirely by grabbing actual on-screen pixels, the same way a manual screenshot would.
- The live iframe is swapped for this static image while in Comment Mode. Every pin and stroke drawn is pixel-locked to that specific snapshot.
- Switching back to Interact Mode and later back into Comment Mode takes a **fresh** snapshot and starts a **new, separate annotation set** — annotation sets never drift out of place because they're each frozen to their own image, never re-attached to a live-updating page.

## 3. Placing feedback

In Comment Mode, a small toolbar offers two tools:
- **Pin** — click a spot on the snapshot, type a note. Threaded replies, a resolve/unresolve toggle (no deletion needed for MVP — resolved just dims it in the panel).
- **Draw** — freehand pen only for this pass (one accent color, matching the app's existing single-accent TE-inspired visual style — see `2026-08-05-canvas-completion-design.md` §5), plus undo. No shape tools, no multi-color, no text-on-canvas beyond pin notes.

Both render as an overlay directly on top of the frozen snapshot image.

## 4. Layout

Chosen via a visual mockup comparison (three options shown, this one picked): **full-bleed preview with a collapsible comment panel**, not a persistently-docked side panel and not a stacked (preview-on-top, comments-below) layout. The panel is closed by default so the live/frozen preview stays full-size — the point of the page — and opens automatically when Comment Mode is switched on, or when an existing pin is clicked.

The comment panel lists all comments for the **currently shown snapshot only** (threaded, with resolve toggles as above). Since each Comment Mode entry takes a fresh snapshot, there needs to be a lightweight way to look back at **past** snapshots and their comment sets — a small strip/list (thumbnail + timestamp + comment count) that lets you reopen an old snapshot read-only, or continue commenting on it, without disturbing the current live preview. Exact placement of this strip (above the panel, below it, a separate collapsible section) was not finalized.

## 5. Comment routing — deliberately just a log

Comments do **not** automatically feed into any chat or trigger any agent action. This was an explicit choice (considered and rejected: auto-sending comments as a prompt into a chat) — comments are a review log a human reads and acts on manually, at least for this pass. Revisit if that turns out to be too much manual work in practice.

## 6. Persistence

Matches this app's existing multiplayer pattern: Supabase tables for snapshots (image + timestamp) and comments (pin position or stroke path, text, resolved flag, snapshot reference), synced live via the same Supabase realtime subscription pattern already used for `merge_events` (see `src/App.tsx`'s existing `postgres_changes` subscription) — so teammates see each other's comments appear in real time without a page reload.

**Not Liveblocks:** comments are persisted/historical record, not ephemeral live presence — Supabase realtime is the right layer here, same reasoning already established for `chats`/`merge_events` in this codebase. Liveblocks stays reserved for genuinely ephemeral state (cursors, canvas positions, claim presence).

## 7. Explicitly out of scope for this pass

- Multi-color/shape drawing tools — pen + pins only.
- Comment @mentions or notifications.
- Exporting a review as a report/shareable artifact.
- Auto-feeding comments into a chat (see §5) — comments stay a manual-read log.
- Where exactly image storage lives (Supabase Storage vs. some other blob store) — not decided.

## 8. Open questions for the next session

- **Which Rust crate/approach for native screen-region capture.** A few reasonable cross-platform options exist (e.g. a screenshot crate that can target a specific region/window). Pick the simplest one that works well enough for this team's actual machines — don't over-engineer for platforms nobody here uses.
- Exact placement/interaction of the past-snapshots strip (§4).
- Where snapshot images get stored (Supabase Storage bucket vs. elsewhere) and any size/retention limits.
- Whether resolved comments should eventually be filterable/hideable, not just dimmed.
- This spec was paused before the brainstorming skill's own self-review pass (placeholder scan, internal consistency, scope check) — do that pass before writing an implementation plan against it.
