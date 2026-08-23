import { useMemo } from "react";
import type { ChatRow } from "../types/chat";
import type { Profile } from "../lib/profiles";
import type { LogbookEntry } from "../lib/logbookEntries";
import type { MentionInboxEntry } from "../lib/mentions";
import { computeClaimant, type Occupant } from "../lib/claim";
import { activeChats, groupActiveChats } from "../lib/chatGroups";
import { colorForUser, displayNameForUser, initialsForUser, textColorForBackground } from "../lib/presenceColor";
import { formatRelativeTime } from "../lib/time";
import { MarkdownText } from "./MessageBlock";

// A handoff entry's `user_email` is whoever performed the handoff, not who
// it's for — the person this entry is actually relevant to is the recipient
// for a handoff, and the actor for anything else (a checkpoint has no other
// party). Ported from LogPanel.tsx.
function entryOwner(entry: LogbookEntry): string | null {
  return entry.kind === "handoff" ? entry.handed_off_to ?? entry.user_email : entry.user_email;
}

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

function entryChatTitle(chats: ChatRow[], chatId: string | null): string {
  if (!chatId) return "a chat";
  return chats.find((c) => c.id === chatId)?.title ?? "Untitled chat";
}

// Live claimant wins (someone's actually on it right now); otherwise fall
// back to the persisted handoff target (assigned but not yet picked up) —
// same reconciliation ChatCard.tsx already does per-card, just aggregated.
function assigneeFor(chat: ChatRow, claimant: string | null): string | null {
  return claimant ?? chat.handed_off_to ?? null;
}

function Avatar({ email, size = 22 }: { email: string; size?: number }) {
  const bg = colorForUser(email);
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold shrink-0"
      style={{ width: size, height: size, background: bg, color: textColorForBackground(bg), fontSize: size * 0.42 }}
      title={displayNameForUser(email)}
    >
      {initialsForUser(displayNameForUser(email))}
    </div>
  );
}

function UnassignedDot({ size = 20 }: { size?: number }) {
  return (
    <div
      className="rounded-full border border-dashed border-border shrink-0"
      style={{ width: size, height: size }}
      title="Unassigned"
    />
  );
}

function ChatRowButton({
  chat,
  assignee,
  timestamp,
  onClick,
}: {
  chat: ChatRow;
  assignee: string | null;
  timestamp: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex items-center gap-[0.6em] w-full text-left px-[0.7em] py-[0.5em] rounded-md border-none bg-transparent hover:bg-bg-tertiary cursor-pointer"
      onClick={onClick}
    >
      {assignee ? <Avatar email={assignee} size={20} /> : <UnassignedDot />}
      <span className="flex-1 min-w-0 truncate text-[13px] text-text-primary">{chat.title ?? "Untitled chat"}</span>
      {timestamp && <span className="text-[11px] text-text-tertiary shrink-0">{formatRelativeTime(timestamp)}</span>}
    </button>
  );
}

export function HomeView({
  chats,
  profiles,
  selfOccupant,
  otherOccupants,
  onlineEmails,
  onJumpToChat,
  logbookEntries,
  mentionInbox,
  selfEmail,
  onClearMentions,
}: {
  chats: ChatRow[];
  profiles: Profile[];
  selfOccupant: Occupant | null;
  otherOccupants: Occupant[];
  onlineEmails: Set<string>;
  onJumpToChat: (chatId: string) => void;
  logbookEntries: LogbookEntry[];
  mentionInbox: MentionInboxEntry[];
  selfEmail: string | null;
  onClearMentions: () => void;
}) {
  const active = useMemo(() => activeChats(chats), [chats]);

  // Oldest first, chat-log style — `logbookEntries` arrives newest-first
  // from the fetch (matches the DB query order). Scoped to entries relevant
  // to you (own checkpoints, handoffs to/from you), same default LogPanel
  // used — this is a "catch up" surface, not a full team audit log.
  const myEntries = useMemo(
    () => logbookEntries.filter((e) => !selfEmail || entryOwner(e) === selfEmail).slice(0, 8).reverse(),
    [logbookEntries, selfEmail]
  );

  const claimantByChat = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const c of active) map.set(c.id, computeClaimant(c.id, selfOccupant, otherOccupants));
    return map;
  }, [active, selfOccupant, otherOccupants]);

  const sections = useMemo(() => groupActiveChats(active), [active]);

  const unassigned = useMemo(
    () => active.filter((c) => !assigneeFor(c, claimantByChat.get(c.id) ?? null)),
    [active, claimantByChat]
  );

  const byPerson = useMemo(() => {
    const map = new Map<string, ChatRow[]>();
    for (const c of active) {
      const who = assigneeFor(c, claimantByChat.get(c.id) ?? null);
      if (!who) continue;
      const list = map.get(who) ?? [];
      list.push(c);
      map.set(who, list);
    }
    return map;
  }, [active, claimantByChat]);

  const completed = useMemo(
    () =>
      chats
        .filter((c) => c.archived_at)
        .sort((a, b) => (b.archived_at ?? "").localeCompare(a.archived_at ?? ""))
        .slice(0, 8),
    [chats]
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-[2em] py-[1.8em]">
      <div className="max-w-[880px] mx-auto flex flex-col gap-[1.8em]">
        <div className="flex items-center gap-[0.5em]">
          {profiles.map((p) => (
            <div key={p.email} className="relative" style={{ width: 26, height: 26 }}>
              <Avatar email={p.email} size={26} />
              <span
                className="absolute -bottom-px -right-px w-2 h-2 rounded-full border-2"
                style={{
                  background: onlineEmails.has(p.email) ? "var(--merged)" : "var(--text-tertiary)",
                  borderColor: "var(--bg-primary)",
                }}
              />
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-border bg-bg-secondary px-[1.2em] py-[1em]">
          <div className="text-[15px] font-semibold text-text-primary mb-[0.2em]">
            {unassigned.length === 0
              ? "You're all caught up"
              : `${unassigned.length} chat${unassigned.length === 1 ? "" : "s"} need${unassigned.length === 1 ? "s" : ""} an owner`}
          </div>
          <div className="text-[12.5px] text-text-tertiary">
            {sections.length} task list{sections.length === 1 ? "" : "s"} · {active.length} active chat
            {active.length === 1 ? "" : "s"} · {completed.length} recently completed
          </div>
        </div>

        {(mentionInbox.length > 0 || myEntries.length > 0) && (
          <div className="flex flex-col gap-[0.8em]">
            <div className="text-[12px] font-semibold tracking-[0.06em] uppercase text-text-tertiary">At a glance</div>
            <div className="rounded-lg border border-border flex flex-col divide-y divide-border">
              {mentionInbox.length > 0 && (
                <div className="flex flex-col gap-[0.4em] px-[1em] py-[0.8em]">
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
                  {mentionInbox.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="flex items-center gap-[0.5em] text-left text-[12.5px] px-[0.6em] py-[0.4em] rounded-md border-none cursor-pointer bg-transparent hover:bg-bg-tertiary"
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
              {myEntries.length > 0 && (
                <div className="flex flex-col gap-[0.6em] px-[1em] py-[0.8em]">
                  <span className="text-[11px] font-medium text-text-secondary">Recent activity</span>
                  {myEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className={`rounded-md px-[0.7em] py-[0.6em] border-l-2 bg-bg-tertiary${entry.chat_id ? " cursor-pointer hover:brightness-110" : ""}`}
                      style={{ borderLeftColor: entry.user_email ? colorForUser(entry.user_email) : "var(--border)" }}
                      role={entry.chat_id ? "button" : undefined}
                      tabIndex={entry.chat_id ? 0 : undefined}
                      onClick={entry.chat_id ? () => onJumpToChat(entry.chat_id!) : undefined}
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
                        {entryChatTitle(chats, entry.chat_id)}
                        {entry.kind === "handoff" ? ` → ${entry.handed_off_to ?? "teammate"}` : " · ⏸ auto-checkpoint"}
                      </div>
                      <MarkdownText text={entry.summary} className="markdown text-[13px] leading-[1.5] text-text-primary" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-[1em]">
          <div className="text-[12px] font-semibold tracking-[0.06em] uppercase text-text-tertiary">Task lists</div>
          {sections.map((section) => (
            <div key={section.title} className="flex flex-col gap-[0.15em]">
              <div className="text-[11px] font-medium tracking-[0.05em] uppercase text-text-tertiary px-[0.7em]">
                {section.title} · {section.chats.length}
              </div>
              {section.chats.length === 0 ? (
                <div className="px-[0.7em] py-[0.4em] text-[12.5px] text-text-tertiary">Nothing here.</div>
              ) : (
                section.chats.map((chat) => (
                  <ChatRowButton
                    key={chat.id}
                    chat={chat}
                    assignee={assigneeFor(chat, claimantByChat.get(chat.id) ?? null)}
                    timestamp={chat.last_message_at}
                    onClick={() => onJumpToChat(chat.id)}
                  />
                ))
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-[0.8em]">
          <div className="text-[12px] font-semibold tracking-[0.06em] uppercase text-text-tertiary">Assigned to</div>
          <div className="grid grid-cols-2 gap-[0.8em]">
            {profiles.map((p) => {
              const mine = byPerson.get(p.email) ?? [];
              return (
                <div key={p.email} className="rounded-lg border border-border px-[0.9em] py-[0.7em]">
                  <div className="flex items-center gap-[0.5em] mb-[0.4em]">
                    <Avatar email={p.email} size={20} />
                    <span className="text-[12.5px] font-medium text-text-primary">{displayNameForUser(p.email)}</span>
                    <span className="text-[11px] text-text-tertiary ml-auto">{mine.length}</span>
                  </div>
                  {mine.length === 0 ? (
                    <div className="text-[12px] text-text-tertiary">Nothing assigned.</div>
                  ) : (
                    <div className="flex flex-col gap-[0.05em]">
                      {mine.map((chat) => (
                        <ChatRowButton
                          key={chat.id}
                          chat={chat}
                          assignee={assigneeFor(chat, claimantByChat.get(chat.id) ?? null)}
                          timestamp={chat.last_message_at}
                          onClick={() => onJumpToChat(chat.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-[0.15em]">
          <div className="text-[12px] font-semibold tracking-[0.06em] uppercase text-text-tertiary px-[0.7em] mb-[0.2em]">
            Recently completed
          </div>
          {completed.length === 0 ? (
            <div className="px-[0.7em] text-[12.5px] text-text-tertiary">Nothing archived yet.</div>
          ) : (
            completed.map((chat) => (
              <ChatRowButton
                key={chat.id}
                chat={chat}
                assignee={null}
                timestamp={chat.archived_at}
                onClick={() => onJumpToChat(chat.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
