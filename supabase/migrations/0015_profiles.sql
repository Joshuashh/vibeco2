-- A lightweight directory of known teammates, so a chat can be manually
-- assigned to anyone on the team (not just whoever's currently online in
-- Liveblocks presence, which is all handed_off_to's email could reach
-- before this). No roles/membership system exists anywhere in this project
-- (see decisions.md) -- this is the minimum needed to list "everyone",
-- kept in sync with auth.users via a trigger rather than a manual sync step.

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles_select_all" on profiles
  for select to authenticated using (true);

create function handle_new_user_profile()
returns trigger as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert or update of email on auth.users
  for each row execute function handle_new_user_profile();

insert into profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;
