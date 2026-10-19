export type UserRole = "participant" | "external_annotator" | "researcher";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export enum GroupStatus {
  PENDING = "pending",
  ACTIVE = "active",
  CONVERSATION_COMPLETE = "conversation_complete",
  CONSTRUCTION_COMPLETE = "construction_complete",
  ANNOTATION_COMPLETE = "annotation_complete",
  DELIBERATION_COMPLETE = "deliberation_complete",
}

export interface Turn {
  id: string;
  conversation_id: string;
  turn_number: number;
  speaker_id: string;
  speaker_name: string;
  text: string;
  timestamp: string;
  flagged?: boolean;
}

export interface Conversation {
  id: string;
  group_id: string;
  topic: string;
  started_at: string;
  ended_at: string | null;
  turns: Turn[];
}

export interface KnowledgeItem {
  id: string;
  conversation_id: string;
  author_id: string;
  raw_ideal_response: string;
  neutralized_ideal_response?: string;
  ai_suggestion_used: boolean;
  window_start_turn_number: number;
  window_end_turn_number: number;
  best_turn_number: number;
  contribution_type: string;
  contribution_type_detail?: string;
  pertinence: number;
  notes?: string;
  source: string;
  review_status: string;
  inserted_resources?: string;
  ai_interaction_log?: string;
  created_at: string;
}

export interface SearchResult {
  id: string;
  query: string;
  result_title: string;
  result_snippet?: string;
  result_url?: string;
  result_metadata?: Record<string, unknown>;
}

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface Annotation {
  id: string;
  excerpt_id: string;
  knowledge_item_id: string;
  annotator_id: string;
  annotator_role: string;
  phase: string;
  window_start_turn_number: number | null;
  window_end_turn_number: number | null;
  best_turn_number: number | null;
  do_not_surface: boolean;
  extends_before: boolean;
  extends_after: boolean;
  contribution_type: string | null;
  contribution_type_detail?: string | null;
  pertinence: number | null;
  rationale: string | null;
  revision_of_id: string | null;
  created_at: string;
}

export interface ExcerptDetail {
  id: string;
  conversation_id: string;
  knowledge_item_id: string;
  start_turn_number: number;
  end_turn_number: number;
  conversation_min_turn: number;
  conversation_max_turn: number;
  preceding_context_summary: string | null;
  following_context_summary: string | null;
  turns: Turn[];
  knowledge_item: {
    neutralized_ideal_response: string;
    contribution_type: string;
  };
}

export interface Assignment {
  excerpt_id: string;
  conversation_id: string;
  knowledge_item_id: string;
  excerpt_start_turn: number;
  excerpt_end_turn: number;
  item_contribution_type: string;
  completed: boolean;
}

export interface AnnotationProgress {
  total: number;
  completed: number;
  pending: number;
}

export interface PeerAnnotation {
  annotator_label: string;
  window_start_turn_number: number | null;
  window_end_turn_number: number | null;
  best_turn_number: number | null;
  do_not_surface: boolean;
  extends_before: boolean;
  extends_after: boolean;
  rationale: string | null;
  contribution_type: string | null;
  pertinence: number | null;
}

export interface PeersResponse {
  peers: PeerAnnotation[];
  own_annotation: Annotation;
}

export interface RevisionPayload {
  window_start_turn_number: number | null;
  window_end_turn_number: number | null;
  best_turn_number: number | null;
  do_not_surface: boolean;
  extends_before: boolean;
  extends_after: boolean;
  rationale?: string;
  contribution_type?: string | null;
  contribution_type_detail?: string | null;
  pertinence?: number | null;
}

export interface GroupProgress {
  total_participants: number;
  completed_count: number;
  all_complete: boolean;
  participants: ParticipantStatus[];
}

export interface ParticipantStatus {
  user_id: string;
  user_name: string;
  is_current_user: boolean;
  completed: boolean;
}

export type WebSocketMessageType =
  | "message"
  | "new_turn"
  | "connected"
  | "user_joined"
  | "user_left"
  | "system"
  | "typing_start"
  | "typing_stop"
  | "flag"
  | "flag_created"
  | "unflag"
  | "flag_removed"
  | "conversation_ended"
  | "error";

export interface WebSocketMessage {
  type: WebSocketMessageType;
  payload: Record<string, unknown>;
  timestamp: string;
}
