-- Logbook: auto-generated state-of-play briefs, written on a manual handoff
-- or an auto-checkpoint (app closed while still holding a claim). Separate
-- from merge_events — different shape (who worked, for how long, on what)
-- and a different identity axis (a person's stretch of work, not a git
-- merge outcome). Same open-to-authenticated pattern as every other table
-- in this project (see decisions.md — no roles table exists).

create table logbook_entries (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid references chats(id) on delete set null,
  project_id uuid references projects(id) on delete cascade,
  user_id uuid references auth.users(id),
  kind text not null check (kind in ('handoff', 'checkpoint')),
  handed_off_to uuid references auth.users(id),
  summary text not null,
  duration_seconds integer,
  created_at timestamptz not null default now()
);

alter table logbook_entries enable row level security;

create policy "logbook_entries_select_all" on logbook_entries
  for select to authenticated using (true);
create policy "logbook_entries_insert_all" on logbook_entries
  for insert to authenticated with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'logbook_entries'
  ) then
    alter publication supabase_realtime add table logbook_entries;
  end if;
end $$;

-- Persists a handoff assignment so it survives the assignee not being online
-- yet — same reasoning as claude_session_owner (0005_session_owner.sql).
-- Cleared when the assignee claims the chat or it's handed off again.
alter table chats
  add column handed_off_to uuid references auth.users(id);
