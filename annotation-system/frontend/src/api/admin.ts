import apiClient from "@/api/client";

// ---- Types ----

export interface StudyGroup {
  id: string;
  scenario: string;
  status: string;
  join_code: string;
  prompt_id?: string;
  member_count: number;
  created_at: string;
}

export interface CreateGroupPayload {
  scenario: string;
  prompt_id?: string;
}

export interface TransitionPayload {
  target_status: string;
}

export interface GroupConversation {
  id: string;
  group_id: string;
  started_at: string;
  ended_at?: string;
  turn_count: number;
}

export interface GroupItemStats {
  total: number;
  neutralized: number;
  pending: number;
  approved: number;
  rejected: number;
}

export interface GroupMember {
  id: string;
  user_id: string;
  name: string;
  email?: string;
  role: string;
  joined_at: string;
  construction_done_at: string | null;
  annotation_done_at: string | null;
  deliberation_completed_at: string | null;
}

export interface Prompt {
  id: string;
  scenario: string;
  text: string;
  created_at: string;
}

export interface CreatePromptPayload {
  scenario: string;
  text: string;
}

export interface AdminUser {
  id: string;
  name: string;
  email?: string;
  role: string;
  created_at: string;
}

export interface CreateUserPayload {
  name: string;
  email: string;
  role: string;
  password: string;
}

export interface UpdateUserPayload {
  name?: string;
  email?: string;
  role?: string;
  password?: string;
}

export interface ReviewItem {
  id: string;
  conversation_id: string;
  author_id: string;
  raw_ideal_response: string;
  neutralized_ideal_response?: string;
  review_status: string;
  contribution_type: string;
  quality_checklist?: Record<string, boolean>;
  created_at: string;
}

export interface ReviewPayload {
  action: "approve" | "reject" | "edit";
  edited_neutralized_response?: string;
}

export interface Excerpt {
  id: string;
  conversation_id: string;
  knowledge_item_id: string;
  start_turn_number: number;
  end_turn_number: number;
  preceding_context_summary?: string;
  following_context_summary?: string;
  created_at: string;
}

export interface UpdateExcerptPayload {
  start_turn_number?: number;
  end_turn_number?: number;
  preceding_context_summary?: string;
  following_context_summary?: string;
}

export interface PracticePair {
  excerpt_id: string;
  item_id: string;
  expected_answer: string;
}


// ---- Groups ----

export async function listGroups(): Promise<StudyGroup[]> {
  const response = await apiClient.get<StudyGroup[]>("/admin/groups");
  return response.data;
}

export async function createGroup(
  data: CreateGroupPayload
): Promise<StudyGroup> {
  const response = await apiClient.post<StudyGroup>("/admin/groups", data);
  return response.data;
}

export async function transitionGroup(
  groupId: string,
  data: TransitionPayload
): Promise<StudyGroup> {
  const response = await apiClient.post<StudyGroup>(
    `/admin/groups/${groupId}/transition`,
    data
  );
  return response.data;
}

export async function revertGroup(
  groupId: string,
  data: TransitionPayload
): Promise<StudyGroup> {
  const response = await apiClient.post<StudyGroup>(
    `/admin/groups/${groupId}/revert`,
    data
  );
  return response.data;
}

export async function listGroupConversations(
  groupId: string
): Promise<GroupConversation[]> {
  const response = await apiClient.get<GroupConversation[]>(
    `/admin/groups/${groupId}/conversations`
  );
  return response.data;
}

export async function getGroupItemStats(
  groupId: string
): Promise<GroupItemStats> {
  const response = await apiClient.get<GroupItemStats>(
    `/admin/groups/${groupId}/item-stats`
  );
  return response.data;
}

export async function listGroupMembers(
  groupId: string
): Promise<GroupMember[]> {
  const response = await apiClient.get<GroupMember[]>(
    `/admin/groups/${groupId}/members`
  );
  return response.data;
}

export async function addGroupMember(
  groupId: string,
  userId: string
): Promise<GroupMember> {
  const response = await apiClient.post<GroupMember>(
    `/admin/groups/${groupId}/members`,
    { user_id: userId }
  );
  return response.data;
}

export async function removeGroupMember(
  groupId: string,
  userId: string
): Promise<void> {
  await apiClient.delete(`/admin/groups/${groupId}/members/${userId}`);
}

// ---- Prompts ----

export async function listPrompts(): Promise<Prompt[]> {
  const response = await apiClient.get<Prompt[]>("/admin/prompts");
  return response.data;
}

export async function createPrompt(
  data: CreatePromptPayload
): Promise<Prompt> {
  const response = await apiClient.post<Prompt>("/admin/prompts", data);
  return response.data;
}

// ---- Users ----

export async function listUsers(): Promise<AdminUser[]> {
  const response = await apiClient.get<AdminUser[]>("/admin/users");
  return response.data;
}

export async function createUser(
  data: CreateUserPayload
): Promise<AdminUser> {
  const response = await apiClient.post<AdminUser>("/admin/users", data);
  return response.data;
}

export async function updateUser(
  userId: string,
  data: UpdateUserPayload
): Promise<AdminUser> {
  const response = await apiClient.put<AdminUser>(
    `/admin/users/${userId}`,
    data
  );
  return response.data;
}

// ---- Items / Review ----

export async function listItems(
  status?: string
): Promise<ReviewItem[]> {
  const params = status ? { status } : {};
  const response = await apiClient.get<ReviewItem[]>("/admin/items", {
    params,
  });
  return response.data;
}

export async function reviewItem(
  itemId: string,
  data: ReviewPayload
): Promise<ReviewItem> {
  const response = await apiClient.put<ReviewItem>(
    `/admin/items/${itemId}/review`,
    data
  );
  return response.data;
}

export async function neutralizeItem(
  itemId: string
): Promise<ReviewItem> {
  const response = await apiClient.put<ReviewItem>(
    `/admin/items/${itemId}/neutralize`
  );
  return response.data;
}

// ---- Excerpts ----

export async function listExcerpts(
  conversationId: string
): Promise<Excerpt[]> {
  const response = await apiClient.get<Excerpt[]>(
    `/admin/excerpts/${conversationId}`
  );
  return response.data;
}

export async function updateExcerpt(
  excerptId: string,
  data: UpdateExcerptPayload
): Promise<Excerpt> {
  const response = await apiClient.put<Excerpt>(
    `/admin/excerpts/${excerptId}`,
    data
  );
  return response.data;
}

