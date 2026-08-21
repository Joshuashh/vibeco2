-- Distinguishes which human sent a role='user' message, so a shared chat
-- can show "you" vs a teammate instead of always reading as one voice.
-- Same pattern as 0014's user_email: store the sender's own email at write
-- time, no profiles/email-lookup join needed.
alter table messages add column author_email text;
