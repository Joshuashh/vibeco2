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

// No same-origin fallback: this instrument's own default dev server would
// otherwise preview itself recursively. Stays blank until a real, separate
// target-app URL is configured (see .env.example).
const PREVIEW_URL = import.meta.env.VITE_BUILD_PREVIEW_URL as string | undefined;

export function MainAgentInstrument({ data }: NodeProps<MainAgentInstrumentNode>) {
  const [logOpen, setLogOpen] = useState(false);
  const counts = countByStatus(data.mergeEvents);

  return (
    <div className="main-agent-instrument">
      <div className="build-preview-panel">
        <div className="build-preview-header">BUILD · PREVIEW</div>
        {PREVIEW_URL ? (
          <iframe
            key={data.refreshKey}
            className="build-preview-frame"
            src={PREVIEW_URL}
            title="Live build preview"
          />
        ) : (
          <div className="build-preview-empty">No build configured</div>
        )}
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
