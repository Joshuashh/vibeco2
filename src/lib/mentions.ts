import { supabase } from "./supabase";
import type { Profile } from "./profiles";

export const MENTION_RE = /@([a-zA-Z0-9._-]+)/g;

// Lowercased email local-parts (the bit before @) mentioned in a message —
// matches how MentionMenu inserts them ("@ben"), plus the synthetic "all".
export function extractMentions(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(MENTION_RE)) names.add(match[1].toLowerCase());
  return [...names];
}

// Resolves raw "@name" tokens to real teammate emails for persistence —
// "all" expands to every other teammate rather than needing to be a real
// profile. Unmatched names (typos, stray "@word" that isn't a teammate)
// are silently dropped, same as the old broadcast-based behavior.
export function resolveMentions(names: string[], profiles: Profile[], selfEmail: string): string[] {
  const emails = new Set<string>();
  const byLocalPart = new Map(profiles.map((p) => [p.email.split("@")[0].toLowerCase(), p.email]));
  for (const name of names) {
    if (name === "all") {
      profiles.forEach((p) => p.email !== selfEmail && emails.add(p.email));
      continue;
    }
    const email = byLocalPart.get(name);
    if (email && email !== selfEmail) emails.add(email);
  }
  return [...emails];
}

export type MentionKind = "mention" | "handoff";

export interface MentionInboxEntry {
  id: string;
  chatId: string;
  chatTitle: string | null;
  fromEmail: string;
  kind: MentionKind;
  createdAt: string;
}

interface MentionRow {
  id: string;
  chat_id: string;
  chat_title: string | null;
  from_email: string;
  kind: MentionKind;
  created_at: string;
}

function rowToEntry(row: MentionRow): MentionInboxEntry {
  return {
    id: row.id,
    chatId: row.chat_id,
    chatTitle: row.chat_title,
    fromEmail: row.from_email,
    kind: row.kind,
    createdAt: row.created_at,
  };
}

export async function fetchUnreadMentions(toEmail: string): Promise<MentionInboxEntry[]> {
  const { data, error } = await supabase
    .from("mentions")
    .select("id, chat_id, chat_title, from_email, kind, created_at")
    .eq("to_email", toEmail)
    .is("read_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`failed to fetch mentions: ${error.message}`);
  return (data ?? []).map(rowToEntry);
}

export async function insertMentions(params: {
  projectId: string;
  chatId: string;
  chatTitle: string | null;
  fromEmail: string;
  toEmails: string[];
  kind?: MentionKind;
}): Promise<void> {
  if (params.toEmails.length === 0) return;
  const { error } = await supabase.from("mentions").insert(
    params.toEmails.map((toEmail) => ({
      project_id: params.projectId,
      chat_id: params.chatId,
      chat_title: params.chatTitle,
      from_email: params.fromEmail,
      to_email: toEmail,
      kind: params.kind ?? "mention",
    }))
  );
  if (error) throw new Error(`failed to insert mentions: ${error.message}`);
}

export async function markMentionsRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from("mentions").update({ read_at: new Date().toISOString() }).in("id", ids);
  if (error) throw new Error(`failed to mark mentions read: ${error.message}`);
}
