import { useRef, useState } from "react";
import { Popover, PopoverHeader, PopoverRow, PopoverDivider } from "./Popover";
import { NewTeamDialog } from "./NewTeamDialog";
import { EditTeamDialog } from "./EditTeamDialog";
import { TeamAvatar } from "./TeamAvatar";
import { fetchMyTeams, type TeamRow } from "../lib/teams";

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

// Row with a hover-reveal edit button — mirrors ProjectMenu's ProjectRowItem.
// Clicking the row switches team; the pencil opens the edit modal.
function TeamRowItem({
  team,
  active,
  onSelect,
  onEdit,
}: {
  team: TeamRow;
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
      <span className="text-text-primary truncate">{team.name}</span>
      <span className="flex-1" />
      <button
        type="button"
        title="Edit team"
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

// Left segment of the Team ▾ / Project ▾ breadcrumb. Switching team is
// handled by the parent (App), which clears the selected project; an
// in-place edit (rename) goes through onTeamUpdated so the project stays.
export function TeamMenu({
  team,
  onSelectTeam,
  onTeamUpdated,
}: {
  team: TeamRow;
  onSelectTeam: (team: TeamRow) => void;
  onTeamUpdated: (team: TeamRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TeamRow | null>(null);
  const [teams, setTeams] = useState<TeamRow[] | "loading">("loading");
  const anchorRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        className="flex items-center gap-[0.4em] h-[26px] text-text-secondary text-[0.78em] bg-transparent border-none rounded-md px-[0.5em] cursor-pointer transition-colors hover:bg-bg-tertiary hover:text-text-primary"
        onClick={() => {
          setOpen((o) => !o);
          fetchMyTeams().then(setTeams);
        }}
      >
        <TeamAvatar team={team} size={16} />
        {team.name}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} width={220}>
        <PopoverHeader title="Teams" />
        {teams === "loading" && <div className="text-[13px] text-text-tertiary px-3.5 pb-2">Loading...</div>}
        {teams !== "loading" &&
          teams.map((t) => (
            <TeamRowItem
              key={t.id}
              team={t}
              active={t.id === team.id}
              onSelect={() => {
                setOpen(false);
                if (t.id !== team.id) onSelectTeam(t);
              }}
              onEdit={() => {
                setOpen(false);
                setEditingTeam(t);
              }}
            />
          ))}
        <PopoverDivider />
        <PopoverRow
          title="New team"
          onClick={() => {
            setOpen(false);
            setCreating(true);
          }}
        />
      </Popover>
      <NewTeamDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(newTeam) => {
          setCreating(false);
          onSelectTeam(newTeam);
        }}
      />
      {editingTeam && (
        <EditTeamDialog
          open={editingTeam !== null}
          team={editingTeam}
          onClose={() => setEditingTeam(null)}
          onSaved={(updated) => {
            setTeams((prev) => (prev === "loading" ? prev : prev.map((t) => (t.id === updated.id ? updated : t))));
            setEditingTeam(updated);
            onTeamUpdated(updated);
          }}
        />
      )}
    </>
  );
}
