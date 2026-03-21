export interface Artifact {
  id: string;
  workspace_id: string;
  session_id: string | null;
  message_id: string | null;
  title: string;
  artifact_type: string;
  language: string;
  content: string;
  description: string;
  tags: string; // JSON string
  is_pinned: boolean;
  version: number;
  parent_artifact_id: string | null;
  token_count: number;
  created_at: string;
  updated_at: string;
}

export interface ArtifactSummary {
  id: string;
  title: string;
  artifact_type: string;
  language: string;
  description: string;
  tags: string[];
  is_pinned: boolean;
  version: number;
  updated_at: string;
}

export interface CreateArtifactRequest {
  workspace_id: string;
  session_id?: string | null;
  message_id?: string | null;
  title: string;
  artifact_type: string;
  language: string;
  content: string;
  description: string;
  tags?: string[];
  parent_artifact_id?: string | null;
}
