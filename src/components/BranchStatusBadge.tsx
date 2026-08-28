import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Popover, PopoverHeader } from "./Popover";

type ChatLite = { id: string; title: string | null };

// Rightmost breadcrumb segment: one pill for "is anything in this project
// still waiting to be rendered into team?". Green "Up to date" when every
// chat branch is merged; amber "Behind" when at least one chat has commits
// team doesn't have yet. Click to see which chats — and jump to one.
export function BranchStatusBadge({
  chats,
  onJumpToChat,
}: {
  chats: ChatLite[];
  onJumpToChat: (chatId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pendingIds, setPendingIds] = useState<string[] | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);

  // Stable key so the fetch effect doesn't re-run on every App render.
  const idsKey = useMemo(() => chats.map((c) => c.id).sort().join(","), [chats]);

  const refresh = useCallback(() => {
    const ids = idsKey ? idsKey.split(",") : [];
    invoke<string[]>("chats_needing_merge", { chatIds: ids })
      .then(setPendingIds)
      .catch(() => setPendingIds(null));
  }, [idsKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const behind = (pendingIds?.length ?? 0) > 0;
  const label = pendingIds === null ? "…" : behind ? "Behind" : "Up to date";
  const color = behind ? "var(--held)" : "var(--merged)";

  const pending = (pendingIds ?? [])
    .map((id) => chats.find((c) => c.id === id))
    .filter((c): c is ChatLite => !!c);

  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        title="Branch status"
        className="flex items-center h-[20px] leading-none text-[8px] uppercase tracking-wide rounded-full px-[0.7em] mx-1.5 cursor-pointer border transition-colors"
        style={{ color, borderColor: color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
        onClick={() => {
          setOpen((o) => !o);
          refresh();
        }}
      >
        {label}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} width={240}>
        <PopoverHeader title={behind ? "Chats to render" : "Branch status"} />
        {pendingIds === null ? (
          <div className="text-[13px] text-text-tertiary px-3.5 pb-2">Loading...</div>
        ) : pending.length === 0 ? (
          <div className="text-[13px] text-text-tertiary px-3.5 pb-2">
            Every chat is merged into team.
          </div>
        ) : (
          pending.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setOpen(false);
                onJumpToChat(c.id);
              }}
              className="appearance-none bg-transparent border-0 outline-none text-left w-[calc(100%-8px)] mx-1 my-0 py-[7px] px-2.5 rounded-md text-[13px] text-text-primary cursor-default hover:bg-[rgba(236,236,236,0.08)] truncate"
            >
              {c.title || "Untitled chat"}
            </button>
          ))
        )}
      </Popover>
    </>
  );
}
