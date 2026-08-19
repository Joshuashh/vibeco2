import { useMemo, useRef, useState } from "react";
import type { ChatRow } from "../types/chat";
import { Popover, PopoverRow } from "./Popover";

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ChatBubbleIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function TrayIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8L21 16 3 16 3 8M21 8L17 3 7 3 3 8M21 8L3 8" />
    </svg>
  );
}

function PuzzleIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h3a1 1 0 0 0 1-1V5a2 2 0 1 1 4 0v1a1 1 0 0 0 1 1h3v3a1 1 0 0 0 1 1h1a2 2 0 1 1 0 4h-1a1 1 0 0 0-1 1v3h-3a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0v-1a1 1 0 0 0-1-1H4v-3a1 1 0 0 0-1-1H2a2 2 0 1 1 0-4h1a1 1 0 0 0 1-1V7z" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </svg>
  );
}

function SidebarRow({
  chat,
  isActive,
  onSelect,
  onRename,
  onDelete,
}: {
  chat: ChatRow;
  isActive: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(chat.title ?? "");

  function commitRename() {
    const trimmed = draft.trim();
    if (trimmed) onRename(trimmed);
    setRenaming(false);
    setOpen(false);
  }

  return (
    <div className={isActive ? "sidebar-row sidebar-row-active" : "sidebar-row"} onClick={onSelect}>
      <span className="sidebar-row-title">{chat.title ?? "Untitled chat"}</span>
      <div className="chat-card-menu" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="icon-button icon-button-sm"
          title="Chat options"
          onClick={() => {
            setDraft(chat.title ?? "");
            setOpen((o) => !o);
          }}
        >
          <DotsIcon />
        </button>
        {open &&
          (renaming ? (
            <div className="chat-card-menu-dropdown">
              <input
                className="chat-card-rename-input"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setRenaming(false);
                }}
                onBlur={commitRename}
              />
            </div>
          ) : (
            <div className="chat-card-menu-dropdown">
              <button type="button" onClick={() => setRenaming(true)}>
                Rename
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
              >
                Delete
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}

export function Sidebar({
  chats,
  activeChatId,
  onSelect,
  onCreateChat,
  onRename,
  onDelete,
  userEmail,
  onSignOut,
}: {
  chats: ChatRow[];
  activeChatId: string | null;
  onSelect: (chatId: string) => void;
  onCreateChat: () => void;
  onRename: (chatId: string, title: string) => void;
  onDelete: (chatId: string) => void;
  userEmail: string;
  onSignOut: () => void;
}) {
  const [searchText, setSearchText] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsAnchorRef = useRef<HTMLButtonElement>(null);

  const filtered = useMemo(() => {
    if (!searchText.trim()) return chats;
    const q = searchText.toLowerCase();
    return chats.filter((c) => (c.title ?? "").toLowerCase().includes(q));
  }, [chats, searchText]);

  return (
    <div className="sidebar">
      <button type="button" className="sidebar-navrow sidebar-navrow-primary" onClick={onCreateChat}>
        <PlusIcon />
        New Chat
      </button>

      <div className="sidebar-nav">
        <div className="sidebar-navrow sidebar-navrow-selected">
          <ChatBubbleIcon />
          Chats
        </div>
        {/* ponytail: no Projects/Skills backend yet — visual slots only, per this
            project's established pattern of keeping inert UI in place (see
            ChatCardMenu's fork/archive rows) rather than omitting it. */}
        <button type="button" className="sidebar-navrow" disabled title="Not yet available">
          <TrayIcon />
          Projects
        </button>
        <button type="button" className="sidebar-navrow" disabled title="Not yet available">
          <PuzzleIcon />
          Skills
        </button>
      </div>

      <div className="sidebar-search">
        <SearchIcon />
        <input placeholder="Search" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
      </div>

      <div className="sidebar-list">
        <div className="sidebar-section-header">RECENTS</div>
        {filtered.length === 0 && <div className="sidebar-empty">No chats yet</div>}
        {filtered.map((chat) => (
          <SidebarRow
            key={chat.id}
            chat={chat}
            isActive={chat.id === activeChatId}
            onSelect={() => onSelect(chat.id)}
            onRename={(title) => onRename(chat.id, title)}
            onDelete={() => onDelete(chat.id)}
          />
        ))}
      </div>

      <div className="sidebar-footer">
        <span className="sidebar-avatar">{userEmail.slice(0, 1).toUpperCase()}</span>
        <span className="sidebar-email">{userEmail}</span>
        <button
          type="button"
          ref={settingsAnchorRef}
          className="icon-button icon-button-sm"
          title="Settings"
          onClick={() => setSettingsOpen((o) => !o)}
        >
          <GearIcon />
        </button>
        <Popover open={settingsOpen} onClose={() => setSettingsOpen(false)} anchorRef={settingsAnchorRef} width={180}>
          <PopoverRow
            title="Sign out"
            onClick={() => {
              setSettingsOpen(false);
              onSignOut();
            }}
          />
        </Popover>
      </div>
    </div>
  );
}
