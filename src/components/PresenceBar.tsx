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
    <div className="presence-facepile">
      {people.map((p) => {
        const color = colorForUser(p.email);
        return (
          <div
            key={p.email}
            className="presence-avatar"
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
