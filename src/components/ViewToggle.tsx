export function ViewToggle({
  mode,
  onChange,
}: {
  mode: "chat" | "canvas" | "preview" | "logbook";
  onChange: (mode: "chat" | "canvas" | "preview" | "logbook") => void;
}) {
  // ponytail: base carries only non-color/background utilities. Tailwind
  // compiles utility classes in an internal order, not JSX order, so a
  // button that carried both `bg-transparent` (base) and `bg-bg-primary`
  // (active) at once had `bg-transparent` win the cascade regardless of
  // class order — the active tab's highlight never rendered. Keeping
  // color/background mutually exclusive per state avoids that.
  const base = "border-none text-[0.85em] font-medium px-[1.1em] py-[0.5em] rounded-md";
  const inactive = "bg-transparent text-text-secondary";
  const active = "bg-bg-primary text-text-primary";
  const disabled = "bg-transparent text-text-tertiary opacity-60";

  return (
    <div className="flex gap-[0.2em] bg-bg-tertiary rounded-lg p-[3px]">
      {/* ponytail: no planning-mode backend yet — visual slot only, matching
          Sidebar's Projects/Skills rows. */}
      <button className={`${base} ${disabled}`} disabled title="Not yet available">
        Plan
      </button>
      <button
        className={mode === "chat" ? `${base} ${active}` : `${base} ${inactive}`}
        onClick={() => onChange("chat")}
      >
        Chat
      </button>
      <button
        className={mode === "canvas" ? `${base} ${active}` : `${base} ${inactive}`}
        onClick={() => onChange("canvas")}
      >
        Canvas
      </button>
      <button
        className={mode === "preview" ? `${base} ${active}` : `${base} ${inactive}`}
        onClick={() => onChange("preview")}
      >
        Preview
      </button>
      <button
        className={mode === "logbook" ? `${base} ${active}` : `${base} ${inactive}`}
        onClick={() => onChange("logbook")}
      >
        Logbook
      </button>
    </div>
  );
}
