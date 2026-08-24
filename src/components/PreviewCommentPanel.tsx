import { useState } from "react";
import type { PreviewPin, PreviewPinReply } from "../lib/previewComments";
import type { Profile } from "../lib/profiles";
import { colorForUser, displayNameForUser, initialsForUser, textColorForBackground } from "../lib/presenceColor";

// pillBase pattern kept local per Task 7's precedent. This is the last
// consumer of .pill/.pill-ghost — see decisions.md for the App.css cleanup
// this enabled.
const pillBase =
  "appearance-none border-0 outline-none box-border inline-flex items-center gap-[0.35em] text-[0.78em] px-[0.7em] py-[0.4em] rounded-lg cursor-default hover:bg-bg-tertiary";
const pillGhost = `${pillBase} text-text-secondary bg-transparent`;

function nameFor(profiles: Profile[], userId: string): string {
  const email = profiles.find((p) => p.id === userId)?.email;
  return email ? displayNameForUser(email) : "Teammate";
}

function Avatar({ profiles, userId }: { profiles: Profile[]; userId: string }) {
  const email = profiles.find((p) => p.id === userId)?.email ?? userId;
  const bg = colorForUser(email);
  return (
    <div
      className="w-5 h-5 rounded-full flex items-center justify-center font-bold shrink-0 text-[10px]"
      style={{ background: bg, color: textColorForBackground(bg) }}
    >
      {initialsForUser(displayNameForUser(email))}
    </div>
  );
}

export function PreviewCommentPanel({
  pins,
  repliesByPin,
  currentUserId,
  profiles,
  showResolved,
  onToggleShowResolved,
  onResolve,
  onDelete,
  onReply,
}: {
  pins: PreviewPin[];
  repliesByPin: Record<string, PreviewPinReply[]>;
  currentUserId: string;
  profiles: Profile[];
  showResolved: boolean;
  onToggleShowResolved: () => void;
  onResolve: (pinId: string, resolved: boolean) => void;
  onDelete: (pinId: string) => void;
  onReply: (pinId: string, text: string) => void;
}) {
  const sorted = [...pins].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return (
    // Absolutely positioned over the preview instead of a flex sibling that
    // shrinks the iframe — shrinking it would resize the (responsive) page
    // inside, reflowing its content and leaving every pin pointing at the
    // wrong spot the moment this panel opens.
    <div className="absolute inset-y-0 right-0 z-20 w-[320px] border-l border-border bg-bg-sidebar flex flex-col overflow-hidden shadow-[-8px_0_24px_rgba(0,0,0,0.25)]">
      <div className="flex items-center justify-between px-[1em] py-[0.75em] border-b border-border text-[13px] text-text-primary">
        <span>Comments</span>
        <button type="button" className={pillGhost} onClick={onToggleShowResolved}>
          {showResolved ? "Hide resolved" : "Show resolved"}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
        {sorted.length === 0 && (
          <div className="text-text-tertiary text-[12px] p-[1em]">
            No comments yet — select Pin on the toolbar to leave one.
          </div>
        )}
        {sorted.map((pin) => (
          <PreviewCommentItem
            key={pin.id}
            pin={pin}
            replies={repliesByPin[pin.id] ?? []}
            currentUserId={currentUserId}
            profiles={profiles}
            onResolve={onResolve}
            onDelete={onDelete}
            onReply={onReply}
          />
        ))}
      </div>
    </div>
  );
}

// Boxed like a queue item (ShelfPanel) — a bordered card per comment so a
// wall of pins stays easy to tell apart, with the author's name/avatar up
// top, larger comment text, a reply box, and delete.
function PreviewCommentItem({
  pin,
  replies,
  currentUserId,
  profiles,
  onResolve,
  onDelete,
  onReply,
}: {
  pin: PreviewPin;
  replies: PreviewPinReply[];
  currentUserId: string;
  profiles: Profile[];
  onResolve: (pinId: string, resolved: boolean) => void;
  onDelete: (pinId: string) => void;
  onReply: (pinId: string, text: string) => void;
}) {
  const [replyText, setReplyText] = useState("");

  function submitReply() {
    if (!replyText.trim()) return;
    onReply(pin.id, replyText.trim());
    setReplyText("");
  }

  return (
    <div
      className={`rounded-lg border border-border bg-bg-tertiary p-2.5 flex flex-col gap-2 text-[13px]${
        pin.resolved ? " opacity-[0.55]" : ""
      }`}
    >
      <div className="flex items-center gap-1.5">
        <Avatar profiles={profiles} userId={pin.created_by} />
        <span className="text-[12.5px] font-medium text-text-primary">
          {pin.created_by === currentUserId ? "You" : nameFor(profiles, pin.created_by)}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          title={pin.resolved ? "Unresolve" : "Resolve"}
          onClick={() => onResolve(pin.id, !pin.resolved)}
          className="appearance-none border-0 bg-transparent p-0.5 rounded cursor-default text-text-tertiary hover:text-text-primary hover:bg-bg-secondary"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </button>
        <button
          type="button"
          title="Delete"
          onClick={() => onDelete(pin.id)}
          className="appearance-none border-0 bg-transparent p-0.5 rounded cursor-default text-text-tertiary hover:text-[#E2584F] hover:bg-bg-secondary"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 2.5l9 9M11.5 2.5l-9 9" />
          </svg>
        </button>
      </div>
      <div className="text-[13px] leading-[1.5] text-text-primary">{pin.text}</div>
      {replies.map((reply) => (
        <div key={reply.id} className="flex items-start gap-1.5 pl-1">
          <Avatar profiles={profiles} userId={reply.created_by} />
          <div className="text-[12.5px] leading-[1.45] text-text-secondary">
            <span className="font-medium text-text-primary">
              {reply.created_by === currentUserId ? "You" : nameFor(profiles, reply.created_by)}:
            </span>{" "}
            {reply.text}
          </div>
        </div>
      ))}
      <input
        type="text"
        className="bg-bg-primary border border-border rounded-md text-text-primary [font:inherit] px-2 py-1 text-[12.5px]"
        placeholder="Reply…"
        value={replyText}
        onChange={(e) => setReplyText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submitReply();
        }}
      />
    </div>
  );
}
