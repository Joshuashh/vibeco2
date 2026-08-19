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
        className="[font-family:inherit] text-[12px] tracking-[0.06em] uppercase text-text-primary bg-bg-tertiary border border-accent rounded-xl px-[0.9em] py-[0.3em] cursor-default whitespace-nowrap"
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
    <div
      className="font-[SF_Mono,monospace] text-[12px] tracking-[0.06em] uppercase text-text-tertiary bg-bg-tertiary border border-border rounded-xl px-[0.9em] py-[0.3em] cursor-default whitespace-nowrap"
      onClick={() => setEditing(true)}
    >
      {data.label}
    </div>
  );
}
