import { useState } from "react";
import { Dialog } from "./Dialog";
import { createTeam, type TeamRow } from "../lib/teams";

export function NewTeamDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (team: TeamRow) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const team = await createTeam(name.trim());
      setName("");
      onCreated(team);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create team");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New team">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Team name"
          autoFocus
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
