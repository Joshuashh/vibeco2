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

export function InputBar({ onSend, disabled }: { onSend: (prompt: string) => void; disabled: boolean }) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function resize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  function submit() {
    if ((!value.trim() && attachments.length === 0) || disabled) return;
    onSend(value);
    setValue("");
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="input-bar flex flex-col gap-[0.6em] pt-[1em] pr-[1.3em] pb-[1.2em] pl-[1.3em] border-t border-border">
      <div className="flex items-center flex-wrap gap-x-[0.4em] gap-y-[0.4em]">
        <RepoPill />
      </div>

      <AttachmentStrip
        files={attachments}
        onRemove={(name) => setAttachments((a) => a.filter((f) => f !== name))}
      />

      <div className="relative bg-[#20201f] border border-border rounded-2xl py-[0.9em] pr-[3em] pl-[1em] focus-within:border-accent">
        <textarea
          ref={textareaRef}
          rows={1}
          className="appearance-none bg-transparent border-0 outline-none block w-full resize-none text-sm text-text-primary [font-family:inherit] leading-[1.4] placeholder:text-text-tertiary"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            resize(e.target);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Describe a task or ask a question"
          disabled={disabled}
        />
        <button
          type="button"
          className="appearance-none border-0 outline-none absolute right-[0.6em] top-[0.6em] w-8 h-8 rounded-[10px] flex items-center justify-center bg-bg-tertiary [&_svg]:w-[15px] [&_svg]:h-[15px] [&_svg]:stroke-text-tertiary enabled:bg-send-active enabled:[&_svg]:stroke-[#1c1c1c] disabled:opacity-100"
          onClick={submit}
          disabled={disabled || (!value.trim() && attachments.length === 0)}
          aria-label="Send"
        >
          <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
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
