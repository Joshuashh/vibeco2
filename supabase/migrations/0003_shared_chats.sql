-- Shared workspace model: chats are collaborative slots people claim to work
-- in, not resources permanently owned by whoever created them.
-- See docs/superpowers/specs/2026-08-05-canvas-view-design.md §2, §3, §10.

alter table chats
  add column position_x double precision,
  add column position_y double precision,
  add column claude_session_id text;

-- Drop the owner-only policies from 0002_auth_rls.sql.
drop policy "chats_select_own" on chats;
drop policy "chats_insert_own" on chats;
drop policy "chats_update_own" on chats;
drop policy "chats_delete_own" on chats;
drop policy "messages_select_own" on messages;
drop policy "messages_insert_own" on messages;
drop policy "messages_update_own" on messages;
drop policy "messages_delete_own" on messages;

-- Open read/write to any authenticated user. Delete guardrails (confirm
-- dialog, must be unclaimed) are enforced app-side only — there is no roles
-- table yet to gate delete at the RLS level (accepted gap, spec §10).
create policy "chats_select_all" on chats
  for select to authenticated using (true);
create policy "chats_insert_all" on chats
  for insert to authenticated with check (true);
create policy "chats_update_all" on chats
  for update to authenticated using (true);
create policy "chats_delete_all" on chats
  for delete to authenticated using (true);

create policy "messages_select_all" on messages
  for select to authenticated using (true);
create policy "messages_insert_all" on messages
  for insert to authenticated with check (true);
create policy "messages_update_all" on messages
  for update to authenticated using (true);
create policy "messages_delete_all" on messages
  for delete to authenticated using (true);

-- Enable Realtime so teammates' cards live-update on completed turns
-- (idempotent — skips tables already in the publication).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'chats'
  ) then
    alter publication supabase_realtime add table chats;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end $$;
