import { useOthers, useSelf } from "../lib/liveblocks";
import { colorForUser, displayNameForUser, initialsForUser, textColorForBackground } from "../lib/presenceColor";

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
        const bg = colorForUser(p.email);
        const name = displayNameForUser(p.email);
        return (
          <div
            key={p.email}
            className="w-[26px] h-[26px] flex items-center justify-center rounded-full text-[11px] font-bold -ml-2 first:ml-0"
            style={{ background: bg, color: textColorForBackground(bg), border: "2px solid var(--bg-primary)" }}
            title={p.isSelf ? `You (${name})` : name}
          >
            {initialsForUser(name)}
          </div>
        );
      })}
    </div>
  );
}
