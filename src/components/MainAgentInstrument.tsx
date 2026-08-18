import { useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { invoke } from "@tauri-apps/api/core";
import type { MergeEvent } from "../lib/mergeEvents";
import { countByStatus, insertMergeEvent } from "../lib/mergeEvents";

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
  const [promoting, setPromoting] = useState(false);
  const counts = countByStatus(data.mergeEvents);

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
      <div className="build-preview-panel">
        <div className="build-preview-header">
          BUILD · PREVIEW
          <button type="button" className="pill" onClick={promote} disabled={promoting}>
            {promoting ? "Promoting…" : "Promote to main"}
          </button>
        </div>
        <iframe
          key={data.refreshKey}
          className="build-preview-frame"
          src={TEAM_PREVIEW_URL}
          title="Live team preview"
        />
      </div>
      <div className="main-agent-bar" onClick={() => setLogOpen((open) => !open)}>
        <span className="main-agent-label">⬡ MAIN AGENT</span>
        <span className="main-agent-count main-agent-count-merged">{counts.merged} merged</span>
        <span className="main-agent-count main-agent-count-held">{counts.held} held</span>
        <span className="main-agent-count main-agent-count-conflict">{counts.conflict} conflict</span>
      </div>
      {logOpen && (
        <div className="main-agent-log">
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
