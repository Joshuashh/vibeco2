import { supabase } from "./supabase";
import type { Attachment } from "../types/message";

const BUCKET = "chat-attachments";

// Uploaded objects are cleaned up on a weekly schedule (see the
// cleanup_old_chat_attachments cron job) — attachments are expected to be
// used within a single chat session, not kept indefinitely. `path` is the
// storage object key (not part of the persisted Attachment shape) — kept
// around only so an attachment removed before sending can be deleted again.
export async function uploadAttachment(chatId: string, file: File): Promise<Attachment & { path: string }> {
  const path = `${chatId}/${crypto.randomUUID()}-${file.name}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
  });
  if (error) throw new Error(`failed to upload attachment: ${error.message}`);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { name: file.name, url: data.publicUrl, mimeType: file.type || "application/octet-stream", path };
}

export async function deleteAttachment(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(`failed to delete attachment: ${error.message}`);
}
