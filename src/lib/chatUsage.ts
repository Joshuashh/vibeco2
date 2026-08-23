import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface ChatUsage {
  contextTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
}

// ponytail: fixed at Claude's standard 200K context window rather than
// looking up the model's actual limit — bump if/when this app lets users
// pick a larger-context model.
export const CONTEXT_WINDOW = 200_000;
const POLL_MS = 4000;

export function fetchChatUsage(chatId: string, sessionId: string): Promise<ChatUsage> {
  return invoke<ChatUsage>("get_chat_usage", { chatId, sessionId });
}

export function useChatUsage(chatId: string, sessionId: string | null): ChatUsage | null {
  const [usage, setUsage] = useState<ChatUsage | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setUsage(null);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      fetchChatUsage(chatId, sessionId)
        .then((u) => !cancelled && setUsage(u))
        .catch(() => {
          // No transcript yet (chat hasn't sent a message this session) — stay silent.
        });
    };
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [chatId, sessionId]);

  return usage;
}
