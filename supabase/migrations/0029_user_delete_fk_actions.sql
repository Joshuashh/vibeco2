-- Deleting a Supabase auth user failed with "Database error deleting user"
-- because several app tables still referenced auth.users(id) through NO
-- ACTION foreign keys. Every such FK is converted here to either:
--   * cascade  — the row is meaningless without its user, or
--   * set null — the row survives; it just loses the attribution.
-- (profiles + team_members already cascade and are left alone.)

-- chats: user_id is only the "owner" for display/lock attribution now (RLS
-- on chats/messages is open-to-authenticated), so a departing user must NOT
-- take a chat's message history with them. Drop NOT NULL and set null on
-- delete -- the chat survives ownerless (ownerEmailForChat already returns
-- null gracefully). claude_session_owner is likewise just attribution.
alter table chats alter column user_id drop not null;
alter table chats drop constraint chats_user_id_fkey,
  add constraint chats_user_id_fkey foreign key (user_id)
    references auth.users(id) on delete set null;
alter table chats drop constraint chats_claude_session_owner_fkey,
  add constraint chats_claude_session_owner_fkey foreign key (claude_session_owner)
    references auth.users(id) on delete set null;

-- logbook_entries.user_id is already nullable and purely informational.
alter table logbook_entries drop constraint logbook_entries_user_id_fkey,
  add constraint logbook_entries_user_id_fkey foreign key (user_id)
    references auth.users(id) on delete set null;

-- preview annotations: created_by is NOT NULL and worthless without the
-- author -> cascade (pin replies already cascade from their pin).
alter table preview_pins drop constraint preview_pins_created_by_fkey,
  add constraint preview_pins_created_by_fkey foreign key (created_by)
    references auth.users(id) on delete cascade;
alter table preview_pin_replies drop constraint preview_pin_replies_created_by_fkey,
  add constraint preview_pin_replies_created_by_fkey foreign key (created_by)
    references auth.users(id) on delete cascade;
alter table preview_strokes drop constraint preview_strokes_created_by_fkey,
  add constraint preview_strokes_created_by_fkey foreign key (created_by)
    references auth.users(id) on delete cascade;

-- A promotion approval is bound to one approver; if they're gone the
-- approval is meaningless (the promote gate re-derives approvers live).
alter table promotion_approvals drop constraint promotion_approvals_approved_by_fkey,
  add constraint promotion_approvals_approved_by_fkey foreign key (approved_by)
    references auth.users(id) on delete cascade;

-- projects / teams: no RLS policy depends on created_by after insert, so
-- keep the row and just null the attribution. Requires dropping NOT NULL.
alter table projects alter column created_by drop not null;
alter table projects drop constraint projects_created_by_fkey,
  add constraint projects_created_by_fkey foreign key (created_by)
    references auth.users(id) on delete set null;

alter table teams alter column created_by drop not null;
alter table teams drop constraint teams_created_by_fkey,
  add constraint teams_created_by_fkey foreign key (created_by)
    references auth.users(id) on delete set null;
