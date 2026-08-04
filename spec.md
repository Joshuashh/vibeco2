# Vibeco2 — Design Spec

Date: 2026-08-04
Status: Brainstormed and agreed; not yet planned or implemented.

## 1. What this is

A multiplayer coworking app: several people, each running their own local Claude Code CLI, working side by side in one shared visual space instead of in isolated terminals. The core idea carried over from the original Vibeco concept: **each person's chat is a branch**, and a **Main Agent** is the only thing with authority to merge work into `main`. This app is the UI and coordination layer on top of that idea — a visual, collaborative front end for a workflow GitHub already enforces well, built to bring people closer together while they use it rather than working apart.

Evolves the existing **Claude Code GUI** codebase (currently native Swift/SwiftUI, single-player, local-only) rather than starting from scratch, though the platform decision below changes the implementation stack.

## 2. UI shell

Two view modes, toggled from the titlebar, both reading from the same underlying data (chats, canvas positions, statuses) — switching modes never changes the data, only how it's rendered.

### 2.1 Chat view

Fixed, docked layout for focused pair work:

- **Left column** — human-to-human chat (Slack-style). The team talking to each other as people, not through their agents.
- **Center-left pane** — your own AI conversation. Always present, always fixed here.
- **Center-right pane** — swaps between teammates' AI conversations via tabs along the top. One open question this spec leaves for the implementation plan: whether the pinned pane is read-only (you watch, only that teammate can direct their own agent) or anyone can type into it. Leaning read-only to avoid collision, but not locked in.
- **Right column** — tools/logs: file tree, terminal, diff viewer, and a merge log showing recent Main Agent decisions.
- **Toolbar** — person tabs, plus two buttons that are deliberately *not* tabs: **Main Agent** (its own conversation/log, same as everyone else's but with elevated permissions) and **Preview Build** (swaps the center panes for a live preview of the running app; toggles back to restore the split).

### 2.2 Canvas view

A pannable, zoomable, Figma-style spatial view of the same chats:

- Each chat renders as a **small but complete Claude Code-style conversation card** — real message bubbles (both sides), tool-call rows, its own input bar. Not a comment or a one-line status note. Clicking a card expands it to full size, same as the docked pane.
- Cards are grouped into **labeled frames** representing feature areas (e.g. "UI", "Features") — dashed-border regions people drag their chat cards into. No enforced structure; frames are just labeled regions.
- Multiple chats can share a frame.
- Unassigned/scratch chats can float outside any frame.
- **Main Agent sits at the top as the root of a top-down flowchart**, not a hub-and-spoke wheel. A trunk line splits evenly into symmetrical branches, one per frame (or per floating chat), landing at the top of each — reads as a build/review pipeline, not a social graph.
- Left (human chat) and right (tools/logs) columns stay fixed and identical to Chat view; only the center changes.

## 3. Platform & sync

- **Client**: Tauri + Rust backend, web frontend (React or similar) for the UI — chosen over continuing pure native Swift specifically because of the Canvas view. SwiftUI has no good answer for draggable-node/connector-line UI (and this codebase's own `decisions.md` already shows real pain from custom SwiftUI layout — the GeometryReader popover bug, a 218s single-view compile time), while the web ecosystem has purpose-built libraries for exactly this (React Flow, tldraw). Tauri was chosen over Electron for a lighter footprint (no bundled Chromium) and lower idle RAM, at the cost of a Rust backend instead of Node — judged an acceptable tradeoff since the backend's job (spawn a process, parse a JSON stream, relay over the network) doesn't lean hard on either language's strengths. Both Electron and Tauri were confirmed capable of driving the local `claude` CLI over a PTY, same as native Swift does today — that requirement did not favor Swift over web-tech at all.
- **Local CLI, BYO subscription**: Each person's own machine runs its own `claude` CLI process locally (same PTY-driven architecture as the current Claude Code GUI), authenticated under their own individual Claude subscription. No shared/centralized token source for human users. This also resolves the "does the engine need to run somewhere always-on" question that a centralized-CLI design would have created — there is no shared engine to host for the humans.
- **Backend split — Supabase for durable state, Liveblocks for realtime/multiplayer**: two vendors, deliberately, because they solve different problems and multiplayer is the core product driver here (see `decisions.md` for the full comparison).
  - **Supabase** (Postgres + Auth): persists chat history, canvas layout snapshots, and the merge log so state survives reloads and lets people rejoin. Auth handles room membership.
  - **Liveblocks**: carries all live multiplayer — human chat delivery, live cursors, canvas card drag/position sync, frame membership changes, and each person's live AI conversation content streaming to onlookers in full (not just status; privacy was explicitly ruled out as a concern since this is only used for internal work builds). Liveblocks' Presence gives cursors/awareness for free, and its CRDT storage (`LiveList`/`LiveObject`/`LiveMap`) gives conflict-free simultaneous edits — e.g. two people dragging different canvas cards at once — without hand-rolled conflict resolution. This is the same realtime layer already proven in the sibling `VibeCo` codebase (`liveblocks.config.ts`, `Cursors.tsx`), reused here rather than rebuilt on Supabase's lower-level Presence/Broadcast primitives.
  - Supabase Realtime was considered and rejected as the multiplayer layer specifically (not rejected as the persistence layer) — see `decisions.md`.
- **Distribution / cost**: no cost to build and run locally. Distributing the built app to teammates needs either (a) an Apple Developer Program membership ($99/year) for code-signing + notarization so installs are frictionless, or (b) zero cost with each teammate doing a one-time manual Gatekeeper bypass on an unsigned build. Start with (b); revisit (a) once the team is large enough that the friction matters. Mac App Store distribution was ruled out — sandboxing requirements complicate spawning the `claude` subprocess via PTY.
- **The official Claude desktop/chat app is unrelated** — different product surface, different backend, no data crossover with anything in Vibeco2.

## 4. Orchestration model — the Main Agent

### 4.1 Roles

- **Everyone's local CLI is a code-writing "sub-agent"**: it can write files, make changes, commit, and push to its own feature branch. It has no authority to touch `main`.
- **The Main Agent is the sole entity with write access to `main`** — holds GitHub credentials (bot/service account) capable of running the equivalent of `git merge` / `gh pr merge`. Architecturally it's just another `claude` instance, same as everyone else's, with a coordinator-flavored system prompt and elevated permissions instead of a person typing at it — which is why it gets a tab/pane like everyone else rather than being a special UI concept.

### 4.2 Trigger and flow

1. A person finishes work in their chat and explicitly hits **Commit** — nothing happens automatically before this; the Main Agent doesn't watch continuously.
2. The Main Agent evaluates the incoming change against everything else currently in flight.
3. **If GitHub reports a clean, non-conflicting merge**: proceed (subject to the triage/judgment layer in §4.3 — a clean git-level merge doesn't automatically skip AI review entirely, see below).
4. **If there's a conflict or overlap with someone else's in-progress work**: the Main Agent raises the conflict and can suggest holding the new work on its own branch rather than merging immediately.
5. Once the conflicting work resolves (the other person finishes, or their own commit lands first), the Main Agent compares the held branch against the new state of `main` and performs a **controlled merge** — reconciling both sets of changes rather than a raw git merge.
6. On any real ambiguity, the Main Agent never merges unsupervised — it flags the problem (into the relevant person's chat, or its own tab) and waits for a human, rather than guessing.

### 4.3 GitHub does the mechanical work; AI only judges what git can't

This is a deliberate cost- and correctness-driven split, not an implementation detail:

- **Git/GitHub's own dry-run merge detection** decides whether two branches conflict at the text level, and exactly which lines — for free, instantly, no model involved.
- **The AI is only invoked when there's something to actually judge**: either git reports a genuine textual conflict that needs reconciling, or (rarer) git reports a clean merge but the changes are close enough in intent that they warrant review anyway (two people touching the same function from different angles without literally overlapping lines).
- When the AI is invoked, it's handed the targeted diff/patch GitHub already computed — not told to go re-derive what changed by exploring the repo itself.
- A cheap triage pass (a fast model, or a plain mechanical file-overlap check — no model at all) filters the large majority of clean, unambiguous commits before they ever reach a full agentic reasoning pass. Full reasoning-model judgment is reserved for the genuinely ambiguous cases.

This funnel — free git check → cheap triage → expensive judgment only when warranted — is the primary cost control for the whole system, more load-bearing than model choice.

### 4.4 Hosting the Main Agent

- No dedicated always-on server for the Main Agent. It's event-triggered (a commit signal, or a later-arriving conflict resolution), which maps naturally onto **GitHub Actions** — a workflow run checks out the repo and invokes Claude with real repo access (Anthropic ships an official GitHub Action for this), billed per-run rather than for idle server time.
- The one real limitation: a GitHub Action can't sit and wait indefinitely for a *different* branch to finish (the "hold and reconcile later" case in §4.2 step 4–5). That case is handled as a **stateless resume**, not a long-lived process — state for the pending comparison lives in Supabase, and the second branch's own commit event re-triggers a fresh Action run that picks the pending comparison back up from stored state.
- **Credentials**: the Main Agent authenticates against the **Anthropic API directly (pay-per-token)**, not a Claude Pro/Max subscription (CLI OAuth login). This was a deliberate choice after evaluating both alternatives:
  - *A dedicated Pro/Max subscription account* was rejected — the five-hour usage window a subscription plan allows is sized for one person's interactive pace, not a shared service that may be triggered by a dozen+ commits clustered in a short window across a whole team; it risks throttling exactly when people are waiting on merges, with no way to buy more headroom mid-window. It's also a use pattern (unattended automated service, not personal use) the plan isn't really sold for.
  - *A local LLM* was rejected — it reintroduces the always-on-hosting problem the GitHub Actions choice specifically avoids (needs real, continuously available GPU compute), and the capability gap between an affordably-self-hostable model and Claude Sonnet/Opus matters most on exactly the task being delegated here (nuanced merge/conflict judgment, the most consequential decision in the whole system).

## 5. Cost model

- **Model default: Sonnet, not Opus**, reserved for the cases that reach full AI judgment per the §4.3 funnel. Opus (5× the output cost) is not the default; escalate to it only if a specific case demonstrably needs it.
- **Prompt caching is architected in from the start**, not bolted on later — repeated context across invocations (repo state, recent history) should hit cache (~10% of full cost) rather than reprocessing from scratch on every turn. This matters most for any multi-turn reconciliation work, where naive re-sending of full history on every turn is the single biggest cost risk in the whole system.
- **A hard budget/alert** should exist so a runaway loop or unexpectedly busy day doesn't silently run up an unbounded bill.
- **Honest range, not a promise**: earlier back-of-envelope math (assuming lightweight single-pass diff review) put this at $20–100/month for a busy team — that estimate was too optimistic, since real reconciliation work is closer to a genuine agentic coding session (multi-turn, tool-heavy, growing context) than a quick classification pass. A more honest range, absent the mitigations above, is plausibly in the low hundreds of dollars a month for a busy team. The §4.3 GitHub-does-the-heavy-lifting funnel is the primary lever pulling that back down, since it should keep the large majority of commits from ever reaching full AI reasoning at all.
- **Before committing to any number, run a real pilot** against a day or two of actual team commit volume and measure real spend — neither the optimistic nor the pessimistic estimate here is grounded in real data yet.
- **BYO CLI for humans limits blast radius**: since each person's own coding work runs on their own personal subscription, the shared/metered cost surface is just the Main Agent's coordination overhead — it doesn't multiply per additional teammate the way a fully centralized model would.

## 6. Open questions (not resolved — flag for the implementation plan)

- Chat view center-right pane: read-only when viewing a teammate's agent, or can anyone type into it?
- Exact conflict-detection heuristic for the "git says clean but still worth AI review" case in §4.3 — what triggers it beyond "touches the same function"?
- Exact triage-tier model/heuristic used before full AI judgment (a specific fast model vs. a pure mechanical check).
- Apple Developer Program timing — at what team size does the $99/year distribution friction become worth paying for?
- Whether/how a person can override or appeal a Main Agent decision they disagree with.
