export function ViewToggle({
  mode,
  onChange,
}: {
  mode: "chat" | "canvas";
  onChange: (mode: "chat" | "canvas") => void;
}) {
  return (
    <div className="view-toggle">
      <button className={mode === "chat" ? "active" : ""} onClick={() => onChange("chat")}>
        Chat
      </button>
      <button className={mode === "canvas" ? "active" : ""} onClick={() => onChange("canvas")}>
        Canvas
      </button>
    </div>
  );
}
