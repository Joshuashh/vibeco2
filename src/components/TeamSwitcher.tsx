import { useEffect, useState } from "react";
import { fetchMyTeams, type TeamRow } from "../lib/teams";
import { NewTeamDialog } from "./NewTeamDialog";

export function TeamSwitcher({ onSelect }: { onSelect: (team: TeamRow) => void }) {
  const [teams, setTeams] = useState<TeamRow[] | "loading">("loading");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMyTeams()
      .then(setTeams)
      .catch((err) => setError(err instanceof Error ? err.message : "failed to load teams"));
  }, []);

  return (
    <div className="flex items-center justify-center h-screen bg-bg-primary">
      <div className="flex flex-col gap-3 w-[320px]">
        <h1>Teams</h1>

        {teams === "loading" && <p className="text-text-secondary text-[0.9em] m-0">Loading...</p>}

        {teams !== "loading" && (
          <>
            {teams.length === 0 && (
              <p className="text-text-secondary text-[0.9em] m-0">You're not on any team yet.</p>
            )}
            {teams.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelect(t)}
                className="flex flex-col items-start gap-0.5 rounded-md border border-border bg-bg-secondary px-3 py-2 text-left hover:bg-bg-tertiary"
              >
                <span className="text-text-primary">{t.name}</span>
              </button>
            ))}
            <button type="button" onClick={() => setCreating(true)}>
              New team
            </button>
          </>
        )}

        {error && <p className="text-danger text-[0.9em] m-0">{error}</p>}
      </div>

      <NewTeamDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(team) => {
          setCreating(false);
          onSelect(team);
        }}
      />
    </div>
  );
}
