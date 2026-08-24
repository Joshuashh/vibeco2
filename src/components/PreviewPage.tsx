import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { ChatRow } from "../types/chat";
import {
  fetchPreviewPins,
  fetchPreviewPinReplies,
  fetchPreviewStrokes,
  insertPreviewPin,
  insertPreviewPinReply,
  setPinResolved,
  movePreviewPin,
  insertPreviewStroke,
  deletePreviewStroke,
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
import { PreviewAnnotationLayer } from "./PreviewAnnotationLayer";
import { PreviewCommentPanel } from "./PreviewCommentPanel";
import { showToast } from "./ToastHost";

// Same fixed port preview_server.rs always uses — see MainAgentInstrument.tsx.
const TEAM_PREVIEW_URL = "http://localhost:5180";

export function PreviewPage({
  session,
  chats,
  activeChatId,
}: {
  session: Session;
  chats: ChatRow[];
  activeChatId: string | null;
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
  const [draftPin, setDraftPin] = useState<PercentPoint | null>(null);
  const [activeStroke, setActiveStroke] = useState<PercentPoint[] | null>(null);
  const [currentPagePath, setCurrentPagePath] = useState<string | null>(null);
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
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "preview_pin_replies" }, (payload) => {
        setReplies((prev) => [...prev, payload.new as PreviewPinReply]);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "preview_strokes" }, (payload) => {
        setStrokes((prev) => [...prev, payload.new as PreviewStroke]);
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

  function handleStrokeEnd() {
    if (activeStroke && activeStroke.length >= 2) {
      insertPreviewStroke(activeStroke).catch((err) => {
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
      deletePreviewStroke(stroke.id).catch((err) => console.error("failed to undo stroke", err));
    }
  }

  return (
    <div className="flex flex-1 min-w-0 min-h-0 gap-3 p-3">
      <div
        className="relative flex-1 min-w-0 bg-chat-pane-bg border border-border rounded-2xl overflow-hidden"
        ref={containerRef}
      >
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
                    ref={iframeRef}
                    className="w-full h-full border-none block rounded-[30px] bg-white"
                    src={target === "team" ? TEAM_PREVIEW_URL : `http://localhost:${localPort}`}
                    aria-label={target === "team" ? "Live team preview (mobile)" : "Live local chat preview (mobile)"}
                  />
                </div>
              </div>
            ) : (
              <iframe
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
              onPlacePin={setDraftPin}
              onSaveDraftPin={handleSaveDraftPin}
              onCancelDraftPin={handleCancelDraftPin}
              onStrokeStart={(point) => setActiveStroke([point])}
              onStrokePoint={(point) => setActiveStroke((prev) => (prev ? [...prev, point] : [point]))}
              onStrokeEnd={handleStrokeEnd}
              onPinClick={() => setPanelOpen(true)}
              onMovePin={handleMovePin}
            />
            <PreviewToolbar
              tool={tool}
              onToolChange={handleToolChange}
              onUndo={handleUndo}
              canUndo={lastOwnStroke(strokes, session.user.id) !== null}
            />
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
        <div className="absolute bottom-3 left-3 flex items-center gap-[0.2em] bg-bg-tertiary/40 rounded-lg p-[0.2em]">
          <button
            type="button"
            onClick={() => setTarget("team")}
            className={`relative border-none text-[0.85em] font-medium px-[1.1em] py-[calc(0.2em+2px)] rounded-md transition-colors ${
              target === "team" ? "view-toggle-active text-text-primary" : "bg-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            Team
          </button>
          <button
            type="button"
            onClick={() => setTarget("local")}
            className={`relative border-none text-[0.85em] font-medium px-[1.1em] py-[calc(0.2em+2px)] rounded-md transition-colors ${
              target === "local" ? "view-toggle-active text-text-primary" : "bg-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            Local
          </button>
          {target === "local" && (
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
          )}
        </div>
        <div className="absolute bottom-3 right-3 flex items-center gap-[0.2em] bg-bg-tertiary/40 rounded-lg p-[0.2em]">
          <button
            type="button"
            onClick={() => setViewport("desktop")}
            title="Desktop view"
            className={`relative border-none text-[0.85em] font-medium px-[1.1em] py-[calc(0.2em+2px)] rounded-md transition-colors ${
              viewport === "desktop" ? "view-toggle-active text-text-primary" : "bg-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            Desktop
          </button>
          <button
            type="button"
            onClick={() => setViewport("mobile")}
            title="Mobile view"
            className={`relative border-none text-[0.85em] font-medium px-[1.1em] py-[calc(0.2em+2px)] rounded-md transition-colors ${
              viewport === "mobile" ? "view-toggle-active text-text-primary" : "bg-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            Mobile
          </button>
        </div>
      </div>
      {panelOpen && previewStatus === "ready" && (
        <PreviewCommentPanel
          pins={visiblePins(pins, showResolved)}
          repliesByPin={repliesByPin(replies)}
          currentUserId={session.user.id}
          showResolved={showResolved}
          onToggleShowResolved={() => setShowResolved((s) => !s)}
          onResolve={(pinId, resolved) => setPinResolved(pinId, resolved).catch((err) => console.error("failed to update pin", err))}
          onReply={(pinId, text) => insertPreviewPinReply(pinId, text).catch((err) => console.error("failed to add reply", err))}
        />
      )}
    </div>
  );
}
