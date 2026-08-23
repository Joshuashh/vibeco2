import { useEffect, useRef, useState } from "react";

// Full-height bar pinned to the right of the workspace — same pattern as the
// Sidebar on the left (flush, no card chrome, collapses to an icon strip
// rather than disappearing). Shared by both Cowork and Solo: the queue is
// app-wide, not per-mode, so any chat's changes can land here regardless of
// which surface they were queued from. Each surface's own "Add to Queue"
// button lives in its header — this panel only shows what's already queued
// and drives merging into team.
//
// No per-item approval gate here (previously: everyone who contributed to
// a chat had to "agree" before that item could be merged). Merging now just
// pushes everything queued into `team`, unconditionally — review/approval
// before `team` -> `main` is a separate, not-yet-built step meant to live in
// the Preview tab instead (see decisions.md).

const C = {
  seam: "#23262E",
  ink: "#EDEDF0",
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

export interface ShelfItem {
  id: string;
  chatId: string;
  title: string;
  summary: string;
  status: "queued" | "conflict";
}

export function ShelfPanel({
  shelf,
  publishing,
  onPublish,
  onRemove,
}: {
  shelf: ShelfItem[];
  publishing: boolean;
  onPublish: () => void;
  onRemove: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(true);

  // Auto-expand whenever a new item lands, same as the old shelve() did —
  // tracked by count rather than owning the add itself, since adding now
  // happens from AgentWindow's reply pane instead of from this panel.
  const prevLength = useRef(shelf.length);
  useEffect(() => {
    if (shelf.length > prevLength.current) setCollapsed(false);
    prevLength.current = shelf.length;
  }, [shelf.length]);

  const publishable = shelf.filter((it) => it.status === "queued");

  if (collapsed) {
    return (
      <div
        style={{
          flex: "0 0 56px",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "14px 0 16px",
          gap: 12,
          background: "var(--bg-sidebar)",
          borderLeft: "1px solid var(--border)",
        }}
      >
        <div
          onClick={() => setCollapsed(false)}
          title="Queue — add changes here, then merge to team"
          style={{ position: "relative", width: 32, height: 32, borderRadius: 8, background: C.idleBg, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
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
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: C.fainter, writingMode: "vertical-rl", transform: "rotate(180deg)" }}>QUEUE</div>
        {shelf.map((it) => (
          <div key={it.id} style={{ width: 8, height: 8, borderRadius: "50%", background: it.status === "conflict" ? "#E2584F" : C.ready }} />
        ))}
        <div style={{ flex: 1 }} />
      </div>
    );
  }

  return (
    <div
      style={{
        flex: "0 0 340px",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-sidebar)",
        borderLeft: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", borderBottom: `1px solid ${C.seam}` }}>
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: C.sub }}>Merge queue</div>
        <div style={{ fontSize: 12, color: C.faint, whiteSpace: "nowrap" }}>
          {shelf.length} {shelf.length === 1 ? "change waiting" : "changes waiting"}
        </div>
        <div onClick={() => setCollapsed(true)} title="Collapse the queue" style={{ marginLeft: "auto", width: 24, height: 24, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.faint }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M4.5 2.5L10 7l-5.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      <div style={{ flex: 1, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 18, overflow: "auto" }}>
        {shelf.length === 0 ? (
          <div style={{ fontSize: 12.5, lineHeight: 1.6, color: C.fainter }}>
            Nothing waiting. Add a chat to the queue and it will show up here.
          </div>
        ) : (
          shelf.map((it) => (
            <div key={it.id} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink, flex: 1 }}>{it.title}</div>
                <div
                  onClick={() => onRemove(it.id)}
                  title="Remove from queue"
                  style={{ flex: "none", width: 20, height: 20, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.fainter }}
                >
                  <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                    <path d="M2.5 2.5l9 9M11.5 2.5l-9 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </div>
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.55, color: C.sub }}>{it.summary}</div>
              <div style={{ fontSize: 11.5, color: it.status === "conflict" ? "#E2584F" : C.mint }}>
                {it.status === "conflict" ? "Conflict · resolve before merging" : "Queued · ready to merge"}
              </div>
            </div>
          ))
        )}
      </div>
      <div style={{ borderTop: `1px solid ${C.seam}`, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 9 }}>
        <div
          onClick={onPublish}
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
          {publishing ? "Merging…" : publishable.length ? `Merge ${publishable.length} to Team` : "Nothing to merge"}
        </div>
        <div style={{ fontSize: 11.5, lineHeight: 1.5, color: C.fainter }}>
          Merges everything queued into the team branch, one at a time, so nobody's files clash.
        </div>
      </div>
    </div>
  );
}
