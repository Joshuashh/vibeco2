import { useMemo, useState } from "react";
import { useSelf, useOthers } from "../lib/liveblocks";
import { colorForUser } from "../lib/presenceColor";
import type { ChatRow } from "../types/chat";
import type { LogbookEntry } from "../lib/logbookEntries";

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function chatTitle(chats: ChatRow[], chatId: string | null): string {
  if (!chatId) return "a chat";
  return chats.find((c) => c.id === chatId)?.title ?? "Untitled chat";
}

export function LogbookPage({ chats, entries }: { chats: ChatRow[]; entries: LogbookEntry[] }) {
  const self = useSelf();
  const others = useOthers();
  const [filterEmail, setFilterEmail] = useState<string | null>(null);

  const working = useMemo(() => {
    const people = [
      ...(self ? [{ email: self.presence.email, claimedChatId: self.presence.claimedChatId }] : []),
      ...others.map((o) => ({ email: o.presence.email, claimedChatId: o.presence.claimedChatId })),
    ];
    return people.filter((p) => p.claimedChatId);
  }, [self, others]);

  const filtered = filterEmail ? entries.filter((e) => e.user_email === filterEmail) : entries;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="max-w-[720px] mx-auto">
        <div className="mb-8 border border-border rounded-lg px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-text-tertiary mb-2">Right now</div>
          {working.length === 0 ? (
            <div className="text-[13px] text-text-tertiary">Nobody's claimed a chat.</div>
          ) : (
            <div className="flex flex-col gap-[6px]">
              {working.map((p) => (
                <div key={p.email} className="flex items-center gap-[0.5em] text-[13px]">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colorForUser(p.email) }} />
                  <span className="font-medium">{p.email}</span>
                  <span className="text-text-tertiary">is working on {chatTitle(chats, p.claimedChatId)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mb-4">
          <div className="text-[11px] uppercase tracking-wide text-text-tertiary">Logbook</div>
          {filterEmail && (
            <button
              type="button"
              className="text-[12px] text-text-secondary bg-transparent border-none cursor-pointer p-0"
              onClick={() => setFilterEmail(null)}
            >
              Clear filter ({filterEmail}) ×
            </button>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="text-[13px] text-text-tertiary">No entries yet — hand off a chat or close the app mid-work to see one here.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map((entry) => (
              <div key={entry.id} className="border border-border rounded-lg px-4 py-3">
                <div className="flex items-center gap-[0.5em] text-[12px] text-text-tertiary mb-2">
                  <button
                    type="button"
                    className="bg-transparent border-none cursor-pointer p-0 font-medium text-text-secondary"
                    onClick={() => entry.user_email && setFilterEmail(entry.user_email)}
                  >
                    {entry.user_email ?? "Someone"}
                  </button>
                  <span>·</span>
                  <span>{chatTitle(chats, entry.chat_id)}</span>
                  {entry.duration_seconds != null && (
                    <>
                      <span>·</span>
                      <span>{formatDuration(entry.duration_seconds)}</span>
                    </>
                  )}
                  <span>·</span>
                  <span>{entry.kind === "handoff" ? `→ ${entry.handed_off_to ?? "teammate"}` : "⏸ auto-checkpoint"}</span>
                </div>
                <div className="text-[14px] leading-[1.6] whitespace-pre-wrap">{entry.summary}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
