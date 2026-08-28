import { useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import { showToast } from "./ToastHost";
import { fetchProfiles, type Profile } from "../lib/profiles";
import { fetchTeamMembers, addTeamMember, removeTeamMember, type TeamRow } from "../lib/teams";

// Team membership is a plain team_members row, added/removed here. This is
// separate from GitHub repo access (see EditProjectDialog's InviteTeammate) —
// being on the team lets you see the team's projects; cloning each repo still
// needs its own GitHub collaborator invite.
export function TeamMembersDialog({
  open,
  team,
  onClose,
}: {
  open: boolean;
  team: TeamRow;
  onClose: () => void;
}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSelected("");
    Promise.all([fetchProfiles(), fetchTeamMembers(team.id)])
      .then(([ps, ms]) => {
        setProfiles(ps);
        setMemberIds(new Set(ms.map((m) => m.user_id)));
      })
      .catch((err) => showToast(err instanceof Error ? err.message : "Couldn't load team members."))
      .finally(() => setLoading(false));
  }, [open, team.id]);

  const members = profiles.filter((p) => memberIds.has(p.id));
  const addable = profiles.filter((p) => !memberIds.has(p.id));

  async function add() {
    if (!selected) return;
    setBusy(true);
    try {
      await addTeamMember(team.id, selected);
      setMemberIds((prev) => new Set(prev).add(selected));
      setSelected("");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't add that person.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: string) {
    setBusy(true);
    try {
      await removeTeamMember(team.id, userId);
      setMemberIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't remove that person.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={`${team.name} — members`}>
      <div className="flex flex-col gap-3">
        {loading ? (
          <p className="text-text-tertiary text-[0.85em] m-0">Loading…</p>
        ) : (
          <>
            <ul className="list-none p-0 m-0 flex flex-col gap-1">
              {members.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-[13px] text-text-primary">
                  <span className="truncate flex-1">{p.display_name || p.email}</span>
                  <button
                    type="button"
                    onClick={() => remove(p.id)}
                    disabled={busy || members.length <= 1}
                    title={members.length <= 1 ? "A team needs at least one member" : "Remove from team"}
                    className="text-text-tertiary hover:text-danger text-[0.8em] bg-transparent border-none cursor-pointer disabled:opacity-40"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>

            {addable.length > 0 && (
              <div className="flex gap-2 pt-2 border-t border-border">
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  disabled={busy}
                  className="flex-1"
                >
                  <option value="" disabled>
                    Add a teammate…
                  </option>
                  {addable.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name || p.email}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={add} disabled={busy || !selected}>
                  Add
                </button>
              </div>
            )}
          </>
        )}
        <div className="flex justify-end">
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Dialog>
  );
}
