-- Preview review page (docs/superpowers/specs/2026-08-19-preview-review-page-design.md):
-- pin/reply/stroke annotations directly on the live team preview. No
-- snapshot/image table — annotations sit on the live, auto-updating iframe
-- rather than a frozen capture (see spec §2 for why). Same open-to-
-- authenticated RLS pattern as every other table in this project (no roles
-- table exists, see decisions.md).

create table preview_pins (
  id uuid primary key default gen_random_uuid(),
  x_pct real not null,
  y_pct real not null,
  text text not null,
  resolved boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table preview_pin_replies (
  id uuid primary key default gen_random_uuid(),
  pin_id uuid not null references preview_pins(id) on delete cascade,
  text text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table preview_strokes (
  id uuid primary key default gen_random_uuid(),
  path jsonb not null, -- array of {x_pct, y_pct} points
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table preview_pins enable row level security;
alter table preview_pin_replies enable row level security;
alter table preview_strokes enable row level security;

create policy "preview_pins_select_all" on preview_pins
  for select to authenticated using (true);
create policy "preview_pins_insert_all" on preview_pins
  for insert to authenticated with check (true);
create policy "preview_pins_update_all" on preview_pins
  for update to authenticated using (true) with check (true);

create policy "preview_pin_replies_select_all" on preview_pin_replies
  for select to authenticated using (true);
create policy "preview_pin_replies_insert_all" on preview_pin_replies
  for insert to authenticated with check (true);

create policy "preview_strokes_select_all" on preview_strokes
  for select to authenticated using (true);
create policy "preview_strokes_insert_all" on preview_strokes
  for insert to authenticated with check (true);
create policy "preview_strokes_delete_all" on preview_strokes
  for delete to authenticated using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'preview_pins'
  ) then
    alter publication supabase_realtime add table preview_pins;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'preview_pin_replies'
  ) then
    alter publication supabase_realtime add table preview_pin_replies;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'preview_strokes'
  ) then
    alter publication supabase_realtime add table preview_strokes;
  end if;
end $$;
