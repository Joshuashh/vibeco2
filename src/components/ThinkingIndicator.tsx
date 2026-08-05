import { useEffect, useState } from "react";

const FRAMES = ["✻", "✽", "✶", "✳", "✢", "✳", "✶", "✽"];

function elapsedText(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function FlowerSpinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 180);
    return () => clearInterval(id);
  }, []);
  return <span className="flower-spinner">{FRAMES[frame]}</span>;
}

export function ThinkingIndicator({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="thinking-row">
      <FlowerSpinner />
      <span>Thinking · {elapsedText((now - startedAt) / 1000)}</span>
    </div>
  );
}
