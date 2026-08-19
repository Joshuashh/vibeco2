import { useOthers, useSelf } from "../lib/liveblocks";
import { colorForUser } from "../lib/presenceColor";

export function PresenceBar() {
  const self = useSelf();
  const others = useOthers();

  const people = [
    ...(self ? [{ email: self.presence.email, isSelf: true }] : []),
    ...others.map((other) => ({ email: other.presence.email, isSelf: false })),
  ];

  return (
    <div className="flex">
      {people.map((p) => {
        const color = colorForUser(p.email);
        return (
          <div
            key={p.email}
            className="w-[26px] h-[26px] flex items-center justify-center rounded-full border-[1.5px] bg-bg-tertiary text-[11px] font-semibold -ml-2 first:ml-0"
            style={{ borderColor: color, color, background: `${color}26` }}
            title={p.isSelf ? `You (${p.email})` : p.email}
          >
            {p.email.slice(0, 1).toUpperCase()}
          </div>
        );
      })}
    </div>
  );
}
