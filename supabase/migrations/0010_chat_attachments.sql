-- Shareable chat attachments (decisions.md: "wire attachments into the
-- actual Claude turn"). Files are uploaded here so every teammate's client
-- can render them (Claude itself reads a separate local-worktree copy via
-- its own Read tool, saved by the Rust side — see save_attachment in
-- src-tauri/src/lib.rs). Attachments are expected to be used within a
-- single chat session, not kept indefinitely, so a weekly cron job prunes
-- anything older than 7 days rather than growing storage forever.

insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-attachments', 'chat-attachments', true, 52428800) -- 50MB
on conflict (id) do nothing;

-- Same open-to-authenticated pattern as every other table/bucket in this
-- project (no roles table exists, see decisions.md).
create policy "chat_attachments_insert_authenticated" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-attachments');

create policy "chat_attachments_select_all" on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'chat-attachments');

create extension if not exists pg_cron with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'cleanup_old_chat_attachments') then
    perform cron.unschedule('cleanup_old_chat_attachments');
  end if;

  perform cron.schedule(
    'cleanup_old_chat_attachments',
    '0 3 * * 0', -- Sundays at 03:00 UTC
    $sql$
      delete from storage.objects
      where bucket_id = 'chat-attachments'
        and created_at < now() - interval '7 days';
    $sql$
  );
end $$;
