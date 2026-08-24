import { useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ChatState } from "../lib/chatStore";
import type { SentAttachment } from "../types/message";
import { useSelf, useOthers, useUpdateMyPresence } from "../lib/liveblocks";
import { colorForUser, displayNameForUser, initialsForUser } from "../lib/presenceColor";
import { defaultSplitPaneWidth } from "../lib/layout";
import { MessageList } from "./MessageList";
import { PaneResizeHandle } from "./PaneResizeHandle";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { BUILTIN_COMMANDS, useCustomSlashCommands, type SlashCommand } from "../lib/slashCommands";
import { ModelPicker, EffortPicker } from "./InputToolbelt";
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

// `all: unset` first — App.css's global `@layer base { button { padding:
// 0.6em 1em; border: 1px solid ...; } }` reset otherwise eats almost the
// entire 26px box (same reason .icon-button/.toolbar-icon-button use
// `all: unset` in App.css instead of overriding each property by hand).
const toolbarButtonStyle: CSSProperties = {
  all: "unset",
  color: C.sub,
  width: 26,
  height: 26,
  borderRadius: 6,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 13,
  cursor: "pointer",
  flex: "none",
  boxSizing: "border-box",
};
const toolbarDividerStyle: CSSProperties = {
  width: 1,
  height: 18,
  background: C.seam,
  margin: "0 4px",
  flex: "none",
};
// Reuses the same blue "this is selected/on" language the ready/agree
// buttons elsewhere in this file already use, rather than inventing a new
// active-state color just for the toolbar.
const activeToolbarButtonStyle: CSSProperties = {
  background: C.blueBg,
  color: C.blueInk,
};

// Built from <line>/<rect>/<circle> rather than hand-written <path> arcs —
// a malformed path silently renders nothing, and that's exactly what
// happened to the first version of these icons.
function OrderedListIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <line x1="9" y1="6" x2="21" y2="6" />
      <line x1="9" y1="12" x2="21" y2="12" />
      <line x1="9" y1="18" x2="21" y2="18" />
      <text x="2" y="8.5" fontSize="7" fill="currentColor" stroke="none">1</text>
      <text x="2" y="14.5" fontSize="7" fill="currentColor" stroke="none">2</text>
      <text x="2" y="20.5" fontSize="7" fill="currentColor" stroke="none">3</text>
    </svg>
  );
}
function BulletedListIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <line x1="9" y1="6" x2="21" y2="6" />
      <line x1="9" y1="12" x2="21" y2="12" />
      <line x1="9" y1="18" x2="21" y2="18" />
      <circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
function QuoteIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
      <line x1="5" y1="5" x2="5" y2="19" />
      <line x1="9" y1="8" x2="19" y2="8" />
      <line x1="9" y1="13" x2="16" y2="13" />
    </svg>
  );
}

// Only while the whole draft is still just "/word" (no space yet) — see
// InputBar.tsx's identical constant.
const SLASH_TOKEN = /^\/([a-zA-Z0-9_-]*)$/;

function initialsFor(email: string): string {
  return initialsForUser(displayNameForUser(email));
}

function nicknameOrLocalPart(email: string): string {
  const name = displayNameForUser(email);
  const raw = name === email ? email.split("@")[0] : name;
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Converts the execCommand-formatted contentEditable draft into markdown so
// the plain-text Claude side (and MessageBlock's react-markdown renderer)
// sees **bold**, *italic*, lists, links, and blockquotes rather than raw HTML.
function htmlToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as HTMLElement;
  const inner = Array.from(el.childNodes).map(htmlToMarkdown).join("");
  switch (el.tagName) {
    case "B":
    case "STRONG":
      return `**${inner}**`;
    case "I":
    case "EM":
      return `*${inner}*`;
    case "U":
      return `<u>${inner}</u>`;
    case "A":
      return `[${inner}](${el.getAttribute("href") ?? ""})`;
    case "BLOCKQUOTE":
      return `${inner
        .trim()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n`;
    case "UL":
      return `${Array.from(el.children)
        .map((li) => `- ${htmlToMarkdown(li)}`)
        .join("\n")}\n`;
    case "OL":
      return `${Array.from(el.children)
        .map((li, i) => `${i + 1}. ${htmlToMarkdown(li)}`)
        .join("\n")}\n`;
    case "LI":
      return inner;
    case "BR":
      return "\n";
    case "DIV":
    case "P":
      return `${inner}\n`;
    default:
      return inner;
  }
}

// Text length alone stayed 0 right after inserting an empty list/blockquote
// (no characters typed yet), so the "Describe the change…" placeholder kept
// showing on top of it. Counting element children too means any inserted
// wrapper — even an empty one, ready to type into — counts as "has content."
function measureDraft(el: HTMLElement): number {
  return el.innerText.trim().length + el.childElementCount;
}

function draftToMarkdown(root: HTMLElement): string {
  const raw = Array.from(root.childNodes)
    .map(htmlToMarkdown)
    .join("")
    .replace(/​/g, "");
  return raw
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  disabled = false,
  disabledReason,
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
  // True when this chat is claimed elsewhere (e.g. someone's running it in
  // Solo right now) — blocks sending here so two sessions never race the
  // same chatId/session concurrently.
  disabled?: boolean;
  disabledReason?: string | null;
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
  const editorWrapRef = useRef<HTMLDivElement>(null);
  const slashAnchorRef = useRef<HTMLDivElement>(null);
  const [draftLen, setDraftLen] = useState(0);
  const [draftText, setDraftText] = useState("");
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const customCommands = useCustomSlashCommands();
  const allCommands = useMemo(() => [...BUILTIN_COMMANDS, ...customCommands], [customCommands]);
  const slashMatch = SLASH_TOKEN.exec(draftText);
  const slashQuery = slashMatch?.[1] ?? null;
  const slashItems =
    slashQuery !== null && !slashDismissed
      ? allCommands.filter((c) => c.name.toLowerCase().startsWith(slashQuery.toLowerCase())).slice(0, 8)
      : [];

  function selectCommand(cmd: SlashCommand) {
    const el = editorRef.current;
    if (el) {
      el.textContent = `/${cmd.name} `;
      setDraftLen(measureDraft(el));
      setDraftText(el.innerText);
      el.focus();
      const after = endOfContentRange(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(after);
      savedRangeRef.current = after.cloneRange();
    }
    setSlashDismissed(false);
    setSlashIndex(0);
  }
  // Which formats apply at the current caret/selection, so the toolbar can
  // show e.g. Bold as pressed while you're typing inside bold text — mirrors
  // what every rich-text toolbar does, just computed by hand for the
  // manually-wrapped list/quote (queryCommandState only knows about the
  // execCommand-driven bold/italic/underline).
  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());
  // JS-driven instead of a CSS `:hover` rule — with `onMouseDown`'s
  // `preventDefault()` (needed to keep the editor's selection alive across
  // the click), some WebKit builds stop re-evaluating `:hover` until the
  // pointer actually moves, so the grey hover background stuck around after
  // clicking even once a toggle (e.g. the list button) turned back off.
  // mouseenter/mouseleave aren't affected by that, since preventDefault only
  // touches the mousedown/click pair.
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);

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

  // Clicking a toolbar button (a real, focusable <button>) can steal focus
  // and collapse the editor's selection before exec() ever runs. Saving
  // the Range on mousedown (before any of that happens) and restoring it in
  // exec() makes every command apply to what was actually selected.
  const savedRangeRef = useRef<Range | null>(null);
  function saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  }
  // Recomputes which formats apply at the caret — the execCommand-backed
  // ones via queryCommandState (the one thing it's reliably good at), the
  // manually-wrapped list/quote by walking up from the selection to see if
  // a <blockquote>/<ul>/<ol> is an ancestor.
  function toolbarStyle(key: string, extra?: CSSProperties): CSSProperties {
    if (activeFormats.has(key)) return { ...toolbarButtonStyle, ...activeToolbarButtonStyle, ...extra };
    if (hoveredBtn === key) return { ...toolbarButtonStyle, background: "#2A2D37", color: "#EDEDF0", ...extra };
    return { ...toolbarButtonStyle, ...extra };
  }
  function updateActiveFormats() {
    const el = editorRef.current;
    const next = new Set<string>();
    if (el) {
      try {
        if (document.queryCommandState("bold")) next.add("bold");
        if (document.queryCommandState("italic")) next.add("italic");
        if (document.queryCommandState("underline")) next.add("underline");
      } catch {
        // queryCommandState can throw outside a live selection context.
      }
      const sel = window.getSelection();
      let node: Node | null = sel && el.contains(sel.anchorNode) ? sel.anchorNode : null;
      while (node && node !== el) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const tag = (node as HTMLElement).tagName;
          if (tag === "BLOCKQUOTE") next.add("quote");
          if (tag === "UL") next.add("bullet");
          if (tag === "OL") next.add("numbered");
        }
        node = node.parentNode;
      }
    }
    setActiveFormats(next);
  }

  // execCommand is deprecated but remains the only zero-dependency way to
  // drive a contentEditable's native rich-text formatting — pulling in a
  // whole editor library (TipTap/Slate) for bold/italic/lists/link/quote
  // would be a lot of surface for what the browser already does.
  function exec(command: string, value?: string) {
    if (streaming) return;
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (sel && savedRangeRef.current) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
    document.execCommand(command, false, value);
    setDraftLen(measureDraft(el));
    updateActiveFormats();
  }
  // execCommand's list/formatBlock support is notoriously unreliable in
  // WebKit-based webviews (unlike bold/italic/underline, which are plain
  // CSS-backed inline commands and work fine) — silently no-ops instead of
  // erroring. Building the wrapper element by hand via the Range API sides
  // steps the browser's implementation entirely instead of trying to detect
  // and work around it.
  function wrapSelection(build: (contents: DocumentFragment) => HTMLElement) {
    if (streaming) return;
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel) return;
    if (savedRangeRef.current && el.contains(savedRangeRef.current.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
    // Whatever's selected still might not actually be inside the editor —
    // nothing was ever clicked/highlighted in here yet (a fresh draft, or a
    // stray selection elsewhere on the page) — not just "totally empty."
    // Checking rangeCount alone missed that case: the button appeared to do
    // nothing unless you'd first highlighted real text. Fall back to a
    // collapsed caret at the end of the draft so the command always runs.
    if (sel.rangeCount === 0 || !el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.addRange(range);
    }
    const range = sel.getRangeAt(0);
    const contents = range.extractContents();
    const wrapper = build(contents);
    range.insertNode(wrapper);
    sel.removeAllRanges();
    sel.addRange(endOfContentRange(wrapper));
    setDraftLen(measureDraft(el));
    updateActiveFormats();
  }
  // Flattens a <blockquote> back into its plain contents in place of the
  // element itself — toggle-off half of the quote button, same shape as
  // unwrapList below.
  function unwrapQuote(bq: HTMLElement) {
    const frag = document.createDocumentFragment();
    while (bq.firstChild) frag.appendChild(bq.firstChild);
    bq.replaceWith(frag);
  }

  function execQuote() {
    if (streaming) return;
    const el = editorRef.current;
    if (!el) return;
    const anchorNode = savedRangeRef.current?.startContainer ?? window.getSelection()?.anchorNode ?? null;
    const existing = anchorNode ? closestQuote(anchorNode) : null;
    if (existing) {
      // Already inside a quote at the caret — pressing the button again
      // means "undo it," not "nest another quote inside it."
      el.focus();
      unwrapQuote(existing);
      const after = endOfContentRange(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(after);
      savedRangeRef.current = after.cloneRange();
      setDraftLen(measureDraft(el));
      updateActiveFormats();
      return;
    }
    const color = colorForUser(myEmail);
    wrapSelection((contents) => {
      const bq = document.createElement("blockquote");
      bq.appendChild(contents);
      bq.style.borderLeftColor = color;
      bq.style.background = `${color}22`;
      return bq;
    });
  }
  // `selectNodeContents(container); collapse(false)` looks like "end of
  // container" but actually lands at (container, container.childNodes.length)
  // — a child-index position, not a position inside the last real text run.
  // For a collapsed range used only as an *insertion point* that's harmless
  // (insertNode just appends), but for a range that becomes the caret the
  // user actually sees, it produced an invisible/degenerate caret — verified
  // live via a standalone repro (see wrapSelection). Drilling to the real
  // last leaf and using its actual text offset is what gives a genuine one.
  function endOfContentRange(container: Node): Range {
    let leaf: Node = container;
    while (leaf.lastChild) leaf = leaf.lastChild;
    const r = document.createRange();
    if (leaf.nodeType === Node.TEXT_NODE) {
      r.setStart(leaf, leaf.textContent?.length ?? 0);
    } else {
      r.selectNodeContents(leaf);
    }
    r.collapse(true);
    return r;
  }

  function closestTag(node: Node | null, tag: string): HTMLElement | null {
    let n = node;
    while (n && n !== editorRef.current) {
      if (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).tagName === tag) return n as HTMLElement;
      n = n.parentNode;
    }
    return null;
  }
  function closestQuote(node: Node | null): HTMLElement | null {
    return closestTag(node, "BLOCKQUOTE");
  }

  // Flattens a <ul>/<ol> back into plain lines (each <li>'s content, joined
  // by <br>s) in place of the list element itself — the toggle-off half of
  // the bullet/numbered buttons.
  function unwrapList(list: HTMLElement) {
    const items = Array.from(list.children);
    const frag = document.createDocumentFragment();
    items.forEach((li, i) => {
      while (li.firstChild) frag.appendChild(li.firstChild);
      if (i < items.length - 1) frag.appendChild(document.createElement("br"));
    });
    list.replaceWith(frag);
  }

  function execList(ordered: boolean) {
    if (streaming) return;
    const el = editorRef.current;
    if (!el) return;
    const tag = ordered ? "OL" : "UL";
    const anchorNode = savedRangeRef.current?.startContainer ?? window.getSelection()?.anchorNode ?? null;
    const existing = anchorNode ? closestTag(anchorNode, tag) : null;
    if (existing) {
      // Already a list of this kind at the caret — pressing the button again
      // means "undo it," not "nest another one inside it."
      el.focus();
      unwrapList(existing);
      const after = endOfContentRange(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(after);
      savedRangeRef.current = after.cloneRange();
      setDraftLen(measureDraft(el));
      updateActiveFormats();
      return;
    }
    wrapSelection((contents) => {
      const li = document.createElement("li");
      li.appendChild(contents);
      // An empty li has only the ::before marker as a flex item — nothing
      // else for the caret to occupy, so it renders stacked on/behind the
      // marker instead of beside it. A <br> looked like the obvious
      // placeholder, but inside a flex container it becomes a flex item
      // rather than an inline line-break, and stopped being a valid caret
      // anchor at all — the cursor disappeared entirely. A zero-width-space
      // text node is a real (if invisible) inline text run, which is what
      // the caret actually needs to sit in; stripped back out in
      // draftToMarkdown so it never reaches the sent message.
      if (!li.hasChildNodes()) li.appendChild(document.createTextNode("​"));
      const list = document.createElement(ordered ? "ol" : "ul");
      list.appendChild(li);
      return list;
    });
  }

  // Markdown-style auto-list: typing "1. " or "- "/"• " at the very start of
  // a line converts it the same way the toolbar buttons do — checked on the
  // triggering space itself. `node.previousSibling == null` is what "start of
  // a line" resolves to here: Enter starts a fresh block/text node in every
  // engine, so being first-child-with-nothing-before-it holds whether it's
  // the first line in the whole draft or one after a line break.
  function handleEditorKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (slashItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % slashItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + slashItems.length) % slashItems.length);
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        selectCommand(slashItems[Math.min(slashIndex, slashItems.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashDismissed(true);
        return;
      }
    }
    // Backspace inside an emptied-out blockquote (you deleted everything you
    // quoted, or created one and never typed into it) otherwise has nowhere
    // to go — it's the editor's only content, so there's no "after it" to
    // click into. Once the quote is empty, one more Backspace drops it and
    // hands you a caret right where it was, instead of leaving you stuck.
    if (e.key === "Backspace") {
      const el = editorRef.current;
      const sel = window.getSelection();
      if (el && sel && sel.isCollapsed && sel.rangeCount > 0) {
        const bq = closestQuote(sel.getRangeAt(0).startContainer);
        if (bq && (bq.textContent ?? "").trim() === "") {
          e.preventDefault();
          bq.remove();
          if (el.childNodes.length === 0) el.appendChild(document.createTextNode(""));
          const after = endOfContentRange(el);
          sel.removeAllRanges();
          sel.addRange(after);
          savedRangeRef.current = after.cloneRange();
          setDraftLen(measureDraft(el));
          updateActiveFormats();
          return;
        }
      }
    }
    // Plain Enter exits the quote entirely (matches "return takes you out of
    // it"); Shift+Enter is left to the browser's own default line-break
    // behavior, which stays inside the current block — i.e. still quoted.
    if (e.key === "Enter" && !e.shiftKey) {
      const el = editorRef.current;
      const sel = window.getSelection();
      if (el && sel && sel.isCollapsed && sel.rangeCount > 0) {
        const bq = closestQuote(sel.getRangeAt(0).startContainer);
        if (bq) {
          e.preventDefault();
          const line = document.createElement("div");
          line.appendChild(document.createElement("br"));
          if (bq.nextSibling) el.insertBefore(line, bq.nextSibling);
          else el.appendChild(line);
          const range = document.createRange();
          range.setStart(line, 0);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          savedRangeRef.current = range.cloneRange();
          setDraftLen(measureDraft(el));
          updateActiveFormats();
          return;
        }
      }
    }
    if (e.key !== " ") return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE || node.previousSibling) return;
    const before = (node.textContent ?? "").slice(0, range.startOffset);
    const ordered = before === "1.";
    const bulleted = before === "-" || before === "•";
    if (!ordered && !bulleted) return;
    e.preventDefault();
    node.textContent = (node.textContent ?? "").slice(range.startOffset);
    const caret = document.createRange();
    caret.setStart(node, 0);
    caret.collapse(true);
    sel.removeAllRanges();
    sel.addRange(caret);
    savedRangeRef.current = caret.cloneRange();
    execList(ordered);
  }

  function send() {
    if (!allReady || streaming || disabled) return;
    const el = editorRef.current;
    const text = el ? draftToMarkdown(el) : "";
    if (!text) return;
    onSend(text);
    if (el) el.innerHTML = "";
    setDraftLen(0);
    setDraftText("");
    setForced({});
    // Reset own readiness for the next turn; teammates reset their own.
    updateMyPresence({ readyForChatId: null });
  }

  // ── Render values ──────────────────────────────────────────────────────────
  const anyUnready = occupants.some((o) => !o.ready && !forced[o.email] && !o.isMe);
  const readyShort = `${readyCount}/${total} ready`;
  const sendShort = disabled
    ? disabledReason ?? "Claimed elsewhere"
    : streaming
      ? "Working…"
      : allReady
        ? "Send to Nova"
        : `Send · ${total - readyCount} left`;
  const canSend = allReady && !streaming && !disabled;

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
          <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.seam}`, fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: C.sub }}>
            Collaborators
          </div>
          <div ref={editorWrapRef} style={{ position: "relative", flex: 1, minHeight: 0, overflow: "auto" }}>
            <div
              ref={editorRef}
              className="agent-draft-editor"
              contentEditable={!streaming && !disabled}
              suppressContentEditableWarning
              spellCheck={false}
              onInput={() => {
                const el = editorRef.current;
                if (el) {
                  setDraftLen(measureDraft(el));
                  setDraftText(el.innerText);
                }
                setSlashDismissed(false);
                setSlashIndex(0);
                updateActiveFormats();
              }}
              onKeyDown={handleEditorKeyDown}
              onKeyUp={updateActiveFormats}
              onMouseUp={updateActiveFormats}
              style={{
                minHeight: "100%",
                padding: "28px 30px",
                fontSize: 15.5,
                lineHeight: 1.4,
                color: "#FFFFFF",
                outline: "none",
                cursor: "text",
              }}
            />
            {draftLen === 0 && (
              // Same font-size/line-height/padding as the editor itself
              // (below) — any mismatch there is what made the placeholder
              // sit at a different position/size than the caret typing over it.
              <div style={{ position: "absolute", top: 28, left: 30, fontSize: 15.5, lineHeight: 1.4, color: C.fainter, pointerEvents: "none" }}>
                Describe the change for Nova — everyone marks ready, then send.
              </div>
            )}
            {/* A slash command only ever matches while the whole draft is
                still "/word" (see SLASH_TOKEN) — i.e. the first line, right
                at the editor's top-left padding — so an anchor pinned there
                tracks the caret without needing real caret-rect tracking.
                Anchoring the popover to editorWrapRef (the full scrollable
                pane) instead put it off-screen below a tall draft area. */}
            <div ref={slashAnchorRef} style={{ position: "absolute", top: 28, left: 30, width: 1, height: 24, pointerEvents: "none" }} />
            <SlashCommandMenu
              anchorRef={slashAnchorRef}
              items={slashItems}
              selectedIndex={slashIndex}
              onSelect={selectCommand}
              onClose={() => setSlashDismissed(true)}
            />
          </div>
          <div
            // Belt-and-braces alongside each button's own onMouseLeave: if a
            // button's leave event is ever missed (couldn't confirm either
            // way inside the actual WKWebView, which this app runs in but
            // which I have no way to sign into and test directly), the
            // pointer still has to cross this row's boundary to get
            // anywhere else, which clears the stuck state as a fallback.
            onMouseLeave={() => setHoveredBtn(null)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "8px 12px",
              borderTop: `1px solid ${C.seam}`,
              flex: "none",
            }}
          >
            {[
              { cmd: "bold", label: "B", style: { fontWeight: 700 } },
              { cmd: "italic", label: "I", style: { fontStyle: "italic" as const } },
              { cmd: "underline", label: "U", style: { textDecoration: "underline" } },
            ].map((b) => (
              <button
                key={b.cmd}
                type="button"
                title={b.cmd}
                onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
                onMouseEnter={() => setHoveredBtn(b.cmd)}
                onMouseLeave={() => setHoveredBtn(null)}
                onClick={() => exec(b.cmd)}
                style={toolbarStyle(b.cmd, b.style)}
              >
                {b.label}
              </button>
            ))}
            <div style={toolbarDividerStyle} />
            <button
              type="button"
              title="Numbered list"
              onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
              onMouseEnter={() => setHoveredBtn("numbered")}
              onMouseLeave={() => setHoveredBtn(null)}
              onClick={() => execList(true)}
              style={toolbarStyle("numbered")}
            >
              <OrderedListIcon />
            </button>
            <button
              type="button"
              title="Bulleted list"
              onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
              onMouseEnter={() => setHoveredBtn("bullet")}
              onMouseLeave={() => setHoveredBtn(null)}
              onClick={() => execList(false)}
              style={toolbarStyle("bullet")}
            >
              <BulletedListIcon />
            </button>
            <div style={toolbarDividerStyle} />
            <button
              type="button"
              title="Quote"
              onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
              onMouseEnter={() => setHoveredBtn("quote")}
              onMouseLeave={() => setHoveredBtn(null)}
              onClick={execQuote}
              style={toolbarStyle("quote")}
            >
              <QuoteIcon />
            </button>
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
                    force {nicknameOrLocalPart(o.email)}
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
                title={disabled ? disabledReason ?? "This chat is claimed elsewhere" : undefined}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  padding: "9px 14px",
                  borderRadius: 8,
                  cursor: canSend ? "pointer" : "default",
                  whiteSpace: "nowrap",
                  color: canSend ? C.blueInk : C.faint,
                  background: canSend ? C.blueBg : C.idleBg,
                  border: `1px solid ${canSend ? C.blueBorder : C.idleBorder}`,
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "8px 10px 8px 18px",
              borderBottom: `1px solid ${C.seam}`,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: C.sub }}>
              Nova
            </span>
            <span style={{ flex: 1 }} />
            <ModelPicker />
            <EffortPicker />
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
                {shelving ? "Rendering…" : "Add to Queue"}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
