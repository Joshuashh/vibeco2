import { useState, type ReactNode } from "react";
import type { PreviewPin, PreviewPinReply } from "../lib/previewComments";
import type { Profile } from "../lib/profiles";
import { colorForUser, displayNameForUser, initialsForUser, textColorForBackground } from "../lib/presenceColor";

// Shared look for the two places a comment renders — the side panel
// (PreviewCommentPanel) and the in-place pin popover (PreviewAnnotationLayer).
// Both used to style themselves independently and had drifted apart (one had
// avatars and real names, the other said "Teammate" with no avatar).

export function nameFor(profiles: Profile[], userId: string, currentUserId: string): string {
  if (userId === currentUserId) return "You";
  const email = profiles.find((p) => p.id === userId)?.email;
  return email ? displayNameForUser(email) : "Teammate";
}

export function Avatar({
  profiles,
  userId,
  size = 20,
}: {
  profiles: Profile[];
  userId: string;
  size?: number;
}) {
  const email = profiles.find((p) => p.id === userId)?.email ?? userId;
  const bg = colorForUser(email);
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold shrink-0"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: bg, color: textColorForBackground(bg) }}
    >
      {initialsForUser(displayNameForUser(email))}
    </div>
  );
}

// Compact relative time ("just now" / "5m" / "3h" / "2d") — no library.
export function relTime(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}

const actionBtn =
  "appearance-none border-0 bg-transparent p-1 rounded cursor-default text-text-tertiary hover:bg-bg-secondary transition-colors";

export function ResolveButton({ resolved, onClick }: { resolved: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={resolved ? "Unresolve" : "Resolve"}
      onClick={onClick}
      className={`${actionBtn} ${resolved ? "text-merged" : "hover:text-text-primary"}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    </button>
  );
}

export function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" title="Delete" onClick={onClick} className={`${actionBtn} hover:text-[#E2584F]`}>
      <svg width="13" height="13" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
      </svg>
    </button>
  );
}

export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" aria-label="Close" onClick={onClick} className={`${actionBtn} hover:text-text-primary`}>
      <svg width="13" height="13" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4l16 16M20 4L4 20" />
      </svg>
    </button>
  );
}

// Author row + comment text + replies + a reply box. The caller supplies the
// positioned/bordered wrapper and the header action buttons (`actions`).
export function CommentThread({
  pin,
  replies,
  profiles,
  currentUserId,
  actions,
  onReply,
}: {
  pin: PreviewPin;
  replies: PreviewPinReply[];
  profiles: Profile[];
  currentUserId: string;
  actions?: ReactNode;
  onReply: (pinId: string, text: string) => void;
}) {
  const [replyText, setReplyText] = useState("");

  function submit() {
    const t = replyText.trim();
    if (!t) return;
    onReply(pin.id, t);
    setReplyText("");
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Avatar profiles={profiles} userId={pin.created_by} />
        <span className="text-[12.5px] font-semibold text-text-primary">
          {nameFor(profiles, pin.created_by, currentUserId)}
        </span>
        <span className="text-[11px] text-text-tertiary">{relTime(pin.created_at)}</span>
        <div className="flex-1" />
        {actions}
      </div>
      <div className="text-[13px] leading-[1.5] text-text-primary whitespace-pre-wrap break-words">{pin.text}</div>
      {replies.length > 0 && (
        <div className="flex flex-col gap-2 border-l border-border pl-2.5 ml-[9px]">
          {replies.map((reply) => (
            <div key={reply.id} className="flex items-start gap-1.5">
              <Avatar profiles={profiles} userId={reply.created_by} size={16} />
              <div className="text-[12.5px] leading-[1.45] text-text-secondary break-words">
                <span className="font-semibold text-text-primary">
                  {nameFor(profiles, reply.created_by, currentUserId)}
                </span>{" "}
                {reply.text}
              </div>
            </div>
          ))}
        </div>
      )}
      <input
        type="text"
        className="bg-bg-primary border border-border rounded-md text-text-primary [font:inherit] px-2.5 py-1.5 text-[12.5px] outline-none focus:border-text-tertiary"
        placeholder="Reply…"
        value={replyText}
        onChange={(e) => setReplyText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
    </div>
  );
}
