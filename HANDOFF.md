# Hand-off — Vibeco2

## This chat (2026-08-28)

Several pieces, all committed-worthy, nothing committed yet. `npx tsc
--noEmit` clean, `npx vitest run` 106/106, `cargo check` clean (pre-existing
`open_pty` warning only). Render this to `team` and start fresh.

### 1. Comments/markup visual polish (done, Josh verified styling)

- New `src/components/previewCommentUi.tsx` — shared `Avatar`, `nameFor`,
  `relTime`, icon buttons, `CommentThread`. `PreviewCommentPanel` and the
  in-place `PinPopover` (in `PreviewAnnotationLayer`) now render the same
  card so they can't drift. Filled teardrop pin marker.
- Comment panel is a floating inset card: `rounded-lg` (8px),
  `shadow-[0_2px_16px_rgba(0,0,0,0.1)]`, inset 12px.
- Draft-pin cancel keeps you on the comment tool (`handleCancelDraftPin`).

### 2. Light-mode fix

- `.agent-draft-editor` in `App.css` had `color:#FFFFFF` hardcoded (+
  placeholder, blockquote) → `var(--text-primary)` / `var(--text-tertiary)`.

### 3. GitHub sign-in + token capture (code done, NEEDS DASHBOARD + MIGRATIONS)

- `src-tauri/src/oauth.rs` — `oauth_listen` (async + spawn_blocking; a sync
  command beachballs the UI) catches the OAuth redirect on `127.0.0.1:8899`
  (NOT `localhost` — IPv6/IPv4 mismatch = connection refused).
- `auth.ts signInWithGitHub` — PKCE + loopback, stores `provider_token` in
  `localStorage["vibeco.github_provider_token"]`, persists
  `user_metadata.user_name` → `profiles.github_login`. `supabase.ts` set to
  `flowType:"pkce"`, `detectSessionInUrl:false`.
- `LoginScreen` — "Continue with GitHub" button alongside email/pw.
- **Josh has done the 3 dashboard steps** (GitHub OAuth app, Supabase
  provider, redirect URL `http://127.0.0.1:8899`). Live round-trip not yet
  confirmed working end-to-end.

### 4. Pick a project from your GitHub repos

- `src/lib/github.ts` `fetchMyRepos` — `GET /user/repos`, plain webview
  `fetch`. `NewProjectDialog` shows a repo dropdown; picking fills the URL
  (`ssh_url`) + name. Manual URL kept.
- `git_ops.rs` clone error now appends a "ask to be added as a collaborator"
  hint on access failures.

### 5. Invite a teammate to the repo from the app

- `github.ts` `addCollaborator` (`PUT .../collaborators/{login}`, push) +
  `acceptPendingInvites([owner/repo])` + `parseOwnerRepo`.
- `EditProjectDialog` — "Invite a teammate" section (dropdown of profiles
  with a `github_login`, `window.confirm` gate).
- `App.tsx` open-project effect calls `acceptPendingInvites` for the
  project's repo before `open_project_repo`, so an invited teammate's clone
  just works on next open.

## MUST DO before features 3–5 work

Apply to Supabase `febfuemspzwslaujdtwc` (SQL editor or MCP):
- `supabase/migrations/0026_promotion_approvals.sql` — still unapplied from
  the previous chat (promote gate).
- `supabase/migrations/0027_profiles_github_login.sql` — new.

## Next

1. Apply migrations 0026 + 0027.
2. Live-test GitHub sign-in end to end; then invite Ben, confirm his app
   auto-accepts and the clone succeeds.
3. Leftover from earlier: trim the "more models" legacy list to the 4 real
   CLI model IDs.
