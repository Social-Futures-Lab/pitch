import apiClient from "@/api/client";
import type { Turn, KnowledgeItem, SearchResult } from "@/types";

export async function getTranscript(conversationId: string): Promise<Turn[]> {
  const response = await apiClient.get<{ turns: Turn[] }>(
    `/construction/${conversationId}/transcript`
  );
  return response.data.turns;
}

export async function getItems(
  conversationId: string
): Promise<KnowledgeItem[]> {
  const response = await apiClient.get<KnowledgeItem[]>(
    `/construction/${conversationId}/items`
  );
  return response.data;
}

export async function createItem(
  conversationId: string,
  data: Partial<KnowledgeItem>
): Promise<KnowledgeItem> {
  const response = await apiClient.post<KnowledgeItem>(
    `/construction/${conversationId}/items`,
    data
  );
  return response.data;
}

export async function updateItem(
  itemId: string,
  data: Partial<KnowledgeItem>
): Promise<KnowledgeItem> {
  const response = await apiClient.put<KnowledgeItem>(
    `/construction/items/${itemId}`,
    data
  );
  return response.data;
}

export async function searchForItem(
  itemId: string,
  query: string
): Promise<SearchResult[]> {
  const response = await apiClient.post<SearchResult[]>(
    `/construction/items/${itemId}/search`,
    { query }
  );
  return response.data;
}

export async function searchForConversation(
  conversationId: string,
  query: string
): Promise<SearchResult[]> {
  const response = await apiClient.post<SearchResult[]>(
    `/construction/${conversationId}/search`,
    { query }
  );
  return response.data;
}

export async function webSearchForConversation(
  conversationId: string,
  query: string
): Promise<SearchResult[]> {
  const response = await apiClient.post<SearchResult[]>(
    `/construction/${conversationId}/web-search`,
    { query }
  );
  return response.data;
}

export async function getAiSuggestion(
  itemId: string,
  existingText?: string
): Promise<{ suggestion: string }> {
  const response = await apiClient.post<{ suggestion: string }>(
    `/construction/items/${itemId}/ai-suggest`,
    existingText?.trim() ? { existing_text: existingText } : {}
  );
  return response.data;
}

export async function getAiSuggestionForConversation(
  conversationId: string,
  contributionType: string,
  importance: number,
  windowStart: number,
  windowEnd: number,
  bestTurn: number,
  insertedResources: Array<{
    id: string;
    title: string;
    snippet?: string;
    url?: string;
    source: string;
  }>,
  existingText?: string,
  mode: "refine" | "polish" = "refine"
): Promise<{ suggestion: string }> {
  const response = await apiClient.post<{ suggestion: string }>(
    `/construction/${conversationId}/ai-suggest`,
    {
      contribution_type: contributionType,
      importance: importance,
      window_start: windowStart,
      window_end: windowEnd,
      best_turn: bestTurn,
      inserted_resources: insertedResources,
      existing_text: existingText?.trim() || undefined,
      mode,
    }
  );
  return response.data;
}

export async function getAiIntentions(
  conversationId: string,
  windowStart: number,
  windowEnd: number,
  bestTurn: number
): Promise<Array<{ tag: string; category: string }>> {
  const response = await apiClient.post<Array<{ tag: string; category: string }>>(
    `/construction/${conversationId}/ai-intentions`,
    { window_start: windowStart, window_end: windowEnd, best_turn: bestTurn }
  );
  return response.data;
}

export async function aiSourceSearch(
  conversationId: string,
  windowStart: number,
  windowEnd: number,
  bestTurn: number,
  intentionTag: string,
  contributionType: string
): Promise<{ queries_used: string[]; results: Array<{ id: string; query: string; result_title: string; result_snippet?: string; result_url?: string; result_metadata?: Record<string, unknown> }> }> {
  const response = await apiClient.post(
    `/construction/${conversationId}/ai-source-search`,
    {
      window_start: windowStart,
      window_end: windowEnd,
      best_turn: bestTurn,
      intention_tag: intentionTag,
      contribution_type: contributionType,
    }
  );
  return response.data;
}

export async function aiGenerateMessage(
  conversationId: string,
  params: {
    windowStart: number;
    windowEnd: number;
    bestTurn: number;
    intentionTag: string;
    contributionType: string;
    pertinence: number;
    insertedResources: Array<{ id: string; title: string; snippet?: string; url?: string; source: string }>;
    followUpPrompt?: string;
    previousMessages?: Array<{ role: string; content: string }>;
  }
): Promise<{ message: string }> {
  const response = await apiClient.post<{ message: string }>(
    `/construction/${conversationId}/ai-generate-message`,
    {
      window_start: params.windowStart,
      window_end: params.windowEnd,
      best_turn: params.bestTurn,
      intention_tag: params.intentionTag,
      contribution_type: params.contributionType,
      pertinence: params.pertinence,
      inserted_resources: params.insertedResources,
      follow_up_prompt: params.followUpPrompt,
      previous_messages: params.previousMessages,
    }
  );
  return response.data;
}

export interface NextItemSuggestion {
  direction: string;
  category: string;
  start_turn: number;
  end_turn: number;
  best_turn: number;
  detail: string;
}

export async function getNextItemSuggestions(
  conversationId: string
): Promise<NextItemSuggestion[]> {
  const response = await apiClient.post<{ suggestions: NextItemSuggestion[] }>(
    `/construction/${conversationId}/next-item-suggestions`
  );
  return response.data.suggestions;
}

export async function markConstructionDone(
  conversationId: string
): Promise<void> {
  await apiClient.post(`/construction/${conversationId}/mark-done`);
}

export async function unmarkConstructionDone(
  conversationId: string
): Promise<void> {
  await apiClient.delete(`/construction/${conversationId}/mark-done`);
}

export async function deleteItem(itemId: string): Promise<void> {
  await apiClient.delete(`/construction/items/${itemId}`);
}
