-- merge_events was read-only from the app (migration 0004) pending this
-- orchestration work. Same open-to-authenticated pattern as every other
-- table in this project (see decisions.md — no roles table exists).
create policy "merge_events_insert_all" on merge_events
  for insert to authenticated with check (true);
