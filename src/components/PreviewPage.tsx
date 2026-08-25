import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { ChatRow } from "../types/chat";
import type { Profile } from "../lib/profiles";
import {
  fetchPreviewPins,
  fetchPreviewPinReplies,
  fetchPreviewStrokes,
  insertPreviewPin,
  insertPreviewPinReply,
  setPinResolved,
  deletePreviewPin,
  movePreviewPin,
  insertPreviewStroke,
  deletePreviewStroke,
  clearOwnPreviewStrokes,
  lastOwnStroke,
  visiblePins,
  pinsOnPage,
  repliesByPin,
  type PreviewPin,
  type PreviewPinReply,
  type PreviewStroke,
} from "../lib/previewComments";
import type { PercentPoint } from "../lib/overlayGeometry";
import { PreviewToolbar, type PreviewTool } from "./PreviewToolbar";
import { PillToggle } from "./PillToggle";
import { PreviewAnnotationLayer } from "./PreviewAnnotationLayer";
import { PreviewCommentPanel } from "./PreviewCommentPanel";
import { showToast } from "./ToastHost";

// Same fixed port preview_server.rs always uses — see MainAgentInstrument.tsx.
const TEAM_PREVIEW_URL = "http://localhost:5180";

export function PreviewPage({
  session,
  chats,
  activeChatId,
  profiles,
}: {
  session: Session;
  chats: ChatRow[];
  activeChatId: string | null;
  profiles: Profile[];
}) {
  const [target, setTarget] = useState<"team" | "local">("team");
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const [localChatId, setLocalChatId] = useState<string | null>(activeChatId);
  const [previewStatus, setPreviewStatus] = useState<"starting" | "ready" | "error">("starting");
  const [localPort, setLocalPort] = useState<number | null>(null);
  const [tool, setTool] = useState<PreviewTool>("cursor");
  const [pins, setPins] = useState<PreviewPin[]>([]);
  const [replies, setReplies] = useState<PreviewPinReply[]>([]);
  const [strokes, setStrokes] = useState<PreviewStroke[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [openPinId, setOpenPinId] = useState<string | null>(null);
  const [draftPin, setDraftPin] = useState<PercentPoint | null>(null);
  const [activeStroke, setActiveStroke] = useState<PercentPoint[] | null>(null);
  const [currentPagePath, setCurrentPagePath] = useState<string | null>(null);
  // Bumped to force the iframe to remount — a plain reload() call would need
  // cross-origin access to the iframe's window, which the browser blocks.
  const [reloadKey, setReloadKey] = useState(0);
  // Team preview is a local dev server per machine, not something a
  // teammate's merge pushes to automatically — this tracks whether
  // origin/team has commits this machine hasn't pulled into its own team
  // worktree yet, so the Update button can show that there's something to
  // get rather than silently doing nothing when clicked out of habit.
  const [teamHasUpdate, setTeamHasUpdate] = useState(false);
  const [pulling, setPulling] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let cancelled = false;
    setPreviewStatus("starting");
    setLocalPort(null);
    setCurrentPagePath(null);

    if (target === "team") {
      invoke("ensure_team_preview_running")
        .then(() => {
          if (!cancelled) setPreviewStatus("ready");
        })
        .catch((err) => {
          console.error("ensure_team_preview_running failed", err);
          if (!cancelled) setPreviewStatus("error");
        });
      return () => {
        cancelled = true;
      };
    }

    if (!localChatId) {
      setPreviewStatus("error");
      return () => {
        cancelled = true;
      };
    }

    invoke<number>("ensure_chat_preview_running", { chatId: localChatId })
      .then((port) => {
        if (!cancelled) {
          setLocalPort(port);
          setPreviewStatus("ready");
        }
      })
      .catch((err) => {
        console.error("ensure_chat_preview_running failed", err);
        if (!cancelled) setPreviewStatus("error");
      });
    return () => {
      cancelled = true;
      invoke("stop_chat_preview", { chatId: localChatId }).catch((err) =>
        console.error("stop_chat_preview failed", err),
      );
    };
  }, [target, localChatId]);

  // Polls rather than pushing this over realtime — it's cheap (a bare `git
  // fetch`, no data transfer beyond refs) and every teammate needs to know
  // independently anyway, since "there's an update" is relative to each
  // person's own local team worktree, not a single shared value.
  useEffect(() => {
    if (target !== "team") {
      setTeamHasUpdate(false);
      return;
    }
    let cancelled = false;
    function check() {
      invoke<boolean>("team_preview_has_update")
        .then((has) => {
          if (!cancelled) setTeamHasUpdate(has);
        })
        .catch((err) => console.error("team_preview_has_update failed", err));
    }
    check();
    const id = setInterval(check, 20_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [target]);

  function handleUpdateClick() {
    if (target !== "team") {
      setReloadKey((k) => k + 1);
      return;
    }
    // Re-ensuring the server here (not just on tab mount) means a dev-only
    // restart of the Rust binary — which kills its tracked `npm run dev`
    // child along with it — doesn't leave Team preview dead until someone
    // happens to leave and re-enter the tab. ensure_team_preview_running is
    // a no-op if a live child is already tracked, so this costs nothing on
    // the common path.
    setPulling(true);
    invoke("ensure_team_preview_running")
      .then(() => (teamHasUpdate ? invoke("pull_team_preview_update") : Promise.resolve()))
      .then(() => {
        setTeamHasUpdate(false);
        setPreviewStatus("ready");
        setReloadKey((k) => k + 1);
      })
      .catch((err) => {
        console.error("team preview update failed", err);
        showToast("Couldn't update the team preview — try again.");
      })
      .finally(() => setPulling(false));
  }

  useEffect(() => {
    fetchPreviewPins().then(setPins).catch((err) => console.error("failed to fetch preview pins", err));
    fetchPreviewPinReplies()
      .then(setReplies)
      .catch((err) => console.error("failed to fetch preview pin replies", err));
    fetchPreviewStrokes().then(setStrokes).catch((err) => console.error("failed to fetch preview strokes", err));
  }, []);

  // The preview iframe is cross-origin (its own localhost port, not the
  // app's), so this is the only way to know which page it's currently
  // showing — vibeco-preview-tracker.js (seeded into every project, see
  // git_ops::bootstrap_empty_repo) posts its path here on load and on every
  // client-side navigation. Checked against the live iframe's own
  // contentWindow, not just origin, so a stale message from a previous
  // preview session (e.g. right after switching target/chat) can't set the
  // wrong page.
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type === "vibeco-preview-path" && typeof e.data.path === "string") {
        setCurrentPagePath(e.data.path);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("preview-comments-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "preview_pins" }, (payload) => {
        setPins((prev) => [...prev, payload.new as PreviewPin]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "preview_pins" }, (payload) => {
        const updated = payload.new as PreviewPin;
        setPins((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "preview_pins" }, (payload) => {
        const row = payload.old as { id: string };
        setPins((prev) => prev.filter((p) => p.id !== row.id));
        setOpenPinId((cur) => (cur === row.id ? null : cur));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "preview_pin_replies" }, (payload) => {
        setReplies((prev) => [...prev, payload.new as PreviewPinReply]);
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "preview_pin_replies" }, (payload) => {
        const row = payload.old as { id: string };
        setReplies((prev) => prev.filter((r) => r.id !== row.id));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "preview_strokes" }, (payload) => {
        const row = payload.new as PreviewStroke;
        // Our own strokes are already added optimistically in handleStrokeEnd
        // below — skip the echo so it doesn't render twice.
        setStrokes((prev) => (prev.some((s) => s.id === row.id) ? prev : [...prev, row]));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "preview_strokes" }, (payload) => {
        const row = payload.old as { id: string };
        setStrokes((prev) => prev.filter((s) => s.id !== row.id));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  function handleSaveDraftPin(text: string) {
    if (draftPin && text.trim()) {
      // Success needs no local state update here — the realtime subscription
      // above appends the new row once the insert lands.
      insertPreviewPin(draftPin, text.trim(), currentPagePath).catch((err) => {
        console.error("failed to add pin", err);
        showToast("Couldn't save that comment — try again.");
      });
      setPanelOpen(true);
    }
    setDraftPin(null);
    setTool("cursor");
  }

  function handleCancelDraftPin() {
    setDraftPin(null);
    setTool("cursor");
  }

  function handleMovePin(pinId: string, point: PercentPoint) {
    // Optimistic — the realtime UPDATE subscription above would eventually
    // land the same change, but waiting for that round-trip means the pin
    // visibly snaps back to its old spot for a moment after every drag.
    setPins((prev) => prev.map((p) => (p.id === pinId ? { ...p, x_pct: point.x_pct, y_pct: point.y_pct } : p)));
    movePreviewPin(pinId, point).catch((err) => {
      console.error("failed to move pin", err);
      showToast("Couldn't move that pin — try again.");
    });
  }

  function handleDeletePin(pinId: string) {
    setOpenPinId((cur) => (cur === pinId ? null : cur));
    // Optimistic, same reasoning as handleMovePin — otherwise the pin sits
    // on screen until the realtime DELETE round-trips back.
    setPins((prev) => prev.filter((p) => p.id !== pinId));
    deletePreviewPin(pinId).catch((err) => {
      console.error("failed to delete pin", err);
      showToast("Couldn't delete that comment — try again.");
    });
  }

  function handleStrokeEnd() {
    if (activeStroke && activeStroke.length >= 2) {
      // Optimistic, same reasoning as handleMovePin — otherwise the stroke
      // vanishes the instant the pointer lifts and only reappears once the
      // realtime INSERT round-trips back.
      insertPreviewStroke(activeStroke)
        .then((stroke) => setStrokes((prev) => (prev.some((s) => s.id === stroke.id) ? prev : [...prev, stroke])))
        .catch((err) => {
          console.error("failed to add stroke", err);
          showToast("Couldn't save that drawing — try again.");
        });
    }
    setActiveStroke(null);
  }

  function handleToolChange(newTool: PreviewTool) {
    setTool(newTool);
    setPanelOpen(newTool === "pin");
  }

  function handleUndo() {
    const stroke = lastOwnStroke(strokes, session.user.id);
    if (stroke) {
      setStrokes((prev) => prev.filter((s) => s.id !== stroke.id));
      deletePreviewStroke(stroke.id).catch((err) => console.error("failed to undo stroke", err));
    }
  }

  function handleClear() {
    const ownIds = new Set(strokes.filter((s) => s.created_by === session.user.id).map((s) => s.id));
    if (ownIds.size === 0) return;
    setStrokes((prev) => prev.filter((s) => !ownIds.has(s.id)));
    clearOwnPreviewStrokes(strokes, session.user.id).catch((err) => console.error("failed to clear strokes", err));
  }

  return (
    <div className="flex flex-1 min-w-0 min-h-0 gap-3 p-3">
      <div
        className="relative flex-1 min-w-0 bg-chat-pane-bg border border-border rounded-2xl overflow-hidden"
        ref={containerRef}
      >
        <div className="absolute top-3 left-3 z-10 flex items-center gap-[0.2em] bg-bg-tertiary rounded-lg p-[0.2em]">
          <button
            type="button"
            onClick={handleUpdateClick}
            disabled={(previewStatus === "starting" && target !== "team") || pulling}
            title={teamHasUpdate ? "A teammate merged changes — click to pull them in" : "Reload preview"}
            className={`relative flex items-center gap-[0.4em] border-none text-[0.85em] font-medium px-[1.1em] py-[calc(0.2em+2px)] rounded-md transition-colors hover:text-text-primary disabled:opacity-40 disabled:pointer-events-none ${
              teamHasUpdate ? "bg-accent/15 text-accent" : "bg-transparent text-text-secondary"
            }`}
          >
            <RefreshCw className={`w-[1em] h-[1em] ${pulling ? "animate-spin" : ""}`} />
            Update
            {teamHasUpdate && !pulling && (
              <span className="w-[6px] h-[6px] rounded-full bg-accent" aria-hidden="true" />
            )}
          </button>
        </div>
        {previewStatus === "ready" ? (
          <>
            {viewport === "mobile" ? (
              <div className="w-full h-full overflow-auto flex items-center justify-center py-6">
                <div
                  className="relative bg-black rounded-[40px] p-[10px] shadow-2xl shrink-0"
                  style={{ width: 300 + 20, height: 650 + 20 }}
                >
                  <div className="absolute top-[10px] left-1/2 -translate-x-1/2 w-[96px] h-[22px] bg-black rounded-b-[14px] z-10" />
                  <iframe
                    key={reloadKey}
                    ref={iframeRef}
                    className="w-full h-full border-none block rounded-[30px] bg-white"
                    src={target === "team" ? TEAM_PREVIEW_URL : `http://localhost:${localPort}`}
                    aria-label={target === "team" ? "Live team preview (mobile)" : "Live local chat preview (mobile)"}
                  />
                </div>
              </div>
            ) : (
              <iframe
                key={reloadKey}
                ref={iframeRef}
                className="w-full h-full border-none block"
                src={target === "team" ? TEAM_PREVIEW_URL : `http://localhost:${localPort}`}
                aria-label={target === "team" ? "Live team preview" : "Live local chat preview"}
              />
            )}
            <PreviewAnnotationLayer
              containerRef={containerRef}
              tool={tool}
              pins={pinsOnPage(pins, currentPagePath)}
              strokes={strokes}
              activeStroke={activeStroke}
              draftPin={draftPin}
              openPinId={openPinId}
              repliesByPin={repliesByPin(replies)}
              currentUserId={session.user.id}
              onPlacePin={setDraftPin}
              onSaveDraftPin={handleSaveDraftPin}
              onCancelDraftPin={handleCancelDraftPin}
              onStrokeStart={(point) => setActiveStroke([point])}
              onStrokePoint={(point) => setActiveStroke((prev) => (prev ? [...prev, point] : [point]))}
              onStrokeEnd={handleStrokeEnd}
              onPinClick={(pinId) => setOpenPinId((cur) => (cur === pinId ? null : pinId))}
              onMovePin={handleMovePin}
              onClosePopover={() => setOpenPinId(null)}
              onResolvePin={(pinId, resolved) => setPinResolved(pinId, resolved).catch((err) => console.error("failed to update pin", err))}
              onDeletePin={handleDeletePin}
              onReplyPin={(pinId, text) => insertPreviewPinReply(pinId, text).catch((err) => console.error("failed to add reply", err))}
            />
            <PreviewToolbar
              tool={tool}
              onToolChange={handleToolChange}
              onUndo={handleUndo}
              canUndo={lastOwnStroke(strokes, session.user.id) !== null}
              onClear={handleClear}
              canClear={strokes.some((s) => s.created_by === session.user.id)}
            />
            {panelOpen && (
              <PreviewCommentPanel
                pins={visiblePins(pins, showResolved)}
                repliesByPin={repliesByPin(replies)}
                currentUserId={session.user.id}
                profiles={profiles}
                showResolved={showResolved}
                onToggleShowResolved={() => setShowResolved((s) => !s)}
                onResolve={(pinId, resolved) => setPinResolved(pinId, resolved).catch((err) => console.error("failed to update pin", err))}
                onDelete={handleDeletePin}
                onReply={(pinId, text) => insertPreviewPinReply(pinId, text).catch((err) => console.error("failed to add reply", err))}
              />
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[12px] tracking-[0.05em] text-text-tertiary">
            {previewStatus === "starting"
              ? "Starting preview…"
              : target === "local" && !localChatId
                ? "Pick a chat to preview."
                : "Couldn't start the preview server."}
          </div>
        )}
        <div className="absolute bottom-3 left-3">
          <PillToggle
            items={[
              { key: "team", label: "Team" },
              { key: "local", label: "Local" },
            ]}
            active={target}
            onChange={setTarget}
            trailing={
              target === "local" && (
                <select
                  value={localChatId ?? ""}
                  onChange={(e) => setLocalChatId(e.target.value || null)}
                  className="ml-1 bg-transparent text-[12px] text-text-primary border-none outline-none w-auto"
                >
                  <option value="" disabled>
                    Select a chat…
                  </option>
                  {chats
                    .filter((c) => !c.archived_at)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title ?? "Untitled chat"}
                      </option>
                    ))}
                </select>
              )
            }
          />
        </div>
        <div className="absolute bottom-3 right-3">
          <PillToggle
            items={[
              { key: "desktop", label: "Desktop", title: "Desktop view" },
              { key: "mobile", label: "Mobile", title: "Mobile view" },
            ]}
            active={viewport}
            onChange={setViewport}
          />
        </div>
      </div>
    </div>
  );
}
