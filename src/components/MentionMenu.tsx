import type { RefObject } from "react";
import { Popover } from "./Popover";
import { colorForUser } from "../lib/presenceColor";
import type { AssignableTeammate } from "./AssignChatMenu";

export function MentionMenu({
  anchorRef,
  items,
  selectedIndex,
  onSelect,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  items: AssignableTeammate[];
  selectedIndex: number;
  onSelect: (teammate: AssignableTeammate) => void;
  onClose: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <Popover open onClose={onClose} anchorRef={anchorRef} width={260} keepFocus>
      {items.map((teammate, i) => (
        <button
          key={teammate.email}
          type="button"
          onClick={() => onSelect(teammate)}
          className={`appearance-none border-0 outline-none font-normal text-left transition-none box-border flex items-center w-[calc(100%-8px)] mx-1 my-0 py-[7px] px-2.5 rounded-md text-[13px] cursor-default gap-2 ${
            i === selectedIndex ? "bg-[rgba(236,236,236,0.08)]" : ""
          }`}
        >
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colorForUser(teammate.email) }} />
          <span className="text-text-primary truncate">{teammate.email}</span>
          <span className="flex-1" />
          {teammate.online && <span className="text-[10px] text-text-tertiary shrink-0">online</span>}
        </button>
      ))}
    </Popover>
  );
}
