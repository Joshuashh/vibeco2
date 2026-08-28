import { describe, it, expect } from "vitest";
import { isChatLockedForCowork, isChatLockedForViewer, IDLE_MS } from "./chatLock";
import type { ChatRow } from "../types/chat";
import type { Profile } from "./profiles";

const owner: Profile = { id: "owner-id", email: "owner@x.com", display_name: null, color: null, github_login: null };
const other: Profile = { id: "other-id", email: "other@x.com", display_name: null, color: null, github_login: null };
const profiles = [owner, other];

function chat(overrides: Partial<ChatRow> = {}): ChatRow {
  return {
    id: "c1",
    title: null,
    user_id: owner.id,
    position_x: null,
    position_y: null,
    claude_session_id: null,
    claude_session_owner: null,
    created_at: new Date().toISOString(),
    sort_order: 0,
    group_name: null,
    archived_at: null,
    last_message_at: new Date().toISOString(),
    project_id: "p1",
    handed_off_to: null,
    open: false,
    ...overrides,
  };
}

describe("isChatLockedForCowork", () => {
  it("is unlocked when the chat is open", () => {
    expect(isChatLockedForCowork(chat({ open: true }), profiles, new Set([owner.email]))).toBe(false);
  });

  it("is locked while restricted and the owner is online and recently active", () => {
    expect(isChatLockedForCowork(chat(), profiles, new Set([owner.email]))).toBe(true);
  });

  it("auto-unlocks once the owner goes offline", () => {
    expect(isChatLockedForCowork(chat(), profiles, new Set())).toBe(false);
  });

  it("auto-unlocks once the owner has been idle past the threshold", () => {
    const staleChat = chat({ last_message_at: new Date(Date.now() - IDLE_MS - 1000).toISOString() });
    expect(isChatLockedForCowork(staleChat, profiles, new Set([owner.email]))).toBe(false);
  });

  it("locks for the owner too — Cowork has no self-exception", () => {
    expect(isChatLockedForCowork(chat(), profiles, new Set([owner.email]))).toBe(true);
  });
});

describe("isChatLockedForViewer", () => {
  it("never locks out the owner in Solo", () => {
    expect(isChatLockedForViewer(chat(), owner.email, profiles, new Set([owner.email]))).toBe(false);
  });

  it("locks out a non-owner while the restriction is active", () => {
    expect(isChatLockedForViewer(chat(), other.email, profiles, new Set([owner.email]))).toBe(true);
  });

  it("lets a non-owner observe once the owner is idle/offline", () => {
    expect(isChatLockedForViewer(chat(), other.email, profiles, new Set())).toBe(false);
  });
});
