# Canvas view completion — Groups, Main Agent, Build Preview — Design Spec

Date: 2026-08-05
Status: Brainstormed and agreed; not yet planned or implemented.

## 1. What this covers

The Canvas view (multi-chat, drag/position sync) and a basic Chat view already exist
(`docs/superpowers/specs/2026-08-05-canvas-view-design.md`). This spec designs the
remaining pieces of the Canvas view that `spec.md` described in prose but were never
laid out concretely: **groups** (spec.md's "frames"), the **Main Agent** node, and a
**live build preview**. It supersedes spec.md §2.2's frame and Main Agent description
where they conflict — see §6.

Out of scope for this pass (unchanged, still prose-only per spec.md): the human-to-human
chat column, the tools/logs column, and Chat view refinement.

## 2. Groups (replaces "frames")

spec.md originally described frames as dashed-border regions someone draws and drags
chats into. That's replaced with **implicit, proximity-based grouping** — no one draws
anything:

- Dragging a chat card near other cards causes them to auto-cluster into a group.
- Clustering **snaps cards into a magnetic horizontal/vertical grid** — not a free-form
  organic layout. Cards align to a shared grid within the cluster as they're dragged in.
- A group's identity is a **floating label chip** hovering above the cluster's centroid —
  no boundary line, no background tint, no hull. Lightest-weight visual treatment,
  relies on spatial proximity + snap alignment to read as "these belong together."
- The label is editable (click to rename).
- Dragging a card far enough away from its cluster splits it back out to unassigned/floating.
- Multiple cards can share a group; unassigned/scratch chats float outside any group with
  no label.

## 3. Main Agent

spec.md §4.1 originally framed the Main Agent as "architecturally just another claude
instance... gets a tab/pane like everyone else." That's replaced:

- **No conversation interface.** You do not chat with the Main Agent. It's an auditor —
  it merges, holds, and flags — not a peer to talk to. Humans resolve conflicts by
  talking to each other or editing their own branches, not by prompting the Main Agent.
- It renders as a **compact status bar**: three colored counters — merged (green) / held
  (amber) / conflict (red) — plus a small identifying label/icon.
- **Click expands a dropdown log** with per-item detail (which chat, what happened, when).
- When the Main Agent holds or flags a specific chat's work, that chat's **card also gets
  a visible marker** (colored border + small badge, e.g. amber "⚠ held") — not just an
  entry in the log. The owner should see it at a glance on canvas without opening the log.
- This removes the open question in spec.md §6 ("whether/how a person can override or
  appeal a Main Agent decision") from being mediated through a Main Agent chat — appeals
  happen through the person's own workflow (talk to teammates, adjust their branch), not
  a conversation with the Main Agent. Still an open question *how* exactly, deferred to
  implementation planning.

## 4. Live build preview

New piece, not in the original spec.md:

- A **large panel showing the actual running app**, live — not a thumbnail, not a toggle
  that replaces the canvas. It's a persistent element on the canvas itself.
- **Position: fused to the top of the tree.** The Main Agent status bar sits along the
  panel's **bottom edge**, physically part of the same instrument rather than a separate
  node beneath it. The trunk line for the flowchart originates from the bottom of this
  combined preview+status unit.
- **Auto-refreshes on every successful merge to main** — no manual rebuild trigger. This
  is the point: watching the build evolve as merges land, together.
- **Freely resizable** (drag handles) — not fixed size, not just collapsible.
- This is a different mechanism from Chat view's existing "Preview Build" toggle button
  (spec.md §2.1), which swaps panes rather than persistently rendering. Whether that Chat
  view toggle stays, changes, or gets unified with this is an open question (§6).

## 5. Visual direction

Teenage engineering-inspired: near-black base surface, a single accent color (used here
as orange, exact hex TBD at implementation time) reserved for active/live state, thin
schematic lines rather than heavy borders or drop shadows, monospace micro-labels
(uppercase, letter-spaced) for status text, faint background grid texture. Idle/inactive
elements render muted gray; only active/live elements (streaming chats, the live counter
dots, held/conflict markers) carry the accent color — color is a signal, not decoration.

**Pulse animation**: active (currently streaming/working) chats show a visual pulse
traveling along their trunk connector line, up into the Main Agent/preview instrument —
implying live energy/data flowing from work-in-progress into the build. Idle chats show
no pulse, muted connector line. Exact animation mechanics (dot spacing, speed, easing)
are an implementation-time detail, not specified further here — reference the
`ui-resources` skill for concrete TE-style visual language during implementation rather
than re-deriving it from scratch.

## 6. Open questions (not resolved — flag for the implementation plan)

- How exactly does a person override/appeal a Main Agent hold, given there's no chat to
  argue with it? (E.g., a "force merge" action on the card itself? A required teammate
  review?)
- Does Chat view's existing "Preview Build" toggle (spec.md §2.1) get replaced by this
  persistent panel, coexist as a separate mechanism, or get unified?
- Exact grid-snap spacing/tolerance for group clustering.
- Exact accent color, type scale, and spacing tokens for the TE-inspired visual system —
  deferred to implementation, informed by `ui-resources`.
- Pulse animation implementation details (speed, dot count, trigger condition beyond
  "chat is actively streaming").
