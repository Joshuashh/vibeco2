import type { RefObject } from "react";
import { Popover } from "./Popover";
import type { SlashCommand } from "../lib/slashCommands";

export function SlashCommandMenu({
  anchorRef,
  items,
  selectedIndex,
  onSelect,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  items: SlashCommand[];
  selectedIndex: number;
  onSelect: (cmd: SlashCommand) => void;
  onClose: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <Popover open onClose={onClose} anchorRef={anchorRef} width={300} keepFocus>
      {items.map((cmd, i) => (
        <button
          key={`${cmd.source}-${cmd.name}`}
          type="button"
          onClick={() => onSelect(cmd)}
          className={`appearance-none border-0 outline-none font-normal text-left transition-none box-border flex items-center w-[calc(100%-8px)] mx-1 my-0 py-[7px] px-2.5 rounded-md text-[13px] cursor-default gap-2 ${
            i === selectedIndex ? "bg-[rgba(236,236,236,0.08)]" : ""
          }`}
        >
          <span className="font-[SF_Mono,monospace] text-text-primary shrink-0">/{cmd.name}</span>
          <span className="text-text-tertiary truncate">{cmd.description}</span>
          <span className="flex-1" />
          {cmd.source === "custom" && <span className="text-[10px] text-text-tertiary shrink-0">custom</span>}
        </button>
      ))}
    </Popover>
  );
}
