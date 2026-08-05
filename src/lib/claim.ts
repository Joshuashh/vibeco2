export interface Occupant {
  email: string;
  claimedChatId: string | null;
}

export function computeClaimant(chatId: string, self: Occupant | null, others: Occupant[]): string | null {
  if (self?.claimedChatId === chatId) return self.email;
  const other = others.find((o) => o.claimedChatId === chatId);
  return other?.email ?? null;
}

export function isClaimedByOther(chatId: string, self: Occupant | null, others: Occupant[]): boolean {
  const claimant = computeClaimant(chatId, self, others);
  return claimant !== null && claimant !== self?.email;
}
