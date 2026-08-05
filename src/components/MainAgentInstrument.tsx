import { useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import type { MergeEvent } from "../lib/mergeEvents";
import { countByStatus } from "../lib/mergeEvents";

export interface MainAgentInstrumentData {
  mergeEvents: MergeEvent[];
  refreshKey: number;
  [key: string]: unknown;
}

export type MainAgentInstrumentNode = Node<MainAgentInstrumentData, "mainAgentInstrument">;

const PREVIEW_URL = import.meta.env.VITE_BUILD_PREVIEW_URL ?? "http://localhost:1420";

export function MainAgentInstrument({ data }: NodeProps<MainAgentInstrumentNode>) {
  const [logOpen, setLogOpen] = useState(false);
  const counts = countByStatus(data.mergeEvents);

  return (
    <div className="main-agent-instrument">
      <div className="build-preview-panel">
        <div className="build-preview-header">BUILD · PREVIEW</div>
        <iframe key={data.refreshKey} className="build-preview-frame" src={PREVIEW_URL} title="Live build preview" />
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
