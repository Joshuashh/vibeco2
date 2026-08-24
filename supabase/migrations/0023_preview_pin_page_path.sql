-- Lets a pinned comment be scoped to the page it was left on, once the
-- previewed project reports its current path via vibeco-preview-tracker.js
-- (see src-tauri/src/git_ops.rs). Nullable — pins from before this feature,
-- or from a project without the tracker wired in, just stay unscoped and
-- always show, rather than becoming invisible.
alter table preview_pins add column page_path text;
