import { useRef, useState } from "react";
import { Popover, PopoverHeader, PopoverRow, PopoverDivider } from "./Popover";
import { NewTeamDialog } from "./NewTeamDialog";
import { TeamMembersDialog } from "./TeamMembersDialog";
import { fetchMyTeams, type TeamRow } from "../lib/teams";

// Left segment of the Team ▾ / Project ▾ breadcrumb. Switching team is
// handled by the parent (App), which clears the selected project.
export function TeamMenu({
  team,
  onSelectTeam,
}: {
  team: TeamRow;
  onSelectTeam: (team: TeamRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);
  const [teams, setTeams] = useState<TeamRow[] | "loading">("loading");
  const anchorRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        className="flex items-center gap-[0.4em] h-[26px] text-text-secondary text-[0.85em] bg-transparent border-none rounded-md px-[0.5em] cursor-pointer transition-colors hover:bg-bg-tertiary hover:text-text-primary"
        onClick={() => {
          setOpen((o) => !o);
          fetchMyTeams().then(setTeams);
        }}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        {team.name}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} width={220}>
        <PopoverHeader title="Teams" />
        {teams === "loading" && <div className="text-[13px] text-text-tertiary px-3.5 pb-2">Loading...</div>}
        {teams !== "loading" &&
          teams.map((t) => (
            <PopoverRow
              key={t.id}
              title={t.name}
              checked={t.id === team.id}
              onClick={() => {
                setOpen(false);
                if (t.id !== team.id) onSelectTeam(t);
              }}
            />
          ))}
        <PopoverDivider />
        <PopoverRow
          title="Manage members"
          onClick={() => {
            setOpen(false);
            setManaging(true);
          }}
        />
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
      <TeamMembersDialog open={managing} team={team} onClose={() => setManaging(false)} />
    </>
  );
}
