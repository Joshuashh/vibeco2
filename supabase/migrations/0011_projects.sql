-- Projects: each project owns a repo (local checkout path for now) and a
-- set of chats. First step of multi-project support — data model only, no
-- UI wired up yet. See decisions.md "Multi-project support" entry.

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  repo_path text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) default auth.uid()
);

alter table projects enable row level security;

-- Same open shared-workspace policy as chats (0003_shared_chats.sql) — any
-- authenticated user can see/create/edit projects.
create policy "projects_select_all" on projects
  for select to authenticated using (true);
create policy "projects_insert_all" on projects
  for insert to authenticated with check (true);
create policy "projects_update_all" on projects
  for update to authenticated using (true);
create policy "projects_delete_all" on projects
  for delete to authenticated using (true);

-- Nullable for now so existing chats keep working untouched; becomes
-- required once the switcher (step 2) and project-scoped workspace
-- (step 3) land.
alter table chats
  add column project_id uuid references projects(id) on delete cascade;
