import { useRef, useState } from "react";
import { Popover, PopoverHeader, PopoverRow, PopoverDivider } from "./Popover";
import { usePrefs, MODELS, MORE_MODELS, EFFORTS, PERMISSIONS } from "../lib/prefs";

// ponytail: voice input is still local-only/no-op — no transcription backend
// exists yet. Model/effort/permission are wired to real preferences (see
// lib/prefs.ts) and flow into the actual Claude CLI invocation. The repo
// picker that used to live here was removed — repo selection now happens
// once, per-project, in ProjectSwitcher.tsx (see decisions.md's multi-project
// support entries), so a second per-message picker had nothing left to pick.

const MODEL_BADGES: Record<string, string> = { "Fable 5": "Requires usage credits" };

const pillBase =
  "appearance-none border-0 outline-none box-border inline-flex items-center gap-[0.35em] text-[0.78em] px-[0.7em] py-[0.4em] rounded-lg cursor-default hover:bg-bg-tertiary [&>svg]:w-3 [&>svg]:h-3 [&>svg]:stroke-current [&>svg]:fill-none [&>svg]:stroke-2";
const pillGhost = `${pillBase} text-text-secondary bg-transparent`;

export function PermissionPill() {
  const { permission, setPermission, bypassPermissions, setBypassPermissions } = usePrefs();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        title="Permission mode"
        className={`${pillBase} text-held bg-[rgba(232,184,74,0.12)]`}
        onClick={() => setOpen((o) => !o)}
      >
        {bypassPermissions ? "Bypass" : permission.label}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} width={220}>
        <PopoverHeader title="Permissions" />
        {PERMISSIONS.map((p, i) => (
          <PopoverRow
            key={p.label}
            title={p.label}
            shortcut={String(i + 1)}
            checked={!bypassPermissions && permission.label === p.label}
            onClick={() => { setPermission(p); setOpen(false); }}
          />
        ))}
        <PopoverDivider />
        <PopoverRow
          title="Bypass permissions"
          shortcut={bypassPermissions ? "Enabled" : "Enable"}
          onClick={() => setBypassPermissions(!bypassPermissions)}
        />
      </Popover>
    </>
  );
}

export function ModelPicker() {
  const { model, setModel } = usePrefs();
  const [showMore, setShowMore] = useState(false);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    setShowMore(false);
  }

  return (
    <>
      <button type="button" ref={anchorRef} title="Model" className={pillGhost} onClick={() => setOpen((o) => !o)}>
        {model.label}
      </button>
      <Popover open={open} onClose={close} anchorRef={anchorRef} width={220}>
        <PopoverHeader title="Models" />
        {MODELS.map((m, i) => (
          <PopoverRow
            key={m.label}
            title={m.label}
            shortcut={String(i + 1)}
            checked={model.label === m.label}
            badge={MODEL_BADGES[m.label]}
            onClick={() => { setModel(m); close(); }}
          />
        ))}
        <PopoverDivider />
        <PopoverRow title="More models" chevron onClick={() => setShowMore((s) => !s)} />
        {showMore &&
          MORE_MODELS.map((m) => (
            <PopoverRow key={m.label} title={m.label} indent checked={model.label === m.label} onClick={() => { setModel(m); close(); }} />
          ))}
      </Popover>
    </>
  );
}

export function EffortPicker() {
  const { effort, setEffort } = usePrefs();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" ref={anchorRef} title="Effort" className={pillGhost} onClick={() => setOpen((o) => !o)}>
        {effort.label}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} width={220}>
        <PopoverHeader title="Effort" />
        {EFFORTS.map((e, i) => (
          <PopoverRow
            key={e.label}
            title={e.label}
            shortcut={String(i + 1)}
            checked={effort.label === e.label}
            tint={e.label === "Max" ? "purple" : undefined}
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

