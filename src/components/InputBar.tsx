import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PermissionPill, ModelPicker, EffortPicker, AttachButton, MicButton } from "./InputToolbelt";
import { AttachmentStrip, type PendingAttachment } from "./AttachmentStrip";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { MentionMenu } from "./MentionMenu";
import { BUILTIN_COMMANDS, useCustomSlashCommands, type SlashCommand } from "../lib/slashCommands";
import { uploadAttachment, deleteAttachment } from "../lib/attachments";
import type { SentAttachment } from "../types/message";
import type { AssignableTeammate } from "./AssignChatMenu";
import { ChatUsageRing } from "./ChatUsageRing";
import { useOthers, useUpdateMyPresence } from "../lib/liveblocks";
import { colorForUser, displayNameForUser } from "../lib/presenceColor";

// Only while the whole box is still just "/word" (no space yet) — a slash
// mentioned mid-message shouldn't pop the menu.
const SLASH_TOKEN = /^\/([a-zA-Z0-9_-]*)$/;

// Finds an in-progress "@word" ending at the cursor, anywhere in the
// message (unlike SLASH_TOKEN, a mention can appear mid-sentence). Returns
// null once the token is broken by whitespace or isn't preceded by
// start-of-string/whitespace (so it doesn't fire inside a pasted email).
function findMentionToken(value: string, cursor: number): { query: string; start: number } | null {
  const upToCursor = value.slice(0, cursor);
  const at = upToCursor.lastIndexOf("@");
  if (at === -1) return null;
  const before = at === 0 ? "" : upToCursor[at - 1];
  if (before && !/\s/.test(before)) return null;
  const query = upToCursor.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { query, start: at };
}

export function InputBar({
  chatId,
  sessionId = null,
  onSend,
  onStop,
  disabled,
  streaming = false,
  accentColor,
  teammates = [],
}: {
  chatId: string;
  sessionId?: string | null;
  onSend: (prompt: string, attachments?: SentAttachment[]) => void;
  onStop?: () => void;
  disabled: boolean;
  streaming?: boolean;
  accentColor?: string;
  teammates?: AssignableTeammate[];
}) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  // Dragging over a child element fires dragleave on the parent before
  // dragenter fires again on re-entry — a plain enter/leave toggle flickers.
  // A depth counter only clears the highlight once the pointer has actually
  // left every nested element.
  const dragDepthRef = useRef(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [mentionToken, setMentionToken] = useState<{ query: string; start: number } | null>(null);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);

  // A teammate currently focused in *this* chat's box — locks the box for
  // everyone else until they blur or send (see the focus/blur handlers and
  // updateMyPresence calls below). Only one teammate can hold it at a time;
  // ponytail: last-focus-wins, no queueing, good enough for a two-person MVP.
  const others = useOthers();
  const updateMyPresence = useUpdateMyPresence();
  const typingOther = others.find((o) => o.presence.typing?.chatId === chatId)?.presence;
  const lockedByOther = typingOther != null;

  const latestTyping = useRef("");
  const typingFrameRef = useRef<number | null>(null);
  function broadcastTyping(text: string) {
    latestTyping.current = text;
    if (typingFrameRef.current != null) return;
    typingFrameRef.current = requestAnimationFrame(() => {
      typingFrameRef.current = null;
      updateMyPresence({ typing: { chatId, text: latestTyping.current } });
    });
  }
  function releaseTyping() {
    if (typingFrameRef.current != null) {
      cancelAnimationFrame(typingFrameRef.current);
      typingFrameRef.current = null;
    }
    updateMyPresence({ typing: null });
  }
  // Releases the lock when this pane switches to a different chat (the
  // component doesn't unmount on that — see ChatPane, same instance just
  // gets a new chatId prop) or unmounts outright — otherwise a chat you
  // navigated away from mid-type would stay "selected" for everyone else
  // forever.
  useEffect(() => {
    return () => {
      if (typingFrameRef.current != null) {
        cancelAnimationFrame(typingFrameRef.current);
        typingFrameRef.current = null;
      }
      updateMyPresence({ typing: null });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // Uploads start the moment a file is attached, not when Send is pressed —
  // so the composer's spinner is real, visible feedback of an in-flight
  // upload rather than something the user only sees for an instant.
  async function uploadOne(id: string, file: File) {
    try {
      const [localPath, uploaded] = await Promise.all([
        (async () => {
          const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
          return invoke<string>("save_attachment", { chatId, fileName: file.name, data: bytes });
        })(),
        uploadAttachment(chatId, file),
      ]);
      const { path: storagePath, ...attachment } = uploaded;
      const sent: SentAttachment = { ...attachment, localPath };
      setAttachments((a) =>
        a.map((item) => (item.id === id ? { ...item, status: "done", sent, storagePath } : item))
      );
    } catch (err) {
      console.error("attachment upload failed", err);
      setAttachments((a) => a.map((item) => (item.id === id ? { ...item, status: "error" } : item)));
    }
  }

  function addFiles(fileList: FileList | File[]) {
    const items: PendingAttachment[] = Array.from(fileList).map((file) => ({
      id: crypto.randomUUID(),
      file,
      status: "uploading",
      sent: null,
      storagePath: null,
    }));
    setAttachments((a) => [...a, ...items]);
    items.forEach((item) => uploadOne(item.id, item.file));
  }

  // Undoes an in-flight or completed upload when the user removes an
  // attachment before sending, so it doesn't linger in Storage/on disk for
  // up to a week waiting on the cleanup cron.
  function removeAttachment(id: string) {
    setAttachments((a) => {
      const item = a.find((it) => it.id === id);
      if (item?.status === "done" && item.storagePath) {
        deleteAttachment(item.storagePath).catch((err) => console.error("failed to delete attachment", err));
        invoke("delete_attachment", { chatId, fileName: item.file.name }).catch((err) =>
          console.error("failed to delete local attachment", err)
        );
      }
      return a.filter((it) => it.id !== id);
    });
  }

  const customCommands = useCustomSlashCommands();
  const allCommands = useMemo(() => [...BUILTIN_COMMANDS, ...customCommands], [customCommands]);

  const slashMatch = SLASH_TOKEN.exec(value);
  const slashQuery = slashMatch?.[1] ?? null;
  const slashItems =
    slashQuery !== null && !slashDismissed
      ? allCommands.filter((c) => c.name.toLowerCase().startsWith(slashQuery.toLowerCase())).slice(0, 8)
      : [];

  function selectCommand(cmd: SlashCommand) {
    setValue(`/${cmd.name} `);
    setSlashDismissed(false);
    setSlashIndex(0);
    const el = textareaRef.current;
    if (el) {
      el.focus();
      requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
    }
  }

  const mentionItems =
    mentionToken !== null && !mentionDismissed
      ? teammates
          .filter((t) => t.email.split("@")[0].toLowerCase().startsWith(mentionToken.query.toLowerCase()))
          .slice(0, 8)
      : [];

  function selectMention(teammate: AssignableTeammate) {
    if (!mentionToken) return;
    const cursor = mentionToken.start + 1 + mentionToken.query.length;
    const name = teammate.email.split("@")[0];
    const next = `${value.slice(0, mentionToken.start)}@${name} ${value.slice(cursor)}`;
    setValue(next);
    setMentionToken(null);
    setMentionDismissed(false);
    setMentionIndex(0);
    const el = textareaRef.current;
    if (el) {
      el.focus();
      const caret = mentionToken.start + name.length + 2;
      requestAnimationFrame(() => el.setSelectionRange(caret, caret));
    }
  }

  // Grows with content up to 10 lines, then scrolls internally rather than
  // pushing the rest of the pane around indefinitely.
  function resize(el: HTMLTextAreaElement) {
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 19.6;
    const maxHeight = lineHeight * 10;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  // A locked box's value updates from presence, not local onChange, so it
  // needs its own trigger to grow with the teammate's live text.
  useEffect(() => {
    if (lockedByOther && textareaRef.current) resize(textareaRef.current);
  }, [lockedByOther, typingOther?.typing?.text]);

  const stillUploading = attachments.some((a) => a.status === "uploading");

  function submit() {
    if ((!value.trim() && attachments.length === 0) || disabled || stillUploading) return;
    const text = value;
    const sent = attachments.filter((a) => a.sent != null).map((a) => a.sent as SentAttachment);
    setValue("");
    setAttachments([]);
    setMentionToken(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.overflowY = "hidden";
    }
    releaseTyping();
    onSend(text, sent.length > 0 ? sent : undefined);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
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
    if (mentionItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionItems.length) % mentionItems.length);
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        selectMention(mentionItems[Math.min(mentionIndex, mentionItems.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionDismissed(true);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }

  return (
    <div
      className={`input-bar relative flex flex-col gap-[0.6em] pt-[1em] pr-[1.3em] pb-[12px] pl-[1.3em] border-t ${
        dragActive ? "border-accent" : "border-border"
      }`}
      onDragEnter={handleDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={handleDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        dragDepthRef.current = 0;
        setDragActive(false);
        if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
      }}
    >
      {dragActive && (
        <div className="absolute inset-0 z-[50] flex items-center justify-center bg-accent/10 border-2 border-dashed border-accent rounded-b-2xl pointer-events-none">
          <span className="text-[13px] font-medium text-accent">Drop to attach</span>
        </div>
      )}
      <AttachmentStrip items={attachments} onRemove={removeAttachment} />

      {typingOther && (
        <div className="flex items-center gap-[0.4em] text-[12px] text-text-tertiary px-[0.3em]">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colorForUser(typingOther.email) }} />
          {displayNameForUser(typingOther.email)} is typing…
        </div>
      )}

      <div
        ref={inputWrapRef}
        className={`relative min-h-[40px] flex items-center bg-[var(--input-pill-bg)] border rounded-xl py-[0.45em] pr-[3em] pl-[0.3em] ${
          lockedByOther ? "border-[var(--user-color)]" : "border-border focus-within:border-[var(--user-color)]"
        }`}
        style={{
          ["--user-color" as string]: lockedByOther ? colorForUser(typingOther.email) : accentColor ?? "var(--accent)",
        }}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          className="appearance-none bg-transparent border-0 outline-none block w-full resize-none overflow-y-hidden text-sm text-text-primary [font-family:inherit] leading-[1.4] placeholder:text-text-tertiary"
          value={lockedByOther ? typingOther.typing?.text ?? "" : value}
          onChange={(e) => {
            setValue(e.target.value);
            setSlashDismissed(false);
            setSlashIndex(0);
            setMentionToken(findMentionToken(e.target.value, e.target.selectionStart ?? e.target.value.length));
            setMentionDismissed(false);
            setMentionIndex(0);
            resize(e.target);
            broadcastTyping(e.target.value);
          }}
          onFocus={() => broadcastTyping(value)}
          onBlur={releaseTyping}
          onKeyDown={handleKeyDown}
          placeholder="Describe a task or ask a question, or type / for commands"
          disabled={disabled || lockedByOther}
        />
        <SlashCommandMenu
          anchorRef={inputWrapRef}
          items={slashItems}
          selectedIndex={slashIndex}
          onSelect={selectCommand}
          onClose={() => setSlashDismissed(true)}
        />
        <MentionMenu
          anchorRef={inputWrapRef}
          items={mentionItems}
          selectedIndex={mentionIndex}
          onSelect={selectMention}
          onClose={() => setMentionDismissed(true)}
        />
        {(() => {
          const sendButtonStyle = {
            position: "absolute" as const,
            right: "0.6em",
            top: "50%",
            transform: "translateY(-50%)",
            width: 32,
            height: 32,
            borderRadius: 10,
          };
          if (streaming) {
            return (
              <button
                type="button"
                className="icon-button"
                style={{ ...sendButtonStyle, background: "var(--send-active)", color: "var(--bg-primary)" }}
                onClick={onStop}
                aria-label="Stop"
                title="Stop"
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <rect x="2" y="2" width="20" height="20" rx="3" />
                </svg>
              </button>
            );
          }
          const canSend = !disabled && !stillUploading && (value.trim().length > 0 || attachments.length > 0);
          return (
            <button
              type="button"
              className="icon-button"
              style={{
                ...sendButtonStyle,
                background: canSend ? "var(--send-active)" : "var(--bg-tertiary)",
                color: canSend ? "var(--bg-primary)" : "var(--text-tertiary)",
              }}
              onClick={submit}
              disabled={!canSend}
              aria-label="Send"
              title="Send"
            >
              <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          );
        })()}
      </div>

      <div className="flex items-center flex-wrap gap-x-[0.4em] gap-y-[0.4em]">
        <PermissionPill />
        <AttachButton onAttach={addFiles} />
        <MicButton />
        <span className="flex-1 min-w-0" />
        <ModelPicker />
        <EffortPicker />
        <ChatUsageRing chatId={chatId} sessionId={sessionId} accentColor={accentColor} />
      </div>
    </div>
  );
}
