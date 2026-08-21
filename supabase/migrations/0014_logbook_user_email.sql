-- user_id (uuid FK) is kept for potential ownership/RLS use, but nothing
-- client-side can turn it back into a display-friendly email (no
-- profiles/email-lookup table exists) -- same gap handed_off_to had in
-- 0013. Store the acting user's own email directly, since the client
-- always knows its own session email at write time.
alter table logbook_entries add column user_email text;
