import type { User, Turn, KnowledgeItem, SearchResult } from "@/types";

export const mockUser: User = {
  id: "user-1",
  name: "Test User",
  email: "test@test.com",
  role: "participant" as const,
};

export const mockResearcher: User = {
  id: "researcher-1",
  name: "Test Researcher",
  email: "researcher@test.com",
  role: "researcher" as const,
};

export const mockExternalAnnotator: User = {
  id: "annotator-1",
  name: "Test Annotator",
  email: "annotator@test.com",
  role: "external_annotator" as const,
};

export const mockTurns: Turn[] = Array.from({ length: 10 }, (_, i) => ({
  id: `turn-${i + 1}`,
  conversation_id: "conv-1",
  turn_number: i + 1,
  speaker_id: i % 2 === 0 ? "user-1" : "user-2",
  speaker_name: i % 2 === 0 ? "Alice" : "Bob",
  text: `This is turn ${i + 1} content`,
  timestamp: new Date(Date.now() + i * 60000).toISOString(),
  flagged: i === 3 || i === 7,
}));

export const mockKnowledgeItem: KnowledgeItem = {
  id: "item-1",
  conversation_id: "conv-1",
  author_id: "user-1",
  raw_ideal_response: "Test ideal response",
  neutralized_ideal_response: undefined,
  ai_suggestion_used: false,
  window_start_turn_number: 3,
  window_end_turn_number: 7,
  best_turn_number: 5,
  contribution_type: "heads_up",
  pertinence: 0.8,
  source: "participant",
  review_status: "pending",
  created_at: new Date().toISOString(),
};

export const mockSearchResults: SearchResult[] = [
  {
    id: "sr-1",
    query: "LLM ethics",
    result_title: "Ethics of Large Language Models",
    result_snippet: "A survey of ethical considerations...",
    result_url: "https://example.com/paper1",
    result_metadata: { authors: ["Smith"], year: 2024 },
  },
];
