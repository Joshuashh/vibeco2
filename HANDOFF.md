# Hand-off — Vibeco2

## This session

Two pieces of work — both should be rendered to `team`, then start a fresh
chat for the comments/markup redesign.

### 1. Light mode (done, verified by Josh)

- Retuned `:root[data-theme="light"]` in `src/App.css` — off-white instead of
  pure white, softened text, darkened status hues.
- `HomeView.tsx`, `AgentWindow.tsx`, `ShelfPanel.tsx` each had a hardcoded
  dark `const C = {…}` palette → now `var(--…)` strings resolving against
  App.css tokens that flip on `[data-theme]`. Added a `--cw-*` token group
  (`:root` + light block). Scattered inline hex literals repointed too;
  chart/gradient/badge colors deliberately left literal.

### 2. team → main promotion gate (code done, MIGRATION NOT APPLIED)

Fills the last gap in the queue pipeline (decisions.md #3): `team` → `main`,
gated in the Preview tab (Team mode).

- **`supabase/migrations/0026_promotion_approvals.sql` is written but NOT
  applied** — the Supabase MCP apply was blocked by the sandbox classifier.
  Apply it (SQL editor or MCP) before the feature works. It: adds `'merged'`
  to the `queue_items` status check, creates `promotion_approvals`
  (project_id, team_sha, approved_by, approver_name, unique triple), enables
  RLS (open-to-authenticated, same as everything else), adds it to the
  realtime publication.
- **Behaviour:** "Merge to Team" now flips queue items to `status='merged'`
  instead of deleting them (they stay until a successful promote so the gate
  can show what's pending). A "Promote" button + popover in the Preview
  toolbar (Team mode only) shows: the merged changes, comment-resolution
  status, and an approval row per `profiles` row. Enabled only when **all
  `preview_pins` are resolved AND every profile has approved the current
  `team` sha**. On promote: `invoke("promote_to_main")` (unchanged, ff-only),
  then delete the merged queue items + clear the project's approvals.
- **Approvals are sha-bound** — `team_and_main_shas` (new Rust command)
  gives the current `origin/team` / `origin/main` SHAs; a later merge into
  `team` moves the sha and silently invalidates earlier approvals.
- **"Everyone" = every `profiles` row** (currently 2 = Josh + Ben). No roles
  table. Josh wants a real permissions/access-rights feature later — that
  supersedes this. Known limit: `profiles` isn't project-scoped.
- Files: `git_ops.rs` + `lib.rs` (`team_and_main_shas`), `src/lib/promotion.ts`
  (new), `src/lib/queueItems.ts` (`markQueueItemMerged`, `'merged'`),
  `src/components/PreviewPage.tsx` (gate UI, takes a new `project` prop),
  `src/App.tsx` (mark-merged not delete; pass `project`; filter `shelf` for
  ShelfPanel).

## State

- `npx tsc --noEmit` clean, `npx vitest run` 93/93, `cargo check` clean
  (pre-existing `open_pty` dead-code warning only).
- Nothing committed yet this session. Not clicked through live (Josh
  verifies UI himself).
- **Migration `0026` still needs applying to `febfuemspzwslaujdtwc`.**

## Next

1. Apply migration `0026`.
2. Live-check the promote gate: merge something to team, confirm it shows as
   pending, leave a comment → gate blocks, resolve it + both approve → gate
   unlocks, promote → `main` moves and the queue/approvals clear.
3. Fresh chat: **comments + markup redesign** — Josh: "really clunky at the
   moment and look pretty ugly." Independent of the gate (which only reads
   `preview_pins.resolved`).
4. Small leftover: trim the "more models" legacy list to the 4 real CLI
   model IDs (decisions.md / prior hand-off).
