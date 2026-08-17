-- Native `claude --resume` only works for whoever's local machine/account
-- created the session — the transcript file it reads lives on disk there,
-- not anywhere shared. So a chat's live CLI session has a real owner, even
-- though the chat itself (and its message history) is shared/claimable by
-- anyone. Tracking that owner lets the app fall back to transcript-priming
-- instead of a native resume when someone else picks up the chat.
-- See docs/superpowers/specs/2026-08-05-canvas-view-design.md and
-- decisions.md's "session ownership vs shared chats" entry.

alter table chats
  add column claude_session_owner uuid references auth.users(id);
