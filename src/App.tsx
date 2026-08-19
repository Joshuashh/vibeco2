import { useState, useEffect, useCallback, useRef } from "react";
import "./App.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Session } from "@supabase/supabase-js";
import { LiveMap } from "@liveblocks/client";
import { ChatPane, ChatPaneEmpty } from "./components/ChatPane";
import { LoginScreen } from "./components/LoginScreen";
import { Sidebar } from "./components/Sidebar";
import { ResizeDivider } from "./components/ResizeDivider";
import { ViewToggle } from "./components/ViewToggle";
import { CanvasView } from "./components/CanvasView";
import { LiveCursors } from "./components/LiveCursors";
import type { ChatRow } from "./types/chat";
import { applyChatEvent, applyRealtimeMessage, addUserMessage, setSessionError, initChatState, type ChatEnvelope, type ChatState } from "./lib/chatStore";
import {
  createChat,
  loadChatMessages,
  fetchAllChats,
  updateChatSession,
  updateChatTitle,
  deleteChat,
  rowsToMessages,
  type StoredMessageRow,
} from "./lib/persistChat";
import { buildTranscriptPreamble } from "./lib/transcript";
import { getSession, onAuthStateChange, signOut } from "./lib/auth";
import { fetchMergeEvents, type MergeEvent } from "./lib/mergeEvents";
import { RoomProvider, ROOM_ID, useUpdateMyPresence, useSelf, useOthers } from "./lib/liveblocks";
import { PresenceBar } from "./components/PresenceBar";
import { supabase } from "./lib/supabase";
import { isClaimedByOther, computeClaimant } from "./lib/claim";

function AppShell({ session }: { session: Session }) {
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [chatStates, setChatStates] = useState<Record<string, ChatState>>({});
  const [mergeEvents, setMergeEvents] = useState<MergeEvent[]>([]);
  const [viewMode, setViewMode] = useState<"chat" | "canvas">("canvas");
  const [chatLayout, setChatLayout] = useState<"single" | "split">("split");
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(260);
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
      // Sweeps any chat worktree/branch left behind by a delete that never
      // finished (app quit mid-delete, was offline, etc) — known gap, see
      // decisions.md.
      invoke("prune_orphaned_chat_worktrees", { knownChatIds: rows.map((row) => row.id) }).catch((err) =>
        console.error("failed to prune orphaned chat worktrees", err)
      );
    });
  }, []);

  useEffect(() => {
    fetchMergeEvents().then(setMergeEvents);
  }, []);

  useEffect(() => {
    const unlisten = listen<ChatEnvelope>("claude-event", (event) => {
      setChatStates((prev) => applyChatEvent(prev, event.payload));
      if (event.payload.event.type === "session_started") {
        updateChatSession(event.payload.chatId, event.payload.event.session_id, session.user.id).catch((err) =>
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
      // Native `--resume` only works for whoever's machine/account created the
      // session (see decisions.md). A different claimant gets a fresh session
      // primed with the stored transcript instead, so Claude isn't blind to
      // what already happened.
      const isOwner = !chat?.claude_session_id || chat.claude_session_owner === session.user.id;
      const priorMessages = chatStates[chatId]?.messages ?? [];
      const effectivePrompt = isOwner ? prompt : `${buildTranscriptPreamble(priorMessages)}\n\n${prompt}`;
      // Every chat gets its own git worktree so concurrent chats never edit
      // the same working directory (see docs/superpowers/specs/2026-08-18-
      // main-agent-merge-orchestration-design.md §2). Falls back to the repo
      // root if worktree creation fails, rather than blocking the send.
      invoke<string>("ensure_chat_worktree", { chatId })
        .catch((err) => {
          console.error("ensure_chat_worktree failed, falling back to repo root", err);
          return ".";
        })
        .then((workingDirectory) =>
          invoke("start_session", {
            chatId,
            prompt: effectivePrompt,
            workingDirectory,
            resumeSessionId: isOwner ? chat?.claude_session_id ?? null : null,
          })
        )
        .catch((err) => {
          console.error("start_session failed", err);
          const detail = err instanceof Error ? err.message : String(err);
          setChatStates((prev) => setSessionError(prev, chatId, `Couldn't start the Claude session: ${detail}`));
        });
    },
    [chats, chatStates, updateMyPresence, session.user.id]
  );

  const handleLeave = useCallback(
    (_chatId: string) => {
      updateMyPresence({ claimedChatId: null });
    },
    [updateMyPresence]
  );

  const handleDelete = useCallback((chatId: string) => {
    deleteChat(chatId).catch((err) => console.error("failed to delete chat", err));
    invoke("remove_chat_worktree", { chatId }).catch((err) =>
      console.error("failed to remove chat worktree", err)
    );
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
          claude_session_owner: null,
          created_at: new Date().toISOString(),
        },
      ]);
      setChatStates((prev) => ({ ...prev, [id]: initChatState() }));
      setActiveChatId(id);
    });
  }, [session.user.id]);

  const selfOccupant = self ? { email: self.presence.email, claimedChatId: self.presence.claimedChatId } : null;
  const otherOccupants = others.map((o) => ({ email: o.presence.email, claimedChatId: o.presence.claimedChatId }));

  const activeState = activeChatId ? chatStates[activeChatId] : undefined;
  const activeChat = activeChatId ? chats.find((c) => c.id === activeChatId) : undefined;
  const activeClaimant = activeChatId ? computeClaimant(activeChatId, selfOccupant, otherOccupants) : null;
  const activeClaimedByOther = activeChatId ? isClaimedByOther(activeChatId, selfOccupant, otherOccupants) : false;

  // Split-view right pane: whichever teammate currently has a chat claimed —
  // simple "auto-follow" pick, no picker UI, since this is a two-person team.
  const teammate = others.find((o) => o.presence.claimedChatId);
  const teammateChatId = teammate?.presence.claimedChatId ?? null;
  const teammateChat = teammateChatId ? chats.find((c) => c.id === teammateChatId) : undefined;
  const teammateState = teammateChatId ? chatStates[teammateChatId] : undefined;
  const teammateClaimant = teammateChatId ? computeClaimant(teammateChatId, selfOccupant, otherOccupants) : null;
  const teammateClaimedByOther = teammateChatId ? isClaimedByOther(teammateChatId, selfOccupant, otherOccupants) : false;

  const appRef = useRef<HTMLDivElement>(null);

  return (
    <div className="app" ref={appRef}>
      <LiveCursors containerRef={appRef} />
      <div className="toolbar">
        <div className="toolbar-side" />
        <ViewToggle mode={viewMode} onChange={setViewMode} />
        <div className="toolbar-side toolbar-actions">
          {viewMode === "canvas" && (
            <button className="btn btn-primary" onClick={handleCreateChat}>
              <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New chat
            </button>
          )}
          {viewMode === "chat" && (
            <div className="view-toggle">
              <button className={chatLayout === "single" ? "active" : ""} onClick={() => setChatLayout("single")}>
                Single
              </button>
              <button className={chatLayout === "split" ? "active" : ""} onClick={() => setChatLayout("split")}>
                Split
              </button>
            </div>
          )}
          <PresenceBar />
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
        <div className="chat-workspace">
          <div className="sidebar-panel" style={{ width: sidebarWidth }}>
            <Sidebar
              chats={chats}
              activeChatId={activeChatId}
              onSelect={setActiveChatId}
              onCreateChat={handleCreateChat}
              onRename={handleRename}
              onDelete={handleDelete}
              userEmail={session.user.email ?? "you"}
              onSignOut={() => signOut()}
            />
          </div>
          <ResizeDivider width={sidebarWidth} onChange={setSidebarWidth} min={200} max={420} />
          <div className="chat-panes">
            {activeChatId && activeChat ? (
              <ChatPane
                chat={activeChat}
                state={activeState}
                claimant={activeClaimant}
                isSelf={activeClaimant === session.user.email}
                disabled={activeState?.streaming === true || activeClaimedByOther}
                onSend={(prompt) => handleSend(activeChatId, prompt)}
                onRename={(title) => handleRename(activeChatId, title)}
                onDelete={() => handleDelete(activeChatId)}
              />
            ) : (
              <ChatPaneEmpty text="Select a chat, or start a new one." />
            )}

            {chatLayout === "split" &&
              (teammateChatId && teammateChat ? (
                <ChatPane
                  chat={teammateChat}
                  state={teammateState}
                  claimant={teammateClaimant}
                  isSelf={teammateClaimant === session.user.email}
                  disabled={teammateState?.streaming === true || teammateClaimedByOther}
                  onSend={(prompt) => handleSend(teammateChatId, prompt)}
                  onRename={(title) => handleRename(teammateChatId, title)}
                  onDelete={() => handleDelete(teammateChatId)}
                />
              ) : (
                <ChatPaneEmpty text="No teammate is in a chat right now." />
              ))}
          </div>
        </div>
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
      initialPresence={{ email: session.user.email ?? "unknown", claimedChatId: null, cursor: null }}
      initialStorage={{ positions: new LiveMap(), chatGroups: new LiveMap(), groupLabels: new LiveMap() }}
    >
      <AppShell session={session} />
    </RoomProvider>
  );
}

export default App;
