-- Handoff assignment gets the same durable, realtime-delivered notification
-- path as a mention (0018_mentions.sql) rather than a second parallel
-- system — a handed-off chat is arguably a stronger "this needs you" signal
-- than a mention, and reuses the exact same badge/toast/OS-notification/
-- inbox machinery, just with different display text per kind.
alter table mentions add column kind text not null default 'mention' check (kind in ('mention', 'handoff'));
