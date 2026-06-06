export interface ConversationSummary {
  id: string;
  session_id: string;
  workspace_id: string;
  summary_type: 'info' | 'extensive';
  content: string;
  key_topics: string[];
  message_range_start: number;
  message_range_end: number;
  token_count: number;
  created_at: string;
  updated_at: string;
}
