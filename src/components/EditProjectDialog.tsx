import { useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import { showToast } from "./ToastHost";
import type { ProjectRow } from "../types/project";
import { updateProject } from "../lib/persistProject";
import { fetchProfiles, type Profile } from "../lib/profiles";
import { getSession, getGitHubToken } from "../lib/auth";
import { addCollaborator, parseOwnerRepo } from "../lib/github";

export function EditProjectDialog({
  open,
  project,
  onClose,
  onSaved,
}: {
  open: boolean;
  project: ProjectRow;
  onClose: () => void;
  onSaved: (project: ProjectRow) => void;
}) {
  const [name, setName] = useState(project.name);
  const [repoUrl, setRepoUrl] = useState(project.repo_url);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Re-sync the fields whenever the dialog is (re-)opened for this project,
  // so a prior edit's leftover state doesn't linger into the next open.
  useEffect(() => {
    if (open) {
      setName(project.name);
      setRepoUrl(project.repo_url);
      setError(null);
    }
  }, [open, project]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const updated = await updateProject(project.id, name.trim(), repoUrl.trim());
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to update project");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Edit project">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
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
          placeholder="GitHub repo (e.g. git@github.com:org/repo.git)"
          required
        />
        <div className="flex gap-2">
          <button type="submit" disabled={submitting}>
            {submitting ? "Saving..." : "Save"}
          </button>
          <button type="button" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
        </div>
        {error && <p className="text-danger text-[0.9em] m-0">{error}</p>}
      </form>

      <InviteTeammate open={open} repoUrl={project.repo_url} />
    </Dialog>
  );
}

// Invite a teammate to this project's GitHub repo as a collaborator, by their
// stored GitHub username (profiles.github_login) — GitHub sends them an
// invite, and their own app auto-accepts it (App.tsx open-project effect).
function InviteTeammate({ open, repoUrl }: { open: boolean; repoUrl: string }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected("");
    getSession().then((s) => setMyId(s?.user.id ?? null));
    fetchProfiles().then(setProfiles).catch(() => setProfiles([]));
  }, [open]);

  const ownerRepo = parseOwnerRepo(repoUrl);
  const invitable = profiles.filter((p) => p.id !== myId && p.github_login);
  const missingLogin = profiles.filter((p) => p.id !== myId && !p.github_login);

  if (!getGitHubToken()) {
    return (
      <p className="mt-3 pt-3 border-t border-border text-text-tertiary text-[0.8em] m-0">
        Sign in with GitHub to invite teammates to this repo.
      </p>
    );
  }
  if (!ownerRepo) {
    return (
      <p className="mt-3 pt-3 border-t border-border text-text-tertiary text-[0.8em] m-0">
        Set a github.com repo URL above to invite teammates.
      </p>
    );
  }

  async function invite() {
    const login = invitable.find((p) => p.id === selected)?.github_login;
    if (!login || !ownerRepo) return;
    if (
      !window.confirm(
        `Give ${login} push access to ${ownerRepo.owner}/${ownerRepo.repo} on GitHub?`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const result = await addCollaborator(ownerRepo.owner, ownerRepo.repo, login);
      showToast(
        result === "already"
          ? `${login} already has access.`
          : `Invited ${login} — they'll get access once their app picks it up.`,
      );
      setSelected("");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't send that invite.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-border flex flex-col gap-2">
      <span className="text-text-secondary text-[0.8em]">
        Invite a teammate to {ownerRepo.owner}/{ownerRepo.repo}
      </span>
      {invitable.length === 0 ? (
        <p className="text-text-tertiary text-[0.8em] m-0">
          No teammates with a known GitHub username yet — they each need to sign in with GitHub once.
        </p>
      ) : (
        <div className="flex gap-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={busy}
            className="flex-1"
          >
            <option value="" disabled>
              Pick a teammate…
            </option>
            {invitable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name || p.email} ({p.github_login})
              </option>
            ))}
          </select>
          <button type="button" onClick={invite} disabled={busy || !selected}>
            {busy ? "Inviting…" : "Invite"}
          </button>
        </div>
      )}
      {missingLogin.length > 0 && invitable.length > 0 && (
        <p className="text-text-tertiary text-[0.75em] m-0">
          Not shown (no GitHub sign-in yet): {missingLogin.map((p) => p.display_name || p.email).join(", ")}
        </p>
      )}
    </div>
  );
}
