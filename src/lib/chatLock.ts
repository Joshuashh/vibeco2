import type { ChatRow } from "../types/chat";
import type { Profile } from "./profiles";

// A restricted chat (`open === false`) auto-unlocks once its owner isn't
// actually around to be interrupted by — offline entirely, or online but
// hasn't touched this chat in a while. Ten minutes of silence reads as
// "stepped away," matching a typical idle timeout.
export const IDLE_MS = 10 * 60 * 1000;

export function ownerEmailForChat(chat: ChatRow, profiles: Profile[]): string | null {
  const ownerId = chat.claude_session_owner ?? chat.user_id;
  return profiles.find((p) => p.id === ownerId)?.email ?? null;
}

// True while the chat is actually enforcing its restriction against anyone
// — i.e. restricted, has a known owner, and that owner is both online and
// has touched it within the idle window. Owner identity isn't excluded here
// on purpose: Cowork is a team surface, so a restricted chat stays off it
// even for its own owner until they explicitly unlock it.
export function isChatLockedForCowork(
  chat: ChatRow,
  profiles: Profile[],
  onlineEmails: Set<string>,
  now: number = Date.now()
): boolean {
  if (chat.open) return false;
  const email = ownerEmailForChat(chat, profiles);
  if (!email || !onlineEmails.has(email)) return false;
  const lastActive = chat.last_message_at ? new Date(chat.last_message_at).getTime() : 0;
  return now - lastActive <= IDLE_MS;
}

// Solo view: the owner can always keep editing their own restricted chat;
// everyone else can still open it to observe, but can't send while the
// restriction is actually in effect (see isChatLockedForCowork).
export function isChatLockedForViewer(
  chat: ChatRow,
  viewerEmail: string,
  profiles: Profile[],
  onlineEmails: Set<string>,
  now: number = Date.now()
): boolean {
  const email = ownerEmailForChat(chat, profiles);
  if (email === viewerEmail) return false;
  return isChatLockedForCowork(chat, profiles, onlineEmails, now);
}
