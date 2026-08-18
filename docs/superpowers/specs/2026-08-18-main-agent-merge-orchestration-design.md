# Main Agent merge orchestration (lite) — Design Spec

Date: 2026-08-18
Status: Brainstormed and agreed; not yet planned or implemented.

## 1. What this covers

`spec.md` §4 describes the Main Agent as the sole entity with merge authority, backed
by GitHub Actions, an Anthropic API-billed identity, a triage funnel, and AI-driven
conflict reconciliation. None of that exists yet — this repo has zero git/branch/
worktree infrastructure today, and every chat currently shares one hardcoded
`workingDirectory: "."` (`src/App.tsx:126`), so two concurrent chats editing files would
collide in the same working tree.

This spec designs a **lite first version**: real GitHub branches and merges, no hosted
Main Agent process, no GitHub Actions, no automated AI judgment except a one-shot
explanation on genuine conflicts. Verification is **visual, human-driven, via a live
preview** rather than an automated test/build gate. Scope is a single repo — this one
(Vibeco itself) — per the "undecided / just this repo for now" answer; multi-repo
targeting is future work, not designed here.

**Supersedes** `docs/superpowers/specs/2026-08-05-canvas-completion-design.md` §4's "auto-
refreshes on every successful merge to main" — see §7 below for why this is actually
subsumed, not contradicted.

## 2. Foundational piece: worktree-per-chat

Each chat gets its own `git worktree`, created lazily on that chat's first Render
Preview or Commit action (not at chat-creation — most chats never reach that point):

- Branch: `chat/<chat-id>`.
- Worktree path: a sibling directory, e.g. `../vibeco-worktrees/<chat-id>`.
- `node_modules` is symlinked from the main worktree rather than reinstalled (it's
  gitignored either way; symlinking is free and avoids a redundant `npm install` per
  chat).
- Removed (`git worktree remove`) when the chat is deleted.
- `workingDirectory` in `App.tsx` becomes per-chat instead of the current hardcoded `"."`.

## 3. Branch model: chat → team → main

Three tiers, not two — this is the key structural decision from this design pass:

1. **`chat/<chat-id>`** — one per chat, where that chat's `claude` CLI process actually
   commits. Ephemeral; broken/WIP is expected and fine.
2. **`team`** — a single shared, persistent integration branch. This is what Render
   Preview merges into, and it's what actually catches conflicts between *multiple*
   people's simultaneous in-flight work — a pairwise chat-vs-`main` check alone would
   miss two branches that each merge cleanly into `main` but break each other.
3. **`main`** — stable, but explicitly **not** a production/deploy target (confirmed: no
   CI, no protected branches, no deploy workflow configured on this repo today). Only
   ever advances by **promotion** from `team` (§6), never touched directly by any chat.
   This is what new chats branch from, so it stays trustworthy even while `team` is
   messy mid-session.

## 4. The Render Preview button

A manual, on-demand action per chat (not automatic on every commit, not a continuous
file-watcher on uncommitted work — deliberately, to keep the cost of pressing it
predictable and avoid rebuilding on every keystroke-adjacent save). On press:

1. Commit the chat's current working-tree state (auto-generated message) in its
   worktree, push `chat/<chat-id>`.
2. In the (single, shared) `team` worktree: `git merge chat/<chat-id> --no-edit`.
3. **Conflict** → `git merge --abort` immediately — `team`'s files are never left in a
   conflicted state. See §5.
4. **Clean** → the merge commit lands on `team` and is pushed. See §6 for what the
   person sees.

## 5. Conflict handling

On a failed merge into `team`:

- Capture the conflicting file list (`git diff --name-only --diff-filter=U` before the
  abort, or equivalent via `git merge-tree` first as a pre-check).
- Write a `merge_events` row: `status: 'conflict'`, `detail` = file list.
- **This is the one place an LLM is invoked** — handed the two diffs (the chat's branch
  vs. `team`'s tip), it writes a **one-shot explanation and a proposed resolution**. This
  is posted as a system-style entry in the affected chat and/or the Main Agent's log
  detail — **not** an interactive conversation with the Main Agent. Per
  `2026-08-05-canvas-completion-design.md` §3, the Main Agent has no conversation
  interface and is not a peer to prompt; this preserves that — the LLM output here is a
  one-shot analysis artifact, the same shape as any other log entry, not a chat session.
- The human applies the fix themselves (in their own chat/branch) and presses Render
  Preview again. No auto-applied resolution in this version — an explicit, deliberate
  choice to keep a human in the loop on every conflict resolution, not just merges.
- Open question (not resolved here, see §9): does a `team` conflict block *everyone's*
  preview, or just that chat's? Default assumption for this pass: it blocks the shared
  preview, since it's one branch and one running server — simplest, and conflicts should
  be rare/fast to resolve for a two-person team.

## 6. The shared preview

Instead of building/serving a fresh preview per Render Preview press, one long-lived
dev server (`npm run dev` / `vite`, same pattern as the existing `.claude/launch.json`
`vite-dev` config) runs continuously against the `team` worktree. A clean merge in §4
just updates files on disk in that worktree — Vite's own file watcher picks up the
change and hot-reloads. No server restart, no rebuild-from-scratch cost per press.

This server is what the *existing* preview surfaces point at — the canvas preview
panel/Main Agent instrument (`MainAgentInstrument.tsx`'s `PREVIEW_URL` iframe) and the
Chat view's "Preview Build" toggle (`spec.md` §2.1) — no new preview UI needed, just a
new source of truth for what they display. Whether these two surfaces get unified is
still open per `2026-08-05-canvas-completion-design.md` §6 and isn't resolved here.

On a clean merge: `merge_events` row `status: 'held'` — buildable, previewable, not yet
on `main`. This is what a person watches before deciding to promote.

## 7. Promotion to `main`

A separate, explicit action — a "Merge to main" / "Promote" button, distinct from
Render Preview. Since nothing ever commits to `main` directly, `main` is always an
ancestor of `team`'s current tip, so promotion is a **fast-forward**
(`git push origin team:main`), not a second merge commit. On success: `merge_events`
row `status: 'merged'`.

**Why this subsupersedes the old "auto-refresh on every merge to main" behavior**
(`2026-08-05-canvas-completion-design.md` §4) rather than contradicting it: the preview
always tracks `team`'s current tip. Before promotion that's "pending merge preview";
since promotion is a fast-forward with no file changes, the exact same running worktree
and server continue to accurately reflect `main` immediately after promotion too — the
preview was already showing that state. Nothing needs to explicitly "refresh on merge."

## 8. Data model

`merge_events` (migration `0004`) already has the right shape — `chat_id`, `status:
'merged' | 'held' | 'conflict'`, `detail`, realtime-enabled — and is currently read-only
from the app. This adds an `insert` policy matching this project's existing
open-to-authenticated RLS pattern (no roles table exists anywhere else in this project
either):

```sql
create policy "merge_events_insert_all" on merge_events
  for insert to authenticated with check (true);
```

No new columns, no new tables. `MainAgentInstrument.tsx` already renders counts and an
expandable log from this table — it needs no changes, just real data flowing into it.

## 9. Open questions (not resolved — flag for the implementation plan)

- Does a `team`-branch conflict block everyone's shared preview, or only the offending
  chat's view of it? Defaulted to "blocks everyone" for this pass (§5); revisit if
  conflicts turn out to be frequent enough that this is actually painful.
- Exact prompt/scope for the one-shot conflict-explanation LLM call, and where precisely
  it's authenticated/billed from (reuses the person's own local `claude` CLI auth, same
  as every other chat? Or a separate call?) — not decided here.
- Whether/how the canvas preview panel and Chat view's "Preview Build" toggle get
  unified — carried over as still-open from `2026-08-05-canvas-completion-design.md` §6.
- What happens to a chat's worktree/branch after its work is promoted — deleted
  immediately, kept around, merged back to a fresh branch for continued work on the same
  chat? Not decided here.

## 10. Explicitly out of scope for this pass

No GitHub Actions, no hosted Main Agent identity/credentials, no Anthropic API billing
setup, no triage funnel, no cost budget/alerts, no auto-merge on clean (a human always
presses Promote), no continuous/live preview refresh on uncommitted work (Render Preview
is manual, on-demand only), no multi-repo targeting, no automated (auto-applied) conflict
resolution — the LLM in §5 only explains and proposes, a human applies the fix.
