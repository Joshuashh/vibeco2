import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchMyRepos, addCollaborator, parseOwnerRepo, NoGitHubTokenError } from "./github";
import { getGitHubToken } from "./auth";

vi.mock("./auth", () => ({ getGitHubToken: vi.fn() }));

describe("fetchMyRepos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws NoGitHubTokenError when there's no stored token", async () => {
    vi.mocked(getGitHubToken).mockReturnValue(null);
    await expect(fetchMyRepos()).rejects.toBeInstanceOf(NoGitHubTokenError);
  });

  it("sends the token and maps the response down to the fields we use", async () => {
    vi.mocked(getGitHubToken).mockReturnValue("gho_abc");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          full_name: "josh/vibeco",
          name: "vibeco",
          ssh_url: "git@github.com:josh/vibeco.git",
          clone_url: "https://github.com/josh/vibeco.git",
          private: true,
          updated_at: "2026-08-01T00:00:00Z",
          stargazers_count: 3,
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const repos = await fetchMyRepos();

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("api.github.com/user/repos");
    expect(opts.headers.Authorization).toBe("Bearer gho_abc");
    expect(repos).toEqual([
      {
        full_name: "josh/vibeco",
        name: "vibeco",
        ssh_url: "git@github.com:josh/vibeco.git",
        clone_url: "https://github.com/josh/vibeco.git",
        private: true,
        updated_at: "2026-08-01T00:00:00Z",
      },
    ]);
  });

  it("maps a 401 to NoGitHubTokenError", async () => {
    vi.mocked(getGitHubToken).mockReturnValue("stale");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    await expect(fetchMyRepos()).rejects.toBeInstanceOf(NoGitHubTokenError);
  });
});

describe("parseOwnerRepo", () => {
  it.each([
    ["git@github.com:josh/vibeco.git", { owner: "josh", repo: "vibeco" }],
    ["https://github.com/josh/vibeco.git", { owner: "josh", repo: "vibeco" }],
    ["https://github.com/josh/vibeco", { owner: "josh", repo: "vibeco" }],
    ["ssh://git@github.com/an-org/some.repo.git", { owner: "an-org", repo: "some.repo" }],
  ])("parses %s", (url, expected) => {
    expect(parseOwnerRepo(url)).toEqual(expected);
  });

  it("returns null for a non-GitHub URL", () => {
    expect(parseOwnerRepo("git@gitlab.com:josh/vibeco.git")).toBeNull();
  });
});

describe("addCollaborator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGitHubToken).mockReturnValue("gho_abc");
  });

  it("returns 'invited' on 201 and PUTs the right URL with push permission", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 201 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(addCollaborator("josh", "vibeco", "ben")).resolves.toBe("invited");

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/josh/vibeco/collaborators/ben");
    expect(opts.method).toBe("PUT");
    expect(JSON.parse(opts.body)).toEqual({ permission: "push" });
  });

  it("returns 'already' on 204", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 204 }));
    await expect(addCollaborator("josh", "vibeco", "ben")).resolves.toBe("already");
  });

  it("gives a clear error on 403 (not an admin)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 403 }));
    await expect(addCollaborator("josh", "vibeco", "ben")).rejects.toThrow(/admin access/);
  });
});
