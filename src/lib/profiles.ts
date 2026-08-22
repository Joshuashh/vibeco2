import { supabase } from "./supabase";

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  color: string | null;
}

export async function fetchProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, color")
    .order("email", { ascending: true });
  if (error) throw new Error(`failed to fetch profiles: ${error.message}`);
  return (data ?? []) as Profile[];
}

export async function updateMyProfile(
  userId: string,
  updates: { display_name?: string | null; color?: string | null }
): Promise<void> {
  const { error } = await supabase.from("profiles").update(updates).eq("id", userId);
  if (error) throw new Error(`failed to update profile: ${error.message}`);
}
