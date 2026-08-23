import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import "./App.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Session } from "@supabase/supabase-js";
import { LiveMap, type Json } from "@liveblocks/client";
import { ChatPane, ChatPaneEmpty } from "./components/ChatPane";
import { LoginScreen } from "./components/LoginScreen";
import { ProjectSwitcher } from "./components/ProjectSwitcher";
import { ProjectMenu } from "./components/ProjectMenu";
import { Sidebar } from "./components/Sidebar";
import { ResizeDivider } from "./components/ResizeDivider";
import { PaneResizeHandle } from "./components/PaneResizeHandle";
import { ViewToggle } from "./components/ViewToggle";
import { CanvasView, type FlowScreenApi } from "./components/CanvasView";
import { PreviewPage } from "./components/PreviewPage";
import { LiveCursors } from "./components/LiveCursors";
import { TooltipHost } from "./components/TooltipHost";
import { ToastHost, showToast } from "./components/ToastHost";
import { PermissionPrompt, type PermissionRequest } from "./components/PermissionPrompt";
import type { ChatRow } from "./types/chat";
import { applyChatEvent, appendUserMessage, setSessionError, cancelStreaming, initChatState, type ChatEnvelope, type ChatState } from "./lib/chatStore";
import {
  createChat,
  loadChatMessages,
  fetchAllChats,
  updateChatSession,
  updateChatTitle,
  updateChatSortOrder,
  updateChatGroup,
  setChatArchived,
  setChatOpen,
  deleteChat,
  saveChatMessages,
  touchChatLastMessageAt,
  updateChatHandoff,
} from "./lib/persistChat";
import { userMessage, handoffBriefMessage, type SentAttachment, type Message } from "./types/message";
import { deriveChatTitle } from "./lib/chatTitle";
import { computeSortOrder } from "./lib/reorder";
import { buildTranscriptPreamble } from "./lib/transcript";
import { buildSummaryTranscript } from "./lib/summaryTranscript";
import { getSession, onAuthStateChange, signOut } from "./lib/auth";
import { fetchMergeEvents, type MergeEvent } from "./lib/mergeEvents";
import { fetchLogbookEntries, insertLogbookEntry, type LogbookEntry } from "./lib/logbookEntries";
import {
  extractMentions,
  resolveMentions,
  fetchUnreadMentions,
  insertMentions,
  markMentionsRead,
  type MentionInboxEntry,
} from "./lib/mentions";
import { notifyMention } from "./lib/notify";
import { fetchProfiles, updateMyProfile, type Profile } from "./lib/profiles";
import { setProfileOverrides, pickUnusedColor } from "./lib/presenceColor";
import { LogPanel } from "./components/LogPanel";
import { RoomProvider, roomIdForProject, useUpdateMyPresence, useSelf, useOthers, useBroadcastEvent, useEventListener } from "./lib/liveblocks";
import { PresenceBar } from "./components/PresenceBar";
import { supabase } from "./lib/supabase";
import { isClaimedByOther, computeClaimant } from "./lib/claim";
import { PrefsProvider, usePrefs } from "./lib/prefs";
import type { ProjectRow } from "./types/project";

// Even 50/50 split, computed from the container's live width so a freshly
// opened split view starts balanced instead of snapping to whatever the
// last drag left behind. clientWidth includes the container's own padding
// (12px normally, 9px on the left when the sidebar's showing), which has to
// come out too — otherwise the fixed-width left pane claims its share of
// that padding as real space while the flexible right pane silently
// shrinks to absorb the overflow, so the "50/50" split reads left-heavy.
// 12 = .chat-panes' flex gap between the two panes.
function defaultSplitPaneWidth(container: HTMLDivElement | null): number {
  if (!container) return (800 - 12) / 2;
  const style = getComputedStyle(container);
  const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  return (container.clientWidth - horizontalPadding - 12) / 2;
}

function AppShell({ session, project, onSelectProject }: { session: Session; project: ProjectRow; onSelectProject: (project: ProjectRow) => void }) {
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [chatStates, setChatStates] = useState<Record<string, ChatState>>({});
  const [mergeEvents, setMergeEvents] = useState<MergeEvent[]>([]);
  const [logbookEntries, setLogbookEntries] = useState<LogbookEntry[]>([]);
  const [mentionInbox, setMentionInbox] = useState<MentionInboxEntry[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [viewMode, setViewMode] = useState<"chat" | "canvas" | "preview">("chat");
  const [chatLayout, setChatLayout] = useState<"single" | "split">("split");
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [rightChatId, setRightChatId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [leftPaneWidth, setLeftPaneWidth] = useState<number | null>(null);
  const chatPanesRef = useRef<HTMLDivElement>(null);
  const [logPanelOpen, setLogPanelOpen] = useState(false);
  const [logPanelWidth, setLogPanelWidth] = useState(320);
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

  // Used by the mention toast/badge/inbox to snap straight to the chat that
  // was pinged — unread state itself clears via the effect below once this
  // chat becomes the active/right pane, not here directly.
  const jumpToChat = useCallback((chatId: string) => {
    setViewMode("chat");
    setActiveChatId(chatId);
  }, []);

  // Clears the local badge and persists read_at for whatever's cleared —
  // the DB row is the actual source of truth (0018_mentions.sql), so a
  // teammate's own "unread" query stays correct even if this client never
  // reopens that chat again this session.
  const clearMentionsForChat = useCallback((chatId: string) => {
    setMentionInbox((prev) => {
      const toClear = prev.filter((m) => m.chatId === chatId);
      if (toClear.length > 0) {
        markMentionsRead(toClear.map((m) => m.id)).catch((err) => console.error("failed to mark mentions read", err));
      }
      return prev.filter((m) => m.chatId !== chatId);
    });
  }, []);
  const updateMyPresence = useUpdateMyPresence();
  const self = useSelf();
  const others = useOthers();
  const broadcastEvent = useBroadcastEvent();
  const prefs = usePrefs();

  // Not persisted — resets on app restart, an acceptable simplification for
  // an elapsed-time display. Tracks when each chat was first claimed, so a
  // handoff/checkpoint brief can report how long the stretch of work was.
  const claimedSinceRef = useRef<Record<string, number>>({});
  // Kept fresh every render so the close-requested handler below (registered
  // once, per Tauri's event API) always sees the latest claim/messages
  // instead of a stale closure from whenever it was set up.
  const selfRef = useRef(self);
  selfRef.current = self;
  const chatStatesRef = useRef(chatStates);
  chatStatesRef.current = chatStates;

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
    fetchLogbookEntries(project.id).then(setLogbookEntries);
  }, [project.id]);

  useEffect(() => {
    fetchProfiles().then((next) => {
      setProfiles(next);
      setProfileOverrides(next);
    });
  }, []);

  // Live so a teammate's chosen name/color show up immediately instead of on
  // next reload — profiles aren't scoped to a project, so unlike the other
  // realtime subscriptions below this one isn't keyed on project.id.
  useEffect(() => {
    const channel = supabase
      .channel("profiles-live")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, (payload) => {
        const row = payload.new as Profile;
        setProfiles((prev) => {
          const next = prev.map((p) => (p.id === row.id ? row : p));
          setProfileOverrides(next);
          return next;
        });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "profiles" }, (payload) => {
        const row = payload.new as Profile;
        setProfiles((prev) => {
          const next = prev.some((p) => p.id === row.id) ? prev : [...prev, row];
          setProfileOverrides(next);
          return next;
        });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleUpdateProfile = useCallback(
    (updates: { display_name?: string | null; color?: string | null }) => {
      updateMyProfile(session.user.id, updates)
        .then(() => fetchProfiles())
        .then((next) => {
          setProfiles(next);
          setProfileOverrides(next);
        })
        .catch((err) => {
          console.error("failed to update profile", err);
          showToast(
            err instanceof Error && err.message.includes("profiles_color_unique")
              ? "That color was just taken — pick another."
              : "Couldn't save your personalization."
          );
        });
    },
    [session.user.id]
  );

  // Without "Automatic", everyone needs a concrete color — assign the first
  // one nobody else has taken the first time this profile is seen with none.
  const autoAssignedColorRef = useRef(false);
  useEffect(() => {
    if (autoAssignedColorRef.current) return;
    const mine = profiles.find((p) => p.id === session.user.id);
    if (!mine || mine.color) return;
    autoAssignedColorRef.current = true;
    const taken = new Set(profiles.filter((p) => p.id !== session.user.id && p.color).map((p) => p.color as string));
    handleUpdateProfile({ color: pickUnusedColor(taken) });
  }, [profiles, session.user.id, handleUpdateProfile]);

  // Seeds the mentions inbox with anything sent while this session wasn't
  // open — a mention is now a durable row (0018_mentions.sql), not just a
  // live broadcast, so this is what actually makes "tag Ben while he's
  // offline" work: he sees it here on his next launch regardless of whether
  // he was online when it was sent.
  useEffect(() => {
    if (!session.user.email) return;
    fetchUnreadMentions(session.user.email).then(setMentionInbox);
  }, [session.user.email]);

  useEffect(() => {
    if (!session.user.email) return;
    const channel = supabase
      .channel("mentions-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "mentions", filter: `to_email=eq.${session.user.email}` },
        (payload) => {
          const row = payload.new as {
            id: string;
            chat_id: string;
            chat_title: string | null;
            from_email: string;
            to_email: string;
            kind: "mention" | "handoff";
            created_at: string;
          };
          // Belt-and-braces alongside the `to_email` filter above: only ever
          // alert when this row is actually addressed to you. A *positive*
          // check on `to_email` (not a negative check on `from_email`) —
          // the earlier version rejected on `from_email === you`, which also
          // wrongly blocked a legitimate self-directed handoff (from you, to
          // you). Checking `to_email` handles both: still guards against a
          // row the server-side filter shouldn't have let through, without
          // penalizing the case where you really are the recipient.
          if (row.to_email !== session.user.email) return;
          const entry: MentionInboxEntry = {
            id: row.id,
            chatId: row.chat_id,
            chatTitle: row.chat_title,
            fromEmail: row.from_email,
            kind: row.kind,
            createdAt: row.created_at,
          };
          setMentionInbox((prev) => [entry, ...prev]);
          const chatTitle = entry.chatTitle ?? "a chat";
          const text =
            entry.kind === "handoff"
              ? `${entry.fromEmail} handed off "${chatTitle}" to you`
              : `${entry.fromEmail} mentioned you in "${chatTitle}"`;
          showToast(text, "info", () => jumpToChat(entry.chatId));
          notifyMention(entry.kind === "handoff" ? `${entry.fromEmail} handed off a chat to you` : `${entry.fromEmail} mentioned you`, chatTitle).catch(
            (err) => console.error("failed to send notification", err)
          );
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session.user.email, jumpToChat]);

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
      broadcastEvent({ kind: "claude_event", ...event.payload } as unknown as Json);
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

  // Applies a teammate's in-progress turn (and their outgoing prompts)
  // locally as they happen. Doesn't save to Supabase or touch
  // claude_session_id — that's the sending machine's job (above); this just
  // mirrors the same reducers against whatever it broadcasts.
  useEventListener(({ event }) => {
    const broadcast = event as unknown as { kind: "user_message" | "claude_event" } & Record<string, unknown>;
    if (broadcast.kind === "user_message") {
      const { chatId, message } = broadcast as unknown as { chatId: string; message: Message };
      setChatStates((prev) => appendUserMessage(prev, chatId, message));
      return;
    }
    const envelope = broadcast as unknown as ChatEnvelope;
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
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "logbook_entries", filter: `project_id=eq.${project.id}` },
        (payload) => {
          setLogbookEntries((prev) => [payload.new as LogbookEntry, ...prev]);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [project.id]);

  // Fallback for "closed the app and forgot to hand off": if you're still
  // holding a claim with unsummarized work, generate the same kind of brief
  // as a manual handoff but leave the chat unclaimed (not assigned to
  // anyone specific — see decisions.md/plan for why auto-assigning without
  // consent is the wrong call) so whoever picks it up next has context.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        const chatId = selfRef.current?.presence.claimedChatId;
        const messages = chatId ? chatStatesRef.current[chatId]?.messages ?? [] : [];
        if (!chatId || messages.length === 0) return;

        event.preventDefault();
        try {
          const transcript = buildSummaryTranscript(messages);
          const brief = await invoke<string>("generate_session_brief", { transcript });
          const startedAt = claimedSinceRef.current[chatId];
          const durationSeconds = startedAt ? Math.round((Date.now() - startedAt) / 1000) : null;
          await insertLogbookEntry({
            chatId,
            projectId: project.id,
            userId: session.user.id,
            userEmail: session.user.email ?? "",
            kind: "checkpoint",
            handedOffTo: null,
            summary: brief,
            durationSeconds,
          });
          await saveChatMessages(chatId, [handoffBriefMessage(brief, { briefKind: "checkpoint" })]);
        } catch (err) {
          console.error("failed to generate checkpoint brief on close", err);
        }
        await getCurrentWindow().destroy();
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [project.id, session.user.id, session.user.email]);

  const handleSend = useCallback(
    (chatId: string, prompt: string, attachments: SentAttachment[] = []) => {
      updateMyPresence({ claimedChatId: chatId });
      claimedSinceRef.current[chatId] ??= Date.now();
      clearMentionsForChat(chatId);
      const chat = chats.find((c) => c.id === chatId);
      const isFirstMessage = (chatStates[chatId]?.messages.length ?? 0) === 0;
      if (isFirstMessage && !chat?.title) {
        const title = deriveChatTitle(prompt);
        if (title) handleRename(chatId, title);
      }
      const sentMessage = userMessage(prompt, attachments, session.user.email);
      setChatStates((prev) => appendUserMessage(prev, chatId, sentMessage));
      // Teammates otherwise never see this prompt live: the claude-event
      // broadcast below only covers the assistant's turn, so without this a
      // teammate's screen shows Claude's replies but not what was asked —
      // they'd only catch up on the next full reload's loadChatMessages.
      broadcastEvent({ kind: "user_message", chatId, message: sentMessage } as unknown as Json);
      saveChatMessages(chatId, [sentMessage]).catch((err) => {
        console.error("failed to save user message", err);
        showToast("Couldn't save your message — it may not survive a reload.");
      });
      touchChatLastMessageAt(chatId).catch((err) =>
        console.error("failed to update chat last_message_at", err)
      );
      bumpLastMessageAt(chatId);
      const mentioned = extractMentions(prompt);
      if (mentioned.length > 0 && session.user.email) {
        const toEmails = resolveMentions(mentioned, profiles, session.user.email);
        insertMentions({
          projectId: project.id,
          chatId,
          chatTitle: chat?.title ?? null,
          fromEmail: session.user.email,
          toEmails,
        }).catch((err) => console.error("failed to save mentions", err));
      }
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
      // @mentions are addressed to a human teammate, not Claude — without
      // this, the raw "@name" text in the prompt reads as an unresolvable
      // reference and Claude asks who it is instead of just answering.
      const mentionNote =
        mentioned.length > 0
          ? `\n\n(Note: ${mentioned.map((m) => `@${m}`).join(", ")} is a teammate being pulled into this chat to see it, not a name you need to resolve — just answer the message normally.)`
          : "";
      const effectivePrompt =
        (isOwner ? prompt : `${buildTranscriptPreamble(priorMessages)}\n\n${prompt}`) + attachmentNote + mentionNote;
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
    [chats, chatStates, updateMyPresence, session.user.id, session.user.email, prefs, bumpLastMessageAt, profiles, project.id, clearMentionsForChat]
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

  const handleHandoff = useCallback(
    (chatId: string, teammateEmail: string) => {
      const messages = chatStates[chatId]?.messages ?? [];
      // Nothing to summarize — asking the LLM to brief an empty transcript
      // produces a confused, overly technical reply instead of a real
      // summary. Skip the call entirely rather than trying to prompt around it.
      const briefPromise =
        messages.length === 0
          ? Promise.resolve("Empty chat — nothing's happened here yet.")
          : invoke<string>("generate_session_brief", { transcript: buildSummaryTranscript(messages) });
      return briefPromise
        .then((brief) => {
          const startedAt = claimedSinceRef.current[chatId];
          const durationSeconds = startedAt ? Math.round((Date.now() - startedAt) / 1000) : null;
          delete claimedSinceRef.current[chatId];

          const briefMessage = handoffBriefMessage(brief, { briefKind: "handoff", handedOffTo: teammateEmail });
          setChatStates((prev) => ({
            ...prev,
            [chatId]: { ...prev[chatId], messages: [...(prev[chatId]?.messages ?? []), briefMessage] },
          }));
          saveChatMessages(chatId, [briefMessage]).catch((err) => console.error("failed to save handoff brief", err));
          insertLogbookEntry({
            chatId,
            projectId: project.id,
            userId: session.user.id,
            userEmail: session.user.email ?? "",
            kind: "handoff",
            handedOffTo: teammateEmail,
            summary: brief,
            durationSeconds,
          }).catch((err) => console.error("failed to record handoff logbook entry", err));
          updateChatHandoff(chatId, teammateEmail).catch((err) =>
            console.error("failed to persist handoff assignment", err)
          );
          setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, handed_off_to: teammateEmail } : c)));
          updateMyPresence({ claimedChatId: null });
          if (session.user.email) {
            const chat = chats.find((c) => c.id === chatId);
            insertMentions({
              projectId: project.id,
              chatId,
              chatTitle: chat?.title ?? null,
              fromEmail: session.user.email,
              toEmails: [teammateEmail],
              kind: "handoff",
            }).catch((err) => console.error("failed to save handoff notification", err));
          }
        })
        .catch((err) => {
          console.error("failed to generate handoff brief", err);
          showToast("Couldn't generate a handoff brief — try again.");
        });
    },
    [chatStates, chats, project.id, session.user.id, session.user.email, updateMyPresence]
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

  const handleToggleOpen = useCallback((chatId: string) => {
    setChats((prev) => {
      const chat = prev.find((c) => c.id === chatId);
      const nextOpen = !chat?.open;
      setChatOpen(chatId, nextOpen).catch((err) => {
        console.error("failed to update chat open state", err);
        showToast("Couldn't update multiplayer access for this chat.");
      });
      return prev.map((c) => (c.id === chatId ? { ...c, open: nextOpen } : c));
    });
  }, []);

  const handleExpand = useCallback((chatId: string) => {
    setActiveChatId(chatId);
    setViewMode("chat");
  }, []);

  const handleCreateChat = useCallback(() => {
    setChats((prevChats) => {
      const minSortOrder = prevChats.reduce((min, c) => Math.min(min, c.sort_order), Infinity);
      const sortOrder = computeSortOrder(null, Number.isFinite(minSortOrder) ? minSortOrder : null);
      createChat(null, project.id, sortOrder).then((id) => {
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
            sort_order: sortOrder,
            group_name: null,
            archived_at: null,
            last_message_at: null,
            project_id: project.id,
            handed_off_to: null,
            open: false,
          },
        ]);
        setChatStates((prev) => ({ ...prev, [id]: initChatState() }));
        setActiveChatId(id);
      });
      return prevChats;
    });
  }, [session.user.id, project.id]);

  const selfOccupant = self ? { email: self.presence.email, claimedChatId: self.presence.claimedChatId } : null;
  const otherOccupants = others.map((o) => ({ email: o.presence.email, claimedChatId: o.presence.claimedChatId }));
  const onlineEmails = new Set([...(self ? [self.presence.email] : []), ...others.map((o) => o.presence.email)]);
  const assignableTeammates = profiles.map((p) => ({
    email: p.email,
    displayName: p.display_name,
    online: onlineEmails.has(p.email),
  }));

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

  // A mention badge counts as read once its chat is actually opened in the
  // docked view — sending into a chat (any view, see handleSend) is the
  // other "you've seen this" signal, since canvas cards don't have a single
  // "open" moment the way the docked pane's active/right slot does.
  useEffect(() => {
    if (activeChatId) clearMentionsForChat(activeChatId);
    if (effectiveRightChatId) clearMentionsForChat(effectiveRightChatId);
  }, [activeChatId, effectiveRightChatId, clearMentionsForChat]);

  const mentionedChatIds = useMemo(() => new Set(mentionInbox.map((m) => m.chatId)), [mentionInbox]);

  const appRef = useRef<HTMLDivElement>(null);
  const flowApiRef = useRef<FlowScreenApi | null>(null);

  return (
    <div className="app" ref={appRef}>
      <TooltipHost />
      <ToastHost />
      <PermissionPrompt requests={permissionRequests} chats={chats} onAnswer={handleAnswerPermission} />
      <LiveCursors containerRef={appRef} viewMode={viewMode} flowApiRef={flowApiRef} />
      <div className="toolbar" data-tauri-drag-region>
        <div className="toolbar-side toolbar-side-traffic-lights">
          {viewMode === "chat" && (
            <button
              type="button"
              className="toolbar-icon-button"
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
        <ViewToggle
          mode={viewMode}
          onChange={setViewMode}
          onChatClick={() => setChatLayout((l) => (l === "single" ? "split" : "single"))}
        />
        <div className="toolbar-side toolbar-actions">
          {viewMode === "canvas" && (
            <>
              <button
                type="button"
                className="toolbar-icon-button"
                title="Reset zoom to 100%"
                onClick={() => flowApiRef.current?.zoomTo(1, { duration: 200 })}
              >
                <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M11 8v6M8 11h6M21 21l-4.3-4.3" />
                </svg>
              </button>
              <button
                type="button"
                className="flex items-center gap-[0.4em] h-[26px] text-[12px] text-text-secondary bg-bg-tertiary border-none rounded-md px-[0.8em] cursor-pointer hover:text-text-primary"
                onClick={handleCreateChat}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New chat
              </button>
            </>
          )}
          <button
            type="button"
            className="toolbar-icon-button mr-[8px]"
            style={logPanelOpen ? { color: "var(--accent)" } : undefined}
            title="Log"
            onClick={() => setLogPanelOpen((o) => !o)}
          >
            <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          </button>
          <PresenceBar />
        </div>
      </div>
      <div className="flex-1 min-h-0 flex">
      {viewMode === "canvas" ? (
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
          onHandoff={handleHandoff}
          onToggleOpen={handleToggleOpen}
          assignableTeammates={assignableTeammates}
          mentionedChatIds={mentionedChatIds}
          flowApiRef={flowApiRef}
        />
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
                  mentionedChatIds={mentionedChatIds}
                  selfProfile={profiles.find((p) => p.id === session.user.id) ?? null}
                  otherProfiles={profiles.filter((p) => p.id !== session.user.id)}
                  onUpdateProfile={handleUpdateProfile}
                />
              </div>
              <ResizeDivider width={sidebarWidth} onChange={setSidebarWidth} min={200} max={420} />
            </>
          )}
          <div
            ref={chatPanesRef}
            className="chat-panes"
            style={!sidebarCollapsed ? { paddingLeft: 9 } : undefined}
          >
            <div
              className={`min-w-0 min-h-0 flex flex-col flex-1${chatLayout === "split" ? " relative" : ""}`}
              style={
                chatLayout === "split"
                  ? { flex: `0 0 ${leftPaneWidth ?? defaultSplitPaneWidth(chatPanesRef.current)}px` }
                  : undefined
              }
            >
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
                  disabled={activeState?.streaming === true || (activeClaimedByOther && !activeChat.open)}
                  streaming={activeState?.streaming === true}
                  onSend={(prompt, attachments) => handleSend(activeChatId, prompt, attachments)}
                  onStop={() => handleStop(activeChatId)}
                  onRename={(title) => handleRename(activeChatId, title)}
                  onDelete={() => handleDelete(activeChatId)}
                  assignableTeammates={assignableTeammates}
                  onHandoff={(email) => handleHandoff(activeChatId, email)}
                  onToggleOpen={() => handleToggleOpen(activeChatId)}
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
              {chatLayout === "split" && (
                <PaneResizeHandle
                  width={leftPaneWidth ?? defaultSplitPaneWidth(chatPanesRef.current)}
                  onChange={setLeftPaneWidth}
                  onReset={() => setLeftPaneWidth(null)}
                  min={280}
                  max={Math.max(280, (chatPanesRef.current?.clientWidth ?? 2000) - 280 - 12)}
                />
              )}
            </div>

            {chatLayout === "split" && (
              <div className="min-w-0 min-h-0 flex flex-col flex-1">
                {effectiveRightChatId && rightChat ? (
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
                    disabled={rightState?.streaming === true || (rightClaimedByOther && !rightChat.open)}
                    streaming={rightState?.streaming === true}
                    onSend={(prompt, attachments) => handleSend(effectiveRightChatId, prompt, attachments)}
                    onStop={() => handleStop(effectiveRightChatId)}
                    onRename={(title) => handleRename(effectiveRightChatId, title)}
                    onDelete={() => handleDelete(effectiveRightChatId)}
                    assignableTeammates={assignableTeammates}
                    onHandoff={(email) => handleHandoff(effectiveRightChatId, email)}
                    onToggleOpen={() => handleToggleOpen(effectiveRightChatId)}
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
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {logPanelOpen && (
        <>
          <ResizeDivider invert width={logPanelWidth} onChange={setLogPanelWidth} min={260} max={480} />
          <div className="sidebar-panel" style={{ width: logPanelWidth }}>
            <LogPanel
              chats={chats}
              entries={logbookEntries}
              mentions={mentionInbox}
              selfEmail={session.user.email ?? null}
              onJumpToChat={jumpToChat}
              onClearMentions={() => {
                markMentionsRead(mentionInbox.map((m) => m.id)).catch((err) =>
                  console.error("failed to mark mentions read", err)
                );
                setMentionInbox([]);
              }}
              onClose={() => setLogPanelOpen(false)}
            />
          </div>
        </>
      )}
      </div>
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
      initialPresence={{
        email: session.user.email ?? "unknown",
        claimedChatId: null,
        cursor: null,
        cursorView: null,
        typing: null,
      }}
      initialStorage={{ positions: new LiveMap(), chatGroups: new LiveMap(), groupLabels: new LiveMap() }}
    >
      <PrefsProvider>
        <AppShell session={session} project={project} onSelectProject={setProject} />
      </PrefsProvider>
    </RoomProvider>
  );
}

export default App;
