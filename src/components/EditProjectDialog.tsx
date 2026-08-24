import { useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import type { ProjectRow } from "../types/project";
import { updateProject } from "../lib/persistProject";

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
    </Dialog>
  );
}
