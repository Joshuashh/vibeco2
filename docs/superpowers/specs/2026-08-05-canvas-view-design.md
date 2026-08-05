# Canvas View + Multi-Chat — Design Spec

Date: 2026-08-05
Status: Brainstormed and agreed; not yet planned or implemented.

## 1. What this is

The first slice of the Canvas view from `spec.md` §2.2: a pannable, zoomable surface
where each chat renders as a small but complete conversation card. This round also
introduces the multi-chat model the Canvas view depends on — today there is exactly
one chat per app launch, backed by one PTY-spawned `claude` process.

**Explicitly out of scope this round** (deferred to later rounds): labeled frames,
the Main Agent flowchart node, live-streamed in-progress AI content to onlookers
(only completed turns are visible to non-occupants), the human-to-human chat column,
the tools/logs column. These all require pieces (Main Agent, live AI streaming) that
don't exist yet.

## 2. Chats are shared workspace slots, not owned by a user

This is the central shift from the original single-chat model: a chat card is a
**shared space anyone can work in**, not a resource permanently owned by whoever
created it. The mental model: "this is the area you're working in right now," not
"this is my chat."

- **Anyone can create** a new chat card (a "+" canvas control).
- **Anyone can claim** an unclaimed card by sending a message in it — claiming is
  **presence-based** (via Liveblocks), not a persisted database column. Claiming
  self-releases if the claimant disconnects, and there's an explicit **"Leave"**
  button to release early.
- **Only the current claimant can type** into a card's input bar. While claimed by
  someone else, the card is view-only but still shows message history live (via
  Supabase Realtime, see §7).
- **Delete requires the card be unclaimed and a confirm dialog.** There is no
  roles/permissions system in the app yet, so this guardrail is enforced
  app-side only, not at the RLS level (see §3). Real role-based delete
  permissions (e.g. senior vs. junior) are a separate, later feature — flagged as
  an explicit gap, not silently dropped.

## 3. Data model

Extends the existing schema (`chats`, `messages`), no new tables:

- `chats` gains three nullable columns:
  - `position_x`, `position_y` (float) — canvas position. Null means "not yet
    placed," so new cards fall back to a default spawn position.
  - `claude_session_id` (text) — the underlying Claude session's own session id,
    captured from the `session_started` event after a turn completes. Because a
    *different* person can pick up a claimed-and-released chat later, this can't
    live in one browser's local state anymore — it has to be shared, durable
    state so whoever resumes the chat next resumes the same underlying
    conversation.
- **RLS**: `chats` and `messages` move to **read/insert/update open to all
  authenticated users**. Delete is also permitted at the RLS level (no per-row
  role data exists in Postgres to gate it there yet) — see the accepted gap in
  §2. This replaces the owner-only policies from the auth round
  (`0002_auth_rls.sql`).

## 4. Canvas library: React Flow

Chosen over tldraw specifically for licensing clarity: React Flow (`xyflow`) core
is MIT-licensed, free with no conditions. tldraw's SDK is source-available under a
custom license — likely fine for this internal tool's scale, but carries terms
worth not tracking when a clean alternative exists. React Flow's node model (nodes
are plain React components) also fits a full chat card naturally, and its edges
are exactly what the deferred Main Agent flowchart will need later.

## 5. Card rendering

- A card is a compact version of the existing chat UI: reuses `MessageBlock`
  (scrollable, capped height) and `InputBar`.
- Input bar is enabled only for the current claimant (§2); for anyone else it's
  disabled but message history still updates live.
- Clicking a card's expand control switches to **Chat view** with that chat
  selected (see §8) — this satisfies "expands to full size, same as the docked
  pane" from `spec.md` §2.2 without a second full-size-card rendering path.
- A **"+" canvas control** creates a new chat (`createChat(null)`, positioned at
  the click point) and adds a card for it.

## 6. Backend (Rust) — minimal change

`claude --print` is already a one-shot process per turn, not a long-lived
session — `SpawnConfig.resume_session_id` already exists in
`src-tauri/src/claude_process.rs` but is currently always `None`
(`lib.rs::start_session` hardcodes it). This means multi-chat needs **no new
Rust-side session registry** — concurrency is just multiple one-shot invocations
in flight at once, each independent:

- `start_session` gains a `chat_id: String` param and starts actually threading
  `resume_session_id: Option<String>` through (previously always `None` — this
  was a pre-existing gap where every turn started a disconnected session with no
  memory of prior turns; fixing it is required infrastructure for claim
  hand-off, not scope creep).
- Emitted events wrap as `{ chatId, event: ClaudeEvent }` (the event name stays
  `"claude-event"`) so the frontend can route each event to the right chat's
  message reducer.
- After a turn completes, the frontend writes the new `session_id` back to that
  chat's `claude_session_id` column in Supabase (§3), so the *next* send for that
  chat — by the same person or a different one after a claim hand-off — resumes
  the same underlying conversation.

## 7. Frontend state

- Replace the single `messages` / `streaming` / `chatIdRef` state in `App.tsx`
  with `Record<chatId, { messages, streaming }>`, keyed by chat id. Plain React
  state — no new state management library needed for this scope.
- On mount: fetch all chats (now readable for everyone under the new RLS),
  render one card each.
- **Supabase Realtime** subscription on `messages`/`chats` inserts keeps every
  card's history live-updating as completed turns land, regardless of who's
  occupying it. Uses the Supabase JS client already in the app — no new
  dependency.

## 8. View toggle

- Titlebar toggle: **Chat view** (existing single-chat pane, gains a dropdown to
  pick among all chats) ↔ **Canvas view** (new). Both read the same
  `Record<chatId, ChatState>` — switching views never changes the underlying
  data, only how it's rendered, matching `spec.md` §2's framing.

## 9. Position sync

- **Liveblocks Storage `LiveMap<chatId, {x, y}>`** for live drag-follow across
  viewers — reuses the Liveblocks room already wired up for presence
  (`src/lib/liveblocks.ts`), and gives conflict-free simultaneous drags (two
  people moving different cards at once) via its CRDT storage, matching
  `decisions.md`'s rationale for choosing Liveblocks over Supabase Realtime for
  this exact case.
- Debounced (on drag-end) write to `chats.position_x`/`position_y` in Supabase
  so layout survives reload / everyone leaving the room — Liveblocks storage is
  the live layer, Supabase is the durable snapshot, matching the split
  established in `decisions.md`.

## 10. Open gaps (flagged, not silently dropped)

- **No real role-based permissions.** Delete guardrails are UI-only (confirm
  dialog + unclaimed check), not enforced in RLS. A senior/junior permission
  tier was discussed and explicitly deferred — no roles table exists yet.
- **Claim conflicts are last-write-wins at the presence layer.** Two people
  sending in the same instant to a just-unclaimed card is not specifically
  arbitrated in this design; Liveblocks presence updates should make this rare
  in practice, but it isn't a hard guarantee.
- **No abandoned-claim timeout beyond disconnect.** If someone's app crashes
  without a clean disconnect, Liveblocks presence should still expire the claim
  (that's its normal behavior), but this hasn't been verified against this
  specific claim model.
