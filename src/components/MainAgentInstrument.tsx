import { useEffect, useState } from "react";
import { NodeResizer, type Node, type NodeProps } from "@xyflow/react";
import { invoke } from "@tauri-apps/api/core";
import type { MergeEvent } from "../lib/mergeEvents";
import { countByStatus } from "../lib/mergeEvents";

export interface MainAgentInstrumentData {
  mergeEvents: MergeEvent[];
  refreshKey: number;
  [key: string]: unknown;
}

export type MainAgentInstrumentNode = Node<MainAgentInstrumentData, "mainAgentInstrument">;

// The team-branch dev server preview_server.rs keeps running for the app's
// lifetime, always on this fixed port (see src-tauri/src/preview_server.rs).
const TEAM_PREVIEW_URL = "http://localhost:5180";

export function MainAgentInstrument({ data }: NodeProps<MainAgentInstrumentNode>) {
  const [logOpen, setLogOpen] = useState(false);
  // Whether *this* process has actually started (or confirmed running) the
  // team preview server. Deliberately not derived from `mergeEvents` (shared
  // Supabase state) — that stays non-empty across app restarts and other
  // machines, so gating on it kept rendering the iframe against a server
  // nothing in this process had actually started.
  const [previewStatus, setPreviewStatus] = useState<"starting" | "ready" | "error">("starting");
  const counts = countByStatus(data.mergeEvents);

  useEffect(() => {
    invoke("ensure_team_preview_running")
      .then(() => setPreviewStatus("ready"))
      .catch((err) => {
        console.error("ensure_team_preview_running failed", err);
        setPreviewStatus("error");
      });
  }, []);

  return (
    <div className="w-full h-full flex flex-col font-[SF_Mono,JetBrains_Mono,monospace]">
      <NodeResizer minWidth={360} minHeight={280} lineClassName="chat-card-resize-line" handleClassName="chat-card-resize-handle" />
      <div className="bg-canvas-bg border border-border border-b-0 rounded-t-[14px] overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between gap-[0.75em] text-[11px] tracking-[0.08em] text-text-tertiary py-[0.7em] px-[1em] border-b border-border uppercase">
          <span>BUILD · PREVIEW</span>
        </div>
        <div className="nodrag flex-1 min-h-0 flex flex-col">
          {previewStatus === "ready" ? (
            <iframe
              key={data.refreshKey}
              className="flex-1 border-none w-full"
              src={TEAM_PREVIEW_URL}
              aria-label="Live team preview"
            />
          ) : (
            <div className="build-preview-empty">
              {previewStatus === "starting" ? "Starting preview…" : "Couldn't start the preview server."}
            </div>
          )}
        </div>
      </div>
      <div
        className="bg-bg-sidebar border border-accent rounded-b-[14px] py-[0.7em] px-[1em] flex gap-[1em] items-center cursor-default text-[13px]"
        onClick={() => setLogOpen((open) => !open)}
      >
        <span className="text-accent font-semibold tracking-[0.04em]">⬡ MAIN AGENT</span>
        <span className="text-merged">{counts.merged} merged</span>
        <span className="text-held">{counts.held} held</span>
        <span className="text-conflict">{counts.conflict} conflict</span>
      </div>
      {logOpen && (
        <div className="nodrag bg-bg-sidebar border border-border border-t-0 max-h-[200px] overflow-y-auto text-[12px]">
          {data.mergeEvents.length === 0 && (
            <div className="py-[0.6em] px-[1em] text-text-tertiary">No merge activity yet.</div>
          )}
          {data.mergeEvents.map((event) => {
            const statusColor =
              event.status === "merged" ? "text-merged" : event.status === "held" ? "text-held" : "text-conflict";
            return (
              <div
                key={event.id}
                className="flex justify-between py-[0.4em] px-[1em] border-b border-border text-text-secondary"
              >
                <span className={statusColor}>{event.status}</span>
                <span>{event.detail ?? event.chat_id ?? "—"}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
