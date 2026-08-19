# Preview review page — Design Spec

Date: 2026-08-19
Status: **Approved, ready to plan.** Resumed and revised in a later session the same day — see "Revision history" at the end for what changed from the original brainstorm.

## 1. What this covers

Wires up the currently-disabled "Preview" tab (`src/components/ViewToggle.tsx` — `<button disabled title="Not yet available">Preview</button>`) into a real page: the live team-branch preview (already built in the 2026-08-18 merge-orchestration work — `src-tauri/src/preview_server.rs`, `TEAM_PREVIEW_URL` in `MainAgentInstrument.tsx`) shown full-bleed, with pin/draw annotation directly over the live content while it keeps running and hot-reloading underneath.

This is a separate, full-page view from the small `BUILD · PREVIEW` box that already exists inside the Canvas view's Main Agent node — that box is unaffected by this work.

## 2. No frozen snapshots — annotate the live preview directly

The original brainstorm (earlier the same day) called for freezing a native screen capture into a static image whenever review started, so pins/strokes wouldn't drift as the live page changed. **Revised:** annotations sit directly on top of the live, auto-updating iframe instead. A pin's position is recorded as a percentage of the preview container (`x_pct`, `y_pct`), not tied to any specific frame of content — so it holds its on-screen spot as the container resizes, but can visually drift relative to the underlying page if that page's layout changes after the pin was placed. This is an accepted trade-off for this pass, not an oversight.

This removes the need for native screen-region capture entirely — no new crate, no OS-specific code, no image storage, no "Interact vs Comment Mode" swap between iframe and static image, and no past-snapshots history strip (all present in the original brainstorm, all cut here).

## 3. Interaction model — toolbar tool selection, no mode switch

A small toolbar **floats over the preview content** (not docked in the panel header) with four items: **Cursor**, **Pin**, **Draw**, **Comments**.

- **Cursor** (default): clicks pass straight through to the iframe — the preview is fully usable as the real running app, same as today.
- **Pin**: the next click on the preview drops a pin at that spot, opens an inline text input for the note, saves it, then the toolbar automatically reverts to Cursor (one pin per selection, not a repeated-placement mode).
- **Draw**: freehand pen only, one accent color (matching the app's existing single-accent visual style), stays active across multiple strokes until manually switched back to Cursor, with an Undo control.
- **Comments**: toggles the side panel (§5) open/closed independently of which tool is active.

While Pin or Draw is selected, an overlay layer captures pointer events instead of the iframe underneath — this is what makes annotation possible without reading the iframe's cross-origin pixels; no DOM/JS access into the iframe's content is needed anywhere in this design.

## 4. Data model & sync

Two new Supabase tables — no snapshot/image table, unlike the original brainstorm:

```sql
create table preview_pins (
  id uuid primary key default gen_random_uuid(),
  x_pct real not null,
  y_pct real not null,
  text text not null,
  resolved boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table preview_pin_replies (
  id uuid primary key default gen_random_uuid(),
  pin_id uuid not null references preview_pins(id) on delete cascade,
  text text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table preview_strokes (
  id uuid primary key default gen_random_uuid(),
  path jsonb not null, -- array of {x_pct, y_pct} points
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
```

`preview_strokes` deliberately has no `resolved` column or reply thread — strokes are markup, not discussion, matching §3's Draw tool having no text attached. Undo removes the current user's own most recent stroke only.

Synced live via the same Supabase realtime `postgres_changes` subscription pattern already used for `merge_events` (`src/App.tsx`), so teammates see each other's pins/strokes appear without a reload. RLS follows the same open-to-authenticated-users model already used for `chats`/`messages`/`merge_events` in this codebase (see `0003_shared_chats.sql`) — no new permission model introduced here.

## 5. Comment panel

Collapsible side panel, closed by default. Opens automatically when Pin or Draw is selected, or when an existing pin is clicked. Lists all pin threads for the live preview — there's no per-snapshot scoping any more, since there's only ever one live preview, not a history of frozen ones.

Each row: the pin's note, threaded replies, a resolve/unresolve toggle. **Resolved threads are hidden from the list by default**, with a show/hide-resolved toggle in the panel — a small deliberate addition over the original brainstorm's "always dim, never hide" default, per explicit request this session.

## 6. Comment routing — still just a log

Unchanged from the original brainstorm: comments do not automatically feed into any chat or trigger any agent action. This is a review log a human reads and acts on manually. Revisit if that turns out to be too much manual work in practice.

## 7. Explicitly out of scope for this pass

- Multi-color/shape drawing tools — pen + pins only.
- Comment @mentions or notifications.
- Exporting a review as a report/shareable artifact.
- Auto-feeding comments into a chat (see §6).
- Any snapshot/history feature — cut entirely this session, not deferred; revisit only if live-drift turns out to be a real problem in practice.

## 8. Open questions for the next session

None blocking implementation. One thing worth watching once this is in real use: whether pin drift (the live page changing layout under a placed pin, per §2) turns out to be annoying enough in practice to warrant reconsidering some form of point-in-time capture later.

## Revision history

- **2026-08-19, later session:** cut native screen capture / frozen snapshots / past-snapshots strip entirely in favor of annotating the live preview directly (§2); replaced the Interact/Comment mode switch with toolbar tool selection (§3); resolved comments now hide by default instead of just dimming (§5). Original open questions about capture crate, snapshot storage, and strip placement are moot and removed. Status moved from "paused mid-brainstorm" to "approved, ready to plan."
