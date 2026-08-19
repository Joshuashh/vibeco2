import { useRef, useState } from "react";
import { Popover, PopoverHeader, PopoverRow, PopoverDivider } from "./Popover";

// ponytail: every picker here holds local-only state — none of it is wired to
// real backend behavior yet (no per-chat model/effort/permission columns, no
// repo picker, no voice input). Included as real, clickable UI scaffolding
// per explicit request, so the wiring has somewhere to land later instead of
// being invented from scratch then.

const MODELS = [
  { name: "Fable 5", requiresUsageCredits: true },
  { name: "Opus 5", requiresUsageCredits: false },
  { name: "Sonnet 5", requiresUsageCredits: false },
  { name: "Haiku 4.5", requiresUsageCredits: false },
];
const MORE_MODELS = ["Opus 4.8", "Opus 4.7", "Opus 4.6", "Sonnet 4.6"];
const EFFORTS = ["Low", "Medium", "High", "X-High", "Max"];
const PERMISSIONS = ["Manual", "Accept edits", "Plan", "Auto"];

const pillBase =
  "appearance-none border-0 outline-none box-border inline-flex items-center gap-[0.35em] text-[0.78em] px-[0.7em] py-[0.4em] rounded-lg cursor-default hover:bg-bg-tertiary [&>svg]:w-3 [&>svg]:h-3 [&>svg]:stroke-current [&>svg]:fill-none [&>svg]:stroke-2";
const pillPlain = `${pillBase} text-text-secondary bg-bg-secondary`;
const pillGhost = `${pillBase} text-text-secondary bg-transparent`;

export function RepoPill({ repo }: { repo?: string }) {
  return (
    <button type="button" className={pillPlain} title={repo ?? "Select a GitHub repo"}>
      <svg viewBox="0 0 24 24" style={{ fill: "currentColor", stroke: "none" }}>
        <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.85-2.34 4.7-4.57 4.94.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2z" />
      </svg>
      {repo ?? "Select repo"}
    </button>
  );
}

export function PermissionPill() {
  const [mode, setMode] = useState(PERMISSIONS[0]);
  const [bypass, setBypass] = useState(false);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        className={`${pillBase} text-held bg-[rgba(232,184,74,0.12)]`}
        onClick={() => setOpen((o) => !o)}
      >
        {mode}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} width={220}>
        <PopoverHeader title="Permissions" />
        {PERMISSIONS.map((p, i) => (
          <PopoverRow
            key={p}
            title={p}
            shortcut={String(i + 1)}
            checked={mode === p}
            onClick={() => { setMode(p); setOpen(false); }}
          />
        ))}
        <PopoverDivider />
        <PopoverRow
          title="Bypass permissions"
          shortcut={bypass ? "Enabled" : "Enable"}
          onClick={() => setBypass((b) => !b)}
        />
      </Popover>
    </>
  );
}

export function ModelPicker() {
  const [model, setModel] = useState(MODELS[0].name);
  const [showMore, setShowMore] = useState(false);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    setShowMore(false);
  }

  return (
    <>
      <button type="button" ref={anchorRef} className={pillGhost} onClick={() => setOpen((o) => !o)}>
        {model}
      </button>
      <Popover open={open} onClose={close} anchorRef={anchorRef} width={220}>
        <PopoverHeader title="Models" />
        {MODELS.map((m, i) => (
          <PopoverRow
            key={m.name}
            title={m.name}
            shortcut={String(i + 1)}
            checked={model === m.name}
            badge={m.requiresUsageCredits ? "Requires usage credits" : undefined}
            onClick={() => { setModel(m.name); close(); }}
          />
        ))}
        <PopoverDivider />
        <PopoverRow title="More models" chevron onClick={() => setShowMore((s) => !s)} />
        {showMore &&
          MORE_MODELS.map((name) => (
            <PopoverRow key={name} title={name} indent checked={model === name} onClick={() => { setModel(name); close(); }} />
          ))}
      </Popover>
    </>
  );
}

export function EffortPicker() {
  const [effort, setEffort] = useState(EFFORTS[0]);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" ref={anchorRef} className={pillGhost} onClick={() => setOpen((o) => !o)}>
        {effort}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} width={220}>
        <PopoverHeader title="Effort" />
        {EFFORTS.map((e, i) => (
          <PopoverRow
            key={e}
            title={e}
            shortcut={String(i + 1)}
            checked={effort === e}
            tint={e === "Max" ? "purple" : undefined}
            onClick={() => { setEffort(e); setOpen(false); }}
          />
        ))}
      </Popover>
    </>
  );
}

export function AttachButton({ onAttach }: { onAttach: (files: FileList) => void }) {
  return (
    <label className="icon-button" title="Add file">
      <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
      <input
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => e.target.files && onAttach(e.target.files)}
      />
    </label>
  );
}

export function MicButton() {
  return (
    <button type="button" className="icon-button" title="Voice input">
      <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0M12 19v3" />
      </svg>
    </button>
  );
}

export function AttachmentStrip({ files, onRemove }: { files: string[]; onRemove: (name: string) => void }) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-[0.5em]">
      {files.map((name) => (
        <span
          key={name}
          className="inline-flex items-center gap-[0.4em] text-[0.78em] text-text-secondary bg-bg-secondary px-[0.6em] py-[0.3em] rounded-lg [&>svg]:w-3 [&>svg]:h-3 [&>svg]:stroke-current [&>svg]:fill-none [&>svg]:stroke-2"
        >
          <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
          {name}
          <button
            type="button"
            className="appearance-none border-0 outline-none bg-transparent p-0 text-text-tertiary text-[1.1em] leading-none hover:text-text-primary"
            onClick={() => onRemove(name)}
            aria-label={`Remove ${name}`}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
