export function ViewToggle({
  mode,
  onChange,
}: {
  mode: "chat" | "canvas";
  onChange: (mode: "chat" | "canvas") => void;
}) {
  return (
    <div className="view-toggle">
      {/* ponytail: no planning-mode backend yet — visual slot only, matching
          the Preview slot below and Sidebar's Projects/Skills rows. */}
      <button disabled title="Not yet available">
        Plan
      </button>
      <button className={mode === "chat" ? "active" : ""} onClick={() => onChange("chat")}>
        Chat
      </button>
      <button className={mode === "canvas" ? "active" : ""} onClick={() => onChange("canvas")}>
        Canvas
      </button>
      {/* ponytail: no build-preview backend yet — visual slot only, per this
          project's established pattern (see Sidebar's Projects/Skills rows). */}
      <button disabled title="Not yet available">
        Preview
      </button>
    </div>
  );
}
