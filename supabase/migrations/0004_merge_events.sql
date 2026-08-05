-- merge_events: the Main Agent's audit trail (merged / held / conflict per
-- chat). Read-only from the app for now — the Main Agent orchestration that
-- writes these rows is a separate, later infrastructure project (spec.md §4;
-- docs/superpowers/specs/2026-08-05-canvas-completion-design.md §3, §6). The
-- table and read path are built now so the status bar and card badges have
-- something real to read once that orchestration lands.

create table merge_events (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid references chats(id) on delete set null,
  status text not null check (status in ('merged', 'held', 'conflict')),
  detail text,
  created_at timestamptz not null default now()
);

alter table merge_events enable row level security;

create policy "merge_events_select_all" on merge_events
  for select to authenticated using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'merge_events'
  ) then
    alter publication supabase_realtime add table merge_events;
  end if;
end $$;
