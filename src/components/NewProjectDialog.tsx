import { useState } from "react";
import { Dialog } from "./Dialog";
import type { ProjectRow } from "../types/project";
import { createProject } from "../lib/persistProject";

export function NewProjectDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (project: ProjectRow) => void;
}) {
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const project = await createProject(name.trim(), repoUrl.trim());
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
