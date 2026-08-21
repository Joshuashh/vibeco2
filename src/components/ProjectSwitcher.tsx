import { useEffect, useState } from "react";
import type { ProjectRow } from "../types/project";
import { fetchAllProjects } from "../lib/persistProject";
import { NewProjectDialog } from "./NewProjectDialog";

export function ProjectSwitcher({ onSelect }: { onSelect: (project: ProjectRow) => void }) {
  const [projects, setProjects] = useState<ProjectRow[] | "loading">("loading");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAllProjects()
      .then(setProjects)
      .catch((err) => setError(err instanceof Error ? err.message : "failed to load projects"));
  }, []);

  return (
    <div className="flex items-center justify-center h-screen bg-bg-primary">
      <div className="flex flex-col gap-3 w-[320px]">
        <h1>Projects</h1>

        {projects === "loading" && <p className="text-text-secondary text-[0.9em] m-0">Loading...</p>}

        {projects !== "loading" && (
          <>
            {projects.length === 0 && <p className="text-text-secondary text-[0.9em] m-0">No projects yet.</p>}
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect(p)}
                className="flex flex-col items-start gap-0.5 rounded-md border border-border bg-bg-secondary px-3 py-2 text-left hover:bg-bg-tertiary"
              >
                <span className="text-text-primary">{p.name}</span>
                <span className="text-text-tertiary text-[0.8em]">{p.repo_url}</span>
              </button>
            ))}
            <button type="button" onClick={() => setCreating(true)}>
              New project
            </button>
          </>
        )}

        {error && <p className="text-danger text-[0.9em] m-0">{error}</p>}
      </div>

      <NewProjectDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(project) => {
          setCreating(false);
          onSelect(project);
        }}
      />
    </div>
  );
}
