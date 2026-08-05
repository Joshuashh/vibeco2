import { useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";

export interface GroupLabelData {
  label: string;
  onRename: (newLabel: string) => void;
  [key: string]: unknown;
}

export type GroupLabelNode = Node<GroupLabelData, "groupLabel">;

export function GroupLabel({ data }: NodeProps<GroupLabelNode>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== data.label) data.onRename(trimmed);
    else setDraft(data.label);
  }

  if (editing) {
    return (
      <input
        className="group-label group-label-input"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(data.label);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <div className="group-label" onClick={() => setEditing(true)}>
      {data.label}
    </div>
  );
}
