import { getGitHubToken } from "./auth";

export interface GitHubRepo {
  full_name: string;
  name: string;
  ssh_url: string;
  clone_url: string;
  private: boolean;
  updated_at: string;
}

/** Thrown when there's no GitHub token — the user signed in with a password,
 *  or the stored token was rejected. Callers show a "sign in with GitHub" hint. */
export class NoGitHubTokenError extends Error {
  constructor() {
    super("Sign in with GitHub to list your repositories.");
    this.name = "NoGitHubTokenError";
  }
}

// Most-recently-pushed first, including repos reached as a collaborator or
// through an org — not just ones the user owns.
// ponytail: no pagination — 100 repos is plenty for now; add a `page` loop
// if someone actually has more than that to choose from.
export async function fetchMyRepos(): Promise<GitHubRepo[]> {
  const token = getGitHubToken();
  if (!token) throw new NoGitHubTokenError();

  const res = await fetch(
    "https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member",
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } },
  );
  if (res.status === 401) throw new NoGitHubTokenError();
  if (!res.ok) throw new Error(`GitHub API error (${res.status})`);

  const raw = (await res.json()) as GitHubRepo[];
  return raw.map((r) => ({
    full_name: r.full_name,
    name: r.name,
    ssh_url: r.ssh_url,
    clone_url: r.clone_url,
    private: r.private,
    updated_at: r.updated_at,
  }));
}

const GITHUB_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
});

/** Pull `owner`/`repo` out of any of the URL shapes a project's repo_url can
 *  take: `git@github.com:owner/repo.git`, `https://github.com/owner/repo`,
 *  `ssh://git@github.com/owner/repo.git`. Returns null for non-GitHub URLs. */
export function parseOwnerRepo(repoUrl: string): { owner: string; repo: string } | null {
  const m = repoUrl.match(/github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}

/** Invite `login` to `owner/repo` with push access. "already" = they were
 *  already a collaborator; "invited" = GitHub sent them an invite to accept
 *  (their app auto-accepts it via `acceptPendingInvites`). */
export async function addCollaborator(
  owner: string,
  repo: string,
  login: string,
): Promise<"invited" | "already"> {
  const token = getGitHubToken();
  if (!token) throw new NoGitHubTokenError();

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/collaborators/${login}`, {
    method: "PUT",
    headers: { ...GITHUB_HEADERS(token), "Content-Type": "application/json" },
    body: JSON.stringify({ permission: "push" }),
  });
  if (res.status === 204) return "already";
  if (res.status === 201) return "invited";
  if (res.status === 401) throw new NoGitHubTokenError();
  if (res.status === 403) throw new Error("You need admin access to that repo to add collaborators.");
  if (res.status === 404 || res.status === 422) {
    throw new Error(`GitHub couldn't find a user named "${login}" (or the repo).`);
  }
  throw new Error(`GitHub API error (${res.status})`);
}

/** Accept the current user's pending repo invitations. With `onlyRepoFullNames`
 *  given, accepts just the ones matching (e.g. the project you're opening);
 *  without it, accepts all. Best-effort — never throws, returns how many it
 *  accepted. A no-op for password sign-ins (no token). */
export async function acceptPendingInvites(onlyRepoFullNames?: string[]): Promise<number> {
  const token = getGitHubToken();
  if (!token) return 0;

  const res = await fetch("https://api.github.com/user/repository_invitations", {
    headers: GITHUB_HEADERS(token),
  });
  if (!res.ok) return 0;

  const invites = (await res.json()) as { id: number; repository: { full_name: string } }[];
  const wanted = onlyRepoFullNames ? new Set(onlyRepoFullNames.map((s) => s.toLowerCase())) : null;

  let accepted = 0;
  for (const inv of invites) {
    if (wanted && !wanted.has(inv.repository.full_name.toLowerCase())) continue;
    const r = await fetch(`https://api.github.com/user/repository_invitations/${inv.id}`, {
      method: "PATCH",
      headers: GITHUB_HEADERS(token),
    });
    if (r.ok) accepted++;
  }
  return accepted;
}
