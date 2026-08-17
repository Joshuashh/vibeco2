export interface ChatRow {
  id: string;
  title: string | null;
  user_id: string;
  position_x: number | null;
  position_y: number | null;
  claude_session_id: string | null;
  claude_session_owner: string | null;
  created_at: string;
}
