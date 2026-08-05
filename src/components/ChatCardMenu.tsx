import { useState } from "react";

export function TerminalToggle() {
  const [active, setActive] = useState(false);
  return (
    <button
      type="button"
      className={active ? "icon-button icon-button-active" : "icon-button"}
      title="Terminal"
      onClick={() => setActive((a) => !a)}
    >
      <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 9l3 3-3 3M13 15h4" />
      </svg>
    </button>
  );
}

export function ChatCardMenu({
  title,
  onRename,
}: {
  title: string;
  onRename: (newTitle: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(title);

  function commitRename() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== title) onRename(trimmed);
    setRenaming(false);
    setOpen(false);
  }

  return (
    <div className="chat-card-menu">
      <button
        type="button"
        className="icon-button"
        title="Chat settings"
        onClick={() => {
          setDraft(title);
          setOpen((o) => !o);
        }}
      >
        <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="19" cy="12" r="1.5" />
        </svg>
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
            {/* ponytail: no branching/fork concept in Vibeco2 yet — visual only, per explicit request to keep the slot even though it's a no-op */}
            <button type="button" disabled title="Not yet available">
              Fork conversation
            </button>
            {/* ponytail: no archived flag on chats yet — visual only */}
            <button type="button" disabled title="Not yet available">
              Archive
            </button>
          </div>
        ))}
    </div>
  );
}
