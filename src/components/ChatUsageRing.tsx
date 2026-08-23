import { CONTEXT_WINDOW, useChatUsage } from "../lib/chatUsage";

const SIZE = 14;
const STROKE = 2;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ChatUsageRing({
  chatId,
  sessionId,
  accentColor,
}: {
  chatId: string;
  sessionId: string | null;
  accentColor?: string;
}) {
  const usage = useChatUsage(chatId, sessionId);
  if (!usage) return null;

  const pct = Math.min(1, usage.contextTokens / CONTEXT_WINDOW);
  const color = pct >= 0.75 ? "var(--conflict)" : pct >= 0.5 ? "var(--held)" : accentColor ?? "var(--accent)";

  return (
    <span
      className="inline-flex items-center justify-center shrink-0 cursor-default mr-[8px]"
      title={`${usage.contextTokens.toLocaleString()} / ${CONTEXT_WINDOW.toLocaleString()}`}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--border)" strokeWidth={STROKE} />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - pct)}
        />
      </svg>
    </span>
  );
}
