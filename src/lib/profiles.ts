import { supabase } from "./supabase";

export interface Profile {
  id: string;
  email: string;
}

export async function fetchProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase.from("profiles").select("id, email").order("email", { ascending: true });
  if (error) throw new Error(`failed to fetch profiles: ${error.message}`);
  return (data ?? []) as Profile[];
}
