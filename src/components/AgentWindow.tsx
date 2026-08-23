import { useMemo, useRef, useState } from "react";
import type { ChatState } from "../lib/chatStore";
import type { SentAttachment } from "../types/message";
import { useSelf, useOthers, useUpdateMyPresence } from "../lib/liveblocks";
import { colorForUser } from "../lib/presenceColor";
import { defaultSplitPaneWidth } from "../lib/layout";
import { MessageList } from "./MessageList";
import { PaneResizeHandle } from "./PaneResizeHandle";
import type { AssignableTeammate } from "./AssignChatMenu";

// ── Design 3a — "Agent window prototype / collapsed rails" ──────────────────
// Ported from the Claude Design project "Multiplayer AI Chat Component"
// (Agent Window Prototype.dc.html, view 3a) and wired to real Vibeco2 data:
//   • head avatars + ready-check   → real Liveblocks room occupants + the
//                                    `readyForChatId` presence field
//   • prompt → Nova replies        → the real Claude send/stream loop (onSend +
//                                    ChatState.messages, rendered via MessageList)
// The design's palette is kept verbatim (inline styles) so it reads exactly as
// designed rather than being re-derived from the app's Tailwind tokens.
//
// The shelf/publish gate lives in ShelfPanel.tsx now — a full-height bar
// pinned to the right of the screen (App.tsx), separate from this component,
// since it's a property of the chat rather than of either pane here.
//
// Not yet wired (documented follow-up): a *shared* multiplayer prompt draft
// with live carets (the draft here is local per-user).

const C = {
  seam: "#23262E",
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

export function AgentWindow({
  chatId,
  state,
  streaming,
  onSend,
  onStop,
  teammates = [],
  canShelve,
  shelving,
  onShelve,
}: {
  chatId: string;
  state: ChatState | undefined;
  streaming: boolean;
  onSend: (prompt: string, attachments?: SentAttachment[]) => void;
  onStop: () => void;
  teammates?: AssignableTeammate[];
  canShelve: boolean;
  shelving: boolean;
  onShelve: () => void;
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

  // Left/right pane split, same resizable-divider pattern the app's
  // (now-retired) multi-chat split view used.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [paneWidth, setPaneWidth] = useState<number | null>(null);

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

  // ── Render values ──────────────────────────────────────────────────────────
  const anyUnready = occupants.some((o) => !o.ready && !forced[o.email] && !o.isMe);
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
    // Literally the app's own split-tab system (two `.chat-pane` cards in a
    // 12px-gap flex row, real resize handle in the gap) — co-chat area on
    // the left, LLM response area on the right — rather than a bespoke
    // single-card layout, so Team mode matches Solo's split view exactly.
    <div ref={bodyRef} style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", gap: 12, fontFamily: "'Instrument Sans', system-ui, sans-serif" }}>
      {/* left: co-chat area (group prompt + ready-check).
          Before a drag, the split is plain flexbox 50/50 (flex: 1 1 0%,
          matching the right pane's own flex-1) rather than a JS-measured
          pixel width — the measured version read `bodyRef.current` as null
          on the very first render (ref isn't attached until after paint),
          fell back to a fixed guess, then visibly snapped to the real 50%
          on whatever state change re-rendered next. CSS handles the even
          split instantly with no measurement and no jump. */}
      <div
        className="relative flex flex-col"
        style={{ flex: paneWidth != null ? `0 0 ${paneWidth}px` : "1 1 0%", minHeight: 0 }}
      >
        <div className="chat-pane flex-1 min-w-0 min-h-0 flex flex-col bg-chat-pane-bg border border-border rounded-xl overflow-hidden">
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
        <PaneResizeHandle
          width={paneWidth ?? defaultSplitPaneWidth(bodyRef.current)}
          onChange={setPaneWidth}
          onReset={() => setPaneWidth(null)}
          min={280}
          max={Math.max(280, (bodyRef.current?.clientWidth ?? 2000) - 280 - 12)}
        />
      </div>

      {/* right: LLM response area */}
      <div className="min-w-0 min-h-0 flex flex-col flex-1">
        <div className="chat-pane flex-1 min-w-0 min-h-0 flex flex-col bg-chat-pane-bg border border-border rounded-xl overflow-hidden">
          <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.seam}`, fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: C.sub }}>
            Nova
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "6px 4px" }}>
            {(state?.messages?.length ?? 0) === 0 && !streaming ? (
              <div style={{ padding: "20px 18px", fontSize: 13, lineHeight: 1.7, color: C.fainter }}>
                Nova's replies land here once everyone's ready and the prompt is sent.
              </div>
            ) : (
              <MessageList chatId={chatId} messages={state?.messages ?? []} streaming={streaming} teammates={teammates} />
            )}
          </div>
          {canShelve && (
            <div style={{ borderTop: `1px solid ${C.seam}`, padding: "12px 18px" }}>
              <div
                onClick={onShelve}
                style={{
                  padding: "9px 12px",
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontWeight: 600,
                  textAlign: "center",
                  cursor: shelving ? "default" : "pointer",
                  color: shelving ? C.faint : "#A8C0FF",
                  background: C.idleBg,
                  border: `1px solid ${C.idleBorder}`,
                }}
              >
                {shelving ? "Rendering…" : "Add latest reply to shelf"}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
