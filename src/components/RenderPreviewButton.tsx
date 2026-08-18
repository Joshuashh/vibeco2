import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { insertMergeEvent } from "../lib/mergeEvents";

type RenderPreviewResult = { status: "Clean" } | { status: "Conflict"; files: string[] };

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
      className={`pill${state === "conflict" ? " pill-warn" : ""}`}
      onClick={press}
      disabled={state === "running"}
    >
      {state === "running" ? "Rendering…" : state === "conflict" ? "Conflict" : "Render Preview"}
    </button>
  );
}
