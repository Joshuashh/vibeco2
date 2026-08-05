import { useOthers, useSelf } from "../lib/liveblocks";

export function PresenceBar() {
  const self = useSelf();
  const others = useOthers();

  const names = [
    `You (${self?.presence.email ?? "unknown"})`,
    ...others.map((other) => other.presence.email),
  ];

  return <div className="presence-bar">{names.join(", ")} online</div>;
}
