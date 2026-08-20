import { supabase } from "./supabase";
import type { Message, ContentBlock } from "../types/message";
import type { ChatRow } from "../types/chat";

export interface MessageRow {
  chat_id: string;
  role: "user" | "assistant";
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

export async function touchChatLastMessageAt(chatId: string, at: string = new Date().toISOString()): Promise<void> {
  const { error } = await supabase.from("chats").update({ last_message_at: at }).eq("id", chatId);
  if (error) throw new Error(`failed to update chat last_message_at: ${error.message}`);
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
  const { data, error } = await supabase.from("chats").select("*").order("sort_order", { ascending: true });
  if (error) throw new Error(`failed to fetch chats: ${error.message}`);
  return (data ?? []) as ChatRow[];
}

export async function updateChatPosition(chatId: string, x: number, y: number): Promise<void> {
  const { error } = await supabase.from("chats").update({ position_x: x, position_y: y }).eq("id", chatId);
  if (error) throw new Error(`failed to update chat position: ${error.message}`);
}

export async function updateChatTitle(chatId: string, title: string): Promise<void> {
  const { error } = await supabase.from("chats").update({ title }).eq("id", chatId);
  if (error) throw new Error(`failed to update chat title: ${error.message}`);
}

export async function updateChatSortOrder(chatId: string, sortOrder: number): Promise<void> {
  const { error } = await supabase.from("chats").update({ sort_order: sortOrder }).eq("id", chatId);
  if (error) throw new Error(`failed to update chat order: ${error.message}`);
}

export async function updateChatGroup(chatId: string, groupName: string | null): Promise<void> {
  const { error } = await supabase.from("chats").update({ group_name: groupName }).eq("id", chatId);
  if (error) throw new Error(`failed to update chat group: ${error.message}`);
}

export async function setChatArchived(chatId: string, archived: boolean): Promise<void> {
  const { error } = await supabase
    .from("chats")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", chatId);
  if (error) throw new Error(`failed to update chat archived state: ${error.message}`);
}

export async function updateChatSession(chatId: string, sessionId: string, ownerId: string): Promise<void> {
  const { error } = await supabase
    .from("chats")
    .update({ claude_session_id: sessionId, claude_session_owner: ownerId })
    .eq("id", chatId);
  if (error) throw new Error(`failed to update chat session id: ${error.message}`);
}

export async function deleteChat(chatId: string): Promise<void> {
  const { error } = await supabase.from("chats").delete().eq("id", chatId);
  if (error) throw new Error(`failed to delete chat: ${error.message}`);
}
