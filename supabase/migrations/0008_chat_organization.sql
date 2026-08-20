-- Sidebar organization: manual drag-and-drop ordering, named groups, and
-- archiving (soft-delete alternative to the existing hard delete).

alter table chats
  add column sort_order double precision not null default extract(epoch from now()),
  add column group_name text,
  add column archived_at timestamptz;
