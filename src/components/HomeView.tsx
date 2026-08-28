import { useMemo } from "react";
import type { ChatRow } from "../types/chat";
import type { Profile } from "../lib/profiles";
import type { LogbookEntry } from "../lib/logbookEntries";
import type { MentionInboxEntry } from "../lib/mentions";
import { computeClaimant, type Occupant } from "../lib/claim";
import { activeChats } from "../lib/chatGroups";
import { colorForUser, displayNameForUser, initialsForUser, textColorForBackground } from "../lib/presenceColor";
import { formatRelativeTime } from "../lib/time";

// ── "Catch-up Dashboard" (design 5a) ────────────────────────────────────────
// Ported from the Claude Design project "Multiplayer AI Chat Component"
// (Catch-up Dashboard.dc.html, artboard 5a — "Return band + tiles + needs-you")
// into the Home tab: a header band with a welcome + three headline figures and
// an activity ribbon, a tile mosaic of what happened, and a right-hand "Needs
// you" column. Wired to the real data Home already receives — teammate avatars
// from presence/profiles, "Needs you" from the mention inbox and chats assigned
// to you, "Finished" from the logbook, recent chats for the agent-window tile.
// The design's palette is kept verbatim (inline styles) for fidelity.
//
// The per-hour activity ribbon is illustrative: Vibeco doesn't record per-hour
// counts yet, so the bars are a fixed decorative shape rather than real data
// (a follow-up once activity is tracked). Everything else is live.

// Theme-aware: resolves against App.css custom properties that flip on
// [data-theme="light"]. Flat map so the existing `C.xxx` call sites are
// unchanged. `bar` stays a fixed chart hue (reads fine on both themes).
const C = {
  cardBg: "var(--cw-surface)",
  cardBorder: "var(--border)",
  bandBg: "var(--cw-band)",
  seam: "var(--border)",
  border: "var(--border)",
  ink: "var(--text-primary)",
  inkDim: "var(--text-primary)",
  sub: "var(--text-secondary)",
  faint: "var(--text-tertiary)",
  fainter: "var(--text-tertiary)",
  micro: "var(--text-tertiary)",
  blueInk: "var(--cw-blue-ink)",
  blueSub: "var(--cw-blue-sub)",
  blueBg: "var(--cw-blue-bg)",
  blueBorder: "var(--cw-blue-border)",
  needBg: "var(--cw-surface)",
  reply: "var(--cw-blue-ink)",
  green: "var(--merged)",
  bar: "#7C9CFF",
};

// The design's activity-ribbon colors, cycled per bar.
const RIBBON = ["#4FD1A5", "#B084F5", "#7C9CFF"];
// Fixed illustrative ribbon: [heightPct, opacity] grouped into "days", quiet at
// first then building — matches the mock's "quiet days grey, busy days colour
// up" shape. Real per-hour data would replace this.
const RIBBON_DAYS: Array<Array<[number, number]>> = [
  [[6, 0], [17, 0], [7, 0], [13, 0], [11, 0], [12, 0], [14, 0], [8, 0]],
  [[17, 0], [21, 0], [29, 0], [27, 0], [14, 0], [30, 0], [26, 0], [19, 0]],
  [[31, 0.7], [36, 0.7], [28, 0.7], [42, 0.7], [57, 0.7], [55, 0.7], [38, 0.7], [49, 0.7]],
  [[59, 0.85], [77, 0.85], [52, 0.85], [39, 0.85], [64, 0.85], [69, 0.85], [43, 0.85], [55, 0.85]],
  [[44, 1], [42, 1], [55, 1], [43, 1], [88, 1], [71, 1], [61, 1], [92, 1]],
];

function Avatar({ email, size = 24, ring = true }: { email: string; size?: number; ring?: boolean }) {
  const bg = colorForUser(email);
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold shrink-0"
      style={{
        width: size,
        height: size,
        background: bg,
        color: textColorForBackground(bg),
        fontSize: size * 0.42,
        border: ring ? `2px solid ${C.bandBg}` : undefined,
      }}
      title={displayNameForUser(email)}
    >
      {initialsForUser(displayNameForUser(email))}
    </div>
  );
}

function assigneeFor(chat: ChatRow, claimant: string | null): string | null {
  return claimant ?? chat.handed_off_to ?? null;
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: C.cardBg,
        border: `1px solid ${C.cardBorder}`,
        borderRadius: 12,
        padding: "20px 21px",
        display: "flex",
        flexDirection: "column",
        gap: 13,
      }}
    >
      {children}
    </div>
  );
}

function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 13 13" fill="none" style={{ flex: "none" }}>
      <path d="M2.8 6.8l2.6 2.6L10.4 4" stroke="var(--merged)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
  const claimantByChat = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const c of active) map.set(c.id, computeClaimant(c.id, selfOccupant, otherOccupants));
    return map;
  }, [active, selfOccupant, otherOccupants]);

  const name = selfEmail ? displayNameForUser(selfEmail) : "there";

  const teammates = useMemo(() => {
    const others = profiles.map((p) => p.email).filter((e) => e !== selfEmail);
    if (others.length) return others;
    return otherOccupants.map((o) => o.email);
  }, [profiles, otherOccupants, selfEmail]);

  const myTasks = useMemo(
    () => active.filter((c) => assigneeFor(c, claimantByChat.get(c.id) ?? null) === selfEmail),
    [active, claimantByChat, selfEmail]
  );

  const recentChats = useMemo(
    () =>
      [...active]
        .sort((a, b) => (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at))
        .slice(0, 4),
    [active]
  );

  const finished = useMemo(
    () =>
      logbookEntries
        .filter((e) => !selfEmail || (e.kind === "handoff" ? e.handed_off_to === selfEmail : e.user_email === selfEmail))
        .slice(0, 4),
    [logbookEntries, selfEmail]
  );

  const lastActivity = useMemo(() => {
    const times = active.map((c) => c.last_message_at).filter(Boolean) as string[];
    if (!times.length) return null;
    const sorted = times.sort();
    return sorted[sorted.length - 1] ?? null;
  }, [active]);

  const waitingOnYou = mentionInbox.length + myTasks.length;
  const changesLive = logbookEntries.length;
  const activeCount = active.length;
  const caughtUp = waitingOnYou === 0;

  const headline = caughtUp
    ? "You're all caught up."
    : `${waitingOnYou} ${waitingOnYou === 1 ? "thing needs" : "things need"} you.`;

  return (
    <div className="flex-1 min-w-0 min-h-0 overflow-auto flex flex-col" style={{ fontFamily: "'Instrument Sans', system-ui, sans-serif", padding: 12 }}>
      <div className="flex-1 flex flex-col" style={{ width: "100%" }}>
        <div
          className="flex-1"
          style={{
            background: "var(--cw-surface)",
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            overflow: "hidden",
            boxShadow: "0 24px 60px -20px rgba(0,0,0,0.25)",
          }}
        >
          {/* ── return band ── */}
          <div style={{ position: "relative", padding: "34px 32px 26px", borderBottom: `1px solid ${C.seam}`, background: C.bandBg, overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg,#2B2F39 0%,#3C5C93 46%,#7C9CFF 72%,#B084F5 100%)" }} />

            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 48, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 620 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: C.micro }}>
                  Welcome back, {name}
                </div>
                <div style={{ fontSize: 48, fontWeight: 600, color: C.ink, letterSpacing: "-0.025em", lineHeight: 1.05 }}>{headline}</div>
                <div style={{ fontSize: 15, lineHeight: 1.6, color: C.sub }}>
                  {(teammates.length > 0 ? teammates.map(displayNameForUser).join(" and ") : "Your team") + " "}
                  {caughtUp
                    ? "have been busy — nothing is blocked on you right now."
                    : `left ${mentionInbox.length} note${mentionInbox.length === 1 ? "" : "s"} and ${myTasks.length} task${myTasks.length === 1 ? "" : "s"} for you across ${activeCount} chat${activeCount === 1 ? "" : "s"}.`}
                </div>
              </div>

              <div style={{ flex: "none", display: "flex", gap: 34, paddingTop: 6 }}>
                <Figure value={waitingOnYou} label="waiting on you" color={C.blueInk} labelColor={C.blueSub} />
                <div style={{ width: 1, background: C.seam }} />
                <Figure value={changesLive} label="updates logged" color={C.green} labelColor={C.faint} />
                <div style={{ width: 1, background: C.seam }} />
                <Figure value={activeCount} label="active chats" color={C.ink} labelColor={C.faint} />
              </div>
            </div>

            {/* activity ribbon (illustrative) */}
            <div style={{ marginTop: 30, display: "flex", flexDirection: "column", gap: 9 }}>
              <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 2, height: 78 }}>
                {RIBBON_DAYS.map((day, di) => (
                  <div key={di} style={{ display: "flex", alignItems: "flex-end", gap: 2, flex: `${day.length} 1 0`, minWidth: 0, marginRight: di < RIBBON_DAYS.length - 1 ? 10 : 0 }}>
                    {day.map(([h, op], bi) => (
                      <div
                        key={bi}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          height: `${h}%`,
                          borderRadius: 2,
                          background: op === 0 ? "var(--cw-border-strong)" : RIBBON[(di * 8 + bi) % RIBBON.length],
                          opacity: op === 0 ? 0.9 : op,
                        }}
                      />
                    ))}
                  </div>
                ))}
                <div style={{ position: "absolute", top: -6, bottom: -6, right: -1, width: 1, background: C.bar }} />
              </div>
              <div style={{ height: 1, background: C.seam }} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 4 }}>
                <div style={{ fontSize: 11.5, color: C.fainter }}>Activity since your last visit</div>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <Legend color="#7C9CFF" label="prompts" />
                  <Legend color="#4FD1A5" label="published" />
                  <Legend color="#B084F5" label="comments" />
                </div>
                <div style={{ fontSize: 11.5, color: C.blueSub, fontWeight: 600 }}>
                  {lastActivity ? `Last activity ${formatRelativeTime(lastActivity)}` : "No activity yet"}
                </div>
              </div>
            </div>
          </div>

          {/* ── body: tiles + needs-you ── */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 380px" }}>
            {/* tile mosaic */}
            <div style={{ padding: 20, display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 14, alignContent: "start" }}>
              {/* who's here */}
              <Card>
                <TileHead title="Who's here" meta={`${teammates.length + 1} on the project`} />
                <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                  {[selfEmail, ...teammates].filter(Boolean).slice(0, 5).map((email) => (
                    <div key={email!} style={{ display: "flex", alignItems: "center", gap: 11 }}>
                      <Avatar email={email!} size={22} ring={false} />
                      <div style={{ flex: 1, fontSize: 12.5, color: C.inkDim }}>
                        {displayNameForUser(email!)}
                        {email === selfEmail ? " (you)" : ""}
                      </div>
                      <div style={{ fontSize: 11.5, color: onlineEmails.has(email!) ? C.green : C.fainter }}>
                        {onlineEmails.has(email!) ? "online" : "away"}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* your tasks */}
              <Card>
                <TileHead title="Your tasks" meta={`${myTasks.length} assigned to you`} />
                {myTasks.length === 0 ? (
                  <Empty text="Nothing assigned to you right now." />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {myTasks.slice(0, 4).map((c) => (
                      <Row key={c.id} onClick={() => onJumpToChat(c.id)}>
                        <div style={{ flex: "none", width: 14, height: 14, borderRadius: 4, border: "1.5px solid var(--cw-border-strong)" }} />
                        <div style={{ flex: 1, fontSize: 12.5, color: C.inkDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title ?? "Untitled chat"}</div>
                        <div style={{ flex: "none", fontSize: 11.5, color: C.fainter }}>open</div>
                      </Row>
                    ))}
                  </div>
                )}
              </Card>

              {/* agent windows / recent chats */}
              <Card>
                <TileHead title="Agent windows" meta={`${active.length} open`} />
                {recentChats.length === 0 ? (
                  <Empty text="No chats yet — start one in Cowork or Solo." />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {recentChats.map((c) => {
                      const who = assigneeFor(c, claimantByChat.get(c.id) ?? null);
                      return (
                        <Row key={c.id} onClick={() => onJumpToChat(c.id)}>
                          <div style={{ flex: "none", width: 18, height: 18, borderRadius: 5, background: "linear-gradient(140deg,#7C9CFF,#B084F5)" }} />
                          <div style={{ flex: 1, fontSize: 12.5, color: C.inkDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title ?? "Untitled chat"}</div>
                          <div style={{ flex: "none", fontSize: 11.5, color: C.fainter }}>{who ? displayNameForUser(who) : "—"}</div>
                        </Row>
                      );
                    })}
                  </div>
                )}
              </Card>

              {/* recently finished */}
              <Card>
                <TileHead title="Recently finished" meta={`${finished.length} update${finished.length === 1 ? "" : "s"}`} />
                {finished.length === 0 ? (
                  <Empty text="Nothing logged yet." />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {finished.map((e) => (
                      <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <Check />
                        <div style={{ flex: 1, fontSize: 12.5, color: C.sub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.summary}</div>
                        <div style={{ flex: "none", fontSize: 11.5, color: C.fainter }}>{e.user_email ? displayNameForUser(e.user_email) : ""}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {/* needs-you column */}
            <div style={{ background: C.bandBg, borderLeft: `1px solid ${C.seam}`, padding: "22px 22px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                <div style={{ fontSize: 15.5, fontWeight: 600, color: C.ink }}>Needs you</div>
                <div style={{ fontSize: 12.5, color: C.faint }}>{waitingOnYou} thing{waitingOnYou === 1 ? "" : "s"}</div>
              </div>

              {caughtUp && <Empty text="You're all caught up — nothing is waiting on your OK." />}

              {myTasks.slice(0, 3).map((c) => (
                <div key={c.id} style={{ background: C.needBg, border: `1px solid ${C.blueBorder}`, borderRadius: 11, padding: "14px 15px", display: "flex", flexDirection: "column", gap: 9 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: C.blueInk }}>{c.title ?? "Untitled chat"}</div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.55, color: C.blueSub }}>Assigned to you — pick it up when you're ready.</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <button
                      type="button"
                      onClick={() => onJumpToChat(c.id)}
                      style={{ border: `1px solid ${C.blueBorder}`, cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: C.blueInk, background: C.blueBg, padding: "8px 13px", borderRadius: 8 }}
                    >
                      Open chat
                    </button>
                  </div>
                </div>
              ))}

              {mentionInbox.length > 0 && myTasks.length > 0 && <div style={{ height: 1, background: C.seam }} />}

              {mentionInbox.slice(0, 4).map((m) => (
                <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <Avatar email={m.fromEmail} size={20} ring={false} />
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink }}>{displayNameForUser(m.fromEmail)} mentioned you</div>
                  </div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.55, color: C.sub }}>in {m.chatTitle ?? "a chat"}</div>
                  <button
                    type="button"
                    onClick={() => onJumpToChat(m.chatId)}
                    style={{ alignSelf: "flex-start", border: "none", background: "transparent", cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: C.reply, padding: 0 }}
                  >
                    Reply
                  </button>
                </div>
              ))}

              <div style={{ flex: 1 }} />
              {(mentionInbox.length > 0 || myTasks.length > 0) && (
                <button
                  type="button"
                  onClick={onClearMentions}
                  style={{ alignSelf: "flex-start", border: "none", background: "transparent", cursor: "pointer", fontSize: 12.5, color: C.faint, padding: 0 }}
                >
                  Mark everything as seen
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Figure({ value, label, color, labelColor }: { value: number; label: string; color: string; labelColor: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ fontSize: 38, fontWeight: 600, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12.5, color: labelColor, maxWidth: 96, lineHeight: 1.4 }}>{label}</div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      <div style={{ fontSize: 11.5, color: C.faint }}>{label}</div>
    </div>
  );
}

function TileHead({ title, meta }: { title: string; meta: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: C.inkDim }}>{title}</div>
      <div style={{ fontSize: 12, color: C.faint }}>{meta}</div>
    </div>
  );
}

function Row({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 10, cursor: onClick ? "pointer" : "default" }}>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ fontSize: 12.5, lineHeight: 1.6, color: C.fainter }}>{text}</div>;
}
