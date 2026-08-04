import { describe, it, expect, vi, beforeEach } from "vitest";
import { signIn, signOut, getSession } from "./auth";
import { supabase } from "./supabase";

vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      getSession: vi.fn(),
    },
  },
}));

describe("auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("signIn resolves with the session on success", async () => {
    const session = { access_token: "tok", user: { id: "user-1" } };
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: { session, user: session.user },
      error: null,
    } as never);

    const result = await signIn("me@example.com", "hunter2");

    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "me@example.com",
      password: "hunter2",
    });
    expect(result).toEqual(session);
  });

  it("signIn throws a readable error on failure", async () => {
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: { session: null, user: null },
      error: { message: "Invalid login credentials" },
    } as never);

    await expect(signIn("me@example.com", "wrong")).rejects.toThrow(
      "Invalid login credentials"
    );
  });

  it("signOut calls supabase signOut", async () => {
    vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null } as never);

    await signOut();

    expect(supabase.auth.signOut).toHaveBeenCalled();
  });

  it("getSession returns the current session or null", async () => {
    const session = { access_token: "tok", user: { id: "user-1" } };
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session },
      error: null,
    } as never);

    const result = await getSession();

    expect(result).toEqual(session);
  });
});
