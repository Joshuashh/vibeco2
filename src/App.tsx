import { useState, useEffect, useCallback, useRef } from "react";
import "./App.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Session } from "@supabase/supabase-js";
import { LiveMap, type Json } from "@liveblocks/client";
import { ChatPane, ChatPaneEmpty } from "./components/ChatPane";
import { LoginScreen } from "./components/LoginScreen";
import { ProjectSwitcher } from "./components/ProjectSwitcher";
import { ProjectMenu } from "./components/ProjectMenu";
import { Sidebar } from "./components/Sidebar";
import { ResizeDivider } from "./components/ResizeDivider";
import { ViewToggle } from "./components/ViewToggle";
import { CanvasView, type FlowScreenApi } from "./components/CanvasView";
import { PreviewPage } from "./components/PreviewPage";
import { LiveCursors } from "./components/LiveCursors";
import { TooltipHost } from "./components/TooltipHost";
import { ToastHost, showToast } from "./components/ToastHost";
import { PermissionPrompt, type PermissionRequest } from "./components/PermissionPrompt";
import type { ChatRow } from "./types/chat";
import { applyChatEvent, addUserMessage, setSessionError, cancelStreaming, initChatState, type ChatEnvelope, type ChatState } from "./lib/chatStore";
import {
  createChat,
  loadChatMessages,
  fetchAllChats,
  updateChatSession,
  updateChatTitle,
  updateChatSortOrder,
  updateChatGroup,
  setChatArchived,
  deleteChat,
  saveChatMessages,
  touchChatLastMessageAt,
} from "./lib/persistChat";
import { userMessage, type SentAttachment } from "./types/message";
import { deriveChatTitle } from "./lib/chatTitle";
import { buildTranscriptPreamble } from "./lib/transcript";
import { getSession, onAuthStateChange, signOut } from "./lib/auth";
import { fetchMergeEvents, type MergeEvent } from "./lib/mergeEvents";
import { RoomProvider, roomIdForProject, useUpdateMyPresence, useSelf, useOthers, useBroadcastEvent, useEventListener } from "./lib/liveblocks";
import { PresenceBar } from "./components/PresenceBar";
import { supabase } from "./lib/supabase";
import { isClaimedByOther, computeClaimant } from "./lib/claim";
import { PrefsProvider, usePrefs } from "./lib/prefs";
import type { ProjectRow } from "./types/project";

function AppShell({ session, project, onSelectProject }: { session: Session; project: ProjectRow; onSelectProject: (project: ProjectRow) => void }) {
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [chatStates, setChatStates] = useState<Record<string, ChatState>>({});
  const [mergeEvents, setMergeEvents] = useState<MergeEvent[]>([]);
  const [viewMode, setViewMode] = useState<"chat" | "canvas" | "preview">("chat");
  const [chatLayout, setChatLayout] = useState<"single" | "split">("split");
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [rightChatId, setRightChatId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [permissionRequests, setPermissionRequests] = useState<PermissionRequest[]>([]);

  // Bumps the in-memory copy so the sidebar's relative-time/unread signal
  // reacts immediately, without waiting on a round trip to Postgres — the
  // real value is written by touchChatLastMessageAt (DB) alongside every
  // call site below; there's no `chats` UPDATE realtime subscription to
  // pick it up otherwise (only INSERT/DELETE are subscribed above).
  const bumpLastMessageAt = useCallback((chatId: string) => {
    const now = new Date().toISOString();
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, last_message_at: now } : c)));
  }, []);

  const handleSelectActive = useCallback((chatId: string) => {
    setActiveChatId(chatId);
  }, []);

  const handleSelectRight = useCallback((chatId: string) => {
    setRightChatId(chatId);
  }, []);
  const updateMyPresence = useUpdateMyPresence();
  const self = useSelf();
  const others = useOthers();
  const broadcastEvent = useBroadcastEvent();
  const prefs = usePrefs();

  useEffect(() => {
    fetchAllChats(project.id).then(async (rows) => {
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
  }, [project.id]);

  useEffect(() => {
    fetchMergeEvents().then(setMergeEvents);
  }, []);

  useEffect(() => {
    // Same StrictMode double-listen guard as the claude-event listener below.
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;
    listen<PermissionRequest>("permission-request", (event) => {
      setPermissionRequests((prev) =>
        prev.some((r) => r.requestId === event.payload.requestId) ? prev : [...prev, event.payload]
      );
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    });
    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, []);

  const handleAnswerPermission = useCallback((requestId: string, allow: boolean) => {
    setPermissionRequests((prev) => prev.filter((r) => r.requestId !== requestId));
    invoke("answer_permission_request", { requestId, allow }).catch((err) =>
      console.error("failed to answer permission request", err)
    );
  }, []);

  useEffect(() => {
    // listen() is async (a Tauri IPC round-trip), so under React StrictMode's
    // mount→cleanup→mount dev double-invoke, the first mount's cleanup can
    // fire before its listen() call resolves, racing the second mount's
    // listen() and occasionally leaving both listeners live — every backend
    // event then gets applied (and saved, and broadcast) twice. Guarding
    // with `cancelled` closes that window: a listener that resolves after
    // its own effect was already cleaned up unregisters itself immediately
    // instead of staying attached.
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;
    listen<ChatEnvelope>("claude-event", (event) => {
      setChatStates((prev) => {
        const next = applyChatEvent(prev, event.payload);
        if (event.payload.event.type === "turn_complete") {
          const messages = next[event.payload.chatId]?.messages ?? [];
          const last = messages[messages.length - 1];
          if (last?.complete) {
            saveChatMessages(event.payload.chatId, [last]).catch((err) => {
              console.error("failed to save assistant message", err);
              showToast("Couldn't save the response — it may not survive a reload.");
            });
            touchChatLastMessageAt(event.payload.chatId).catch((err) =>
              console.error("failed to update chat last_message_at", err)
            );
            bumpLastMessageAt(event.payload.chatId);
          }
        }
        return next;
      });
      if (event.payload.event.type === "session_started") {
        updateChatSession(event.payload.chatId, event.payload.event.session_id, session.user.id).catch((err) =>
          console.error("failed to persist claude session id", err)
        );
      }
      // Stream this turn to teammates live, ahead of it landing in Postgres —
      // Liveblocks room events are the ephemeral pub/sub already wired up for
      // presence, so no new transport needed.
      broadcastEvent(event.payload as unknown as Json);
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    });
    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, [broadcastEvent, session.user.id, bumpLastMessageAt]);

  // Applies a teammate's in-progress turn locally as it streams in. Doesn't
  // save to Supabase or touch claude_session_id — that's the sending
  // machine's job (above); this just mirrors the same reducer against the
  // events it broadcasts.
  useEventListener(({ event }) => {
    const envelope = event as unknown as ChatEnvelope;
    setChatStates((prev) => applyChatEvent(prev, envelope));
    if (envelope.event.type === "turn_complete") bumpLastMessageAt(envelope.chatId);
  });

  useEffect(() => {
    // Deliberately not subscribed to `messages` INSERTs here: the Liveblocks
    // broadcast above is already the live-sync channel for a turn as it
    // streams, and racing it against this DB echo caused teammates to see
    // the response applied twice (whichever arrived second reopened the
    // "current" message since the first one was already marked complete).
    // A reload still picks up saved messages via loadChatMessages.
    const channel = supabase
      .channel("messages-live")
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
    (chatId: string, prompt: string, attachments: SentAttachment[] = []) => {
      updateMyPresence({ claimedChatId: chatId });
      const chat = chats.find((c) => c.id === chatId);
      const isFirstMessage = (chatStates[chatId]?.messages.length ?? 0) === 0;
      if (isFirstMessage && !chat?.title) {
        const title = deriveChatTitle(prompt);
        if (title) handleRename(chatId, title);
      }
      setChatStates((prev) => {
        const withUserMessage = addUserMessage(prev, chatId, prompt, attachments);
        return {
          ...withUserMessage,
          [chatId]: { ...withUserMessage[chatId], streaming: true },
        };
      });
      saveChatMessages(chatId, [userMessage(prompt, attachments)]).catch((err) => {
        console.error("failed to save user message", err);
        showToast("Couldn't save your message — it may not survive a reload.");
      });
      touchChatLastMessageAt(chatId).catch((err) =>
        console.error("failed to update chat last_message_at", err)
      );
      bumpLastMessageAt(chatId);
      // Native `--resume` only works for whoever's machine/account created the
      // session (see decisions.md). A different claimant gets a fresh session
      // primed with the stored transcript instead, so Claude isn't blind to
      // what already happened.
      const isOwner = !chat?.claude_session_id || chat.claude_session_owner === session.user.id;
      const priorMessages = chatStates[chatId]?.messages ?? [];
      // Local disk paths, not the shareable Supabase URLs — Claude's Read
      // tool only sees local files, see decisions.md.
      const attachmentNote =
        attachments.length > 0
          ? `\n\nAttached files (use Read to view them):\n${attachments.map((a) => `- ${a.localPath}`).join("\n")}`
          : "";
      const effectivePrompt =
        (isOwner ? prompt : `${buildTranscriptPreamble(priorMessages)}\n\n${prompt}`) + attachmentNote;
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
            model: prefs.model.cliValue,
            permissionMode: prefs.effectivePermissionMode,
            effort: prefs.effort.cliValue,
          })
        )
        .catch((err) => {
          console.error("start_session failed", err);
          const detail = err instanceof Error ? err.message : String(err);
          setChatStates((prev) => setSessionError(prev, chatId, `Couldn't start the Claude session: ${detail}`));
        });
    },
    [chats, chatStates, updateMyPresence, session.user.id, prefs, bumpLastMessageAt]
  );

  const handleStop = useCallback((chatId: string) => {
    invoke("stop_session", { chatId }).catch((err) => console.error("stop_session failed", err));
    setChatStates((prev) => cancelStreaming(prev, chatId));
  }, []);

  const handleLeave = useCallback(
    (_chatId: string) => {
      updateMyPresence({ claimedChatId: null });
    },
    [updateMyPresence]
  );

  const handleDelete = useCallback((chatId: string) => {
    invoke<boolean>("chat_has_unmerged_work", { chatId })
      .catch((err) => {
        console.error("failed to check for unmerged work, deleting anyway", err);
        return false;
      })
      .then((hasUnmergedWork) => {
        if (
          hasUnmergedWork &&
          !window.confirm(
            "This chat has work that was never rendered to team — deleting it will discard those changes permanently. Delete anyway?"
          )
        ) {
          return;
        }
        deleteChat(chatId)
          .then(() => setChats((prev) => prev.filter((c) => c.id !== chatId)))
          .catch((err) => {
            console.error("failed to delete chat", err);
            showToast("Couldn't delete the chat — it's still there, try again.");
          });
        invoke("remove_chat_worktree", { chatId }).catch((err) =>
          console.error("failed to remove chat worktree", err)
        );
      });
  }, []);

  const handleRename = useCallback((chatId: string, title: string) => {
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title } : c)));
    updateChatTitle(chatId, title).catch((err) => {
      console.error("failed to rename chat", err);
      showToast("Couldn't save the new chat name.");
    });
  }, []);

  const handleReorder = useCallback((chatId: string, sortOrder: number) => {
    setChats((prev) =>
      prev.map((c) => (c.id === chatId ? { ...c, sort_order: sortOrder } : c)).sort((a, b) => a.sort_order - b.sort_order)
    );
    updateChatSortOrder(chatId, sortOrder).catch((err) => console.error("failed to reorder chat", err));
  }, []);

  const handleGroupChange = useCallback((chatId: string, groupName: string | null) => {
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, group_name: groupName } : c)));
    updateChatGroup(chatId, groupName).catch((err) => {
      console.error("failed to update chat group", err);
      showToast("Couldn't save the group change.");
    });
  }, []);

  const handleArchive = useCallback((chatId: string) => {
    const archivedAt = new Date().toISOString();
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, archived_at: archivedAt } : c)));
    setChatArchived(chatId, true).catch((err) => {
      console.error("failed to archive chat", err);
      showToast("Couldn't archive the chat.");
    });
  }, []);

  const handleUnarchive = useCallback((chatId: string) => {
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, archived_at: null } : c)));
    setChatArchived(chatId, false).catch((err) => {
      console.error("failed to unarchive chat", err);
      showToast("Couldn't restore the chat.");
    });
  }, []);

  const handleExpand = useCallback((chatId: string) => {
    setActiveChatId(chatId);
    setViewMode("chat");
  }, []);

  const handleCreateChat = useCallback(() => {
    createChat(null, project.id).then((id) => {
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
          sort_order: Date.now() / 1000,
          group_name: null,
          archived_at: null,
          last_message_at: null,
          project_id: project.id,
        },
      ]);
      setChatStates((prev) => ({ ...prev, [id]: initChatState() }));
      setActiveChatId(id);
    });
  }, [session.user.id, project.id]);

  const selfOccupant = self ? { email: self.presence.email, claimedChatId: self.presence.claimedChatId } : null;
  const otherOccupants = others.map((o) => ({ email: o.presence.email, claimedChatId: o.presence.claimedChatId }));

  const activeState = activeChatId ? chatStates[activeChatId] : undefined;
  const activeChat = activeChatId ? chats.find((c) => c.id === activeChatId) : undefined;
  const activeClaimant = activeChatId ? computeClaimant(activeChatId, selfOccupant, otherOccupants) : null;
  const activeClaimedByOther = activeChatId ? isClaimedByOther(activeChatId, selfOccupant, otherOccupants) : false;

  // Split-view right pane: defaults to whichever teammate currently has a
  // chat claimed (nice when you haven't picked yet), but rightChatId lets
  // either side be chosen explicitly via the dropdown in its header.
  const teammate = others.find((o) => o.presence.claimedChatId);
  const effectiveRightChatId = rightChatId ?? teammate?.presence.claimedChatId ?? null;
  const rightChat = effectiveRightChatId ? chats.find((c) => c.id === effectiveRightChatId) : undefined;
  const rightState = effectiveRightChatId ? chatStates[effectiveRightChatId] : undefined;
  const rightClaimant = effectiveRightChatId ? computeClaimant(effectiveRightChatId, selfOccupant, otherOccupants) : null;
  const rightClaimedByOther = effectiveRightChatId ? isClaimedByOther(effectiveRightChatId, selfOccupant, otherOccupants) : false;

  const appRef = useRef<HTMLDivElement>(null);
  const flowApiRef = useRef<FlowScreenApi | null>(null);

  return (
    <div className="app" ref={appRef}>
      <TooltipHost />
      <ToastHost />
      <PermissionPrompt requests={permissionRequests} chats={chats} onAnswer={handleAnswerPermission} />
      <LiveCursors containerRef={appRef} viewMode={viewMode} flowApiRef={flowApiRef} />
      <div className="toolbar">
        <div className="toolbar-side">
          {viewMode === "chat" && (
            <button
              type="button"
              className="icon-button"
              title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
              onClick={() => setSidebarCollapsed((c) => !c)}
            >
              <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <line x1="9" y1="4" x2="9" y2="20" />
              </svg>
            </button>
          )}
          <ProjectMenu project={project} onSelectProject={onSelectProject} />
        </div>
        <ViewToggle mode={viewMode} onChange={setViewMode} />
        <div className="toolbar-side toolbar-actions">
          {viewMode === "canvas" && (
            <>
              <button
                type="button"
                className="icon-button"
                title="Reset zoom to 100%"
                onClick={() => flowApiRef.current?.zoomTo(1, { duration: 200 })}
              >
                <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M11 8v6M8 11h6M21 21l-4.3-4.3" />
                </svg>
              </button>
              <button className="btn btn-primary" onClick={handleCreateChat}>
                <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New chat
              </button>
            </>
          )}
          {viewMode === "chat" &&
            (() => {
              // ponytail: mirrors ViewToggle.tsx's base/active/inactive
              // pattern — see decisions.md for why base must never carry
              // a background/text-color utility that active/inactive also
              // set on the same element.
              const base = "border-none text-[0.85em] font-medium px-[1.1em] py-[0.5em] rounded-md";
              const active = "bg-bg-primary text-text-primary";
              const inactive = "bg-transparent text-text-secondary";
              return (
                <div className="flex gap-[0.2em] bg-bg-tertiary rounded-lg p-[3px]">
                  <button
                    className={chatLayout === "single" ? `${base} ${active}` : `${base} ${inactive}`}
                    onClick={() => setChatLayout("single")}
                  >
                    Single
                  </button>
                  <button
                    className={chatLayout === "split" ? `${base} ${active}` : `${base} ${inactive}`}
                    onClick={() => setChatLayout("split")}
                  >
                    Split
                  </button>
                </div>
              );
            })()}
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
            onStop={handleStop}
            onLeave={handleLeave}
            onDelete={handleDelete}
            onArchive={handleArchive}
            onExpand={handleExpand}
            onRename={handleRename}
            flowApiRef={flowApiRef}
          />
        </>
      ) : viewMode === "preview" ? (
        <PreviewPage session={session} />
      ) : (
        <div className="chat-workspace">
          {!sidebarCollapsed && (
            <>
              <div className="sidebar-panel" style={{ width: sidebarWidth }}>
                <Sidebar
                  chats={chats}
                  activeChatId={activeChatId}
                  onSelect={handleSelectActive}
                  onCreateChat={handleCreateChat}
                  onRename={handleRename}
                  onDelete={handleDelete}
                  onReorder={handleReorder}
                  onGroupChange={handleGroupChange}
                  onArchive={handleArchive}
                  onUnarchive={handleUnarchive}
                  userEmail={session.user.email ?? "you"}
                  onSignOut={() => signOut()}
                  self={selfOccupant}
                  others={otherOccupants}
                />
              </div>
              <ResizeDivider width={sidebarWidth} onChange={setSidebarWidth} min={200} max={420} />
            </>
          )}
          <div className="chat-panes">
            {activeChatId && activeChat ? (
              <ChatPane
                chat={activeChat}
                chats={chats}
                onSelectChat={handleSelectActive}
                self={selfOccupant}
                others={otherOccupants}
                excludeChatId={effectiveRightChatId}
                state={activeState}
                claimant={activeClaimant}
                isSelf={activeClaimant === session.user.email}
                disabled={activeState?.streaming === true || activeClaimedByOther}
                streaming={activeState?.streaming === true}
                onSend={(prompt, attachments) => handleSend(activeChatId, prompt, attachments)}
                onStop={() => handleStop(activeChatId)}
                onRename={(title) => handleRename(activeChatId, title)}
                onDelete={() => handleDelete(activeChatId)}
              />
            ) : (
              <ChatPaneEmpty
                text="Select a chat, or start a new one."
                chats={chats}
                onSelectChat={handleSelectActive}
                onCreateChat={handleCreateChat}
                self={selfOccupant}
                others={otherOccupants}
                excludeChatId={effectiveRightChatId}
              />
            )}

            {chatLayout === "split" &&
              (effectiveRightChatId && rightChat ? (
                <ChatPane
                  chat={rightChat}
                  chats={chats}
                  onSelectChat={handleSelectRight}
                  self={selfOccupant}
                  others={otherOccupants}
                  excludeChatId={activeChatId}
                  state={rightState}
                  claimant={rightClaimant}
                  isSelf={rightClaimant === session.user.email}
                  disabled={rightState?.streaming === true || rightClaimedByOther}
                  streaming={rightState?.streaming === true}
                  onSend={(prompt, attachments) => handleSend(effectiveRightChatId, prompt, attachments)}
                  onStop={() => handleStop(effectiveRightChatId)}
                  onRename={(title) => handleRename(effectiveRightChatId, title)}
                  onDelete={() => handleDelete(effectiveRightChatId)}
                />
              ) : (
                <ChatPaneEmpty
                  text={chats.length === 0 ? "No chats available" : "Choose a chat for this pane."}
                  chats={chats}
                  onSelectChat={handleSelectRight}
                  self={selfOccupant}
                  others={otherOccupants}
                  excludeChatId={activeChatId}
                />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  const [session, setSession] = useState<Session | null | "loading">("loading");
  // ponytail: no persistence of the last-picked project across launches —
  // add (e.g. localStorage) if reselecting every launch turns out annoying.
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [repoReady, setRepoReady] = useState(false);

  useEffect(() => {
    getSession().then(setSession);
    return onAuthStateChange(setSession);
  }, []);

  // Clones this project's repo locally (if not already cloned on this
  // machine) and points the Tauri backend's git_ops::repo_root() at it,
  // before AppShell mounts and starts issuing worktree commands against it.
  useEffect(() => {
    if (!project) return;
    setRepoReady(false);
    invoke("open_project_repo", { projectId: project.id, repoUrl: project.repo_url })
      .then(() => setRepoReady(true))
      .catch((err) => {
        console.error("failed to open project repo", err);
        showToast(`Couldn't open "${project.name}"'s repo — check the URL and your git access, then try again.`);
        setProject(null);
      });
  }, [project]);

  if (session === "loading") return null;
  if (!session) return <LoginScreen onSignedIn={() => {}} />;
  if (!project) return <ProjectSwitcher onSelect={setProject} />;
  if (!repoReady) return null;

  return (
    <RoomProvider
      id={roomIdForProject(project.id)}
      initialPresence={{ email: session.user.email ?? "unknown", claimedChatId: null, cursor: null, cursorView: null }}
      initialStorage={{ positions: new LiveMap(), chatGroups: new LiveMap(), groupLabels: new LiveMap() }}
    >
      <PrefsProvider>
        <AppShell session={session} project={project} onSelectProject={setProject} />
      </PrefsProvider>
    </RoomProvider>
  );
}

export default App;
