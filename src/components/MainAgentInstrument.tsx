import { useEffect, useState } from "react";
import { NodeResizer, type Node, type NodeProps } from "@xyflow/react";
import { invoke } from "@tauri-apps/api/core";
import type { MergeEvent } from "../lib/mergeEvents";
import { countByStatus, insertMergeEvent } from "../lib/mergeEvents";
import { RenderPreviewButton } from "./RenderPreviewButton";

export interface MainAgentInstrumentData {
  mergeEvents: MergeEvent[];
  refreshKey: number;
  // Whichever chat the current user has claimed, if any — the preview box
  // renders/merges *that* chat's work rather than needing its own per-chat
  // picker (moved here from the chat card itself per explicit request).
  activeChatId: string | null;
  [key: string]: unknown;
}

export type MainAgentInstrumentNode = Node<MainAgentInstrumentData, "mainAgentInstrument">;

// The team-branch dev server preview_server.rs keeps running for the app's
// lifetime, always on this fixed port (see src-tauri/src/preview_server.rs).
const TEAM_PREVIEW_URL = "http://localhost:5180";

export function MainAgentInstrument({ data }: NodeProps<MainAgentInstrumentNode>) {
  const [logOpen, setLogOpen] = useState(false);
  const [promoting, setPromoting] = useState(false);
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

  async function promote() {
    setPromoting(true);
    try {
      await invoke("promote_to_main");
      await insertMergeEvent(null, "merged", "promoted team → main");
    } catch (err) {
      console.error("promote_to_main failed", err);
    } finally {
      setPromoting(false);
    }
  }

  return (
    <div className="main-agent-instrument">
      <NodeResizer minWidth={360} minHeight={280} lineClassName="chat-card-resize-line" handleClassName="chat-card-resize-handle" />
      <div className="build-preview-panel">
        <div className="build-preview-header">
          <span>BUILD · PREVIEW</span>
          <div className="build-preview-actions nodrag">
            {data.activeChatId ? (
              <RenderPreviewButton chatId={data.activeChatId} />
            ) : (
              <span className="build-preview-hint">Claim a chat to render its preview</span>
            )}
            <button type="button" className="pill" onClick={promote} disabled={promoting}>
              {promoting ? "Promoting…" : "Promote to main"}
            </button>
          </div>
        </div>
        <div className="nodrag nowheel build-preview-content">
          {previewStatus === "ready" ? (
            <iframe
              key={data.refreshKey}
              className="build-preview-frame"
              src={TEAM_PREVIEW_URL}
              title="Live team preview"
            />
          ) : (
            <div className="build-preview-empty">
              {previewStatus === "starting" ? "Starting preview…" : "Couldn't start the preview server."}
            </div>
          )}
        </div>
      </div>
      <div className="main-agent-bar" onClick={() => setLogOpen((open) => !open)}>
        <span className="main-agent-label">⬡ MAIN AGENT</span>
        <span className="main-agent-count main-agent-count-merged">{counts.merged} merged</span>
        <span className="main-agent-count main-agent-count-held">{counts.held} held</span>
        <span className="main-agent-count main-agent-count-conflict">{counts.conflict} conflict</span>
      </div>
      {logOpen && (
        <div className="nodrag nowheel main-agent-log">
          {data.mergeEvents.length === 0 && <div className="main-agent-log-empty">No merge activity yet.</div>}
          {data.mergeEvents.map((event) => (
            <div key={event.id} className={`main-agent-log-row main-agent-log-row-${event.status}`}>
              <span>{event.status}</span>
              <span>{event.detail ?? event.chat_id ?? "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
