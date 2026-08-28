import { supabase } from "./supabase";
import type { ProjectRow } from "../types/project";

export async function fetchAllProjects(teamId: string): Promise<ProjectRow[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("team_id", teamId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`failed to fetch projects: ${error.message}`);
  return (data ?? []) as ProjectRow[];
}

export async function createProject(name: string, repoUrl: string, teamId: string): Promise<ProjectRow> {
  const { data, error } = await supabase
    .from("projects")
    .insert({ name, repo_url: repoUrl, team_id: teamId })
    .select("*")
    .single();
  if (error) throw new Error(`failed to create project: ${error.message}`);
  return data as ProjectRow;
}

export async function updateProject(id: string, name: string, repoUrl: string): Promise<ProjectRow> {
  const { data, error } = await supabase
    .from("projects")
    .update({ name, repo_url: repoUrl })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`failed to update project: ${error.message}`);
  return data as ProjectRow;
}
