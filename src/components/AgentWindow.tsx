import { useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChatRow } from "../types/chat";
import type { ChatState } from "../lib/chatStore";
import type { SentAttachment } from "../types/message";
import { useSelf, useOthers, useUpdateMyPresence } from "../lib/liveblocks";
import { colorForUser } from "../lib/presenceColor";
import { insertMergeEvent } from "../lib/mergeEvents";
import { MessageList } from "./MessageList";
import type { AssignableTeammate } from "./AssignChatMenu";

// ── Design 3a — "Agent window prototype / collapsed rails" ──────────────────
// Ported from the Claude Design project "Multiplayer AI Chat Component"
// (Agent Window Prototype.dc.html, view 3a) and wired to real Vibeco2 data:
//   • head avatars + ready-check   → real Liveblocks room occupants + the
//                                    `readyForChatId` presence field
//   • prompt → Nova replies        → the real Claude send/stream loop (onSend +
//                                    ChatState.messages, rendered via MessageList)
//   • shelf → publish              → real `render_preview` / `promote_to_main`
// The design's palette is kept verbatim (inline styles) so it reads exactly as
// designed rather than being re-derived from the app's Tailwind tokens.
//
// Not yet wired (documented follow-ups): a *shared* multiplayer prompt draft
// with live carets (the draft here is local per-user), and cross-user shelf
// agreement sync (agreements below are local — the shelve/publish *actions*
// hit the real backend, but who-agreed isn't broadcast over Liveblocks yet).

const C = {
  panel: "#181A1F",
  border: "#2B2D36",
  seam: "#23262E",
  railBg: "#15171B",
  ink: "#EDEDF0",
  inkDim: "#DCDDE3",
  sub: "#8A8C99",
  faint: "#787A88",
  fainter: "#5F6270",
  blueInk: "#DCE5FF",
  blueBg: "#25406B",
  blueBorder: "#35578C",
  idleBg: "#242730",
  idleBorder: "#333743",
  ready: "#4FD1A5",
  amber: "#E9C979",
  mint: "#7FDCBB",
};

function initialsFor(email: string): string {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[.\-_+]/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : local.slice(0, 2);
  return letters.toUpperCase();
}

function inkForBg(hex: string): string {
  // Rough luminance check so initials stay legible on their avatar color.
  const n = hex.replace("#", "");
  const r = parseInt(n.slice(0, 2), 16),
    g = parseInt(n.slice(2, 4), 16),
    b = parseInt(n.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#12141A" : "#EDEDF0";
}

interface ShelfItem {
  id: string;
  title: string;
  summary: string;
  approvers: string[]; // who contributed a message to this chat — must agree before publish
  agreed: string[]; // emails (local-only for now)
  status: string;
}

export function AgentWindow({
  chatId,
  chat,
  state,
  streaming,
  onSend,
  onStop,
  teammates = [],
}: {
  chatId: string;
  chat: ChatRow;
  state: ChatState | undefined;
  streaming: boolean;
  onSend: (prompt: string, attachments?: SentAttachment[]) => void;
  onStop: () => void;
  teammates?: AssignableTeammate[];
}) {
  const self = useSelf();
  const others = useOthers();
  const updateMyPresence = useUpdateMyPresence();

  const myEmail = self?.presence.email ?? "you";
  const iAmReady = self?.presence.readyForChatId === chatId;

  // Everyone in the project room is a collaborator on this prompt. Readiness
  // is real presence: readyForChatId === this chat. `forced` lets you push an
  // unresponsive teammate through locally (design's "force Sam").
  const [forced, setForced] = useState<Record<string, boolean>>({});
  const occupants = useMemo(() => {
    const seen = new Set<string>();
    const list: { email: string; ready: boolean; isMe: boolean }[] = [];
    const push = (email: string, readyFor: string | null | undefined, isMe: boolean) => {
      if (seen.has(email)) return;
      seen.add(email);
      list.push({ email, ready: readyFor === chatId, isMe });
    };
    if (self) push(myEmail, self.presence.readyForChatId, true);
    others.forEach((o) => push(o.presence.email, o.presence.readyForChatId, false));
    return list;
  }, [self, others, myEmail, chatId]);

  const total = occupants.length;
  const readyCount = occupants.filter((o) => o.ready || forced[o.email]).length;
  const allReady = total > 0 && readyCount === total;

  const editorRef = useRef<HTMLDivElement>(null);
  const [draftLen, setDraftLen] = useState(0);

  function toggleMe() {
    updateMyPresence({ readyForChatId: iAmReady ? null : chatId });
  }
  function forceUser(email: string) {
    setForced((f) => ({ ...f, [email]: true }));
  }

  function send() {
    if (!allReady || streaming) return;
    const el = editorRef.current;
    const text = el ? el.innerText.replace(/\s+/g, " ").trim() : "";
    if (!text) return;
    onSend(text);
    if (el) el.innerHTML = "";
    setDraftLen(0);
    setForced({});
    // Reset own readiness for the next turn; teammates reset their own.
    updateMyPresence({ readyForChatId: null });
  }

  // ── Shelf (local queue; actions hit the real backend) ──────────────────────
  const [shelf, setShelf] = useState<ShelfItem[]>([]);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [shelving, setShelving] = useState(false);

  const lastReply = useMemo(
    () => [...(state?.messages ?? [])].reverse().find((m) => m.role === "assistant"),
    [state?.messages]
  );
  const canShelve = !!lastReply && !streaming;

  // Approval list = whoever actually contributed a message to this chat, not
  // whoever happens to be present in the tab right now — a chat someone
  // stepped away from still needs their sign-off, and someone just watching
  // shouldn't be counted as a required approver.
  const contributors = useMemo(() => {
    const emails = new Set<string>();
    for (const m of state?.messages ?? []) {
      if (m.role === "user" && m.authorEmail) emails.add(m.authorEmail);
    }
    return Array.from(emails);
  }, [state?.messages]);

  async function shelve() {
    if (!canShelve || shelving) return;
    setShelving(true);
    try {
      const result = await invoke<{ status: "Clean" } | { status: "Conflict"; files: string[] }>(
        "render_preview",
        { chatId }
      );
      const approvers = contributors.length ? contributors : [myEmail];
      if (result.status === "Clean") {
        await insertMergeEvent(chatId, "held", null);
        setShelf((s) => [
          ...s,
          {
            id: `s-${Date.now()}`,
            title: chat.title ?? "Untitled change",
            summary: "Nova's latest change from this chat, rendered into the team preview.",
            approvers,
            agreed: [myEmail],
            status: "held",
          },
        ]);
        setShelfOpen(true);
      } else {
        await insertMergeEvent(chatId, "conflict", result.files.join(", "));
        setShelf((s) => [
          ...s,
          {
            id: `s-${Date.now()}`,
            title: chat.title ?? "Untitled change",
            summary: `Conflicts with the team branch in: ${result.files.join(", ")}`,
            approvers,
            agreed: [],
            status: "conflict",
          },
        ]);
        setShelfOpen(true);
      }
    } catch (err) {
      console.error("render_preview failed", err);
    } finally {
      setShelving(false);
    }
  }

  function toggleAgree(id: string) {
    setShelf((s) =>
      s.map((it) =>
        it.id !== id
          ? it
          : {
              ...it,
              agreed: it.agreed.includes(myEmail)
                ? it.agreed.filter((a) => a !== myEmail)
                : [...it.agreed, myEmail],
            }
      )
    );
  }

  const publishable = shelf.filter(
    (it) => it.status !== "conflict" && it.agreed.length >= it.approvers.length && it.approvers.length > 0
  );
  const [publishing, setPublishing] = useState(false);
  async function publish() {
    if (!publishable.length || publishing) return;
    setPublishing(true);
    try {
      await invoke("promote_to_main");
      await insertMergeEvent(null, "merged", "promoted team → main");
      const ids = new Set(publishable.map((it) => it.id));
      setShelf((s) => s.filter((it) => !ids.has(it.id)));
    } catch (err) {
      console.error("promote_to_main failed", err);
    } finally {
      setPublishing(false);
    }
  }

  // ── Render values ──────────────────────────────────────────────────────────
  const anyUnready = occupants.some((o) => !o.ready && !forced[o.email] && !o.isMe);
  const typingLabel = streaming ? "Nova is working…" : `${total} here`;
  const readyShort = `${readyCount}/${total} ready`;
  const sendShort = streaming ? "Working…" : allReady ? "Send to Nova" : `Send · ${total - readyCount} left`;

  const avatar = (email: string, size: number, ring?: string, dim?: number, onClick?: () => void) => {
    const bg = colorForUser(email);
    return (
      <div
        key={email}
        onClick={onClick}
        title={email}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: size < 24 ? 9 : 9.5,
          fontWeight: 700,
          background: bg,
          color: inkForBg(bg),
          boxShadow: ring,
          opacity: dim ?? 1,
          cursor: onClick ? "pointer" : "default",
          flex: "none",
        }}
      >
        {initialsFor(email)}
      </div>
    );
  };

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "auto",
        fontFamily: "'Instrument Sans', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          // Matches ChatPane's own card treatment (bg-chat-pane-bg/border-
          // border/rounded-xl) instead of the design's own hardcoded dark
          // palette — the 12px "margin" around this card is really just
          // .chat-panes' own padding/gap, same as ChatPane gets, now that
          // this wrapper no longer adds its own 18/20px on top of that.
          background: "var(--chat-pane-bg)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 24px 60px -20px rgba(0,0,0,0.7)",
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 520,
        }}
      >
        {/* header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "11px 16px",
            borderBottom: `1px solid ${C.seam}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div style={{ width: 20, height: 20, borderRadius: 6, background: "linear-gradient(140deg,#7C9CFF,#B084F5)" }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>Nova</div>
            <div style={{ fontSize: 12, color: C.faint }}>Frontend engineer</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 11.5, color: C.faint }}>{typingLabel}</div>
          </div>
        </div>

        {/* body grid: prompt | replies | rail */}
        <div style={{ position: "relative", display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,360px) 56px", flex: 1, minHeight: 0 }}>
          {/* prompt + ready-check footer */}
          <div style={{ display: "flex", flexDirection: "column", borderRight: `1px solid ${C.seam}`, minHeight: 0 }}>
            <div style={{ position: "relative", flex: 1, minHeight: 0, overflow: "auto" }}>
              <div
                ref={editorRef}
                contentEditable={!streaming}
                suppressContentEditableWarning
                spellCheck={false}
                onInput={() => setDraftLen(editorRef.current?.innerText.trim().length ?? 0)}
                style={{
                  minHeight: "100%",
                  padding: "28px 30px",
                  fontSize: 15.5,
                  lineHeight: 2.2,
                  color: C.inkDim,
                  outline: "none",
                  cursor: "text",
                }}
              />
              {draftLen === 0 && (
                <div style={{ position: "absolute", top: 28, left: 30, fontSize: 15.5, lineHeight: 2.2, color: C.fainter, pointerEvents: "none" }}>
                  Describe the change for Nova… everyone marks ready, then send.
                </div>
              )}
            </div>
            <div
              style={{
                borderTop: `1px solid ${C.seam}`,
                padding: "12px 18px",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "10px 14px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", flex: "none" }}>
                {occupants.map((o) => {
                  const on = o.ready || forced[o.email];
                  return (
                    <div key={o.email} style={{ marginRight: 4 }}>
                      {avatar(
                        o.email,
                        25,
                        on ? `0 0 0 2px ${C.ready}` : "0 0 0 1px #454956",
                        on ? 1 : 0.55,
                        o.isMe ? toggleMe : undefined
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ flex: "none", fontSize: 13, color: "#9698A4", whiteSpace: "nowrap" }}>{readyShort}</div>
              {anyUnready &&
                occupants
                  .filter((o) => !o.ready && !forced[o.email] && !o.isMe)
                  .slice(0, 1)
                  .map((o) => (
                    <div
                      key={o.email}
                      onClick={() => forceUser(o.email)}
                      style={{ flex: "none", fontSize: 12.5, fontWeight: 600, color: C.amber, cursor: "pointer", whiteSpace: "nowrap" }}
                    >
                      force {initialsFor(o.email)}
                    </div>
                  ))}
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 9, flex: "none" }}>
                {streaming && (
                  <div
                    onClick={onStop}
                    style={{ fontSize: 12.5, fontWeight: 600, padding: "8px 12px", borderRadius: 8, cursor: "pointer", color: C.sub, background: C.idleBg, border: `1px solid ${C.idleBorder}` }}
                  >
                    Stop
                  </div>
                )}
                <div
                  onClick={toggleMe}
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    padding: "8px 12px",
                    borderRadius: 8,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    color: iAmReady ? C.mint : C.inkDim,
                    background: iAmReady ? "#18291F" : "#2A2D37",
                    border: `1px solid ${iAmReady ? "#2A4634" : "#383C48"}`,
                  }}
                >
                  {iAmReady ? "You're ready ✓" : "I'm ready"}
                </div>
                <div
                  onClick={send}
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    padding: "9px 14px",
                    borderRadius: 8,
                    cursor: allReady && !streaming ? "pointer" : "default",
                    whiteSpace: "nowrap",
                    color: allReady && !streaming ? C.blueInk : C.faint,
                    background: allReady && !streaming ? C.blueBg : C.idleBg,
                    border: `1px solid ${allReady && !streaming ? C.blueBorder : C.idleBorder}`,
                  }}
                >
                  {sendShort}
                </div>
              </div>
            </div>
          </div>

          {/* replies (real Claude feed) */}
          <div style={{ display: "flex", flexDirection: "column", borderRight: `1px solid ${C.seam}`, minHeight: 0 }}>
            <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.seam}`, fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: C.sub, display: "flex", justifyContent: "space-between" }}>
              <span>Nova</span>
              {canShelve && (
                <span onClick={shelve} style={{ cursor: shelving ? "default" : "pointer", color: shelving ? C.faint : "#A8C0FF", textTransform: "none", letterSpacing: 0, fontWeight: 600 }}>
                  {shelving ? "Rendering…" : "Put on the shelf"}
                </span>
              )}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "6px 4px" }}>
              {(state?.messages?.length ?? 0) === 0 && !streaming ? (
                <div style={{ padding: "20px 18px", fontSize: 13, lineHeight: 1.7, color: C.fainter }}>
                  Nova's replies land here once everyone's ready and the prompt is sent.
                </div>
              ) : (
                <MessageList messages={state?.messages ?? []} streaming={streaming} teammates={teammates} />
              )}
            </div>
          </div>

          {/* shelf rail */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "14px 0 16px", gap: 12, background: C.railBg }}>
            <div
              onClick={() => setShelfOpen((v) => !v)}
              style={{ position: "relative", width: 32, height: 32, borderRadius: 8, background: "#22252C", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path d="M2.5 5.5h11v7h-11v-7zM2.5 5.5L4 3h8l1.5 2.5" stroke="#B7C4E8" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
              {shelf.length > 0 && (
                <div style={{ position: "absolute", top: -5, right: -5, minWidth: 16, height: 16, borderRadius: 8, background: "#7C9CFF", color: "#0D0E11", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>
                  {shelf.length}
                </div>
              )}
            </div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: C.fainter, writingMode: "vertical-rl", transform: "rotate(180deg)" }}>SHELF</div>
            {shelf.map((it) => (
              <div key={it.id} style={{ width: 8, height: 8, borderRadius: "50%", background: it.status === "conflict" ? "#E2584F" : it.agreed.length >= it.approvers.length ? C.ready : C.amber }} />
            ))}
            <div style={{ flex: 1 }} />
          </div>

          {/* sliding shelf panel */}
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              right: 56,
              width: 392,
              background: "#171A21",
              borderLeft: `1px solid #2E323C`,
              boxShadow: "-18px 0 40px -12px rgba(0,0,0,0.65)",
              display: "flex",
              flexDirection: "column",
              transform: shelfOpen ? "translateX(0)" : "translateX(105%)",
              opacity: shelfOpen ? 1 : 0,
              pointerEvents: shelfOpen ? "auto" : "none",
              transition: "transform 340ms cubic-bezier(0.22,0.72,0.2,1), opacity 240ms ease",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", borderBottom: `1px solid ${C.seam}` }}>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: C.sub }}>Shelf</div>
              <div style={{ fontSize: 12, color: C.faint, whiteSpace: "nowrap" }}>
                {shelf.length} {shelf.length === 1 ? "change waiting" : "changes waiting"}
              </div>
              <div onClick={() => setShelfOpen(false)} style={{ marginLeft: "auto", width: 24, height: 24, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.faint }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M9.5 2.5L4 7l5.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
            <div style={{ flex: 1, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 18, overflow: "auto" }}>
              {shelf.length === 0 ? (
                <div style={{ fontSize: 12.5, lineHeight: 1.6, color: C.fainter }}>
                  Nothing waiting. Put one of Nova's changes on the shelf and it will queue here.
                </div>
              ) : (
                shelf.map((it) => {
                  const full = it.agreed.length >= it.approvers.length && it.approvers.length > 0;
                  const mine = it.agreed.includes(myEmail);
                  return (
                    <div key={it.id} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink }}>{it.title}</div>
                      <div style={{ fontSize: 12.5, lineHeight: 1.55, color: C.sub }}>{it.summary}</div>
                      <div style={{ fontSize: 11.5, color: it.status === "conflict" ? "#E2584F" : full ? C.mint : C.amber }}>
                        {it.status === "conflict"
                          ? "Conflict · resolve before publishing"
                          : full
                            ? "Everyone agreed · ready to publish"
                            : `${it.agreed.length} of ${it.approvers.length} agreed`}
                      </div>
                      {it.status !== "conflict" && !full && (
                        <div
                          onClick={() => toggleAgree(it.id)}
                          style={{
                            alignSelf: "flex-start",
                            fontSize: 12.5,
                            fontWeight: 600,
                            padding: "8px 13px",
                            borderRadius: 8,
                            cursor: "pointer",
                            color: mine ? "#9698A4" : C.blueInk,
                            background: mine ? "#1B1E24" : C.blueBg,
                            border: `1px solid ${mine ? "#2E323C" : C.blueBorder}`,
                          }}
                        >
                          {mine ? "You agreed" : "Agree"}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            <div style={{ borderTop: `1px solid ${C.seam}`, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 9 }}>
              <div
                onClick={publish}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  padding: 11,
                  borderRadius: 9,
                  cursor: publishable.length && !publishing ? "pointer" : "default",
                  color: publishable.length ? C.blueInk : C.fainter,
                  background: publishable.length ? C.blueBg : C.idleBg,
                  border: `1px solid ${publishable.length ? C.blueBorder : C.idleBorder}`,
                }}
              >
                {publishing ? "Publishing…" : publishable.length ? `Publish ${publishable.length} of ${shelf.length}` : "Nothing to publish"}
              </div>
              <div style={{ fontSize: 11.5, lineHeight: 1.5, color: C.fainter }}>
                Publishing merges everything agreed into the team's main branch at once, so nobody's files clash.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
