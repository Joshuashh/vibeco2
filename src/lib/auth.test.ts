import { describe, it, expect, vi, beforeEach } from "vitest";
import { signIn, signInWithGitHub, signOut, getSession } from "./auth";
import { supabase } from "./supabase";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

const profilesEq = vi.fn(() => Promise.resolve({ error: null }));
const profilesUpdate = vi.fn(() => ({ eq: profilesEq }));

vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signInWithOAuth: vi.fn(),
      exchangeCodeForSession: vi.fn(),
      signOut: vi.fn(),
      getSession: vi.fn(),
    },
    from: vi.fn(() => ({ update: profilesUpdate })),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

describe("auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // vitest's default node environment has no localStorage.
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
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

  it("signInWithGitHub opens the browser, exchanges the code, and stores the provider token", async () => {
    vi.mocked(supabase.auth.signInWithOAuth).mockResolvedValue({
      data: { provider: "github", url: "https://github.test/login/oauth/authorize" },
      error: null,
    } as never);
    vi.mocked(invoke).mockResolvedValue("auth-code-123");
    const session = {
      access_token: "tok",
      provider_token: "gho_abc",
      user: { id: "user-1", user_metadata: { user_name: "joshhub" } },
    };
    vi.mocked(supabase.auth.exchangeCodeForSession).mockResolvedValue({
      data: { session, user: session.user },
      error: null,
    } as never);

    const result = await signInWithGitHub();

    expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "github",
        options: expect.objectContaining({ redirectTo: "http://127.0.0.1:8899" }),
      }),
    );
    expect(openUrl).toHaveBeenCalledWith("https://github.test/login/oauth/authorize");
    expect(invoke).toHaveBeenCalledWith("oauth_listen", { port: 8899 });
    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith("auth-code-123");
    expect(result).toEqual(session);
    expect(localStorage.getItem("vibeco.github_provider_token")).toBe("gho_abc");
    // GitHub username persisted for teammate invites.
    expect(supabase.from).toHaveBeenCalledWith("profiles");
    expect(profilesUpdate).toHaveBeenCalledWith({ github_login: "joshhub" });
  });

  it("signInWithGitHub surfaces an exchange failure", async () => {
    vi.mocked(supabase.auth.signInWithOAuth).mockResolvedValue({
      data: { provider: "github", url: "https://github.test/x" },
      error: null,
    } as never);
    vi.mocked(invoke).mockResolvedValue("bad-code");
    vi.mocked(supabase.auth.exchangeCodeForSession).mockResolvedValue({
      data: { session: null, user: null },
      error: { message: "invalid grant" },
    } as never);

    await expect(signInWithGitHub()).rejects.toThrow("invalid grant");
  });

  it("signOut calls supabase signOut and clears the GitHub token", async () => {
    localStorage.setItem("vibeco.github_provider_token", "gho_abc");
    vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null } as never);

    await signOut();

    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(localStorage.getItem("vibeco.github_provider_token")).toBeNull();
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
