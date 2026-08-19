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
    <div className="input-bar">
      <div className="input-toprow">
        <RepoPill />
      </div>

      <AttachmentStrip
        files={attachments}
        onRemove={(name) => setAttachments((a) => a.filter((f) => f !== name))}
      />

      <div className="input-box">
        <textarea
          ref={textareaRef}
          rows={1}
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
          className="send-button"
          onClick={submit}
          disabled={disabled || (!value.trim() && attachments.length === 0)}
          aria-label="Send"
        >
          <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>

      <div className="input-bottomrow">
        <PermissionPill />
        <AttachButton onAttach={(files) => setAttachments((a) => [...a, ...Array.from(files).map((f) => f.name)])} />
        <MicButton />
        <span className="input-spacer" />
        <ModelPicker />
        <EffortPicker />
      </div>
    </div>
  );
}
