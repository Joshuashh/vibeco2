import { useRef, useState } from "react";
import {
  RepoPill,
  PermissionPill,
  ModelPicker,
  EffortPicker,
  AttachButton,
  MicButton,
  AttachmentStrip,
} from "./InputToolbelt";

export function InputBar({
  onSend,
  onStop,
  disabled,
  streaming = false,
  accentColor,
}: {
  onSend: (prompt: string) => void;
  onStop?: () => void;
  disabled: boolean;
  streaming?: boolean;
  accentColor?: string;
}) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grows with content up to 10 lines, then scrolls internally rather than
  // pushing the rest of the pane around indefinitely.
  function resize(el: HTMLTextAreaElement) {
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 19.6;
    const maxHeight = lineHeight * 10;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  function submit() {
    if ((!value.trim() && attachments.length === 0) || disabled) return;
    onSend(value);
    setValue("");
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.overflowY = "hidden";
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="input-bar flex flex-col gap-[0.6em] pt-[1em] pr-[1.3em] pb-[12px] pl-[1.3em] border-t border-border">
      <div className="flex items-center flex-wrap gap-x-[0.4em] gap-y-[0.4em]">
        <RepoPill />
      </div>

      <AttachmentStrip
        files={attachments}
        onRemove={(name) => setAttachments((a) => a.filter((f) => f !== name))}
      />

      <div
        className="relative min-h-[40px] flex items-center bg-[var(--input-pill-bg)] border border-border rounded-xl py-[0.45em] pr-[3em] pl-[0.9em] focus-within:border-[var(--user-color)]"
        style={{ ["--user-color" as string]: accentColor ?? "var(--accent)" }}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          className="appearance-none bg-transparent border-0 outline-none block w-full resize-none overflow-y-hidden text-sm text-text-primary [font-family:inherit] leading-[1.4] placeholder:text-text-tertiary"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            resize(e.target);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Describe a task or ask a question"
          disabled={disabled}
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
          const canSend = !disabled && (value.trim().length > 0 || attachments.length > 0);
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
        <AttachButton onAttach={(files) => setAttachments((a) => [...a, ...Array.from(files).map((f) => f.name)])} />
        <MicButton />
        <span className="flex-1 min-w-0" />
        <ModelPicker />
        <EffortPicker />
      </div>
    </div>
  );
}
