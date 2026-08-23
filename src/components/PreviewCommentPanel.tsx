import { useState } from "react";
import type { PreviewPin, PreviewPinReply } from "../lib/previewComments";

// pillBase pattern kept local per Task 7's precedent. This is the last
// consumer of .pill/.pill-ghost — see decisions.md for the App.css cleanup
// this enabled.
const pillBase =
  "appearance-none border-0 outline-none box-border inline-flex items-center gap-[0.35em] text-[0.78em] px-[0.7em] py-[0.4em] rounded-lg cursor-default hover:bg-bg-tertiary";
const pillPlain = `${pillBase} text-text-secondary bg-bg-secondary`;
const pillGhost = `${pillBase} text-text-secondary bg-transparent`;

export function PreviewCommentPanel({
  pins,
  repliesByPin,
  currentUserId,
  showResolved,
  onToggleShowResolved,
  onResolve,
  onReply,
}: {
  pins: PreviewPin[];
  repliesByPin: Record<string, PreviewPinReply[]>;
  currentUserId: string;
  showResolved: boolean;
  onToggleShowResolved: () => void;
  onResolve: (pinId: string, resolved: boolean) => void;
  onReply: (pinId: string, text: string) => void;
}) {
  const sorted = [...pins].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return (
    <div className="w-[320px] shrink-0 border-l border-border bg-bg-sidebar flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-[1em] py-[0.75em] border-b border-border text-[13px] text-text-primary">
        <span>Comments</span>
        <button type="button" className={pillGhost} onClick={onToggleShowResolved}>
          {showResolved ? "Hide resolved" : "Show resolved"}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
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
            onResolve={onResolve}
            onReply={onReply}
          />
        ))}
      </div>
    </div>
  );
}

function PreviewCommentItem({
  pin,
  replies,
  currentUserId,
  onResolve,
  onReply,
}: {
  pin: PreviewPin;
  replies: PreviewPinReply[];
  currentUserId: string;
  onResolve: (pinId: string, resolved: boolean) => void;
  onReply: (pinId: string, text: string) => void;
}) {
  const [replyText, setReplyText] = useState("");

  function submitReply() {
    if (!replyText.trim()) return;
    onReply(pin.id, replyText.trim());
    setReplyText("");
  }

  const itemClass = pin.resolved
    ? "border border-border rounded-lg p-2.5 mb-2 text-[13px] opacity-[0.55]"
    : "border border-border rounded-lg p-2.5 mb-2 text-[13px]";

  return (
    <div className={itemClass}>
      <div className="text-[11px] text-text-tertiary mb-1">{pin.created_by === currentUserId ? "You" : "Teammate"}</div>
      <div className="text-text-primary">{pin.text}</div>
      {replies.map((reply) => (
        <div key={reply.id} className="text-xs text-text-secondary mt-1.5">
          <strong>{reply.created_by === currentUserId ? "You" : "Teammate"}:</strong> {reply.text}
        </div>
      ))}
      <div className="flex gap-1.5 mt-2">
        <input
          type="text"
          className="flex-1 min-w-0 bg-bg-primary border border-border rounded-md text-text-primary [font:inherit] px-2 py-1"
          placeholder="Reply…"
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitReply();
          }}
        />
        <button type="button" className={pillPlain} onClick={() => onResolve(pin.id, !pin.resolved)}>
          {pin.resolved ? "Unresolve" : "Resolve"}
        </button>
      </div>
    </div>
  );
}
