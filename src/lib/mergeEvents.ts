import { supabase } from "./supabase";

export interface MergeEvent {
  id: string;
  chat_id: string | null;
  status: "merged" | "held" | "conflict";
  detail: string | null;
  created_at: string;
}

export async function fetchMergeEvents(limit = 20): Promise<MergeEvent[]> {
  const { data, error } = await supabase
    .from("merge_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`failed to fetch merge events: ${error.message}`);
  return (data ?? []) as MergeEvent[];
}

export function countByStatus(events: MergeEvent[]): { merged: number; held: number; conflict: number } {
  const counts = { merged: 0, held: 0, conflict: 0 };
  for (const e of events) counts[e.status]++;
  return counts;
}

export function latestStatusByChat(events: MergeEvent[]): Record<string, MergeEvent["status"]> {
  const latestByChat = new Map<string, MergeEvent>();
  for (const e of events) {
    if (!e.chat_id) continue;
    const current = latestByChat.get(e.chat_id);
    if (!current || e.created_at > current.created_at) latestByChat.set(e.chat_id, e);
  }
  const result: Record<string, MergeEvent["status"]> = {};
  for (const [chatId, e] of latestByChat) result[chatId] = e.status;
  return result;
}

export async function insertMergeEvent(
  chatId: string | null,
  status: MergeEvent["status"],
  detail: string | null
): Promise<void> {
  const { error } = await supabase.from("merge_events").insert({ chat_id: chatId, status, detail });
  if (error) throw new Error(`failed to record merge event: ${error.message}`);
}
