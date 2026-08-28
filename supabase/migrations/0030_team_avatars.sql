-- Optional team profile picture, shown next to the team name in the
-- breadcrumb (people icon is the fallback). Same open-to-authenticated
-- pattern as chat-attachments (0010) — no roles table exists.

alter table teams add column avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit)
values ('team-avatars', 'team-avatars', true, 5242880) -- 5MB
on conflict (id) do nothing;

create policy "team_avatars_insert_authenticated" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'team-avatars');

create policy "team_avatars_select_all" on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'team-avatars');

-- ponytail: replacing an avatar leaves the old object orphaned. Files are
-- tiny and teams are few; add a cleanup cron only if that ever matters.
