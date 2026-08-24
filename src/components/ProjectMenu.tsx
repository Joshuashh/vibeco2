import { useRef, useState } from "react";
import { Popover, PopoverHeader, PopoverRow, PopoverDivider } from "./Popover";
import { NewProjectDialog } from "./NewProjectDialog";
import { EditProjectDialog } from "./EditProjectDialog";
import { fetchAllProjects } from "../lib/persistProject";
import type { ProjectRow } from "../types/project";

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.83 2.83 0 0 1 4 4L7 21l-4 1 1-4Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

// Custom row (rather than the shared PopoverRow) because the hover-reveal
// edit button and the tick shifting to make room for it are specific to
// this menu — not worth adding to the shared row used by every other menu.
function ProjectRowItem({
  project,
  active,
  onSelect,
  onEdit,
}: {
  project: ProjectRow;
  active: boolean;
  onSelect: () => void;
  onEdit: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect()}
      className="group appearance-none bg-transparent border-0 outline-none font-normal text-left text-text-primary box-border flex items-center w-[calc(100%-8px)] mx-1 my-0 py-[7px] px-2.5 rounded-md text-[13px] cursor-default hover:bg-[rgba(236,236,236,0.08)]"
    >
      <span className="text-text-primary truncate">{project.name}</span>
      <span className="flex-1" />
      <button
        type="button"
        title="Edit project"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        className="flex items-center justify-center w-0 h-[18px] p-0 opacity-0 overflow-hidden appearance-none bg-transparent border-none rounded group-hover:w-[18px] group-hover:opacity-100 group-hover:mr-1.5 text-text-tertiary hover:text-text-primary transition-[width,opacity,margin] duration-150 shrink-0"
      >
        <PencilIcon />
      </button>
      {active && (
        <span className="flex w-[11px] h-[11px] text-text-primary shrink-0 [&>svg]:w-full [&>svg]:h-full">
          <CheckIcon />
        </span>
      )}
    </div>
  );
}

export function ProjectMenu({
  project,
  onSelectProject,
}: {
  project: ProjectRow;
  onSelectProject: (project: ProjectRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectRow | null>(null);
  const [projects, setProjects] = useState<ProjectRow[] | "loading">("loading");
  const anchorRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        className="flex items-center gap-[0.4em] h-[26px] text-text-secondary text-[0.85em] bg-transparent border-none rounded-md px-[0.5em] mr-[-0.5em] ml-[calc(4px-0.5em)] cursor-pointer transition-colors hover:bg-bg-tertiary hover:text-text-primary"
        onClick={() => {
          setOpen((o) => !o);
          fetchAllProjects().then(setProjects);
        }}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" className="shrink-0">
          <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.87-1.36-3.87-1.36-.53-1.33-1.29-1.69-1.29-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.78 1.19 1.78 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.18-1.18 3.18-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.07.78 2.15 0 1.55-.01 2.81-.01 3.19 0 .31.21.66.79.55A10.51 10.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
        </svg>
        {project.name}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} width={220}>
        <PopoverHeader title="Projects" />
        {projects === "loading" && <div className="text-[13px] text-text-tertiary px-3.5 pb-2">Loading...</div>}
        {projects !== "loading" &&
          projects.map((p) => (
            <ProjectRowItem
              key={p.id}
              project={p}
              active={p.id === project.id}
              onSelect={() => {
                setOpen(false);
                onSelectProject(p);
              }}
              onEdit={() => {
                setOpen(false);
                setEditingProject(p);
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
      {editingProject && (
        <EditProjectDialog
          open={editingProject !== null}
          project={editingProject}
          onClose={() => setEditingProject(null)}
          onSaved={(updated) => {
            setEditingProject(null);
            setProjects((prev) => (prev === "loading" ? prev : prev.map((p) => (p.id === updated.id ? updated : p))));
            if (updated.id === project.id) onSelectProject(updated);
          }}
        />
      )}
    </>
  );
}
