import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { insertMergeEvent } from "../lib/mergeEvents";

type RenderPreviewResult = { status: "Clean" } | { status: "Conflict"; files: string[] };

// Matches InputToolbelt.tsx's own pillBase pattern (kept local per Task 7's
// precedent). .pill/.pill-warn stay in App.css only because
// PreviewCommentPanel.tsx (out of this task's scope) still uses them.
const pillBase =
  "appearance-none border-0 outline-none box-border inline-flex items-center gap-[0.35em] text-[0.78em] px-[0.7em] py-[0.4em] rounded-lg cursor-default hover:bg-bg-tertiary";
const pillPlain = `${pillBase} text-text-secondary bg-bg-secondary`;
const pillWarn = `${pillBase} text-held bg-[rgba(232,184,74,0.12)]`;

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
      className={state === "conflict" ? pillWarn : pillPlain}
      onClick={press}
      disabled={state === "running"}
    >
      {state === "running" ? "Rendering…" : state === "conflict" ? "Conflict" : "Render Preview"}
    </button>
  );
}
