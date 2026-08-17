import { useRef, useState } from "react";
import { Popover, PopoverHeader, PopoverRow, PopoverDivider } from "./Popover";

// ponytail: every picker here holds local-only state — none of it is wired to
// real backend behavior yet (no per-chat model/effort/permission columns, no
// directory picker, no voice input, no token-usage tracking). Included as
// real, clickable UI scaffolding per explicit request, so the wiring has
// somewhere to land later instead of being invented from scratch then.

const MODELS = [
  { name: "Fable 5", requiresUsageCredits: true },
  { name: "Opus 5", requiresUsageCredits: false },
  { name: "Sonnet 5", requiresUsageCredits: false },
  { name: "Haiku 4.5", requiresUsageCredits: false },
];
const MORE_MODELS = ["Opus 4.8", "Opus 4.7", "Opus 4.6", "Sonnet 4.6"];
const EFFORTS = ["Low", "Medium", "High", "X-High", "Max"];
const PERMISSIONS = ["Manual", "Accept edits", "Plan", "Auto"];

export function LocationPill() {
  const [local, setLocal] = useState(true);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" ref={anchorRef} className="pill" onClick={() => setOpen((o) => !o)}>
        {local ? (
          <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="12" rx="2" />
            <path d="M8 20h8M12 16v4" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.4-1.5A5 5 0 0 0 6.5 19h11z" />
          </svg>
        )}
        {local ? "Local" : "Cloud"}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} width={180}>
        <PopoverHeader title="Run on" />
        <PopoverRow title="Local" checked={local} onClick={() => { setLocal(true); setOpen(false); }} />
        <PopoverRow title="Cloud" checked={!local} onClick={() => { setLocal(false); setOpen(false); }} />
      </Popover>
    </>
  );
}

export function DirectoryPill({ workingDirectory }: { workingDirectory: string }) {
  return (
    <button type="button" className="pill" title={workingDirectory}>
      <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      </svg>
      {workingDirectory}
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
      <button type="button" ref={anchorRef} className="pill pill-warn" onClick={() => setOpen((o) => !o)}>
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
      <button type="button" ref={anchorRef} className="pill pill-ghost" onClick={() => setOpen((o) => !o)}>
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
      <button type="button" ref={anchorRef} className="pill pill-ghost" onClick={() => setOpen((o) => !o)}>
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

export function ContextButton({ fraction = 0 }: { fraction?: number }) {
  const r = 8;
  const circumference = 2 * Math.PI * r;
  return (
    <button type="button" className="context-button" title="Context window">
      <svg viewBox="0 0 20 20">
        <circle cx="10" cy="10" r={r} fill="none" stroke="var(--border)" strokeWidth="2.5" />
        <circle
          cx="10"
          cy="10"
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          transform="rotate(-90 10 10)"
        />
      </svg>
    </button>
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
    <div className="attachment-strip">
      {files.map((name) => (
        <span key={name} className="attachment-chip">
          <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
          {name}
          <button type="button" onClick={() => onRemove(name)} aria-label={`Remove ${name}`}>
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
