import { useRef, useState, type ReactNode, type RefObject } from "react";
import type { ChatRow } from "../types/chat";
import type { Occupant } from "../lib/claim";
import { computeClaimant } from "../lib/claim";
import { colorForUser } from "../lib/presenceColor";
import { activeChats, filterChatsByTitle, groupActiveChats } from "../lib/chatGroups";
import { Popover, PopoverHeader, PopoverRow } from "./Popover";

const SEARCH_THRESHOLD = 8;

export function ChatPicker({
  chats,
  currentChatId,
  excludeChatId = null,
  self,
  others,
  onSelect,
  trigger,
}: {
  chats: ChatRow[];
  currentChatId: string | null;
  excludeChatId?: string | null;
  self: Occupant | null;
  others: Occupant[];
  onSelect: (chatId: string) => void;
  trigger: (props: { onClick: () => void; ref: RefObject<HTMLButtonElement | null> }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const anchorRef = useRef<HTMLButtonElement>(null);

  const active = activeChats(chats);
  const filtered = filterChatsByTitle(active, search);
  const sections = groupActiveChats(filtered);

  function close() {
    setOpen(false);
    setSearch("");
  }

  function select(chatId: string) {
    onSelect(chatId);
    close();
  }

  return (
    <>
      {trigger({ onClick: () => setOpen((o) => !o), ref: anchorRef })}
      <Popover open={open} onClose={close} anchorRef={anchorRef} width={240}>
        {active.length > SEARCH_THRESHOLD && (
          <div className="flex items-center mx-1 my-1 px-2.5 py-[6px] bg-bg-secondary rounded-md">
            <input
              autoFocus
              className="appearance-none bg-transparent border-0 outline-none p-0 flex-1 text-[13px] text-text-primary"
              placeholder="Search chats"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}
        {active.length === 0 && <PopoverRow title="No chats yet" onClick={() => {}} />}
        {active.length > 0 &&
          filtered.length === 0 && <PopoverRow title="No matches" onClick={() => {}} />}
        {sections.map(
          (section) =>
            section.chats.length > 0 && (
              <div key={section.title}>
                <PopoverHeader title={section.title} />
                {section.chats.map((chat) => {
                  const claimant = computeClaimant(chat.id, self, others);
                  const isExcluded = chat.id === excludeChatId;
                  return (
                    <div key={chat.id} className={isExcluded ? "opacity-60" : undefined}>
                      <PopoverRow
                        title={chat.title ?? "Untitled chat"}
                        checked={chat.id === currentChatId}
                        dotColor={claimant ? colorForUser(claimant) : undefined}
                        trailingLabel={isExcluded ? "Already open" : claimant ?? undefined}
                        onClick={() => select(chat.id)}
                      />
                    </div>
                  );
                })}
              </div>
            )
        )}
      </Popover>
    </>
  );
}
