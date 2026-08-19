import { useState } from "react";
import type { PreviewPin, PreviewPinReply } from "../lib/previewComments";

export function PreviewCommentPanel({
  pins,
  repliesByPin,
  currentUserId,
  showResolved,
  onToggleShowResolved,
  onResolve,
  onReply,
  onClose,
}: {
  pins: PreviewPin[];
  repliesByPin: Record<string, PreviewPinReply[]>;
  currentUserId: string;
  showResolved: boolean;
  onToggleShowResolved: () => void;
  onResolve: (pinId: string, resolved: boolean) => void;
  onReply: (pinId: string, text: string) => void;
  onClose: () => void;
}) {
  const sorted = [...pins].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return (
    <div className="preview-comment-panel">
      <div className="preview-comment-panel-header">
        <span>Comments</span>
        <div className="preview-comment-panel-actions">
          <button type="button" className="pill pill-ghost" onClick={onToggleShowResolved}>
            {showResolved ? "Hide resolved" : "Show resolved"}
          </button>
          <button type="button" className="icon-button icon-button-sm" title="Close" onClick={onClose}>
            ×
          </button>
        </div>
      </div>
      <div className="preview-comment-list">
        {sorted.length === 0 && (
          <div className="preview-comment-empty">No comments yet — select Pin on the toolbar to leave one.</div>
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

  return (
    <div className={pin.resolved ? "preview-comment-item resolved" : "preview-comment-item"}>
      <div className="preview-comment-author">{pin.created_by === currentUserId ? "You" : "Teammate"}</div>
      <div className="preview-comment-text">{pin.text}</div>
      {replies.map((reply) => (
        <div key={reply.id} className="preview-comment-reply">
          <strong>{reply.created_by === currentUserId ? "You" : "Teammate"}:</strong> {reply.text}
        </div>
      ))}
      <div className="preview-comment-item-actions">
        <input
          type="text"
          placeholder="Reply…"
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitReply();
          }}
        />
        <button type="button" className="pill" onClick={() => onResolve(pin.id, !pin.resolved)}>
          {pin.resolved ? "Unresolve" : "Resolve"}
        </button>
      </div>
    </div>
  );
}
