export interface ChatRow {
  id: string;
  title: string | null;
  user_id: string;
  position_x: number | null;
  position_y: number | null;
  claude_session_id: string | null;
  claude_session_owner: string | null;
  created_at: string;
  sort_order: number;
  group_name: string | null;
  archived_at: string | null;
  last_message_at: string | null;
  project_id: string | null;
}
