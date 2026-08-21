-- Liveblocks presence (the only place an online teammate is identifiable
-- from the client) carries `email`, not the Supabase user id — there's no
-- email->id lookup anywhere in this codebase, and no roles/profiles table
-- to build one on top of. Store the assignee's email directly instead of a
-- uuid FK to auth.users, matching what's actually available client-side.

alter table logbook_entries drop constraint logbook_entries_handed_off_to_fkey;
alter table logbook_entries alter column handed_off_to type text using handed_off_to::text;

alter table chats drop constraint chats_handed_off_to_fkey;
alter table chats alter column handed_off_to type text using handed_off_to::text;
