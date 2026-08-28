import { useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import type { ProjectRow } from "../types/project";
import { createProject } from "../lib/persistProject";
import { fetchMyRepos, NoGitHubTokenError, type GitHubRepo } from "../lib/github";

export function NewProjectDialog({
  open,
  teamId,
  onClose,
  onCreated,
}: {
  open: boolean;
  teamId: string;
  onClose: () => void;
  onCreated: (project: ProjectRow) => void;
}) {
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The signed-in user's GitHub repos, to pick from instead of typing a URL.
  // `null` = still loading; an empty array = loaded but none.
  const [repos, setRepos] = useState<GitHubRepo[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRepos(null);
    setReposError(null);
    fetchMyRepos()
      .then(setRepos)
      .catch((err) =>
        setReposError(
          err instanceof NoGitHubTokenError
            ? "Sign in with GitHub to pick from your repos — or paste a URL below."
            : err instanceof Error
              ? err.message
              : "Couldn't load your GitHub repos.",
        ),
      );
  }, [open]);

  function pickRepo(fullName: string) {
    const repo = repos?.find((r) => r.full_name === fullName);
    if (!repo) return;
    // `ssh_url` matches the existing "rely on your own git setup" model —
    // teammates clone with their own SSH key / gh auth.
    setRepoUrl(repo.ssh_url);
    if (!name.trim()) setName(repo.name);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const project = await createProject(name.trim(), repoUrl.trim(), teamId);
      setName("");
      setRepoUrl("");
      onCreated(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create project");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New project">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {repos === null && !reposError && (
          <p className="text-text-tertiary text-[0.85em] m-0">Loading your GitHub repos…</p>
        )}
        {repos && repos.length > 0 && (
          <select defaultValue="" onChange={(e) => pickRepo(e.target.value)}>
            <option value="" disabled>
              Pick a GitHub repo…
            </option>
            {repos.map((r) => (
              <option key={r.full_name} value={r.full_name}>
                {r.full_name}
                {r.private ? " (private)" : ""}
              </option>
            ))}
          </select>
        )}
        {reposError && <p className="text-text-tertiary text-[0.85em] m-0">{reposError}</p>}

        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Project name"
          autoFocus
          required
        />
        <input
          type="text"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="Repo URL (filled in when you pick one above)"
          required
        />
        <div className="flex gap-2">
          <button type="submit" disabled={submitting}>
            {submitting ? "Creating..." : "Create"}
          </button>
          <button type="button" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
        </div>
        {error && <p className="text-danger text-[0.9em] m-0">{error}</p>}
      </form>
    </Dialog>
  );
}
