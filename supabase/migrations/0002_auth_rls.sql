-- Wipe existing ownerless test data (dev-only rows from before auth existed).
delete from messages;
delete from chats;

-- Add ownership column, defaulting new rows to the inserting user.
alter table chats
  add column user_id uuid not null references auth.users(id) default auth.uid();

-- Enable RLS on both tables.
alter table chats enable row level security;
alter table messages enable row level security;

-- chats: owner-only access.
create policy "chats_select_own" on chats
  for select using (auth.uid() = user_id);
create policy "chats_insert_own" on chats
  for insert with check (auth.uid() = user_id);
create policy "chats_update_own" on chats
  for update using (auth.uid() = user_id);
create policy "chats_delete_own" on chats
  for delete using (auth.uid() = user_id);

-- messages: ownership derived through the parent chat.
create policy "messages_select_own" on messages
  for select using (
    auth.uid() = (select user_id from chats where chats.id = messages.chat_id)
  );
create policy "messages_insert_own" on messages
  for insert with check (
    auth.uid() = (select user_id from chats where chats.id = messages.chat_id)
  );
create policy "messages_update_own" on messages
  for update using (
    auth.uid() = (select user_id from chats where chats.id = messages.chat_id)
  );
create policy "messages_delete_own" on messages
  for delete using (
    auth.uid() = (select user_id from chats where chats.id = messages.chat_id)
  );
