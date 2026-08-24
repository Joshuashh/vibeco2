-- Comments could be resolved but never removed. Same open-to-authenticated
-- RLS pattern as preview_strokes_delete_all (0007). Replies cascade via the
-- existing `on delete cascade` FK, so deleting a pin removes its replies too.
create policy "preview_pins_delete_all" on preview_pins
  for delete to authenticated using (true);
