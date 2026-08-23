# Vibeco2 — Decisions Log

Non-obvious choices and why, not a session-by-session changelog. Full history remains in `git log` — this file only tracks what's still load-bearing.

## Current shape (as of 2026-08-23)

- **Tabs:** Home / Cowork / Solo / Preview. Canvas is disabled (button removed, code intact, not deleted).
- **Cowork** (`AgentWindow.tsx`) = team attention mode: shared draft editor + ready-check + shelf → publish flow. It is the **only** path to `team`/`main` anywhere in the app — Chat's old instant-push button and the canvas node's "Promote to main" were both removed (see decision 3 below).
- **Solo** (`ChatPane.tsx`) = heads-down individual chat, no ceremony, instant local iframe preview only.
- **Home** = task-coordination dashboard (task lists = `chat.group_name`, completion = archived, assignment = claimant/handed-off-to), plus a trimmed "At a glance" section (your mentions/handoffs + recent activity). Deliberately not activity-log-shaped — see decision 6.
- **Multi-project:** `projects` table keyed by `repo_url` (not a local path — see decision 5), clone-on-demand per teammate. Chats, the Liveblocks room, and the git worktree root are all project-scoped.
- **Messages** carry `authorEmail` (who sent it) — drives shelf approver lists, the mention/@ system, and per-teammate name labels in multi-author chats.

## Standing decisions (with rejected alternatives)

1. **Liveblocks, not Supabase Realtime, for multiplayer.** Supabase stays the durable Postgres/Auth layer; Liveblocks is the live layer (presence, cursors, CRDT storage). Liveblocks is purpose-built for this (ready-made cursor/awareness components, conflict-free storage) and already proven in the sibling VibeCo codebase. Supabase Realtime was rejected as the sole backend — no CRDT layer, would need hand-rolled conflict resolution for concurrent edits.

2. **Session handoff via transcript-priming, not shared native resume.** `claude --resume` only works for the machine/account that created the session, but chats are a shared claimable resource. When the sender owns the session: normal native `--resume`. When they don't: skip resume, prepend a serialized transcript preamble instead, then transfer ownership. Rejected: always-inject (pays the cost even for the common same-owner case) and no-handoff-support (defeats the point of shared chats). Cost: the first message after a handoff is pricier and tool results get summarized, not replayed — accepted tradeoff.

3. **Shelf/publish is the only ship path; the solo instant-push button was removed.** The real differentiator between Cowork and Solo is attention mode, not "review vs. no review." Solo work only affects your own worktree until published, so it needs no ceremony. Cowork's ready-check literally means "everyone affected is present," so publish requires their agreement too — leaving an unreviewed side door anywhere makes that gate optional in practice. Solo chats aren't blocked by this: the ready-check auto-passes when you're the only occupant.

4. **Shelf approvers = message authors in that chat, not current room occupants.** A teammate who stepped away still needs to sign off before their work ships; someone merely watching shouldn't count as a required approver. The pre-send "everyone ready" check is intentionally kept presence-based — that answers a different question ("is everyone who should watch this happen actually here") than "who needs to approve the result."

5. **Projects store `repo_url` + clone-on-demand, not a local filesystem path.** `projects` is one shared row per project across the team — a local path only works if every teammate's checkout happens to live at an identical path, which won't hold. Each client clones into `<app_data_dir>/projects/<project_id>` on first open, deriving the same relative answer independently — no path bookkeeping, shared or per-machine. No GitHub OAuth/repo-browsing yet; assumes the same git credentials (SSH key/credential helper) already configured locally, same assumption the render/promote push code already made.

6. **Home is task-coordination-shaped, not activity-log-shaped**, after an explicit reframe mid-build. A trimmed "for you" mentions/activity section was later folded back in as one section among the task-coordination ones — compatible with the reframe since it's scoped to you, not a full team audit log. If Home starts feeling log-heavy again, that's the section to cut first.

7. **Human-only comments (no Claude invocation) were discussed and rejected/deferred.** Bolting a `to_claude` flag onto the existing message stream would merge human-coordination and AI-directing into one entangled model. If built later, it should be the dedicated separate human-chat column the original spec called for, not a mode-switch on the Claude-turn stream. What stays regardless: @mentions, handoff/assignment, and the per-chat "open" toggle (lets a non-claimant post) — none of these depend on the merged-stream idea.

8. **Mentions are persisted DB rows, not fire-and-forget Liveblocks broadcasts.** A broadcast is invisible to anyone offline at the instant it fires — the actual bar is "tag someone, they see it whenever they next open the app." One row per recipient (`@all` expands to one row per teammate) so read state stays per-person. Handoffs reuse the same table/pipeline (`kind: 'mention' | 'handoff'`) rather than a second notification system. Explicitly out of scope: reaching someone while the app itself isn't running (push notifications, waking a sleeping machine).

9. **Tailwind v4 + Radix/shadcn adopted** over MUI/Chakra/Ant Design (migration completed 2026-08-19/20) — those impose their own visual identity, which fights this app's existing dark palette. Durable gotcha from that migration, worth remembering on any future styling work: **Tailwind compiles utility classes in its own internal order, not JSX class-string order.** Two same-specificity classes targeting the same CSS property (e.g. a `base` and an `active` string both setting `background-color`) resolve by compiled source order, which is opaque and not stable to reason about from the JSX. Rule: never let more than one of a `base`/`active`/`inactive`/`disabled`-style class string touch the same property on the same element.

10. **Real token-level streaming**, not synthetic typewriter. The CLI's `--include-partial-messages` stream was already being requested but the parser ignored `stream_event`/`content_block_delta` entirely, so all text arrived as one lump per finished block regardless of generation speed. Fixed to consume real deltas, then added a client-side smoothed-reveal layer (rAF trickle at ~260 chars/sec, catches up if backlog exceeds 120 chars, snaps to full text the instant streaming ends) purely to smooth the CLI's bursty ~10-15-char delta chunks — never invents delay for text that hasn't arrived yet.

11. **Never run a scaffolding tool with a force/overwrite flag inside a directory with files worth keeping.** Incident (2026-08-04): `create-tauri-app --force` wiped `spec.md`/`decisions.md`/`docs/` because `--force` means wipe-and-recreate, not "tolerate extra files." Recovered from conversation context only, no commit existed yet. Scaffold into a fresh temp directory and move generated files in, or commit existing docs first so there's always a git-recoverable baseline.

## Known open bugs

- **Cowork toolbar (`AgentWindow.tsx`): caret invisible next to list markers, and a stuck grey hover box on toolbar buttons — unresolved despite two rounds of fixes that were each individually verified.** Both fixes were validated via out-of-app standalone HTML/JS reproductions (this session can't sign into the app to test live) and the DOM-position/hover-state reasoning held up in isolation — but the user confirmed both are still broken in the real running app. Don't trust an out-of-app repro's verdict here again; next attempt needs the user driving the actual app or a debugger attached to the live signed-in session.
- **Message timestamp hover-to-fade doesn't hide in the real Tauri app**, despite three different implementations (CSS `:hover`, per-row React state, document-level `mousemove`) all confirmed correct against an isolated repro served from the same dev server. Leading unconfirmed hypothesis: WKWebView's persistent bundle-identifier-scoped cache may be serving a stale JS bundle across restarts. Paused by user request rather than fixed — next step is clearing `~/Library/WebKit/<bundle-id>` and `~/Library/Caches/<bundle-id>`, or attaching Safari's Web Inspector to the running window.

## Deliberately out of scope (raised, not built)

- GitHub OAuth / browsing a teammate's repos in a dropdown for project selection.
- Live collaborative (Google-Docs-style) editing of Cowork's shared draft — would need the draft moved into Liveblocks `Storage` (Yjs), live cursors, and shared toolbar/formatting state. Scoped but not started; a separate piece of work from anything else here.
- Windows support for the permission-approval bridge — it's a Unix domain socket (`permission_bridge.rs`), matching this codebase's existing macOS-only assumptions elsewhere.
- Real auto-update for a packaged `.app` build — the self-update button only works under `tauri dev` (relies on its own file watcher for the "recompile" step).
