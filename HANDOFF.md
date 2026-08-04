# Hand-off — Vibeco2

## What happened this session
Pure brainstorming (no code) that produced `spec.md` in this folder — a multiplayer coworking
app built on top of the existing Claude Code GUI ("each chat is a branch" + a Main Agent that's
the only thing with `main` write access). Covered: UI shell (Chat/Canvas view toggle), platform
(Tauri + Rust + Supabase over native Swift, mainly for canvas/graph UI reasons), orchestration
model (git handles mechanical conflict detection for free; AI only judges what git can't; hosted
on GitHub Actions, billed via the Anthropic API — not a shared Pro/Max subscription, not a local
LLM), and a cost section that got revised upward mid-session after pushback (see spec §5).

## Current state
- `spec.md` — the full design, brainstormed and agreed, not yet planned or implemented.
- No code exists for this project yet. No git repo initialized in this folder yet.
- This is a brand-new sister folder to `../Claude Code GUI` (the existing single-player native
  app this evolves) and `../VibeCo` (an older, unrelated prior project with the same-ish name —
  don't confuse the two).

## Open items (see spec §6 for the full list)
- Chat view center-right pane: read-only or writable when viewing a teammate's agent?
- Exact heuristic for "git says clean but still worth AI review."
- Exact triage-tier model/check used before full AI judgment.
- When the $99/year Apple Developer Program becomes worth it vs. manual Gatekeeper bypass.
- How a person overrides/appeals a Main Agent decision.

## Next steps
Nothing implemented yet — next session should either resolve the open questions above, or go
straight into an implementation plan (`writing-plans` skill) from the spec as-is, flagging the
open questions as decisions to make along the way rather than blockers.

To resume: paste `Vibeco2/spec.md` into a fresh session.
