-- Mentions used to be a fire-and-forget Liveblocks broadcast: if the
-- recipient's app wasn't open at that instant, the ping was gone forever,
-- nothing to catch up on later. This makes a mention durable — one row per
-- recipient (an @all tag inserts one row per teammate) so read state stays
-- per-person — same open-to-authenticated + realtime-publication pattern as
-- logbook_entries (0012_logbook.sql).

create table mentions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  chat_id uuid references chats(id) on delete cascade,
  chat_title text,
  from_email text not null,
  to_email text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index mentions_unread_idx on mentions (to_email) where read_at is null;

alter table mentions enable row level security;

create policy "mentions_select_all" on mentions
  for select to authenticated using (true);
create policy "mentions_insert_all" on mentions
  for insert to authenticated with check (true);
create policy "mentions_update_all" on mentions
  for update to authenticated using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'mentions'
  ) then
    alter publication supabase_realtime add table mentions;
  end if;
end $$;
