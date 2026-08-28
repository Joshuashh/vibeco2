import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { TeamAvatar } from "./TeamAvatar";
import { showToast } from "./ToastHost";
import { fetchProfiles, type Profile } from "../lib/profiles";
import {
  fetchTeamMembers,
  addTeamMember,
  removeTeamMember,
  updateTeam,
  uploadTeamAvatar,
  type TeamRow,
} from "../lib/teams";

// Rename a team, set its picture, and manage its membership — reached from
// the hover-reveal pencil on each row of the TeamMenu breadcrumb dropdown.
//
// Membership is a plain team_members row (FK to auth.users), so you can only
// add someone who has already signed in at least once — same constraint as
// the GitHub repo invite in EditProjectDialog. A real send-an-email invite
// flow would need a pending-invites table + a mailer; not built.
//
// ponytail: no admin/role model yet — the only real distinction is
// teams.created_by ("Owner"); everyone else shows "Member".
export function EditTeamDialog({
  open,
  team,
  onClose,
  onSaved,
}: {
  open: boolean;
  team: TeamRow;
  onClose: () => void;
  onSaved: (team: TeamRow) => void;
}) {
  const [name, setName] = useState(team.name);
  const [avatarUrl, setAvatarUrl] = useState(team.avatar_url);
  const [savingName, setSavingName] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(team.name);
    setAvatarUrl(team.avatar_url);
    setEmail("");
    setLoading(true);
    Promise.all([fetchProfiles(), fetchTeamMembers(team.id)])
      .then(([ps, ms]) => {
        setProfiles(ps);
        setMemberIds(new Set(ms.map((m) => m.user_id)));
      })
      .catch((err) => showToast(err instanceof Error ? err.message : "Couldn't load the team."))
      .finally(() => setLoading(false));
  }, [open, team.id, team.name, team.avatar_url]);

  const members = profiles.filter((p) => memberIds.has(p.id));

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === team.name) return;
    setSavingName(true);
    try {
      onSaved(await updateTeam(team.id, { name: trimmed }));
      showToast("Team name updated.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't rename the team.");
    } finally {
      setSavingName(false);
    }
  }

  async function pickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const url = await uploadTeamAvatar(team.id, file);
      setAvatarUrl(url);
      onSaved(await updateTeam(team.id, { avatar_url: url }));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't upload that image.");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function addByEmail(e: React.FormEvent) {
    e.preventDefault();
    const wanted = email.trim().toLowerCase();
    if (!wanted) return;
    const match = profiles.find((p) => p.email.toLowerCase() === wanted);
    if (!match) {
      showToast("No account for that email yet — they need to sign in once first.");
      return;
    }
    if (memberIds.has(match.id)) {
      showToast(`${match.display_name || match.email} is already on the team.`);
      return;
    }
    setBusy(true);
    try {
      await addTeamMember(team.id, match.id);
      setMemberIds((prev) => new Set(prev).add(match.id));
      setEmail("");
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
    <Dialog open={open} onClose={onClose} title="Edit team">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 flex items-center justify-center rounded-full bg-bg-tertiary text-text-tertiary overflow-hidden shrink-0">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <TeamAvatar team={{ name, avatar_url: null }} size={22} />
            )}
          </span>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploadingAvatar}
            className="text-[0.85em]"
          >
            {uploadingAvatar ? "Uploading…" : avatarUrl ? "Change picture" : "Add picture"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickAvatar} />
        </div>

        <form onSubmit={saveName} className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Team name"
            required
            className="flex-1 min-w-0"
          />
          <button
            type="submit"
            disabled={savingName || !name.trim() || name.trim() === team.name}
            className="shrink-0"
          >
            {savingName ? "Saving…" : "Save"}
          </button>
        </form>

        <div className="flex flex-col gap-2">
          <span className="text-text-secondary text-[0.8em]">Members</span>
          {loading ? (
            <p className="text-text-tertiary text-[0.85em] m-0">Loading…</p>
          ) : (
            <>
              <ul className="list-none p-0 m-0 flex flex-col gap-1.5">
                {members.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 text-[13px]">
                    <span className="flex flex-col min-w-0 flex-1">
                      <span className="text-text-primary truncate">{p.display_name || p.email}</span>
                      <span className="text-text-tertiary text-[0.8em] truncate">{p.email}</span>
                    </span>
                    <span className="text-text-tertiary text-[0.75em] shrink-0">
                      {p.id === team.created_by ? "Owner" : "Member"}
                    </span>
                    <button
                      type="button"
                      onClick={() => remove(p.id)}
                      disabled={busy || members.length <= 1}
                      title={members.length <= 1 ? "A team needs at least one member" : "Remove from team"}
                      className="text-text-tertiary hover:text-danger text-[0.8em] bg-transparent border-none cursor-pointer disabled:opacity-40 shrink-0"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>

              <form onSubmit={addByEmail} className="flex gap-2 pt-2 border-t border-border">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teammate@email.com"
                  disabled={busy}
                  className="flex-1 min-w-0"
                />
                <button type="submit" disabled={busy || !email.trim()} className="shrink-0">
                  Add
                </button>
              </form>
              <p className="text-text-tertiary text-[0.75em] m-0">
                They need to have signed in once before you can add them.
              </p>
            </>
          )}
        </div>

        <div className="flex justify-end">
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Dialog>
  );
}
