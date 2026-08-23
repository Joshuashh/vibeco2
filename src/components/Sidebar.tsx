import { useMemo, useRef, useState } from "react";
import type { ChatRow } from "../types/chat";
import { Popover, PopoverRow, PopoverDivider } from "./Popover";
import { usePrefs } from "../lib/prefs";
import { computeSortOrder } from "../lib/reorder";
import { activeChats as filterActiveChats, filterChatsByTitle, groupActiveChats } from "../lib/chatGroups";
import { formatRelativeTime } from "../lib/time";
import { colorForUser, displayNameForUser, PRESENCE_PALETTE } from "../lib/presenceColor";
import { computeClaimant, type Occupant } from "../lib/claim";
import { isChatLockedForCowork } from "../lib/chatLock";
import type { Profile } from "../lib/profiles";
import { UpdateButton } from "./UpdateButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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

function ArchiveIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 13h4" />
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

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
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
  archived,
  claimant,
  assignedOnline,
  locked,
  blockedForCowork,
  mentioned,
  draggable,
  onSelect,
  onRename,
  onGroupChange,
  onArchive,
  onUnarchive,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
  dragOver,
}: {
  chat: ChatRow;
  isActive: boolean;
  archived: boolean;
  claimant: string | null;
  assignedOnline: boolean;
  locked: boolean;
  // True when this row can't be opened in the current (Cowork) tab at all —
  // restricted chats are Solo-only while their lock is actually in effect.
  blockedForCowork: boolean;
  mentioned: boolean;
  draggable: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onGroupChange: (groupName: string | null) => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  onDelete: () => void;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  dragOver?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [groupEditing, setGroupEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState(chat.title ?? "");
  const [groupDraft, setGroupDraft] = useState(chat.group_name ?? "");

  function commitRename() {
    const trimmed = draft.trim();
    if (trimmed) onRename(trimmed);
    setRenaming(false);
    setOpen(false);
  }

  function commitGroup() {
    onGroupChange(groupDraft.trim() || null);
    setGroupEditing(false);
    setOpen(false);
  }

  return (
    <div
      className={`group flex items-center justify-between gap-[0.4em] mx-[0.6em] my-[0.05em] px-[0.6em] py-[0.3em] rounded-md hover:bg-bg-secondary ${
        isActive ? "bg-bg-tertiary" : ""
      } ${dragOver ? "outline outline-1 outline-accent -outline-offset-1" : ""} ${
        blockedForCowork ? "opacity-50 cursor-not-allowed" : "cursor-default"
      }`}
      title={blockedForCowork ? "Restricted — locked to its owner while they're active. Solo-only until it unlocks." : undefined}
      onClick={blockedForCowork ? undefined : onSelect}
      draggable={draggable && !blockedForCowork}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {renaming ? (
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
          onClick={(e) => e.stopPropagation()}
        />
      ) : groupEditing ? (
        <input
          className="chat-card-rename-input"
          autoFocus
          placeholder="Group name (blank to ungroup)"
          value={groupDraft}
          onChange={(e) => setGroupDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitGroup();
            if (e.key === "Escape") setGroupEditing(false);
          }}
          onBlur={commitGroup}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="flex-1 flex items-center gap-[0.4em] min-w-0">
          {claimant ? (
            <span
              className="w-[6px] h-[6px] rounded-full shrink-0"
              style={{ background: colorForUser(claimant) }}
              title={`In progress: ${claimant}`}
            />
          ) : (
            chat.handed_off_to && (
              // Hollow, never filled, here — filled means "actively working on
              // it right now," which is the claimant branch above. Reaching
              // this branch already means no one's claimed the chat, so the
              // assignee (online or not) isn't currently in it.
              <span
                className="w-[6px] h-[6px] rounded-full shrink-0 box-border"
                style={{ background: "transparent", border: `1px solid ${colorForUser(chat.handed_off_to)}` }}
                title={`Assigned to ${chat.handed_off_to}${assignedOnline ? "" : " (offline)"}`}
              />
            )
          )}
          <span className="text-[0.85em] truncate">{chat.title ?? "Untitled chat"}</span>
          {/* `locked` (see lib/chatLock.ts) is true only while the
              restriction is actually in effect — restricted, and the owner
              is online and recently active — not just whenever
              chat.open === false, so the icon disappears the moment the
              owner goes idle/offline and the chat auto-unlocks. */}
          {locked && (
            <span
              className="w-[10px] h-[10px] shrink-0 text-text-tertiary [&>svg]:w-full [&>svg]:h-full"
              title={claimant ? `Locked to ${claimant} — restricted, no one else can respond` : "Restricted — locked to its owner"}
            >
              <LockIcon />
            </span>
          )}
          {mentioned && (
            <span className="w-[6px] h-[6px] rounded-full shrink-0 bg-accent" title="You were mentioned" />
          )}
          {chat.last_message_at && (
            <span className="text-[0.7em] text-text-tertiary shrink-0 ml-auto pl-[0.5em]">
              {formatRelativeTime(chat.last_message_at)}
            </span>
          )}
        </span>
      )}
      <div
        className={`shrink-0 overflow-hidden w-0 opacity-0 group-hover:w-[24px] group-hover:opacity-100 ${
          open || confirmingDelete ? "w-[24px] opacity-100" : ""
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="icon-button icon-button-sm"
              title="Chat options"
              onClick={() => {
                setDraft(chat.title ?? "");
                setGroupDraft(chat.group_name ?? "");
              }}
            >
              <DotsIcon />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {archived ? (
              <DropdownMenuItem onSelect={() => onUnarchive?.()}>Restore</DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem onSelect={() => setRenaming(true)}>Rename</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setGroupEditing(true)}>
                  {chat.group_name ? "Change group…" : "Add to group…"}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onArchive?.()}>Archive</DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmingDelete(true)}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete "{chat.title ?? "Untitled chat"}"?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes the chat and its message history. This can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={onDelete}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function SidebarSectionHeader({ text }: { text: string }) {
  return (
    <div className="text-[0.7em] font-semibold tracking-[0.06em] text-text-tertiary px-[1em] py-[0.4em]">{text}</div>
  );
}

export function Sidebar({
  chats,
  activeChatId,
  onSelect,
  onCreateChat,
  onRename,
  onDelete,
  onReorder,
  onGroupChange,
  onArchive,
  onUnarchive,
  userEmail,
  onSignOut,
  self,
  others,
  onlineEmails,
  profiles,
  activeTab,
  mentionedChatIds,
  selfProfile,
  otherProfiles,
  onUpdateProfile,
}: {
  chats: ChatRow[];
  activeChatId: string | null;
  onSelect: (chatId: string) => void;
  onCreateChat: () => void;
  onRename: (chatId: string, title: string) => void;
  onDelete: (chatId: string) => void;
  onReorder: (chatId: string, sortOrder: number) => void;
  onGroupChange: (chatId: string, groupName: string | null) => void;
  onArchive: (chatId: string) => void;
  onUnarchive: (chatId: string) => void;
  userEmail: string;
  onSignOut: () => void;
  self?: Occupant | null;
  others?: Occupant[];
  onlineEmails?: Set<string>;
  // Needed to resolve each chat's persisted owner (claude_session_owner /
  // user_id) to an email, and to know whether the sidebar should block
  // selecting a restricted chat (Cowork tab only — see lib/chatLock.ts).
  profiles?: Profile[];
  activeTab?: "cowork" | "solo";
  mentionedChatIds?: Set<string>;
  selfProfile?: Profile | null;
  otherProfiles?: Profile[];
  onUpdateProfile?: (updates: { display_name?: string | null; color?: string | null }) => void;
}) {
  const { theme, setTheme } = usePrefs();
  const [searchText, setSearchText] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPanel, setSettingsPanel] = useState<"main" | "personalization">("main");
  const [nameDraft, setNameDraft] = useState(selfProfile?.display_name ?? "");
  const [mode, setMode] = useState<"chats" | "archive">("chats");
  const [dragChatId, setDragChatId] = useState<string | null>(null);
  const [dragOverChatId, setDragOverChatId] = useState<string | null>(null);
  const settingsAnchorRef = useRef<HTMLButtonElement>(null);
  const takenColors = useMemo(
    () => new Map((otherProfiles ?? []).filter((p) => p.color).map((p) => [p.color as string, p])),
    [otherProfiles]
  );

  const activeChats = useMemo(() => filterActiveChats(chats), [chats]);
  const archivedChats = useMemo(
    () => chats.filter((c) => c.archived_at).sort((a, b) => (b.archived_at ?? "").localeCompare(a.archived_at ?? "")),
    [chats]
  );

  const visible = mode === "chats" ? activeChats : archivedChats;
  const filtered = useMemo(() => filterChatsByTitle(visible, searchText), [visible, searchText]);

  const sections = useMemo(() => {
    if (mode === "archive") return [{ title: "ARCHIVED", chats: filtered }];
    return groupActiveChats(filtered);
  }, [filtered, mode]);

  function dropOnto(targetChat: ChatRow, sectionChats: ChatRow[], targetGroupName: string | null) {
    if (!dragChatId || dragChatId === targetChat.id) return;
    const targetIndex = sectionChats.findIndex((c) => c.id === targetChat.id);
    const before = targetIndex > 0 ? sectionChats[targetIndex - 1].sort_order : null;
    const sortOrder = computeSortOrder(before, targetChat.sort_order);
    const dragged = chats.find((c) => c.id === dragChatId);
    if (dragged && dragged.group_name !== targetGroupName) onGroupChange(dragChatId, targetGroupName);
    onReorder(dragChatId, sortOrder);
    setDragChatId(null);
    setDragOverChatId(null);
  }

  function dropAtEnd(sectionChats: ChatRow[], targetGroupName: string | null) {
    if (!dragChatId) return;
    const last = sectionChats[sectionChats.length - 1];
    const sortOrder = computeSortOrder(last?.sort_order ?? null, null);
    const dragged = chats.find((c) => c.id === dragChatId);
    if (dragged && dragged.group_name !== targetGroupName) onGroupChange(dragChatId, targetGroupName);
    onReorder(dragChatId, sortOrder);
    setDragChatId(null);
    setDragOverChatId(null);
  }

  const navRowBase =
    "flex items-center w-[calc(100%-1.2em)] gap-[0.6em] text-[0.85em] font-normal mx-[0.6em] my-[0.15em] px-[0.7em] py-[0.55em] rounded-md text-text-primary cursor-default bg-transparent border-0 outline-none text-left [&:hover:not(:disabled)]:bg-bg-secondary disabled:text-text-tertiary [&>svg]:w-[15px] [&>svg]:h-[15px] [&>svg]:shrink-0";

  return (
    <div className="h-full flex flex-col min-h-0">
      <button type="button" className={`${navRowBase} mt-[0.8em] font-medium`} onClick={onCreateChat}>
        <PlusIcon />
        New Chat
      </button>

      <div className="pb-[0.4em] border-b border-border">
        <button
          type="button"
          className={mode === "chats" ? `${navRowBase} bg-bg-tertiary` : navRowBase}
          onClick={() => setMode("chats")}
        >
          <ChatBubbleIcon />
          Chats
        </button>
        <button
          type="button"
          className={mode === "archive" ? `${navRowBase} bg-bg-tertiary` : navRowBase}
          onClick={() => setMode("archive")}
        >
          <ArchiveIcon />
          Archive
        </button>
      </div>

      <div className="flex items-center gap-[0.5em] mx-[0.6em] my-[0.7em] px-[0.6em] py-[0.5em] bg-bg-secondary rounded-lg [&>svg]:w-[14px] [&>svg]:h-[14px] [&>svg]:text-text-tertiary [&>svg]:shrink-0">
        <SearchIcon />
        <input
          className="appearance-none bg-transparent border-0 outline-none p-0 flex-1 text-[0.8em] text-text-primary"
          placeholder="Search"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="text-[0.8em] text-text-tertiary px-[1em]">
            {mode === "archive" ? "No archived chats" : "No chats yet"}
          </div>
        )}
        {sections.map(
          (section) =>
            section.chats.length > 0 && (
              <div key={section.title}>
                <SidebarSectionHeader text={section.title} />
                {section.chats.map((chat) => (
                  <SidebarRow
                    key={chat.id}
                    chat={chat}
                    isActive={chat.id === activeChatId}
                    archived={mode === "archive"}
                    claimant={computeClaimant(chat.id, self ?? null, others ?? [])}
                    assignedOnline={!!chat.handed_off_to && (onlineEmails?.has(chat.handed_off_to) ?? false)}
                    locked={isChatLockedForCowork(chat, profiles ?? [], onlineEmails ?? new Set())}
                    blockedForCowork={activeTab === "cowork" && isChatLockedForCowork(chat, profiles ?? [], onlineEmails ?? new Set())}
                    mentioned={mentionedChatIds?.has(chat.id) ?? false}
                    draggable={mode === "chats"}
                    dragOver={dragOverChatId === chat.id}
                    onSelect={() => onSelect(chat.id)}
                    onRename={(title) => onRename(chat.id, title)}
                    onGroupChange={(groupName) => onGroupChange(chat.id, groupName)}
                    onArchive={() => onArchive(chat.id)}
                    onUnarchive={() => onUnarchive(chat.id)}
                    onDelete={() => onDelete(chat.id)}
                    onDragStart={() => setDragChatId(chat.id)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverChatId(chat.id);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      dropOnto(chat, section.chats, section.title === "RECENTS" ? null : chat.group_name);
                    }}
                  />
                ))}
                {mode === "chats" && (
                  <div
                    className="h-[0.6em]"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      dropAtEnd(section.chats, section.title === "RECENTS" ? null : section.chats[0]?.group_name ?? null);
                    }}
                  />
                )}
              </div>
            )
        )}
      </div>

      <div className="flex items-center gap-[0.6em] p-[0.7em] border-t border-border">
        <span className="w-[22px] h-[22px] shrink-0 flex items-center justify-center rounded-full bg-bg-tertiary text-[0.7em] font-medium">
          {displayNameForUser(userEmail).slice(0, 1).toUpperCase()}
        </span>
        <span className="flex-1 text-[0.78em] text-text-secondary truncate">{displayNameForUser(userEmail)}</span>
        <UpdateButton />
        <button
          type="button"
          ref={settingsAnchorRef}
          className="icon-button icon-button-sm"
          title="Settings"
          onClick={() => setSettingsOpen((o) => !o)}
        >
          <GearIcon />
        </button>
        <Popover
          open={settingsOpen}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsPanel("main");
          }}
          anchorRef={settingsAnchorRef}
          width={200}
        >
          {settingsPanel === "main" ? (
            <>
              <PopoverRow title="Dark" checked={theme === "dark"} onClick={() => setTheme("dark")} />
              <PopoverRow title="Light" checked={theme === "light"} onClick={() => setTheme("light")} />
              <PopoverDivider />
              <PopoverRow
                title="Personalization"
                chevron
                dotColor={selfProfile?.color ?? colorForUser(userEmail)}
                onClick={() => {
                  setNameDraft(selfProfile?.display_name ?? "");
                  setSettingsPanel("personalization");
                }}
              />
              <PopoverDivider />
              <PopoverRow
                title="Reload app"
                onClick={() => {
                  setSettingsOpen(false);
                  window.location.reload();
                }}
              />
              <PopoverRow
                title="Sign out"
                onClick={() => {
                  setSettingsOpen(false);
                  onSignOut();
                }}
              />
              <PopoverDivider />
              <div className="flex items-center w-[calc(100%-8px)] mx-1 my-0 py-[7px] px-2.5 text-[13px] text-text-primary cursor-text select-text">
                <span>Version</span>
                <span className="flex-1" />
                <span className="text-xs text-text-tertiary">{__APP_COMMIT__}</span>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                className="appearance-none bg-transparent border-0 outline-none font-normal text-left text-text-tertiary text-[12px] flex items-center gap-1 w-[calc(100%-8px)] mx-1 my-0 py-[6px] px-2.5 cursor-default hover:text-text-primary"
                onClick={() => setSettingsPanel("main")}
              >
                <span className="[&>svg]:w-2.5 [&>svg]:h-2.5 flex rotate-180">
                  <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </span>
                Back
              </button>
              <PopoverDivider />
              <div className="px-2.5 pt-1.5 pb-2">
                <label className="block text-[11px] font-semibold text-text-tertiary mb-1">Username</label>
                <input
                  className="chat-card-rename-input w-full"
                  placeholder={userEmail}
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  onBlur={() => onUpdateProfile?.({ display_name: nameDraft.trim() || null })}
                />
              </div>
              <div className="px-2.5 pb-2">
                <span className="block text-[11px] font-semibold text-text-tertiary mb-1.5">Color</span>
                <div className="flex flex-wrap gap-1.5">
                  {PRESENCE_PALETTE.map((color) => {
                    const takenBy = takenColors.get(color);
                    const isMine = selfProfile?.color === color;
                    return (
                      <button
                        key={color}
                        type="button"
                        title={takenBy ? `Taken by ${displayNameForUser(takenBy.email)}` : color}
                        disabled={!!takenBy}
                        className={`w-[20px] h-[20px] rounded-full shrink-0 flex items-center justify-center ${
                          takenBy ? "opacity-30 cursor-not-allowed" : ""
                        }`}
                        style={{ background: color }}
                        onClick={() => onUpdateProfile?.({ color })}
                      >
                        {isMine && (
                          <svg viewBox="0 0 24 24" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </Popover>
      </div>
    </div>
  );
}
