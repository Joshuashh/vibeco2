import { reduceEvent, type ClaudeEvent, type Message } from "../types/message";

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
  const streaming = envelope.event.type === "turn_complete" ? false : current.streaming;
  return { ...states, [envelope.chatId]: { messages, streaming } };
}

export function applyRealtimeMessage(
  states: Record<string, ChatState>,
  chatId: string,
  message: Message
): Record<string, ChatState> {
  const current = states[chatId] ?? initChatState();
  return { ...states, [chatId]: { ...current, messages: [...current.messages, message] } };
}
