import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChatView } from "./components/ChatView";
import { InputBar } from "./components/InputBar";
import { reduceEvent, type Message, type ClaudeEvent } from "./types/message";

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    const unlisten = listen<ClaudeEvent>("claude-event", (event) => {
      setMessages((prev) => reduceEvent(prev, event.payload));
      if (event.payload.type === "turn_complete") {
        setStreaming(false);
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

  return (
    <div className="app">
      <ChatView messages={messages} />
      <InputBar onSend={handleSend} disabled={streaming} />
    </div>
  );
}

export default App;
