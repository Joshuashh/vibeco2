import { supabase } from "./supabase";

export interface QueueItem {
  id: string;
  chat_id: string;
  project_id: string | null;
  summary: string;
  submitted_by: string;
  // 'merged' = merged into `team`, now waiting for the team -> main promotion
  // gate in the Preview tab (kept, not deleted, so that gate can show what's
  // pending and who still has to approve it). Cleared on a successful promote.
  status: "queued" | "conflict" | "merged";
  created_at: string;
}

export async function fetchQueueItems(projectId: string): Promise<QueueItem[]> {
  const { data, error } = await supabase
    .from("queue_items")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`failed to fetch queue items: ${error.message}`);
  return (data ?? []) as QueueItem[];
}

export async function insertQueueItem(params: {
  chatId: string;
  projectId: string;
  summary: string;
  submittedBy: string;
}): Promise<QueueItem> {
  const { data, error } = await supabase
    .from("queue_items")
    .insert({ chat_id: params.chatId, project_id: params.projectId, summary: params.summary, submitted_by: params.submittedBy })
    .select()
    .single();
  if (error) throw new Error(`failed to add queue item: ${error.message}`);
  return data as QueueItem;
}

export async function markQueueItemConflict(id: string, summary: string): Promise<void> {
  const { error } = await supabase.from("queue_items").update({ status: "conflict", summary }).eq("id", id);
  if (error) throw new Error(`failed to update queue item: ${error.message}`);
}

export async function markQueueItemQueued(id: string, summary: string): Promise<void> {
  const { error } = await supabase.from("queue_items").update({ status: "queued", summary }).eq("id", id);
  if (error) throw new Error(`failed to update queue item: ${error.message}`);
}

export async function markQueueItemMerged(id: string): Promise<void> {
  const { error } = await supabase.from("queue_items").update({ status: "merged" }).eq("id", id);
  if (error) throw new Error(`failed to update queue item: ${error.message}`);
}

export async function deleteQueueItem(id: string): Promise<void> {
  const { error } = await supabase.from("queue_items").delete().eq("id", id);
  if (error) throw new Error(`failed to remove queue item: ${error.message}`);
}
