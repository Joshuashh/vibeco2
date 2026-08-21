import { supabase } from "./supabase";

export interface LogbookEntry {
  id: string;
  chat_id: string | null;
  project_id: string | null;
  user_id: string | null;
  user_email: string | null;
  kind: "handoff" | "checkpoint";
  handed_off_to: string | null;
  summary: string;
  duration_seconds: number | null;
  created_at: string;
}

export async function fetchLogbookEntries(projectId: string, limit = 50): Promise<LogbookEntry[]> {
  const { data, error } = await supabase
    .from("logbook_entries")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`failed to fetch logbook entries: ${error.message}`);
  return (data ?? []) as LogbookEntry[];
}

export async function insertLogbookEntry(entry: {
  chatId: string | null;
  projectId: string;
  userId: string;
  userEmail: string;
  kind: LogbookEntry["kind"];
  handedOffTo: string | null;
  summary: string;
  durationSeconds: number | null;
}): Promise<void> {
  const { error } = await supabase.from("logbook_entries").insert({
    chat_id: entry.chatId,
    project_id: entry.projectId,
    user_id: entry.userId,
    user_email: entry.userEmail,
    kind: entry.kind,
    handed_off_to: entry.handedOffTo,
    summary: entry.summary,
    duration_seconds: entry.durationSeconds,
  });
  if (error) throw new Error(`failed to record logbook entry: ${error.message}`);
}
