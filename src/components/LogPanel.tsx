import { useEffect, useMemo, useRef, useState } from "react";
import { colorForUser } from "../lib/presenceColor";
import { MarkdownText } from "./MessageBlock";
import type { ChatRow } from "../types/chat";
import type { LogbookEntry } from "../lib/logbookEntries";
import type { MentionInboxEntry } from "../lib/mentions";

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function chatTitle(chats: ChatRow[], chatId: string | null): string {
  if (!chatId) return "a chat";
  return chats.find((c) => c.id === chatId)?.title ?? "Untitled chat";
}

type KindFilter = "all" | "handoff" | "checkpoint";

// A handoff entry's `user_email` is whoever performed the handoff, not who
// it's for — filtering "just mine" by that field put every chat you handed
// *away* into your own view and left it out of the recipient's. The person
// this entry is actually relevant to is the recipient for a handoff, and
// the actor for anything else (a checkpoint has no other party).
function entryOwner(entry: LogbookEntry): string | null {
  return entry.kind === "handoff" ? entry.handed_off_to ?? entry.user_email : entry.user_email;
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function LogPanel({
  chats,
  entries,
  mentions,
  selfEmail,
  onJumpToChat,
  onClearMentions,
  onClose,
}: {
  chats: ChatRow[];
  entries: LogbookEntry[];
  mentions: MentionInboxEntry[];
  selfEmail: string | null;
  onJumpToChat: (chatId: string) => void;
  onClearMentions: () => void;
  onClose: () => void;
}) {
  // Defaults to "just my own entries" rather than the whole team's — still
  // just the existing person-filter chip, pre-selected, so clearing it back
  // to everyone is one click away.
  const [filterEmail, setFilterEmail] = useState<string | null>(selfEmail);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");

  // Always includes your own email, even with zero entries so far — otherwise
  // the default "just mine" filter could land on a chip that doesn't exist
  // yet to click off.
  const people = useMemo(() => {
    const emails = new Set(entries.map(entryOwner).filter((e): e is string => e != null));
    if (selfEmail) emails.add(selfEmail);
    return Array.from(emails);
  }, [entries, selfEmail]);

  // Oldest first, chat-log style — `entries` itself arrives newest-first
  // from the fetch (matches the DB query order), so this reverses it rather
  // than duplicating the sort.
  const filtered = entries
    .filter((e) => (!filterEmail || entryOwner(e) === filterEmail) && (kindFilter === "all" || e.kind === kindFilter))
    .reverse();

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [filtered.length]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-[0.9em] py-[0.7em] shrink-0 border-b border-border">
        <span className="text-[13px] font-medium text-text-primary">Activity log</span>
        <button type="button" className="icon-button icon-button-sm" title="Close log" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      {mentions.length > 0 && (
        <div className="flex flex-col gap-[0.4em] px-[0.9em] py-[0.7em] shrink-0 border-b border-border">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-text-secondary">For you</span>
            <button
              type="button"
              className="text-[11px] text-text-tertiary bg-transparent border-none cursor-pointer p-0 hover:text-text-secondary"
              onClick={onClearMentions}
            >
              Clear
            </button>
          </div>
          {mentions.map((m) => (
            <button
              key={m.id}
              type="button"
              className="flex items-center gap-[0.5em] text-left text-[12px] px-[0.6em] py-[0.4em] rounded-md border-none cursor-pointer bg-transparent hover:bg-bg-tertiary"
              onClick={() => onJumpToChat(m.chatId)}
            >
              <span className="w-2 h-2 rounded-full shrink-0 bg-accent" />
              <span className="truncate">
                <span className="font-medium text-text-primary">{m.fromEmail}</span>
                <span className="text-text-tertiary">
                  {m.kind === "handoff" ? " handed off " : " tagged you in "}
                  {m.chatTitle ?? "a chat"}
                  {m.kind === "handoff" ? " to you" : ""}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {people.length > 0 && (
        <div className="flex flex-wrap gap-[0.4em] px-[0.9em] py-[0.6em] shrink-0 border-b border-border">
          {people.map((email) => (
            <button
              key={email}
              type="button"
              className="flex items-center gap-[0.35em] text-[11px] px-[0.6em] py-[0.25em] rounded-full border cursor-pointer"
              style={
                filterEmail === email
                  ? { borderColor: colorForUser(email), color: "var(--text-primary)", background: "var(--bg-tertiary)" }
                  : { borderColor: "var(--border)", color: "var(--text-tertiary)" }
              }
              onClick={() => setFilterEmail((f) => (f === email ? null : email))}
            >
              <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ background: colorForUser(email) }} />
              {email}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-[0.3em] px-[0.9em] py-[0.6em] shrink-0 border-b border-border">
        {(["all", "handoff", "checkpoint"] as const).map((k) => (
          <button
            key={k}
            type="button"
            className="text-[11px] px-[0.65em] py-[0.3em] rounded-md border-none cursor-pointer capitalize"
            style={
              kindFilter === k
                ? { background: "var(--bg-tertiary)", color: "var(--text-primary)" }
                : { background: "transparent", color: "var(--text-tertiary)" }
            }
            onClick={() => setKindFilter(k)}
          >
            {k === "all" ? "All" : `${k}s`}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-[0.9em] py-[0.7em] flex flex-col gap-[0.6em]">
        {filtered.length === 0 ? (
          <div className="text-[12px] text-text-tertiary">
            {entries.length === 0 ? "No entries yet — hand off a chat or close the app mid-work to see one here." : "Nothing matches this filter."}
          </div>
        ) : (
          filtered.map((entry) => (
            <div
              key={entry.id}
              className={`rounded-md px-[0.7em] py-[0.6em] border-l-2 ${entry.chat_id ? "cursor-pointer hover:brightness-110" : ""}`}
              style={{ borderLeftColor: entry.user_email ? colorForUser(entry.user_email) : "var(--border)", background: "var(--bg-tertiary)" }}
              role={entry.chat_id ? "button" : undefined}
              tabIndex={entry.chat_id ? 0 : undefined}
              onClick={entry.chat_id ? () => onJumpToChat(entry.chat_id!) : undefined}
              onKeyDown={
                entry.chat_id
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") onJumpToChat(entry.chat_id!);
                    }
                  : undefined
              }
            >
              <div className="flex items-center gap-[0.4em] text-[11px] text-text-tertiary mb-[0.3em] flex-wrap">
                <span className="font-medium text-text-secondary">{entry.user_email ?? "Someone"}</span>
                <span>·</span>
                <span>{formatTime(entry.created_at)}</span>
                {entry.duration_seconds != null && (
                  <>
                    <span>·</span>
                    <span>{formatDuration(entry.duration_seconds)}</span>
                  </>
                )}
              </div>
              <div className="text-[11px] text-text-tertiary mb-[0.35em]">
                {chatTitle(chats, entry.chat_id)}
                {entry.kind === "handoff" ? ` → ${entry.handed_off_to ?? "teammate"}` : " · ⏸ auto-checkpoint"}
              </div>
              <MarkdownText text={entry.summary} className="markdown text-[13px] leading-[1.5] text-text-primary" />
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
