import { supabase } from "./supabase";

export interface TeamRow {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  avatar_url: string | null;
}

const TEAM_COLS = "id, name, created_by, created_at, avatar_url";

export interface TeamMember {
  user_id: string;
  created_at: string;
}

// The teams the signed-in user belongs to. RLS (0028_teams.sql) already
// scopes this to the caller's memberships, so a plain select is enough.
export async function fetchMyTeams(): Promise<TeamRow[]> {
  const { data, error } = await supabase
    .from("teams")
    .select(TEAM_COLS)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`failed to fetch teams: ${error.message}`);
  return (data ?? []) as TeamRow[];
}

export async function createTeam(name: string): Promise<TeamRow> {
  // created_by defaults to auth.uid() at the column level.
  const { data, error } = await supabase
    .from("teams")
    .insert({ name })
    .select(TEAM_COLS)
    .single();
  if (error) throw new Error(`failed to create team: ${error.message}`);
  const team = data as TeamRow;
  // Creating a team you're not a member of would leave you unable to see it
  // (RLS is membership-scoped) — add yourself in the same call.
  const { error: memberErr } = await supabase
    .from("team_members")
    .insert({ team_id: team.id, user_id: team.created_by });
  if (memberErr) throw new Error(`team created but joining it failed: ${memberErr.message}`);
  return team;
}

export async function updateTeam(
  teamId: string,
  fields: { name?: string; avatar_url?: string | null },
): Promise<TeamRow> {
  const { data, error } = await supabase
    .from("teams")
    .update(fields)
    .eq("id", teamId)
    .select(TEAM_COLS)
    .single();
  if (error) throw new Error(`failed to update team: ${error.message}`);
  return data as TeamRow;
}

// Mirrors uploadAttachment — unique path per upload, public bucket. The
// previous avatar object is left orphaned (see 0030_team_avatars.sql).
export async function uploadTeamAvatar(teamId: string, file: File): Promise<string> {
  const path = `${teamId}/${crypto.randomUUID()}`;
  const { error } = await supabase.storage
    .from("team-avatars")
    .upload(path, file, { contentType: file.type || "image/png" });
  if (error) throw new Error(`failed to upload avatar: ${error.message}`);
  return supabase.storage.from("team-avatars").getPublicUrl(path).data.publicUrl;
}

export async function fetchTeamMembers(teamId: string): Promise<TeamMember[]> {
  const { data, error } = await supabase
    .from("team_members")
    .select("user_id, created_at")
    .eq("team_id", teamId);
  if (error) throw new Error(`failed to fetch team members: ${error.message}`);
  return (data ?? []) as TeamMember[];
}

export async function addTeamMember(teamId: string, userId: string): Promise<void> {
  const { error } = await supabase.from("team_members").insert({ team_id: teamId, user_id: userId });
  // A double-add races nothing important — the composite PK makes it a no-op.
  if (error && !error.message.includes("duplicate key")) {
    throw new Error(`failed to add member: ${error.message}`);
  }
}

export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("team_members")
    .delete()
    .eq("team_id", teamId)
    .eq("user_id", userId);
  if (error) throw new Error(`failed to remove member: ${error.message}`);
}
