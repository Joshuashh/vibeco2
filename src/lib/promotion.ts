import { supabase } from "./supabase";

// The team -> main promotion gate (Preview tab, Team mode). An approval is
// bound to the exact `team` sha it was given for — see 0026_promotion_approvals.sql.
export interface PromotionApproval {
  id: string;
  project_id: string;
  team_sha: string;
  approved_by: string;
  approver_name: string;
  created_at: string;
}

export async function fetchPromotionApprovals(projectId: string): Promise<PromotionApproval[]> {
  const { data, error } = await supabase
    .from("promotion_approvals")
    .select("*")
    .eq("project_id", projectId);
  if (error) throw new Error(`failed to fetch promotion approvals: ${error.message}`);
  return (data ?? []) as PromotionApproval[];
}

export async function insertPromotionApproval(params: {
  projectId: string;
  teamSha: string;
  approvedBy: string;
  approverName: string;
}): Promise<void> {
  const { error } = await supabase.from("promotion_approvals").insert({
    project_id: params.projectId,
    team_sha: params.teamSha,
    approved_by: params.approvedBy,
    approver_name: params.approverName,
  });
  // A second click races the realtime echo — the unique constraint makes the
  // duplicate a no-op, not a real error.
  if (error && !error.message.includes("duplicate key")) {
    throw new Error(`failed to record approval: ${error.message}`);
  }
}

/** Clears every approval for a project — called after a successful promote so
 * the next round starts from zero. */
export async function clearPromotionApprovals(projectId: string): Promise<void> {
  const { error } = await supabase.from("promotion_approvals").delete().eq("project_id", projectId);
  if (error) throw new Error(`failed to clear approvals: ${error.message}`);
}
