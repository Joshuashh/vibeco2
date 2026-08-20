import { reduceEvent, userMessage, errorMessage, type ClaudeEvent, type Message } from "../types/message";

export interface ChatState {
  messages: Message[];
  streaming: boolean;
}

export interface ChatEnvelope {
  chatId: string;
  event: ClaudeEvent;
}

export function initChatState(messages: Message[] = []): ChatState {
  return { messages, streaming: false };
}

export function applyChatEvent(
  states: Record<string, ChatState>,
  envelope: ChatEnvelope
): Record<string, ChatState> {
  const current = states[envelope.chatId] ?? initChatState();
  const messages = reduceEvent(current.messages, envelope.event);
  // Derived from the event itself (not just carried forward) so a teammate
  // watching this turn stream in over the room event channel also sees the
  // thinking indicator, without having called handleSend themselves.
  const streaming =
    envelope.event.type === "turn_complete"
      ? false
      : envelope.event.type === "session_started"
        ? current.streaming
        : true;
  return { ...states, [envelope.chatId]: { messages, streaming } };
}

export function addUserMessage(states: Record<string, ChatState>, chatId: string, text: string): Record<string, ChatState> {
  const current = states[chatId] ?? initChatState();
  return { ...states, [chatId]: { ...current, messages: [...current.messages, userMessage(text)] } };
}

export function setSessionError(states: Record<string, ChatState>, chatId: string, text: string): Record<string, ChatState> {
  const current = states[chatId] ?? initChatState();
  return { ...states, [chatId]: { messages: [...current.messages, errorMessage(text)], streaming: false } };
}

export function applyRealtimeMessage(
  states: Record<string, ChatState>,
  chatId: string,
  message: Message
): Record<string, ChatState> {
  const current = states[chatId] ?? initChatState();
  // The sender's own save also echoes back through this same realtime
  // subscription — skip it if it's already the last message in this chat's
  // state (added locally when sent/streamed) instead of appending a dupe.
  const last = current.messages[current.messages.length - 1];
  if (last && JSON.stringify(last) === JSON.stringify(message)) return states;
  return { ...states, [chatId]: { ...current, messages: [...current.messages, message] } };
}
