-- Track chat recency for the split-view chat picker.
alter table chats
  add column last_message_at timestamptz;

-- Backfill so already-active chats sort sensibly immediately.
update chats c
set last_message_at = coalesce(
  (select max(m.created_at) from messages m where m.chat_id = c.id),
  c.created_at
);
