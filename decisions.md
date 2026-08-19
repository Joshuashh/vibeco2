# Vibeco2 — Decisions Log

## Task 3 (shadcn init): pinned CLI to 3.8.5, fixed a variable clobber (2026-08-19)

**What happened:** `npx shadcn@latest` now resolves to 4.18.0, which shipped a rewritten `init` flow — it defaults to Base UI (not Radix) as the component library and replaced the old "which base color?" (Neutral/Gray/Zinc/Stone/Slate) prompt with a preset picker (Nova/Vega/Maia/...), neither of which matches this plan's design intent (Radix primitives, Neutral base color — see the "Planned: adopt Tailwind CSS + Radix/shadcn primitives" entry below).

**Fix:** pinned to `npx shadcn@3.8.5 init -y -b neutral --css-variables`, the last release with the classic `--base-color`/Radix-default flow the plan was written against. Confirmed via `npm view shadcn versions` that 3.8.5 is the top of the pre-rewrite 3.x line.

**A second, more important issue this surfaced:** shadcn's init doesn't just append new CSS variables to `src/App.css` — where a variable name it wants (`--accent`, `--border`) already existed in the Task 2 `:root` palette block, it silently overwrote that line's value with its own oklch default instead of appending a duplicate. This clobbered `--accent: #ed6b26` → `oklch(0.97 0 0)` and `--border: #35373d` → `oklch(0.922 0 0)` in place. Restored both to their Task 2 values, then deleted everything shadcn actually appended (the `--radius`/`--background`/etc. block inside `:root`, plus the trailing `@theme inline`/`.dark`/`@layer base` blocks) per the plan's Step 4. Verified via the compiled CSS served by a running Vite instance that `--color-accent`/`--color-border` in the `@theme` block still resolve to the original hex values.

**Kept:** `@import "tw-animate-css"` and `@import "shadcn/tailwind.css"` (data-state/data-open custom variants, accordion keyframes, scroll-fade/shimmer utilities) and `@custom-variant dark (&:is(.dark *));` — none of these collide with existing styles, and upcoming Radix-based components (starting Task 4) will need the custom variants.

**Revisit when:** a later task in this plan needs a shadcn CLI feature only in 4.x (e.g. `add`ing a component) — re-evaluate whether to run that specific command unpinned and re-apply this same clobber check, or find 4.x's equivalent of `-b radix`/`--base-color`.

## Hand-off (2026-08-19 session, end)

**What happened this session:** fixed the popover overflow bug and trimmed the input bar (removed token-spend circle and Local/Cloud toggle, repurposed the directory picker into a `RepoPill` — still just UI scaffolding); fixed all four merge-orchestration known gaps (`promote_to_main` local-ref advance, `render_preview` retry-on-race, orphaned worktree sweep, preview-server shutdown-on-exit); designed, planned, and implemented the Preview review page (live team preview + pin/draw annotation overlay + comment panel, no frozen snapshots — see the entry below this one). All of it is committed and pushed to `origin/main`.

**Next requested feature, not started:** the user wants to **pick which repo/project a chat works on**, at the click of a button — i.e., make the `RepoPill` real. Right now every part of the merge-orchestration backend (`git_ops::repo_root()`, chat/team worktrees, the `BUILD · PREVIEW` box, and the new Preview tab) is hardcoded to operate on *this* Vibeco2 repo (`repo_root()` just resolves wherever the Tauri process's CWD is) — there's no concept of "a project" as a switchable thing at all.

**Why this is a new design task, not a quick add-on:**
- Needs a UI for choosing/adding a repo (local path picker? clone-a-GitHub-URL flow? a list of previously-used projects?) and probably a "project" concept persisted somewhere (Supabase table? per-chat column?).
- `git_ops.rs`'s worktree functions all take a `root: &Path` already — the plumbing to parameterize by a chosen repo instead of `repo_root()` is plausible, but every call site (`ensure_chat_worktree`, `render_preview`, `promote_to_main`, `ensure_team_preview_running`) currently derives `root` from the hardcoded resolver, not from anything chat- or project-scoped.
- The `BUILD · PREVIEW` box and the new Preview tab both assume `npm run dev` on a fixed port serves something meaningful — that's true for a Vite/React project (this one) but not for an arbitrary target repo, and definitely not for "just an HTML file with no dev server." The user's triggering example — asking a chat to "create a basic html screen" and wanting it to show up in the preview automatically — needs either a static-file preview path (no dev server, just serve the file) or a smarter per-project preview strategy, neither of which exists today.

**Recommendation:** start a fresh session for this — it's a real design question (brainstorm the repo-selection UX and the preview strategy for non-Vite projects before planning), not a continuation of the preview-page work just finished. Paste this hand-off in to pick it up.

## Preview review page implemented (2026-08-19 session, continued)

Built per `docs/superpowers/plans/2026-08-19-preview-review-page.md` (all 11 tasks): the top-level Preview tab now shows the live team preview full-bleed with a floating Cursor/Pin/Draw/Comments toolbar, pin notes with threaded replies and resolve/unresolve (resolved hidden by default, toggle to show), and freehand strokes with per-user undo. New Supabase tables `preview_pins`/`preview_pin_replies`/`preview_strokes` (migration `0007_preview_comments.sql`, applied), synced live via the same `postgres_changes` pattern as `merge_events`.

**Verification done:** `npm test` (58 passed, including the two new pure-logic suites), `cargo test` (15 passed, untouched by this plan), `tsc --noEmit` clean, no console errors on load in the running `tauri dev` session (HMR picked up the change).

**Verification NOT done:** the app is sign-in gated and this session had no credentials, so the actual click-through — placing a pin, drawing a stroke, resolving a comment, confirming realtime sync between two accounts — was never exercised live. Next session should sign in and walk Task 11 Step 3's manual checklist before trusting this feature end-to-end.

**Mid-session correction, worth remembering:** a chunk of earlier work in this same session (the popover box-sizing fix's component-code half, and all four merge-orchestration gap fixes) sat uncommitted for several turns and nearly got silently absorbed into an unrelated commit when `git add src/App.css` swept up stale changes alongside new ones. Caught by checking `git status` before assuming "done" meant "committed." Worth double-checking `git status` after any turn where code was edited but the commit step wasn't explicitly the last action.

## Fixed the four merge-orchestration known gaps (2026-08-19 session, continued)

**Context:** user confirmed the concurrent-render-preview concern is mitigated by design already — the button lives once on the shared preview box (`MainAgentInstrument.tsx`), scoped to whichever chat the current user has claimed, not duplicated per chat. But two *different* users can still each have their own chat claimed and press it at the same moment, so the race is cross-client, not fixable by having one button per client. Fixed all four gaps:

- **`promote_to_main` now advances local `main`** (`git_ops.rs`): after the remote push succeeds, best-effort fetch + fast-forward (or `update-ref` if `main` isn't the checked-out branch in the primary checkout) so new chats stop branching off a stale snapshot. Failure here doesn't fail the whole promotion — the important push already happened.
- **`render_preview`'s team-branch push now retries on loss** instead of erroring immediately: git's own fast-forward check is the real lock (two renders can't both win), so a losing push now re-fetches, `reset --hard`s the team worktree to the fresh `origin/team` (safe — that worktree only ever holds merges about to be pushed, never independent work), redoes the merge, and retries, up to 5 attempts. Considered adding a same-process `Mutex` too; skipped as redundant — the client button already disables mid-request, and the real race is cross-process, which only a retry-on-loss (or a real distributed lock) actually addresses.
- **Orphaned worktree sweep** (`prune_orphaned_chat_worktrees`, new Tauri command): chat deletion already called `remove_chat_worktree` (this was already wired, not actually missing), but if that call failed to complete (app quit mid-delete, offline), nothing ever retried it. Now, once at startup after chats load, the app tells the backend the known chat ids and any worktree under `vibeco-worktrees/` not in that list (and not `team`) gets removed.
- **Preview server now shuts down on app exit** (`preview_server.rs`'s new `shutdown()`, called from a `tauri::RunEvent::Exit` handler in `lib.rs`): kills the tracked `npm run dev` child so it can't orphan a process holding port 5180 after the window closes.

**Verified:** `cargo check`, `cargo test` (15 passed), `npx tsc --noEmit` all clean. Not exercised against a real concurrent-render scenario (would need two machines/processes racing on the same repo) — logic reasoning only.

## Hand-off (2026-08-19 session)

**What happened this session:**
- Fixed the canvas drag/resize glitch reported after the merge-orchestration work: root cause was `CanvasView.tsx`'s node-rebuilding effect depending on Liveblocks `self`/`others` presence objects, which change identity on every mouse move (live cursor broadcast) — every pointer move was rebuilding all canvas nodes, resetting `NodeResizer`'s internal drag state mid-gesture. Root-caused by building the real `.app` bundle (the raw `tauri dev` process isn't Launch-Services-registered and can't be driven via screen automation) and temporarily rendering the resize handles visible to confirm hit-testing was fine before finding the actual cause.
- Along the way: fixed a real `dragHandle`/`NodeResizer` conflict and a CSS specificity bug (React Flow's own stylesheet was winning over our resize-handle override, causing a persistent blue highlight).
- Merged the 2026-08-18 merge-orchestration branch to local `main` (worktree-per-chat, `chat → team → main` git plumbing, Render Preview / Promote buttons) — see that session's plan/spec docs.
- Brainstormed a **Preview review page** (live prototype + click-to-pin comments + freehand markup) but paused mid-design at the user's request — written up as `docs/superpowers/specs/2026-08-19-preview-review-page-design.md` for a fresh session to pick up. Not implemented.
- Restructured the top tabs into Plan/Build/Review, then reverted that per feedback ("didn't like this UI at all") back to the original flat toggle — kept only a disabled **Plan** tab ahead of Chat. Toolbar is now Plan | Chat | Canvas | Preview, both disabled, Single/Split back in its original toolbar spot.

**Current state:** working tree clean, all changes committed to local `main`. **30 commits are unpushed to `origin/main`**, spanning this entire session plus the prior merge-orchestration session — nothing has been pushed since before this project's rename to Vibeco.

**Open items:**
- Preview review page — spec written, not planned or implemented. See its own "open questions" section (native screen-capture approach, snapshot-strip placement, image storage).
- The merge-orchestration work's own known gaps are still open (see the 2026-08-18 entries below): `promote_to_main` doesn't advance the local `main` ref, no lock around concurrent Render Preview, no chat-worktree cleanup after promotion, no app-quit cleanup of the preview server.
- The revert of the tab restructure was via `git revert` (clean history, not squashed) — the two Plan/Build/Review commits and their reverts are all still in history if that direction is wanted again later.

**Next steps:**
1. Decide whether to push the 30 local commits to `origin/main` — flagged, not done automatically.
2. Pick up the Preview review page spec in a fresh session, or continue on the merge-orchestration known gaps.


## Known gap: `promote_to_main` doesn't advance the local `main` ref in the primary checkout (2026-08-18)

**What happened:** `promote_to_main` (`src-tauri/src/git_ops.rs`) fast-forwards the *remote* `main` by pushing `origin/team:main`, but never fetches/updates the local `main` ref in the developer's own primary repo checkout. `ensure_chat_worktree` branches new chats off local `main` (`-b <branch> <path> main`), so after a promotion, new chats keep branching off an increasingly stale local `main` until someone manually runs `git pull`/`git fetch` on the primary checkout.

**Why not fixed now:** updating a ref while it may be the currently-checked-out branch in the primary worktree is fiddlier than it looks (`git fetch origin main:main` refuses to update a ref that's checked out elsewhere in some configurations), and this self-heals with a manual pull — accepted as a known limitation for this lite pass rather than risking a blind fix to the primary checkout's HEAD.

**Revisit when:** this starts causing real friction (new chats branching off visibly stale `main` more than once a session), or when the app gains a place to safely run `git fetch` against the primary checkout without disturbing whatever's open there.

## Merge-orchestration leaf components call `lib/*` directly, bypassing the App.tsx callback convention (2026-08-18)

**What happened:** `RenderPreviewButton` (and `MainAgentInstrument`'s Promote button, same pattern) call `invoke()` and `lib/mergeEvents.ts`'s `insertMergeEvent` directly from a deeply-nested leaf component, rather than lifting the action up to an `App.tsx`-owned handler the way `handleDelete`/`handleRename` work for every other chat mutation (`ChatCardMenu`/`Sidebar` only ever call passed-in callbacks).

**Why this is fine here, deliberately:** `merge_events` writes don't need to touch any local React state directly — `App.tsx` already has an open Supabase realtime subscription on `merge_events` INSERTs that echoes the write back into state for `MainAgentInstrument`/`CanvasView` to read. Lifting this to a callback would just add an indirection with no behavioral difference. The convention it diverges from exists to keep chat-scoped state mutations centralized; this isn't one.

**When to keep doing this:** a leaf component may call `lib/*` (Supabase) or `invoke()` directly when the result doesn't need to flow through local component state and there's already a realtime/subscription path that reflects it elsewhere. Anything that needs immediate optimistic UI feedback, or that mutates chat-scoped state other code reads synchronously, should still go through an `App.tsx` callback like the existing convention.

## Hand-off (2026-08-17 session)

**Goal for this session:** get to an MVP for a weekend co-founder test.

**What changed (uncommitted — see "Open items" below):**
- **Real bugs fixed:** native `.app` was silently stale after the redesign commit (rebuilt); `claude` CLI binary lookup failed under GUI launch because it shelled out via `sh` instead of the user's real login shell, missing `~/.local/bin` (`src-tauri/src/claude_binary.rs`); failed `start_session` calls now surface as a message instead of vanishing; canvas cards had two overlapping dot-grid layers (removed the static CSS one, kept React Flow's); card drag was whole-card instead of header-only, with no way to pan without accidentally dragging a card (added Space-to-pan, `src/components/CanvasView.tsx`); a `useLayoutEffect` with no dependency array in the new `Popover` component caused an infinite render loop that blanked the UI on open (fixed with a dependency array + `ResizeObserver`); a global content-box sizing gap meant any `width:100%` + padding element (the input bar in split view) rendered wider than its parent and got clipped — fixed with a global `box-sizing: border-box` reset in `src/App.css`, not a one-off patch.
- **Session ownership vs. shared chats:** `claude_session_owner` column (migration `0005_session_owner.sql`, already applied to the live Supabase project) + transcript-priming handoff in `src/lib/transcript.ts` — see the decision entry below this one for the full rationale.
- **Chat view rebuilt** to match the sibling Claude Code GUI: real sidebar (`src/components/Sidebar.tsx`) with search/rename/delete, resizable via `src/components/ResizeDivider.tsx`, markdown rendering (`react-markdown`, new dependency), auto-scroll, centered/capped message column, per-chat title bar.
- **Split view:** two chat panes side by side (`src/components/ChatPane.tsx`) — your active chat + whichever chat your co-founder currently has claimed (auto-follow, no picker — reasonable only because it's a 2-person team). Single/Split toggle added to the toolbar.
- **Presence & live cursors:** deterministic per-user color (`src/lib/presenceColor.ts`, tested), face-pile avatars top-right, live multiplayer cursors (`src/components/LiveCursors.tsx`), colored claim indicators on canvas cards and chat pane title bars.
- **Real popup menus** (`src/components/Popover.tsx`) replacing the old click-to-cycle model/effort/permission pills — same collision/flip-to-avoid-edges logic as the Swift app's `DropdownMenu.swift`.
- Toolbar redocked as a normal top bar (was a floating overlay); several visual cleanups (removed terminal icon placeholder, some divider lines, cursor styling, chat-view sizes/colors matched to the Swift app's exact point values).
- Dev workflow switched from `tauri build --debug` + relaunch to `npx tauri dev` (hot reload) — much faster iteration; currently running in the background of this session.

**Open items / known gaps:**
- **Nothing is committed.** The entire list above is sitting in the working tree uncommitted (see `git status` — new dependency `react-markdown` in `package.json`/`package-lock.json` too). This is the single most important thing to resolve before anything else.
- Sign-out only lives in the Chat view sidebar now (moved there per explicit request) — **Canvas view currently has no way to sign out.** Deliberately left as-is; revisit when Canvas gets its own overhaul pass.
- `npx tauri dev` is running in this session's background process — it will die when this session ends. Next session needs to run it again for hot reload (or `tauri build --debug` for a real bundle check).
- Manual multi-person verification (two real accounts, claim handoff, split-view auto-follow) hasn't been exercised end-to-end — only single-account testing this session.

**Next steps:**
1. Review the diff and commit (probably worth a few logical commits rather than one giant one — CLI/bug fixes, chat-view redesign, split-view + presence, styling — rather than a single commit).
2. Push — `main` is currently 14 commits ahead of `origin/main` from *before* this session even started, plus everything new.
3. Test the split-view + presence + session-handoff features with an actual second person/account.
4. Canvas-view sign-out gap, if it matters before the co-founder test.

## Session ownership vs. shared chats: transcript-priming for handoff, not shared native resume (2026-08-06)

**The conflict:** chats are a shared, claimable resource (any teammate can pick one up and send the next message — the whole point of the canvas-view multi-chat model). But `claude --resume <session_id>` is not portable — the CLI reads a transcript file that lives on whoever's machine/account created that session. A different person claiming a chat and hitting send would silently fail to resume (or the Rust `invoke` would error) because that session doesn't exist on their machine.

**Decided:** Track a `claude_session_owner` (the Supabase user id) alongside `claude_session_id` on `chats` (migration `0005_session_owner.sql`). On send (`App.tsx` `handleSend`):
- If the sender **is** the owner (or no session exists yet): behave as before — native `--resume`, cheap and perfectly faithful.
- If the sender is **not** the owner: skip `--resume` entirely (`resumeSessionId: null`), and instead prepend a compact serialized transcript of the chat's stored message history (`src/lib/transcript.ts`'s `buildTranscriptPreamble`) ahead of the new prompt, so the fresh CLI session Claude starts under the new claimant's account still has situational awareness of what happened before. Ownership then transfers to whoever's session just started (`updateChatSession` sets both fields together on `session_started`).

**Why this option over the alternatives considered:**
- *Never use native resume, always inject transcript* — rejected: makes even the common case (same person continuing their own chat) pay the reconstruction cost and lose the CLI's native transcript fidelity, for no benefit in that case.
- *Don't attempt context handoff at all* — rejected: defeats the actual point of a shared/claimable chat model; a teammate picking up someone else's in-flight work would have Claude respond as if it had no idea what was being discussed.

**Consequence:** The first message after a handoff costs more tokens (full prior transcript resent as a preamble) and tool-use results are summarized as `[used tool: X]` rather than replayed in full — a deliberate lossy compromise to keep the preamble cheap. Every message after that handoff is a normal, cheap native resume again until the next handoff.

## Realtime/multiplayer backend: Liveblocks, not Supabase Realtime (2026-08-04)

**Decided:** Split the backend — Supabase (Postgres + Auth) for durable state, Liveblocks for the realtime/multiplayer layer (chat delivery, live cursors, canvas card position sync, live-streamed AI conversation content). Supabase remains the persistence/auth layer; it is not being replaced.

**Why:** Multiplayer is the core product driver for Vibeco2 (per user, this session). Compared head-to-head:
- **Liveblocks** is purpose-built for exactly this: Presence/cursors are first-class (`useOthers`, `useMyPresence`, ready-made cursor components), and it ships a CRDT storage layer (`LiveList`/`LiveObject`/`LiveMap`) giving conflict-free simultaneous edits for free — e.g. two people dragging different canvas cards at once, or co-editing text via its Yjs/Tiptap integration. This is the same realtime layer already proven working in the sibling `VibeCo` codebase (`liveblocks.config.ts`, `Cursors.tsx`, presence-based ready-up state), so it's reuse, not a new bet.
- **Supabase Realtime** is general-purpose and lower-level. It has Presence and Broadcast, so cursors/ephemeral sync are technically possible, but there's no CRDT storage layer — concurrent edits (e.g. simultaneous card drags) need hand-rolled conflict resolution, and there are no ready-made cursor/awareness components.

**Rejected alternative:** Supabase Realtime for everything (single vendor, simpler ops). Rejected specifically because multiplayer — not persistence — is the priority, and Supabase's realtime primitives are lower-level than what Liveblocks provides out of the box for exactly the Canvas view's draggable-node use case.

**Consequence:** Two backend vendors instead of one. Supabase Postgres tables (`chats`, `messages`, canvas layout snapshots, merge log) are the durable record; Liveblocks storage/presence is the live/ephemeral layer that (where relevant) gets snapshotted into Supabase on completion (e.g. a finished chat turn persists to `messages`, matching the existing foundation plan's Task 10). Auth/room membership stays on Supabase Auth.

**Supersedes:** `spec.md` §3 previously read "Backend: Supabase (Postgres + Realtime + Auth)" with Realtime doing all multiplayer sync. That line has been updated to reflect this split — see spec.md §3.

**Open follow-up:** The foundation plan (`docs/superpowers/plans/2026-08-04-vibeco2-foundation.md`) only used Supabase for chat persistence and did not touch Realtime, so it is unaffected by this change. A later plan (multiplayer/Canvas phase) needs to add the Liveblocks client, room setup, and Presence/Storage wiring — not yet planned.

## Incident: `create-tauri-app --force` deleted spec.md/HANDOFF.md/decisions.md/docs/ (2026-08-04)

**What happened:** While executing Task 1 of the foundation plan, `npx create-tauri-app@latest . --force` was run to scaffold into this non-empty directory. `--force` did not mean "tolerate extra files" as assumed — it cleared the directory before writing the template, deleting `spec.md`, `HANDOFF.md`, `decisions.md`, and the entire `docs/` folder (including the plan itself). No commit existed yet, so there was no git history to recover from.

**Recovery:** All four files were reconstructed from conversation context (they had been read/written earlier in the same session) rather than from Google Drive Trash, which this Drive-mounted folder syncs to but which wasn't queried successfully through available tooling in time. Content should be identical to the pre-incident versions.

**Why this happened:** `--force`'s actual semantics (wipe-and-recreate) weren't checked before use; `--help` output alone didn't make the destructive behavior obvious ("Force create the directory even if it is not empty").

**Fix going forward:** Never run a scaffolding tool with a force/overwrite flag directly inside a directory containing files worth keeping. Scaffold into a fresh temp directory, then move only the generated files in (or `git init` and commit existing docs *before* running any scaffolder, so there's always a git-recoverable baseline). Foundation plan Task 1 should be treated as amended to scaffold via a temp directory next time this is redone elsewhere.

## `portable-pty` 0.8: disable echo via the master fd, not the slave (2026-08-04)

**What happened:** Task 3 of the foundation plan called `slave.as_raw_fd()` to disable PTY echo via termios, mirroring the Swift codebase's approach of setting termios on the slave fd directly. `portable-pty` 0.8.1's `SlavePty` trait only exposes `spawn_command` — no fd access at all. `MasterPty`, however, does expose `as_raw_fd(&self) -> Option<RawFd>` on unix.

**Fix:** Call `tcgetattr`/`tcsetattr` on the **master** fd instead. This is valid because termios settings on a pty are shared terminal state — configuring them from either end affects the same underlying line discipline. `src-tauri/src/claude_process.rs`'s `disable_echo` now takes `&dyn MasterPty` and is called on `pair.master` right after `openpty()`, before the slave ever spawns a command.

**Consequence:** None functionally — same effect (ECHO cleared before any process touches the pty), just sourced from the master handle since that's what the crate actually exposes.

## Open security gap: RLS disabled on `chats`/`messages` (2026-08-04)

**What happened:** Applied the `0001_chats` migration to the real Supabase project (`febfuemspzwslaujdtwc`, "Vibeco 2"). Supabase's own advisor flagged that both `chats` and `messages` have Row Level Security disabled — with the anon/publishable key embedded client-side (as `src/lib/supabase.ts` does), anyone holding that key can read or write every row in both tables.

**Why not fixed immediately:** Enabling RLS with no policies blocks all access outright, and the right policies depend on auth/room membership — explicitly out of scope for the foundation plan (see plan's "Out of scope" section; spec.md §6 also leaves auth undecided). Writing throwaway policies now would need rewriting once real auth lands.

**Accepted for now, revisit before this app handles anything beyond a single developer's own test data:** this is fine for solo local development against a scratch project, but must not be treated as done — RLS + policies belong in whichever plan adds Supabase Auth and room membership (see spec.md §3, §6).

**Remediation SQL, when ready to add policies:**
```sql
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
```

## Planned: adopt Tailwind CSS + Radix/shadcn primitives (2026-08-19)

**Status:** Recommended, not started. Next session should brainstorm/plan this properly before touching code.

**Why:** App currently has zero UI kit — `App.css` is 1,663 lines of hand-rolled CSS across 24 components, including fully custom interactive primitives like `Popover.tsx` (164 lines reimplementing collision/flip-to-avoid-edges positioning). User flagged the app "looks awful" and asked what UI kit to adopt.

**Recommendation:** Tailwind CSS v4 (`@tailwindcss/vite`, no PostCSS config needed) for utility styling, paired with Radix UI primitives (or shadcn/ui, which copies Radix-based components into the repo rather than installing a styled dependency) for interactive components — dropdowns, popovers, dialogs. Rejected MUI/Chakra/Ant Design: they impose their own visual identity, which fights the existing dark palette pulled from the sibling Claude Code GUI (Swift) project's `AC` color system rather than complementing it.

**Migration shape:**
- Port the existing `:root` palette (App.css:22-40) into a Tailwind `@theme` block so existing colors become real Tailwind tokens — preserves current look.
- Tier 1 (swap for Radix, real behavior win): `Popover.tsx`, `ChatCardMenu.tsx`, Sidebar's delete-confirmation flow (→ `AlertDialog`), `ViewToggle.tsx` (→ `Tabs`).
- Tier 2 (pure restyle, no behavior change): remaining ~20 components, one at a time.
- Incremental, not big-bang: Tailwind can run alongside existing `App.css`; migrate file-by-file, deleting each file's old rules from `App.css` as it migrates, rather than one large rewrite PR.

## Task 4: Popover.tsx migrated to Radix Popover (2026-08-19)

**What happened:** Replaced the hand-rolled 164-line collision/flip positioning logic in `Popover.tsx` with Radix's `Popover.Root`/`Anchor` (`virtualRef`)/`Portal`/`Content`, using `avoidCollisions` + `collisionPadding={8}` in place of the old manual edge-clamping math. Added `@radix-ui/react-popover` as a direct dependency (was previously only transitive via the `radix-ui` meta-package from shadcn init). Deleted all `.popover-*` CSS rules from `App.css`, translated pixel-for-pixel into Tailwind utility classes using the `@theme` tokens from Task 2.

**Notable translation choices:**
- `.popover-row`'s `all: unset` was NOT ported as a Tailwind `[all:unset]` arbitrary class — Tailwind v4 orders generated utilities by internal property grouping, not by class-list order, so an `all:unset` utility could unpredictably win or lose the cascade against `box-border`/`flex`/etc. sitting in the same class string. Used explicit resets instead (`appearance-none bg-transparent border-0 outline-none font-inherit text-left`), which is deterministic.
- `.popover-row-badge`'s `background: var(--accent-dim)` kept as an inline `style` (not a Tailwind class) since `--accent-dim` isn't in the Task 2 `@theme` block — out of scope to add new theme tokens in this task.
- `Sidebar.tsx` and `InputToolbelt.tsx` needed zero changes — `Popover`/`PopoverHeader`/`PopoverRow`/`PopoverDivider` kept identical export names and prop signatures.

**Verified:** `npx tsc --noEmit` clean, `npm test` (58/58 pass), `npx vite build` succeeds.

## Task 5: ChatCardMenu.tsx migrated to shadcn DropdownMenu + AlertDialog; two structural CSS bugs found and fixed (2026-08-20)

**What happened:** Added `dropdown-menu.tsx`/`alert-dialog.tsx` via `npx shadcn@3.8.5 add` (also pulled in `button.tsx` as a shared dependency — expected, not requested directly). No new `package.json` dependency lines; both use the existing `radix-ui` meta-package. `DropdownMenuItem` does support `variant="destructive"` as the plan assumed, so no deviation needed there. Rewrote `ChatCardMenu.tsx` per the plan's Step 2 verbatim — prop signature (`title`, `onRename`, `onDelete?`) unchanged, `ChatCard.tsx`/`ChatView.tsx`/`Sidebar.tsx` untouched (confirmed via `git status`).

**Step 3 deviation from the plan's assumption:** the plan's Step 3 assumed `.chat-card-menu-dropdown*` was "exclusively used by the old `ChatCardMenu.tsx` implementation being replaced." That's false — grepping confirmed `Sidebar.tsx`'s still-hand-rolled `SidebarRow` (not migrated until Task 6) uses `.chat-card-menu`, `.chat-card-menu-dropdown`, and its `button` children directly. Kept all of that CSS. The only rule actually dead was `.chat-card-menu-dropdown button.destructive` (Sidebar's own delete button never had that class) — deleted just that one declaration.

**Two pre-existing structural bugs found during the mandated global-CSS-leak self-review, both fixed (not just documented) because they'd have made this task's headline feature — the delete confirmation dialog — genuinely broken or illegible:**

1. **The `input, textarea, select, button {...}` reset (and its `:hover`/`:disabled` siblings) was unlayered CSS beating every Tailwind utility class, not just the two properties Task 4 patched around.** Per the CSS Cascade Layers spec, *any* unlayered rule beats *any* layered rule regardless of specificity — and Tailwind's own utilities (`@import "tailwindcss"`) are emitted inside named layers, while this file's own rules were plain unlayered CSS. Confirmed empirically: built the app (`npx vite build`), served `dist/` via `vite preview`, and inspected `getComputedStyle` on elements carrying the real generated classes. `AlertDialogCancel`'s `h-9 px-4 py-2` computed to `9.12px 15.2px` padding (the global rule's `0.6em 1em`) instead of the intended `8px 16px` — Tailwind's `.px-4`/`.py-2` utilities existed in the compiled CSS but structurally could not win. This also means Task 4's `transition-none`/`text-text-primary` follow-up fixes on `PopoverRow` did not actually work either (verified in the same test) — worth a quick look next time that component is touched, though it's out of scope to fix here since Popover doesn't use the `<button>` element form these rules target the same way affected components do. **Fix:** wrapped just the form-control reset block in `@layer base { ... }` — merges into Tailwind's own pre-existing `base` layer, so it now loses to the `utilities` layer as expected, with zero effect on any of App.css's other (still-unlayered, class-based) rules since those already out-specificity a bare element selector regardless of layer.

2. **`@theme` never defined shadcn's standard semantic tokens** (`background`, `foreground`, `popover`, `muted`, `destructive`, `primary`, `secondary`, `input`, `ring`, `accent-foreground`) — Task 3 deleted shadcn-init's own versions of these as clobber cleanup, which was fine while Task 4's `Popover` was hand-written against this app's custom token names, but the first CLI-`add`ed component (this task) uses shadcn's stock class names (`bg-popover`, `bg-background`, `bg-destructive`, `bg-primary`, ...) which silently resolved to `transparent`/inherited with no error. Confirmed via the same built-and-served computed-style check: `bg-popover`/`bg-background`/`bg-destructive`/`bg-primary` all computed to `rgba(0,0,0,0)` before the fix. **Fix:** added the missing tokens to `@theme`, mapped onto the existing custom palette (e.g. `--color-popover: var(--color-bg-tertiary)`, `--color-destructive: var(--color-danger)`) rather than reintroducing shadcn's oklch defaults — purely additive, no existing token renamed or removed.

**Known minor cosmetic gap, not fixed:** `AlertDialogCancel` (variant `outline`) only sets its border color via `dark:border-input`, and this app never toggles a `.dark` class anywhere (confirmed via grep) — so in practice that border-color rule never applies, and the Cancel button's border falls back to `currentColor` (the inherited light text color) instead of the subtle `--border` shade every other bordered element uses. Cosmetically slightly brighter than intended, not invisible or broken. Revisit if/when a later task wires up an actual dark-mode toggle, or just add an explicit non-dark `border-input` mapping if it's visually bothersome before then.

**Verified:** `npx tsc --noEmit` clean, `npm test` (58/58), `npx vite build` succeeds, and the two CSS fixes above were confirmed by inspecting `getComputedStyle` on real generated classes served from a production build (the app is sign-in gated with no credentials available this session, so the actual authenticated click-through — opening the menu, triggering the confirm dialog — was not exercised live; only the underlying CSS resolution was verified).
