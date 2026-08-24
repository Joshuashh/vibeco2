-- The merge queue (ShelfPanel, "Add to Queue"/"Merge to Team") was pure
-- client React state — nothing durable, nothing shared. That meant a queued
-- item vanished on app restart (or was never visible to a teammate on a
-- different machine at all) with no way to recover it short of re-diffing
-- and re-queueing the chat by hand. Same open-to-authenticated RLS pattern
-- as every other table in this project (see decisions.md).

create table queue_items (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  summary text not null,
  submitted_by text not null,
  status text not null default 'queued' check (status in ('queued', 'conflict')),
  created_at timestamptz not null default now()
);

alter table queue_items enable row level security;

create policy "queue_items_select_all" on queue_items
  for select to authenticated using (true);
create policy "queue_items_insert_all" on queue_items
  for insert to authenticated with check (true);
create policy "queue_items_update_all" on queue_items
  for update to authenticated using (true) with check (true);
create policy "queue_items_delete_all" on queue_items
  for delete to authenticated using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'queue_items'
  ) then
    alter publication supabase_realtime add table queue_items;
  end if;
end $$;
