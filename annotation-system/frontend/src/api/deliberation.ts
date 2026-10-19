import apiClient from "@/api/client";
import type { PeersResponse, Annotation, RevisionPayload, GroupProgress } from "@/types";

export async function getPeerAnnotations(
  excerptId: string,
  knowledgeItemId: string
): Promise<PeersResponse> {
  const response = await apiClient.get<PeersResponse>(
    `/deliberation/${excerptId}/peers`,
    { params: { knowledge_item_id: knowledgeItemId } }
  );
  return response.data;
}

export async function createRevision(
  excerptId: string,
  knowledgeItemId: string,
  data: RevisionPayload
): Promise<Annotation> {
  const response = await apiClient.post<Annotation>(
    `/deliberation/${excerptId}/revise`,
    data,
    { params: { knowledge_item_id: knowledgeItemId } }
  );
  return response.data;
}

export async function getMyOriginal(
  excerptId: string,
  knowledgeItemId: string
): Promise<Annotation> {
  const response = await apiClient.get<Annotation>(
    `/deliberation/${excerptId}/my-original`,
    { params: { knowledge_item_id: knowledgeItemId } }
  );
  return response.data;
}

export async function logVisibility(
  excerptId: string,
  knowledgeItemId: string,
  annotationIds: string[]
): Promise<void> {
  await apiClient.post(
    `/deliberation/${excerptId}/log-visibility`,
    { visible_annotation_ids: annotationIds },
    { params: { knowledge_item_id: knowledgeItemId } }
  );
}

export interface DeliberationProgress {
  total: number;
  completed: number;
  pending: number;
  revised_knowledge_item_ids: string[];
  do_not_surface_count: number;
  deliberation_completed: boolean;
}

export async function getDeliberationProgress(): Promise<DeliberationProgress> {
  const response = await apiClient.get<DeliberationProgress>(
    "/deliberation/progress"
  );
  return response.data;
}

export async function completeDeliberation(): Promise<void> {
  await apiClient.post("/deliberation/complete");
}

export async function getGroupProgress(): Promise<GroupProgress> {
  const response = await apiClient.get<GroupProgress>(
    "/deliberation/group-progress"
  );
  return response.data;
}

export interface DeliberationAssignment {
  excerpt_id: string;
  knowledge_item_id: string;
  conversation_id: string;
  excerpt_start_turn: number;
  excerpt_end_turn: number;
}

export async function getDeliberationAssignments(): Promise<DeliberationAssignment[]> {
  const response = await apiClient.get<DeliberationAssignment[]>(
    "/deliberation/assignments"
  );
  return response.data;
}
