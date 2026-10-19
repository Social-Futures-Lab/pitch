import apiClient from "@/api/client";
import type { GroupProgress } from "@/types";

export interface RankingDeliberationExcerpt {
  excerpt_id: string;
  conversation_id: string;
  excerpt_start_turn: number;
  excerpt_end_turn: number;
  item_count: number;
  revised: boolean;
}

export interface PeerRankedItem {
  knowledge_item_id: string;
  rank: number;
  chosen_best_turn_number: number;
}

export interface PeerRanking {
  annotator_label: string;
  ranked_items: PeerRankedItem[];
  item_rank_map: Record<string, number>;
}

export interface ItemInfo {
  knowledge_item_id: string;
  neutralized_ideal_response: string;
  contribution_type: string;
  best_turn_number: number | null;
  is_own_item: boolean;
  do_not_surface: boolean;
}

export interface PeerRankingsResponse {
  peers: PeerRanking[];
  own_ranking: {
    ranked_items: PeerRankedItem[];
    phase: string;
  };
  original_ranking: {
    ranked_items: PeerRankedItem[];
  };
  items_info: Record<string, ItemInfo>;
}

export interface RankingDeliberationProgress {
  total: number;
  completed: number;
  pending: number;
  revised_excerpt_ids: string[];
  ranking_deliberation_completed: boolean;
}

export async function getRankingDeliberationExcerpts(): Promise<RankingDeliberationExcerpt[]> {
  const response = await apiClient.get<RankingDeliberationExcerpt[]>(
    "/ranking-deliberation/excerpts"
  );
  return response.data;
}

export async function getPeerRankings(excerptId: string): Promise<PeerRankingsResponse> {
  const response = await apiClient.get<PeerRankingsResponse>(
    `/ranking-deliberation/excerpts/${excerptId}/peers`
  );
  return response.data;
}

export async function saveRankingRevision(
  excerptId: string,
  rankedItems: Array<{ knowledge_item_id: string; rank: number; chosen_best_turn_number: number }>
): Promise<void> {
  await apiClient.post(`/ranking-deliberation/excerpts/${excerptId}/revise`, {
    ranked_items: rankedItems,
  });
}

export async function getRankingDeliberationProgress(): Promise<RankingDeliberationProgress> {
  const response = await apiClient.get<RankingDeliberationProgress>(
    "/ranking-deliberation/progress"
  );
  return response.data;
}

export async function completeRankingDeliberation(): Promise<void> {
  await apiClient.post("/ranking-deliberation/complete");
}

export async function getRankingDeliberationGroupProgress(): Promise<GroupProgress> {
  const response = await apiClient.get<GroupProgress>(
    "/ranking-deliberation/group-progress"
  );
  return response.data;
}
