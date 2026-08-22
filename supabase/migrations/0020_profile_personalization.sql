-- Lets a user set a display name and a custom cursor/presence color instead
-- of always showing their raw email and a color hashed from it.
alter table profiles add column display_name text;
alter table profiles add column color text;

create policy "profiles_update_own" on profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- One person per color: guards the "already taken" check in the UI against
-- a race where two people pick the same color at the same instant. Multiple
-- NULLs (not yet personalized) are allowed under a partial unique index.
create unique index profiles_color_unique on profiles(color) where color is not null;

-- Enable Realtime so a teammate's chosen name/color show up live instead of
-- only on next reload (idempotent — skips if already in the publication).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table profiles;
  end if;
end $$;
