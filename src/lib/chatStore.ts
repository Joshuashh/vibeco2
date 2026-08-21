import { reduceEvent, userMessage, errorMessage, type Attachment, type ClaudeEvent, type Message } from "../types/message";

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

export function addUserMessage(
  states: Record<string, ChatState>,
  chatId: string,
  text: string,
  attachments: Attachment[] = [],
  authorEmail?: string
): Record<string, ChatState> {
  const current = states[chatId] ?? initChatState();
  return {
    ...states,
    [chatId]: { ...current, messages: [...current.messages, userMessage(text, attachments, authorEmail)] },
  };
}

export function setSessionError(states: Record<string, ChatState>, chatId: string, text: string): Record<string, ChatState> {
  const current = states[chatId] ?? initChatState();
  return { ...states, [chatId]: { messages: [...current.messages, errorMessage(text)], streaming: false } };
}

export function cancelStreaming(states: Record<string, ChatState>, chatId: string): Record<string, ChatState> {
  const current = states[chatId] ?? initChatState();
  return { ...states, [chatId]: { ...current, streaming: false } };
}
