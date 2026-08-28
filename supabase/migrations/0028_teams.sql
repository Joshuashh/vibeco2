-- Multi-team support, phase 1: data model + project isolation.
-- See decisions.md decision 15. Team ≈ GitHub org; a project belongs to
-- exactly one team. Everything else -- chat/queue RLS, the switcher UI, the
-- branch-status popover -- is later phases. This migration only isolates
-- which *projects* a user can see; child tables (chats, messages,
-- queue_items) stay open-to-authenticated and app-scoped by project_id, same
-- posture as decision 3's "guardrails enforced app-side only".

create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

alter table teams enable row level security;
alter table team_members enable row level security;

-- security definer so the team_members RLS policies can themselves query
-- team_members without tripping infinite recursion.
create function is_team_member(tid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from team_members where team_id = tid and user_id = auth.uid()
  );
$$;

create policy "teams_select_member" on teams
  for select to authenticated using (is_team_member(id));
create policy "teams_insert_own" on teams
  for insert to authenticated with check (created_by = auth.uid());
create policy "teams_update_member" on teams
  for update to authenticated using (is_team_member(id));
create policy "teams_delete_member" on teams
  for delete to authenticated using (is_team_member(id));

create policy "team_members_select_member" on team_members
  for select to authenticated using (is_team_member(team_id));
-- Permissive insert for now: phase 2's invite flow is what should gate who
-- can add whom. ponytail: tighten with roles when they exist.
create policy "team_members_insert_all" on team_members
  for insert to authenticated with check (true);
create policy "team_members_delete_member" on team_members
  for delete to authenticated using (is_team_member(team_id));

-- One Default team holding everyone who exists today; every current project
-- moves into it. Mirrors migration 0021's "there was only ever one implicit
-- team, so there's nothing to split" backfill. Fixed sentinel id (not a
-- generated one carried between migrations) so the three project statements
-- below can reference it directly.
insert into teams (id, name, created_by)
values (
  '00000000-0000-0000-0000-000000000001',
  'Default team',
  (select id from auth.users order by created_at limit 1)
);

insert into team_members (team_id, user_id)
select '00000000-0000-0000-0000-000000000001', id from profiles
on conflict do nothing;

alter table projects add column team_id uuid references teams(id) on delete cascade;
update projects set team_id = '00000000-0000-0000-0000-000000000001' where team_id is null;
alter table projects alter column team_id set not null;

-- Tighten projects from open-to-authenticated (0011) to team-scoped -- this
-- is the actual isolation boundary the feature is about.
drop policy "projects_select_all" on projects;
drop policy "projects_insert_all" on projects;
drop policy "projects_update_all" on projects;
drop policy "projects_delete_all" on projects;

create policy "projects_select_member" on projects
  for select to authenticated using (is_team_member(team_id));
create policy "projects_insert_member" on projects
  for insert to authenticated with check (is_team_member(team_id));
create policy "projects_update_member" on projects
  for update to authenticated using (is_team_member(team_id));
create policy "projects_delete_member" on projects
  for delete to authenticated using (is_team_member(team_id));

-- New signups land in the oldest team so they don't open the app to nothing.
-- ponytail: stopgap until invite-driven membership (phase 2) -- a real invite
-- flow replaces this with "join the team you were invited to".
create or replace function handle_new_user_profile()
returns trigger as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  insert into public.team_members (team_id, user_id)
  select id, new.id from public.teams order by created_at limit 1
  on conflict do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'teams') then
    alter publication supabase_realtime add table teams;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'team_members') then
    alter publication supabase_realtime add table team_members;
  end if;
end $$;
