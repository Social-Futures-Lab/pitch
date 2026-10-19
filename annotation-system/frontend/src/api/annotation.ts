import apiClient from "@/api/client";
import type {
  Assignment,
  Annotation,
  ExcerptDetail,
  AnnotationProgress,
} from "@/types";

export async function getAssignments(): Promise<Assignment[]> {
  const response = await apiClient.get<Assignment[]>(
    "/annotation/assignments"
  );
  return response.data;
}

export async function getExcerptDetail(
  excerptId: string
): Promise<ExcerptDetail> {
  const response = await apiClient.get<ExcerptDetail>(
    `/annotation/excerpts/${excerptId}`
  );
  return response.data;
}

export async function getMyAnnotationsForExcerpt(
  excerptId: string
): Promise<Annotation[]> {
  const response = await apiClient.get<Annotation[]>(
    `/annotation/excerpts/${excerptId}/mine`
  );
  return response.data;
}

export interface CreateAnnotationData {
  excerpt_id: string;
  knowledge_item_id: string;
  window_start_turn_number?: number | null;
  window_end_turn_number?: number | null;
  best_turn_number?: number | null;
  do_not_surface: boolean;
  extends_before: boolean;
  extends_after: boolean;
  contribution_type?: string | null;
  contribution_type_detail?: string | null;
  pertinence?: number | null;
  rationale?: string | null;
}

export async function createAnnotation(
  data: CreateAnnotationData
): Promise<Annotation> {
  const response = await apiClient.post<Annotation>("/annotation/", data);
  return response.data;
}

export async function updateAnnotation(
  id: string,
  data: Partial<CreateAnnotationData>
): Promise<Annotation> {
  const response = await apiClient.put<Annotation>(
    `/annotation/${id}`,
    data
  );
  return response.data;
}

export interface RankingItem {
  knowledge_item_id: string;
  rank: number;
  chosen_best_turn_number: number;
}

export async function submitRanking(
  excerptId: string,
  data: { ranked_items: RankingItem[] }
): Promise<void> {
  await apiClient.post(`/annotation/excerpts/${excerptId}/ranking`, data);
}

export interface RankableItemResponse {
  knowledge_item_id: string;
  neutralized_ideal_response: string;
  contribution_type: string;
  best_turn_number: number;
  best_turn_text: string | null;
  best_turn_speaker: string | null;
  is_own_item: boolean;
  do_not_surface: boolean;
}

export async function getRankableItems(
  conversationId: string
): Promise<RankableItemResponse[]> {
  const response = await apiClient.get<RankableItemResponse[]>(
    "/annotation/rankable-items",
    { params: { conversation_id: conversationId } }
  );
  return response.data;
}

export async function getProgress(): Promise<AnnotationProgress> {
  const response = await apiClient.get<AnnotationProgress>(
    "/annotation/progress"
  );
  return response.data;
}

export async function markAnnotationDone(
  conversationId: string
): Promise<void> {
  await apiClient.post(`/annotation/conversations/${conversationId}/mark-done`);
}

export async function unmarkAnnotationDone(
  conversationId: string
): Promise<void> {
  await apiClient.delete(`/annotation/conversations/${conversationId}/mark-done`);
}

export interface AnnotationDoneProgress {
  total: number;
  done: number;
  current_user_done: boolean;
  group_status: string;
}

export async function getAnnotationDoneProgress(
  conversationId: string
): Promise<AnnotationDoneProgress> {
  const response = await apiClient.get<AnnotationDoneProgress>(
    `/annotation/conversations/${conversationId}/done-progress`
  );
  return response.data;
}

export async function getConversationTurnsRange(
  conversationId: string,
  start: number,
  end: number
): Promise<import("@/types").Turn[]> {
  const response = await apiClient.get<import("@/types").Turn[]>(
    `/annotation/conversations/${conversationId}/turns`,
    { params: { start, end } }
  );
  return response.data;
}
