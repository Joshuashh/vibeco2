import { supabase } from "./supabase";
import type { Message, ContentBlock } from "../types/message";
import type { ChatRow } from "../types/chat";

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

export async function fetchAllChats(): Promise<ChatRow[]> {
  const { data, error } = await supabase.from("chats").select("*").order("created_at", { ascending: true });
  if (error) throw new Error(`failed to fetch chats: ${error.message}`);
  return (data ?? []) as ChatRow[];
}

export async function updateChatPosition(chatId: string, x: number, y: number): Promise<void> {
  const { error } = await supabase.from("chats").update({ position_x: x, position_y: y }).eq("id", chatId);
  if (error) throw new Error(`failed to update chat position: ${error.message}`);
}

export async function updateChatSessionId(chatId: string, sessionId: string): Promise<void> {
  const { error } = await supabase.from("chats").update({ claude_session_id: sessionId }).eq("id", chatId);
  if (error) throw new Error(`failed to update chat session id: ${error.message}`);
}

export async function deleteChat(chatId: string): Promise<void> {
  const { error } = await supabase.from("chats").delete().eq("id", chatId);
  if (error) throw new Error(`failed to delete chat: ${error.message}`);
}
