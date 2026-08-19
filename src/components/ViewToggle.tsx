export function ViewToggle({
  mode,
  onChange,
}: {
  mode: "chat" | "canvas" | "preview";
  onChange: (mode: "chat" | "canvas" | "preview") => void;
}) {
  return (
    <div className="view-toggle">
      {/* ponytail: no planning-mode backend yet — visual slot only, matching
          Sidebar's Projects/Skills rows. */}
      <button disabled title="Not yet available">
        Plan
      </button>
      <button className={mode === "chat" ? "active" : ""} onClick={() => onChange("chat")}>
        Chat
      </button>
      <button className={mode === "canvas" ? "active" : ""} onClick={() => onChange("canvas")}>
        Canvas
      </button>
      <button className={mode === "preview" ? "active" : ""} onClick={() => onChange("preview")}>
        Preview
      </button>
    </div>
  );
}
