import { useRef, useState } from "react";
import { Popover, PopoverHeader, PopoverRow, PopoverDivider } from "./Popover";
import { NewProjectDialog } from "./NewProjectDialog";
import { fetchAllProjects } from "../lib/persistProject";
import type { ProjectRow } from "../types/project";

export function ProjectMenu({
  project,
  onSelectProject,
}: {
  project: ProjectRow;
  onSelectProject: (project: ProjectRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [projects, setProjects] = useState<ProjectRow[] | "loading">("loading");
  const anchorRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        className="text-text-secondary text-[0.85em] bg-transparent border-none rounded-md px-[0.5em] py-[0.3em] -mx-[0.5em] cursor-pointer transition-colors hover:bg-bg-tertiary hover:text-text-primary"
        onClick={() => {
          setOpen((o) => !o);
          fetchAllProjects().then(setProjects);
        }}
      >
        {project.name}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} width={220}>
        <PopoverHeader title="Projects" />
        {projects === "loading" && <div className="text-[13px] text-text-tertiary px-3.5 pb-2">Loading...</div>}
        {projects !== "loading" &&
          projects.map((p) => (
            <PopoverRow
              key={p.id}
              title={p.name}
              checked={p.id === project.id}
              onClick={() => {
                setOpen(false);
                onSelectProject(p);
              }}
            />
          ))}
        <PopoverDivider />
        <PopoverRow
          title="New project"
          onClick={() => {
            setOpen(false);
            setCreating(true);
          }}
        />
      </Popover>
      <NewProjectDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(newProject) => {
          setCreating(false);
          onSelectProject(newProject);
        }}
      />
    </>
  );
}
