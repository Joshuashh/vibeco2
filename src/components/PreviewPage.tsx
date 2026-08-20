import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import {
  fetchPreviewPins,
  fetchPreviewPinReplies,
  fetchPreviewStrokes,
  insertPreviewPin,
  insertPreviewPinReply,
  setPinResolved,
  insertPreviewStroke,
  deletePreviewStroke,
  lastOwnStroke,
  visiblePins,
  repliesByPin,
  type PreviewPin,
  type PreviewPinReply,
  type PreviewStroke,
} from "../lib/previewComments";
import type { PercentPoint } from "../lib/overlayGeometry";
import { PreviewToolbar, type PreviewTool } from "./PreviewToolbar";
import { PreviewAnnotationLayer } from "./PreviewAnnotationLayer";
import { PreviewCommentPanel } from "./PreviewCommentPanel";

// Same fixed port preview_server.rs always uses — see MainAgentInstrument.tsx.
const TEAM_PREVIEW_URL = "http://localhost:5180";

export function PreviewPage({ session }: { session: Session }) {
  const [previewStatus, setPreviewStatus] = useState<"starting" | "ready" | "error">("starting");
  const [tool, setTool] = useState<PreviewTool>("cursor");
  const [pins, setPins] = useState<PreviewPin[]>([]);
  const [replies, setReplies] = useState<PreviewPinReply[]>([]);
  const [strokes, setStrokes] = useState<PreviewStroke[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [draftPin, setDraftPin] = useState<PercentPoint | null>(null);
  const [activeStroke, setActiveStroke] = useState<PercentPoint[] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke("ensure_team_preview_running")
      .then(() => setPreviewStatus("ready"))
      .catch((err) => {
        console.error("ensure_team_preview_running failed", err);
        setPreviewStatus("error");
      });
  }, []);

  useEffect(() => {
    fetchPreviewPins().then(setPins).catch((err) => console.error("failed to fetch preview pins", err));
    fetchPreviewPinReplies()
      .then(setReplies)
      .catch((err) => console.error("failed to fetch preview pin replies", err));
    fetchPreviewStrokes().then(setStrokes).catch((err) => console.error("failed to fetch preview strokes", err));
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
      insertPreviewPin(draftPin, text.trim()).catch((err) => console.error("failed to add pin", err));
      setPanelOpen(true);
    }
    setDraftPin(null);
    setTool("cursor");
  }

  function handleCancelDraftPin() {
    setDraftPin(null);
    setTool("cursor");
  }

  function handleStrokeEnd() {
    if (activeStroke && activeStroke.length >= 2) {
      insertPreviewStroke(activeStroke).catch((err) => console.error("failed to add stroke", err));
    }
    setActiveStroke(null);
  }

  function handleToolChange(newTool: PreviewTool) {
    setTool(newTool);
    setPanelOpen(newTool === "pin");
  }

  function handleUndo() {
    const target = lastOwnStroke(strokes, session.user.id);
    if (target) {
      deletePreviewStroke(target.id).catch((err) => console.error("failed to undo stroke", err));
    }
  }

  return (
    <div className="flex flex-1 min-w-0 min-h-0">
      <div className="relative flex-1 min-w-0" ref={containerRef}>
        {previewStatus === "ready" ? (
          <>
            <iframe
              className="w-full h-full border-none block"
              src={TEAM_PREVIEW_URL}
              title="Live team preview"
            />
            <PreviewAnnotationLayer
              containerRef={containerRef}
              tool={tool}
              pins={pins}
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
            {previewStatus === "starting" ? "Starting preview…" : "Couldn't start the preview server."}
          </div>
        )}
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
