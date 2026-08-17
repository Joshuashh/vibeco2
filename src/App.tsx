import { useState, useEffect, useCallback } from "react";
import "./App.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Session } from "@supabase/supabase-js";
import { LiveMap } from "@liveblocks/client";
import { ChatView } from "./components/ChatView";
import { InputBar } from "./components/InputBar";
import { LoginScreen } from "./components/LoginScreen";
import { ChatSwitcher } from "./components/ChatSwitcher";
import { ViewToggle } from "./components/ViewToggle";
import { CanvasView } from "./components/CanvasView";
import type { ChatRow } from "./types/chat";
import { applyChatEvent, applyRealtimeMessage, addUserMessage, setSessionError, initChatState, type ChatEnvelope, type ChatState } from "./lib/chatStore";
import {
  createChat,
  loadChatMessages,
  fetchAllChats,
  updateChatSessionId,
  updateChatTitle,
  deleteChat,
  rowsToMessages,
  type StoredMessageRow,
} from "./lib/persistChat";
import { getSession, onAuthStateChange, signOut } from "./lib/auth";
import { fetchMergeEvents, type MergeEvent } from "./lib/mergeEvents";
import { RoomProvider, ROOM_ID, useUpdateMyPresence, useSelf, useOthers } from "./lib/liveblocks";
import { PresenceBar } from "./components/PresenceBar";
import { supabase } from "./lib/supabase";
import { isClaimedByOther } from "./lib/claim";

function AppShell({ session }: { session: Session }) {
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [chatStates, setChatStates] = useState<Record<string, ChatState>>({});
  const [mergeEvents, setMergeEvents] = useState<MergeEvent[]>([]);
  const [viewMode, setViewMode] = useState<"chat" | "canvas">("canvas");
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const updateMyPresence = useUpdateMyPresence();
  const self = useSelf();
  const others = useOthers();

  useEffect(() => {
    fetchAllChats().then(async (rows) => {
      setChats(rows);
      setActiveChatId((current) => current ?? rows[0]?.id ?? null);
      const histories = await Promise.all(rows.map((row) => loadChatMessages(row.id)));
      setChatStates((current) => {
        const next = { ...current };
        rows.forEach((row, i) => {
          next[row.id] = initChatState(histories[i]);
        });
        return next;
      });
    });
  }, []);

  useEffect(() => {
    fetchMergeEvents().then(setMergeEvents);
  }, []);

  useEffect(() => {
    const unlisten = listen<ChatEnvelope>("claude-event", (event) => {
      setChatStates((prev) => applyChatEvent(prev, event.payload));
      if (event.payload.event.type === "session_started") {
        updateChatSessionId(event.payload.chatId, event.payload.event.session_id).catch((err) =>
          console.error("failed to persist claude session id", err)
        );
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("messages-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const row = payload.new as StoredMessageRow;
        const [message] = rowsToMessages([row]);
        setChatStates((prev) => applyRealtimeMessage(prev, row.chat_id, message));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chats" }, (payload) => {
        const row = payload.new as ChatRow;
        setChats((prev) => (prev.some((c) => c.id === row.id) ? prev : [...prev, row]));
        setChatStates((prev) => (prev[row.id] ? prev : { ...prev, [row.id]: initChatState() }));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "chats" }, (payload) => {
        const row = payload.old as { id: string };
        setChats((prev) => prev.filter((c) => c.id !== row.id));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "merge_events" }, (payload) => {
        setMergeEvents((prev) => [payload.new as MergeEvent, ...prev]);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleSend = useCallback(
    (chatId: string, prompt: string) => {
      updateMyPresence({ claimedChatId: chatId });
      setChatStates((prev) => {
        const withUserMessage = addUserMessage(prev, chatId, prompt);
        return {
          ...withUserMessage,
          [chatId]: { ...withUserMessage[chatId], streaming: true },
        };
      });
      const chat = chats.find((c) => c.id === chatId);
      invoke("start_session", {
        chatId,
        prompt,
        workingDirectory: ".",
        resumeSessionId: chat?.claude_session_id ?? null,
      }).catch((err) => {
        console.error("start_session failed", err);
        setChatStates((prev) => setSessionError(prev, chatId, "Couldn't reach the Claude CLI. Are you running the native app (`npx tauri dev`), not the browser dev server?"));
      });
    },
    [chats, updateMyPresence]
  );

  const handleLeave = useCallback(
    (_chatId: string) => {
      updateMyPresence({ claimedChatId: null });
    },
    [updateMyPresence]
  );

  const handleDelete = useCallback((chatId: string) => {
    deleteChat(chatId).catch((err) => console.error("failed to delete chat", err));
    setChats((prev) => prev.filter((c) => c.id !== chatId));
  }, []);

  const handleRename = useCallback((chatId: string, title: string) => {
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title } : c)));
    updateChatTitle(chatId, title).catch((err) => console.error("failed to rename chat", err));
  }, []);

  const handleExpand = useCallback((chatId: string) => {
    setActiveChatId(chatId);
    setViewMode("chat");
  }, []);

  const handleCreateChat = useCallback(() => {
    createChat(null).then((id) => {
      setChats((prev) => [
        ...prev,
        {
          id,
          title: null,
          user_id: session.user.id,
          position_x: null,
          position_y: null,
          claude_session_id: null,
          created_at: new Date().toISOString(),
        },
      ]);
      setChatStates((prev) => ({ ...prev, [id]: initChatState() }));
    });
  }, [session.user.id]);

  const activeState = activeChatId ? chatStates[activeChatId] : undefined;
  const activeClaimedByOther = activeChatId
    ? isClaimedByOther(
        activeChatId,
        self ? { email: self.presence.email, claimedChatId: self.presence.claimedChatId } : null,
        others.map((o) => ({ email: o.presence.email, claimedChatId: o.presence.claimedChatId }))
      )
    : false;

  return (
    <div className="app">
      <div className="toolbar">
        <PresenceBar />
        <ViewToggle mode={viewMode} onChange={setViewMode} />
        <div className="toolbar-actions">
          {viewMode === "canvas" ? (
            <button className="btn btn-primary" onClick={handleCreateChat}>
              <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New chat
            </button>
          ) : (
            <ChatSwitcher chats={chats} activeChatId={activeChatId} onSelect={setActiveChatId} />
          )}
          <button className="btn btn-ghost" onClick={() => signOut()}>
            <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
            Sign out
          </button>
        </div>
      </div>
      {viewMode === "canvas" ? (
        <>
          <CanvasView
            chats={chats}
            chatStates={chatStates}
            mergeEvents={mergeEvents}
            onSend={handleSend}
            onLeave={handleLeave}
            onDelete={handleDelete}
            onExpand={handleExpand}
            onRename={handleRename}
          />
        </>
      ) : (
        <>
          <ChatView messages={activeState?.messages ?? []} streaming={activeState?.streaming ?? false} />
          <InputBar
            onSend={(prompt) => activeChatId && handleSend(activeChatId, prompt)}
            disabled={!activeChatId || activeState?.streaming === true || activeClaimedByOther}
          />
        </>
      )}
    </div>
  );
}

function App() {
  const [session, setSession] = useState<Session | null | "loading">("loading");

  useEffect(() => {
    getSession().then(setSession);
    return onAuthStateChange(setSession);
  }, []);

  if (session === "loading") return null;
  if (!session) return <LoginScreen onSignedIn={() => {}} />;

  return (
    <RoomProvider
      id={ROOM_ID}
      initialPresence={{ email: session.user.email ?? "unknown", claimedChatId: null }}
      initialStorage={{ positions: new LiveMap(), chatGroups: new LiveMap(), groupLabels: new LiveMap() }}
    >
      <AppShell session={session} />
    </RoomProvider>
  );
}

export default App;
