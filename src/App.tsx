import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Session } from "@supabase/supabase-js";
import { ChatView } from "./components/ChatView";
import { InputBar } from "./components/InputBar";
import { LoginScreen } from "./components/LoginScreen";
import { reduceEvent, type Message, type ClaudeEvent } from "./types/message";
import { createChat, loadChatMessages, saveChatMessages } from "./lib/persistChat";
import { getSession, onAuthStateChange, signOut } from "./lib/auth";

function App() {
  const [session, setSession] = useState<Session | null | "loading">("loading");
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const chatIdRef = useRef<string | null>(null);

  useEffect(() => {
    getSession().then(setSession);
    return onAuthStateChange(setSession);
  }, []);

  useEffect(() => {
    if (!session || session === "loading") return;
    createChat(null).then(async (id) => {
      chatIdRef.current = id;
      const history = await loadChatMessages(id);
      setMessages(history);
    });
  }, [session]);

  useEffect(() => {
    const unlisten = listen<ClaudeEvent>("claude-event", (event) => {
      setMessages((prev) => reduceEvent(prev, event.payload));
      if (event.payload.type === "turn_complete") {
        setStreaming(false);
        setMessages((current) => {
          if (chatIdRef.current) {
            saveChatMessages(chatIdRef.current, current.slice(-1)).catch((err) =>
              console.error("failed to persist message", err)
            );
          }
          return current;
        });
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleSend = useCallback((prompt: string) => {
    setStreaming(true);
    invoke("start_session", { prompt, workingDirectory: "." }).catch((err) => {
      console.error("start_session failed", err);
      setStreaming(false);
    });
  }, []);

  if (session === "loading") return null;
  if (!session) return <LoginScreen onSignedIn={() => {}} />;

  return (
    <div className="app">
      <button className="sign-out" onClick={() => signOut()}>
        Sign out
      </button>
      <ChatView messages={messages} />
      <InputBar onSend={handleSend} disabled={streaming} />
    </div>
  );
}

export default App;
