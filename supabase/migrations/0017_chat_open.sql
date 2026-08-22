-- Loosens the claim lock per-chat: when open, a non-claimant can still send
-- (each send still invokes Claude — this is not a comment-only path, see
-- decisions.md "Human message authorship + @mentions, phase 1"). Default
-- false keeps today's single-claimant behavior unless someone opts a chat in.
alter table chats add column open boolean not null default false;
