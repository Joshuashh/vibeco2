import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function ChatPreviewPanel({ chatId }: { chatId: string }) {
  const [status, setStatus] = useState<"starting" | "ready" | "error">("starting");
  const [port, setPort] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("starting");
    invoke<number>("ensure_chat_preview_running", { chatId })
      .then((p) => {
        if (!cancelled) {
          setPort(p);
          setStatus("ready");
        }
      })
      .catch((err) => {
        console.error("ensure_chat_preview_running failed", err);
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
      invoke("stop_chat_preview", { chatId }).catch((err) => console.error("stop_chat_preview failed", err));
    };
  }, [chatId]);

  if (status === "error") {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-[0.9em]">
        Failed to start preview server.
      </div>
    );
  }

  if (status === "starting" || port === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-[0.9em]">
        Starting preview…
      </div>
    );
  }

  return <iframe title="Chat preview" src={`http://localhost:${port}`} className="flex-1 w-full border-0 bg-white" />;
}
