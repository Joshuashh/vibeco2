-- The team -> main promotion gate (Preview tab). "Merge to Team" now parks
-- its merged items at status 'merged' instead of deleting them, so the
-- Preview tab can show what's waiting for main and who still has to approve
-- it. On a successful promotion those rows and the approvals below are
-- cleared.
--
-- Approvals are bound to the exact `team` commit being promoted: any new
-- merge into team moves the sha and silently invalidates every prior
-- approval, so nobody can rubber-stamp team and then sneak more in. There's
-- still no roles table (see decisions.md) — "everyone must approve" means
-- every row in `profiles`. A real permissions/roles feature supersedes this.

do $$
begin
  alter table queue_items drop constraint if exists queue_items_status_check;
  alter table queue_items add constraint queue_items_status_check
    check (status in ('queued', 'conflict', 'merged'));
end $$;

create table promotion_approvals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  team_sha text not null,
  approved_by uuid not null references auth.users(id),
  approver_name text not null,
  created_at timestamptz not null default now(),
  unique (project_id, team_sha, approved_by)
);

alter table promotion_approvals enable row level security;

create policy "promotion_approvals_select_all" on promotion_approvals
  for select to authenticated using (true);
create policy "promotion_approvals_insert_all" on promotion_approvals
  for insert to authenticated with check (true);
create policy "promotion_approvals_delete_all" on promotion_approvals
  for delete to authenticated using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'promotion_approvals'
  ) then
    alter publication supabase_realtime add table promotion_approvals;
  end if;
end $$;
