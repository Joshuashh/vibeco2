import { supabase } from "./supabase";
import type { Message, ContentBlock } from "../types/message";

export interface MessageRow {
  chat_id: string;
  role: "assistant";
  blocks: ContentBlock[];
}

export interface StoredMessageRow extends MessageRow {
  id: string;
  created_at: string;
}

export function messagesToRows(chatId: string, messages: Message[]): MessageRow[] {
  return messages.filter((m) => m.complete).map((m) => ({ chat_id: chatId, role: m.role, blocks: m.blocks }));
}

export function rowsToMessages(rows: StoredMessageRow[]): Message[] {
  return rows.map((row) => ({ role: row.role, blocks: row.blocks, complete: true }));
}

export async function saveChatMessages(chatId: string, messages: Message[]): Promise<void> {
  const rows = messagesToRows(chatId, messages);
  if (rows.length === 0) return;
  const { error } = await supabase.from("messages").insert(rows);
  if (error) throw new Error(`failed to save messages: ${error.message}`);
}

export async function loadChatMessages(chatId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`failed to load messages: ${error.message}`);
  return rowsToMessages((data ?? []) as StoredMessageRow[]);
}

export async function createChat(title: string | null): Promise<string> {
  const { data, error } = await supabase.from("chats").insert({ title }).select("id").single();
  if (error) throw new Error(`failed to create chat: ${error.message}`);
  return data.id as string;
}
