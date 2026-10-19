import apiClient from "@/api/client";
import type { Conversation } from "@/types";

export interface MyGroup {
  group_id: string;
  scenario: string;
  status: string;
  conversation_id: string | null;
  conversation_started_at: string | null;
  conversation_ended_at: string | null;
  turn_count: number;
  construction_done?: boolean;
  construction_progress?: { total: number; done: number };
}

export async function getMyGroups(): Promise<MyGroup[]> {
  const response = await apiClient.get<MyGroup[]>("/conversations/my-groups");
  return response.data;
}

export async function getConversation(
  conversationId: string
): Promise<Conversation> {
  const response = await apiClient.get<Conversation>(
    `/conversations/${conversationId}`
  );
  return response.data;
}

export async function endConversation(
  conversationId: string
): Promise<void> {
  await apiClient.post(`/conversations/${conversationId}/end`);
}

export async function resumeConversation(
  conversationId: string
): Promise<void> {
  await apiClient.post(`/conversations/${conversationId}/resume`);
}

export interface Flag {
  id: string;
  turn_id: string;
  timestamp: string;
}

export async function getMyFlags(
  conversationId: string
): Promise<Flag[]> {
  const response = await apiClient.get<Flag[]>(
    `/conversations/${conversationId}/flags`
  );
  return response.data;
}

export async function flagTurn(
  conversationId: string,
  turnId: string,
  reason?: string
): Promise<void> {
  await apiClient.post(`/conversations/${conversationId}/flags`, {
    turn_id: turnId,
    reason: reason ?? "",
  });
}
