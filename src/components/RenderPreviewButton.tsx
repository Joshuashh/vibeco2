import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { insertMergeEvent } from "../lib/mergeEvents";

type RenderPreviewResult = { status: "Clean" } | { status: "Conflict"; files: string[] };

function MergeIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M6 15V9a9 9 0 0 0 9 9" />
    </svg>
  );
}

export function RenderPreviewButton({ chatId }: { chatId: string }) {
  const [state, setState] = useState<"idle" | "running" | "conflict">("idle");

  async function press() {
    setState("running");
    try {
      const result = await invoke<RenderPreviewResult>("render_preview", { chatId });
      if (result.status === "Clean") {
        await insertMergeEvent(chatId, "held", null);
        setState("idle");
      } else {
        await insertMergeEvent(chatId, "conflict", result.files.join(", "));
        setState("conflict");
      }
    } catch (err) {
      console.error("render_preview failed", err);
      setState("idle");
    }
  }

  return (
    <button
      type="button"
      className="icon-button"
      style={state === "conflict" ? { color: "var(--held)" } : undefined}
      onClick={press}
      disabled={state === "running"}
      title={state === "running" ? "Merging…" : state === "conflict" ? "Conflict" : "Commit and Merge"}
    >
      <MergeIcon />
    </button>
  );
}
