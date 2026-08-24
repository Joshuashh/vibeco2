-- 0007_preview_comments.sql declared `created_by uuid not null references
-- auth.users(id)` on all three preview annotation tables, but unlike every
-- other created_by/user_id column in this project (see 0011_projects.sql,
-- 0002_auth_rls.sql), it never got `default auth.uid()`. The insert helpers
-- in src/lib/previewComments.ts never pass created_by explicitly, so every
-- pin/reply/stroke insert has always failed the NOT NULL constraint --
-- silently, since the frontend only logs insert failures to the console.
alter table preview_pins alter column created_by set default auth.uid();
alter table preview_pin_replies alter column created_by set default auth.uid();
alter table preview_strokes alter column created_by set default auth.uid();
