import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import type { Turn, KnowledgeItem, SearchResult } from "@/types";
import {
  getTranscript,
  getItems,
  createItem,
  updateItem,
  deleteItem,
  searchForConversation,
  webSearchForConversation,
  markConstructionDone,
  getNextItemSuggestions,
} from "@/api/construction";
import type { NextItemSuggestion } from "@/api/construction";
import TranscriptReview from "@/components/construction/TranscriptReview";
import type { PlacementWindow, SelectingFor } from "@/components/construction/TranscriptReview";
import { getSpeakerColor } from "@/components/chat/ChatMessage";
import IntentionTags from "@/components/construction/IntentionTags";
import type { IntentionSelection } from "@/components/construction/IntentionTags";
import AISourceFinder, { emptyAISourceFinderState } from "@/components/construction/AISourceFinder";
import type { AISourceFinderState } from "@/components/construction/AISourceFinder";
import MessageCreator from "@/components/construction/MessageCreator";
import type { AIInteraction } from "@/components/construction/MessageCreator";
import { renderMarkdown } from "@/components/common/renderMarkdown";

interface InsertedResource {
  id: string;
  title: string;
  snippet?: string;
  url?: string;
  source: "scholar" | "web" | "manual";
}

const PERTINENCE_LEVELS = [
  { value: 0.0, title: "Nice to have", description: "adds useful context, but the conversation would be fine without it" },
  { value: 0.25, title: "Somewhat important", description: "helps the conversation, but probably would not change its direction" },
  { value: 0.5, title: "Important", description: "meaningfully improves the conversation or fills a clear gap" },
  { value: 0.75, title: "Very important", description: "could shift how the group thinks, decides, or continues" },
  { value: 1.0, title: "Essential", description: "could prevent a major misunderstanding or change the direction of the conversation" },
];

interface DraftItem {
  editingItemId: string | null;
  raw_ideal_response: string;
  contribution_type: string | null;
  contribution_type_detail: string;
  pertinence: number | null;
  notes: string;
  window: PlacementWindow;
  aiGenerated: boolean;
  insertedResources: InsertedResource[];
  intentionTag: IntentionSelection | null;
  pinnedIntentionTag: IntentionSelection | null;
  aiInteractionLog: AIInteraction[];
}

function emptyDraft(): DraftItem {
  return {
    editingItemId: null,
    raw_ideal_response: "",
    contribution_type: null,
    contribution_type_detail: "",
    pertinence: null,
    notes: "",
    window: { startTurn: null, endTurn: null, bestTurn: null },
    aiGenerated: false,
    insertedResources: [],
    intentionTag: null,
    pinnedIntentionTag: null,
    aiInteractionLog: [],
  };
}

export default function ConstructionPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [draft, setDraft] = useState<DraftItem | null>(null);
  const [showDraft, setShowDraft] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewSelectingFor, setPreviewSelectingFor] = useState<SelectingFor>(null);
  const [showReviewInstructions, setShowReviewInstructions] = useState(() => {
    return localStorage.getItem("hideReviewInstructions") !== "true";
  });
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const [itemSearchCache, setItemSearchCache] = useState<Map<string, { scholar: SearchResult[]; web: SearchResult[]; query: string }>>(new Map());

  const [searchQuery, setSearchQuery] = useState("");
  const [scholarResults, setScholarResults] = useState<SearchResult[]>([]);
  const [webResults, setWebResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMode, setSearchMode] = useState<"ai" | "scholar" | "web" | "manual">("ai");
  const [scholarSearchPerformed, setScholarSearchPerformed] = useState(false);
  const [webSearchPerformed, setWebSearchPerformed] = useState(false);
  const [manualSourceTitle, setManualSourceTitle] = useState("");
  const [manualSourceContent, setManualSourceContent] = useState("");
  const [aiFinderState, setAiFinderState] = useState<AISourceFinderState>(emptyAISourceFinderState());

  const [selectingFor, setSelectingFor] = useState<SelectingFor>(null);
  const [scrollToTurn, setScrollToTurn] = useState<number | null>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const [showFinishPrompt, setShowFinishPrompt] = useState(false);
  const [showBookmarkWarning, setShowBookmarkWarning] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<KnowledgeItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [nextSuggestions, setNextSuggestions] = useState<NextItemSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsFetched, setSuggestionsFetched] = useState(false);
  const [pendingSuggestions, setPendingSuggestions] = useState<NextItemSuggestion[] | null>(null);
  const [pendingFetchInProgress, setPendingFetchInProgress] = useState(false);

  // When pending fetch completes and user is on the overview (no draft open), swap in
  useEffect(() => {
    if (pendingSuggestions !== null && !showDraft) {
      setNextSuggestions(pendingSuggestions);
      setPendingSuggestions(null);
      setSuggestionsLoading(false);
      setSuggestionsFetched(true);
    }
  }, [pendingSuggestions, showDraft]);

  // If user is on the overview with items but no suggestions and nothing loading, fetch
  useEffect(() => {
    if (
      !showDraft &&
      items.length > 0 &&
      nextSuggestions.length === 0 &&
      !suggestionsLoading &&
      !pendingFetchInProgress &&
      pendingSuggestions === null &&
      conversationId
    ) {
      setPendingFetchInProgress(true);
      getNextItemSuggestions(conversationId).then((results) => {
        setPendingSuggestions(results);
      }).catch(() => {
        setPendingSuggestions([]);
      }).finally(() => {
        setPendingFetchInProgress(false);
      });
    }
  }, [showDraft, items.length, nextSuggestions.length, suggestionsLoading, pendingFetchInProgress, pendingSuggestions, conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const [transcriptData, itemsData] = await Promise.all([
          getTranscript(conversationId!),
          getItems(conversationId!),
        ]);
        if (!cancelled) {
          setTurns(transcriptData);
          setItems(itemsData);
        }
      } catch {
        if (!cancelled) setLoadError("Failed to load transcript or messages.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [conversationId]);

  useEffect(() => {
    if (!showPreview || !draft) return;
    const bestTurn = draft.window.bestTurn ?? draft.window.startTurn;
    if (bestTurn === null) return;
    const container = previewScrollRef.current;
    if (!container) return;

    requestAnimationFrame(() => {
      const el = container.querySelector(`[data-turn="${bestTurn}"]`) as HTMLElement | null;
      if (!el) return;
      const scrollOffset =
        el.offsetTop - container.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
      container.scrollTo({ top: scrollOffset, behavior: "smooth" });
    });
  }, [showPreview]);

  const speakerMap = useMemo(() => {
    const map = new Map<string, number>();
    let idx = 0;
    for (const turn of turns) {
      if (!map.has(turn.speaker_id)) {
        map.set(turn.speaker_id, idx++);
      }
    }
    return map;
  }, [turns]);

  const handleTurnSelected = useCallback((turnNumber: number) => {
    if (!draft || !selectingFor) return;
    const w = { ...draft.window };

    if (selectingFor === "start") {
      w.startTurn = turnNumber;
      if (w.endTurn !== null && w.endTurn < turnNumber) w.endTurn = null;
      if (w.bestTurn !== null && (w.endTurn === null || w.bestTurn < turnNumber || w.bestTurn > (w.endTurn ?? turnNumber))) w.bestTurn = null;
    } else if (selectingFor === "end") {
      w.endTurn = turnNumber;
      if (w.bestTurn !== null && w.bestTurn > turnNumber) w.bestTurn = null;
    } else if (selectingFor === "best") {
      w.bestTurn = turnNumber;
    }

    setDraft({ ...draft, window: w });
    setSelectingFor(null);
  }, [draft, selectingFor]);

  const fetchSuggestionsInBackground = useCallback(() => {
    if (pendingFetchInProgress || !conversationId) return;
    setPendingFetchInProgress(true);
    getNextItemSuggestions(conversationId).then((results) => {
      setPendingSuggestions(results);
    }).catch(() => {
      setPendingSuggestions([]);
    }).finally(() => {
      setPendingFetchInProgress(false);
    });
  }, [pendingFetchInProgress, conversationId]);

  const handleNewItem = useCallback(() => {
    setDraft(emptyDraft());
    setShowDraft(true);
    setSaveError(null);
    setSelectingFor(null);
    setScholarResults([]);
    setWebResults([]);
    setScholarSearchPerformed(false);
    setWebSearchPerformed(false);
    setSearchQuery("");
    setManualSourceTitle("");
    setManualSourceContent("");
    setSearchMode("ai");
    setAiFinderState(emptyAISourceFinderState());
    // Start background fetch for next set of suggestions
    fetchSuggestionsInBackground();
  }, [fetchSuggestionsInBackground]);

  const handleSuggestionClick = useCallback((suggestion: NextItemSuggestion) => {
    const newDraft = emptyDraft();
    const suggestedTag = { tag: suggestion.direction, category: suggestion.category };
    newDraft.window = {
      startTurn: suggestion.start_turn,
      endTurn: suggestion.end_turn,
      bestTurn: suggestion.best_turn,
    };
    newDraft.intentionTag = suggestedTag;
    newDraft.pinnedIntentionTag = suggestedTag;
    newDraft.contribution_type = suggestion.category;
    newDraft.contribution_type_detail = suggestion.direction;
    setDraft(newDraft);
    setShowDraft(true);
    setSaveError(null);
    setSelectingFor(null);
    setScrollToTurn(suggestion.best_turn ?? suggestion.start_turn);
    setScholarResults([]);
    setWebResults([]);
    setScholarSearchPerformed(false);
    setWebSearchPerformed(false);
    setSearchQuery("");
    setManualSourceTitle("");
    setManualSourceContent("");
    setSearchMode("ai");
    setAiFinderState(emptyAISourceFinderState());
    fetchSuggestionsInBackground();
  }, [fetchSuggestionsInBackground]);

  const handleEditItem = useCallback((item: KnowledgeItem) => {
    const resources = item.inserted_resources ? JSON.parse(item.inserted_resources) : [];
    const cachedSearch = itemSearchCache.get(item.id);
    const aiLog: AIInteraction[] = item.ai_interaction_log ? JSON.parse(item.ai_interaction_log) : [];
    setDraft({
      editingItemId: item.id,
      raw_ideal_response: item.raw_ideal_response,
      contribution_type: item.contribution_type,
      contribution_type_detail: item.contribution_type_detail || "",
      pertinence: item.pertinence,
      notes: item.notes || "",
      window: {
        startTurn: item.window_start_turn_number,
        endTurn: item.window_end_turn_number,
        bestTurn: item.best_turn_number,
      },
      aiGenerated: item.ai_suggestion_used,
      insertedResources: resources,
      intentionTag: item.contribution_type_detail
        ? { tag: item.contribution_type_detail, category: item.contribution_type }
        : { tag: item.contribution_type, category: item.contribution_type },
      pinnedIntentionTag: null,
      aiInteractionLog: aiLog,
    });
    setShowDraft(true);
    setSaveError(null);
    setSelectingFor(null);
    setScrollToTurn(item.best_turn_number ?? item.window_start_turn_number);
    setScholarResults(cachedSearch?.scholar ?? []);
    setWebResults(cachedSearch?.web ?? []);
    setScholarSearchPerformed(cachedSearch?.scholar ? cachedSearch.scholar.length > 0 : false);
    setWebSearchPerformed(cachedSearch?.web ? cachedSearch.web.length > 0 : false);
    setSearchQuery(cachedSearch?.query ?? "");
    setManualSourceTitle("");
    setManualSourceContent("");
    setSearchMode("ai");
    setAiFinderState(emptyAISourceFinderState());
  }, [itemSearchCache]);

  const handleOpenPreview = useCallback(() => {
    if (!draft) return;
    if (draft.window.startTurn === null || draft.window.endTurn === null || draft.window.bestTurn === null) {
      setSaveError("Please select placement window (start, end, and best turns).");
      return;
    }
    if (draft.intentionTag === null) {
      setSaveError("Please select a direction for your message.");
      return;
    }
    if (draft.insertedResources.length === 0) {
      setSaveError("Please add at least one source.");
      return;
    }
    if (draft.pertinence === null) {
      setSaveError("Please rate the importance.");
      return;
    }
    if (!draft.raw_ideal_response.trim()) {
      setSaveError("The message cannot be empty.");
      return;
    }
    setSaveError(null);
    setShowPreview(true);
    setPreviewSelectingFor(null);
    if (localStorage.getItem("hideReviewInstructions") !== "true") {
      setShowReviewInstructions(true);
    }
  }, [draft]);

  const handlePreviewTurnSelected = useCallback((turnNumber: number) => {
    if (!draft || !previewSelectingFor) return;
    const w = { ...draft.window };

    if (previewSelectingFor === "start") {
      w.startTurn = turnNumber;
      if (w.endTurn !== null && w.endTurn < turnNumber) w.endTurn = null;
      if (w.bestTurn !== null && (w.endTurn === null || w.bestTurn < turnNumber || w.bestTurn > (w.endTurn ?? turnNumber))) w.bestTurn = null;
    } else if (previewSelectingFor === "end") {
      w.endTurn = turnNumber;
      if (w.bestTurn !== null && w.bestTurn > turnNumber) w.bestTurn = null;
    } else if (previewSelectingFor === "best") {
      w.bestTurn = turnNumber;
    }

    setDraft({ ...draft, window: w });
    setPreviewSelectingFor(null);
  }, [draft, previewSelectingFor]);

  const handleSaveDraft = useCallback(async () => {
    if (!draft || !conversationId || !user) return;

    if (draft.window.startTurn === null || draft.window.endTurn === null || draft.window.bestTurn === null) {
      setSaveError("Please select placement window (start, end, and best turns).");
      return;
    }
    if (draft.intentionTag === null) {
      setSaveError("Please select a direction for your message.");
      return;
    }
    if (draft.insertedResources.length === 0) {
      setSaveError("Please add at least one source.");
      return;
    }
    if (draft.pertinence === null) {
      setSaveError("Please rate the importance.");
      return;
    }
    if (!draft.raw_ideal_response.trim()) {
      setSaveError("The message cannot be empty.");
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        raw_ideal_response: draft.raw_ideal_response,
        contribution_type: draft.intentionTag.category,
        contribution_type_detail: draft.intentionTag.tag,
        pertinence: draft.pertinence,
        notes: draft.notes || undefined,
        window_start_turn_number: draft.window.startTurn,
        window_end_turn_number: draft.window.endTurn,
        best_turn_number: draft.window.bestTurn,
        inserted_resources: JSON.stringify(draft.insertedResources),
        ai_interaction_log: draft.aiInteractionLog.length > 0 ? JSON.stringify(draft.aiInteractionLog) : undefined,
      };

      let savedItemId: string;
      if (draft.editingItemId) {
        const updated = await updateItem(draft.editingItemId, payload);
        setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
        savedItemId = updated.id;
      } else {
        const newItem = await createItem(conversationId, payload);
        setItems((prev) => [...prev, newItem]);
        savedItemId = newItem.id;
      }
      setItemSearchCache((prev) => {
        const next = new Map(prev);
        next.set(savedItemId, { scholar: scholarResults, web: webResults, query: searchQuery });
        return next;
      });
      setDraft(null);
      setShowDraft(false);
      setShowPreview(false);
      setScholarResults([]);
      setWebResults([]);

      // Swap pending suggestions into displayed set
      if (pendingSuggestions !== null) {
        setNextSuggestions(pendingSuggestions);
        setPendingSuggestions(null);
        setSuggestionsFetched(true);
        setSuggestionsLoading(false);
      } else if (pendingFetchInProgress) {
        // Fetch is still running — mark as loading so UI shows spinner
        setSuggestionsLoading(true);
        setSuggestionsFetched(true);
      } else if (!suggestionsFetched) {
        // Edge case: first save but no fetch was triggered
        setSuggestionsFetched(true);
      }
    } catch {
      setSaveError("Failed to save message. Please check all fields and try again.");
    } finally {
      setSaving(false);
    }
  }, [draft, conversationId, user, scholarResults, webResults, searchQuery, pendingSuggestions, pendingFetchInProgress, suggestionsFetched]);

  const handleCancelDraft = useCallback(() => {
    setDraft(null);
    setShowDraft(false);
    setShowPreview(false);
    setSaveError(null);
    setSelectingFor(null);
    setPreviewSelectingFor(null);
    setScholarResults([]);
    setWebResults([]);
  }, []);

  const handleSearch = useCallback(async () => {
    if (!conversationId || !searchQuery.trim() || !draft) return;
    setSearching(true);
    try {
      const actualMode = searchMode === "ai" ? "web" : searchMode;
      const results = actualMode === "web"
        ? await webSearchForConversation(conversationId, searchQuery.trim())
        : await searchForConversation(conversationId, searchQuery.trim());
      if (actualMode === "web") {
        setWebResults(results);
        setWebSearchPerformed(true);
      } else {
        setScholarResults(results);
        setScholarSearchPerformed(true);
      }
    } catch {
      if (searchMode === "web") {
        setWebResults([]);
        setWebSearchPerformed(true);
      } else {
        setScholarResults([]);
        setScholarSearchPerformed(true);
      }
    } finally {
      setSearching(false);
    }
  }, [conversationId, searchQuery, searchMode, draft]);

  const handleIntentionSelect = useCallback((tag: IntentionSelection) => {
    if (!draft) return;
    setDraft({ ...draft, intentionTag: tag, contribution_type: tag.category, contribution_type_detail: tag.tag });
  }, [draft]);

  const insertSearchResult = useCallback((result: SearchResult) => {
    if (!draft) return;
    const sourceType = searchMode === "scholar" ? "scholar" : "web";
    const resource: InsertedResource = {
      id: result.id,
      title: result.result_title || result.query,
      snippet: result.result_snippet || undefined,
      url: result.result_url || undefined,
      source: sourceType,
    };
    if (!draft.insertedResources.some((r) => r.id === resource.id)) {
      setDraft({
        ...draft,
        insertedResources: [...draft.insertedResources, resource],
      });
    }
  }, [draft, searchMode]);

  const insertResourceFromAI = useCallback((resource: InsertedResource) => {
    if (!draft) return;
    if (!draft.insertedResources.some((r) => r.id === resource.id)) {
      setDraft({
        ...draft,
        insertedResources: [...draft.insertedResources, resource],
      });
    }
  }, [draft]);

  const removeInsertedResource = useCallback((id: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      insertedResources: draft.insertedResources.filter((r) => r.id !== id),
    });
  }, [draft]);

  const openResource = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const handleAddManualSource = useCallback(() => {
    if (!draft || !manualSourceTitle.trim()) return;
    const resource: InsertedResource = {
      id: `manual-${Date.now()}`,
      title: manualSourceTitle.trim(),
      snippet: manualSourceContent.trim() || undefined,
      url: undefined,
      source: "manual",
    };
    setDraft({
      ...draft,
      insertedResources: [...draft.insertedResources, resource],
    });
    setManualSourceTitle("");
    setManualSourceContent("");
  }, [draft, manualSourceTitle, manualSourceContent]);

  const handleFinish = useCallback(() => {
    const bookmarkedTurns = turns.filter((t) => t.flagged);
    if (bookmarkedTurns.length > 0) {
      const hasUncovered = bookmarkedTurns.some((bt) => {
        return !items.some(
          (item) =>
            bt.turn_number >= item.window_start_turn_number &&
            bt.turn_number <= item.window_end_turn_number
        );
      });
      if (hasUncovered) {
        setShowBookmarkWarning(true);
        return;
      }
    }
    setShowFinishPrompt(true);
  }, [turns, items]);

  const handleDeleteItem = useCallback((item: KnowledgeItem) => {
    setItemToDelete(item);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!itemToDelete) return;
    setDeleting(true);
    try {
      await deleteItem(itemToDelete.id);
      setItems((prev) => prev.filter((it) => it.id !== itemToDelete.id));
      setItemSearchCache((prev) => {
        const next = new Map(prev);
        next.delete(itemToDelete.id);
        return next;
      });
      if (draft?.editingItemId === itemToDelete.id) {
        setDraft(null);
        setShowDraft(false);
      }
      setItemToDelete(null);
    } catch {
      alert("Failed to delete message. Please try again.");
    } finally {
      setDeleting(false);
    }
  }, [itemToDelete, draft]);

  const handleCancelDelete = useCallback(() => {
    setItemToDelete(null);
  }, []);

  // Derived state for progressive disclosure
  const windowComplete = draft?.window.startTurn !== null && draft?.window.endTurn !== null && draft?.window.bestTurn !== null;
  const intentionSelected = draft?.intentionTag !== null;
  const sourcesAdded = (draft?.insertedResources.length ?? 0) > 0;
  const importanceSelected = draft?.pertinence !== null;

  // InsertedResourcesList component
  const InsertedResourcesList = () => {
    if (!draft || draft.insertedResources.length === 0) return null;
    return (
      <div className="rounded-md border-2 border-green-400 bg-green-50 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-green-800">
          Inserted Resources ({draft.insertedResources.length})
        </p>
        <div className="space-y-1.5">
          {draft.insertedResources.map((resource) => (
            <div key={resource.id} className="flex items-start gap-2 rounded border border-green-300 bg-white px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-gray-800">{resource.title}</p>
                {resource.snippet && (
                  <p className="mt-0.5 text-xs text-gray-600 line-clamp-2">{resource.snippet}</p>
                )}
                <span className="mt-0.5 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                  {resource.source === "scholar" ? "Scholar" : resource.source === "web" ? "Web" : "Manual"}
                </span>
              </div>
              <div className="flex shrink-0 gap-1">
                {resource.url && (
                  <button
                    onClick={() => openResource(resource.url!)}
                    className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                    title="Open in new tab"
                  >
                    Open
                  </button>
                )}
                <button
                  onClick={() => removeInsertedResource(resource.id)}
                  className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 transition-colors"
                  title="Remove from list"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-gray-400">Loading transcript...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">{loadError}</p>
          <button onClick={() => window.location.reload()} className="mt-3 text-sm text-indigo-600 hover:underline">
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Preview mode: full-page placement review
  if (showPreview && draft) {
    const previewWindow = draft.window;
    const previewIsSelectable = (turnNumber: number): boolean => {
      if (!previewSelectingFor) return false;
      if (previewSelectingFor === "end") {
        return previewWindow.startTurn !== null && turnNumber >= previewWindow.startTurn;
      }
      if (previewSelectingFor === "best") {
        return (
          previewWindow.startTurn !== null &&
          previewWindow.endTurn !== null &&
          turnNumber >= previewWindow.startTurn &&
          turnNumber <= previewWindow.endTurn
        );
      }
      return true;
    };

    const previewGetTurnClasses = (turnNumber: number): string => {
      if (
        previewWindow.startTurn !== null &&
        previewWindow.endTurn !== null &&
        turnNumber >= previewWindow.startTurn &&
        turnNumber <= previewWindow.endTurn
      ) {
        return "bg-indigo-50 ring-1 ring-indigo-200";
      }
      return "";
    };

    return (
      <div className="flex h-full flex-col">
        {/* Instructions popup */}
        {showReviewInstructions && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
              <h3 className="text-base font-semibold text-gray-900 mb-3">Review Your Placement</h3>
              <p className="text-sm text-gray-700 leading-relaxed">
                Your message is shown below, inserted into the conversation after turn #{previewWindow.bestTurn}.
                Check that it reads naturally at this point. You can adjust where it appears using the controls on the page.
              </p>
              <div className="mt-4 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="dontShowAgain"
                  checked={dontShowAgain}
                  onChange={(e) => setDontShowAgain(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="dontShowAgain" className="text-xs text-gray-600">
                  Don't show this again
                </label>
              </div>
              <button
                onClick={() => {
                  if (dontShowAgain) {
                    localStorage.setItem("hideReviewInstructions", "true");
                  }
                  setShowReviewInstructions(false);
                }}
                className="mt-4 w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
              >
                Got It
              </button>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowPreview(false)}
                className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M14 8a.75.75 0 0 1-.75.75H4.56l3.22 3.22a.75.75 0 1 1-1.06 1.06l-4.5-4.5a.75.75 0 0 1 0-1.06l4.5-4.5a.75.75 0 0 1 1.06 1.06L4.56 7.25h8.69A.75.75 0 0 1 14 8Z" clipRule="evenodd" />
                </svg>
                Back to edit
              </button>
              <span className="text-gray-300">|</span>
              <h2 className="text-sm font-semibold text-gray-800">Review Placement</h2>
            </div>
          </div>
          <p className="mt-1.5 text-sm text-gray-600">
            Your message is shown below, inserted into the conversation after turn #{previewWindow.bestTurn}.
            Check that it reads naturally at this point. You can adjust where it appears using the controls below.
          </p>
        </div>

        {/* Transcript with inserted message */}
        <div ref={previewScrollRef} className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-3xl space-y-1.5">
            {turns.map((turn) => {
              const speakerIndex = speakerMap.get(turn.speaker_id) ?? 0;
              const color = getSpeakerColor(speakerIndex);
              const isStart = previewWindow.startTurn === turn.turn_number;
              const isEnd = previewWindow.endTurn === turn.turn_number;
              const isBest = previewWindow.bestTurn === turn.turn_number;
              const selectable = previewIsSelectable(turn.turn_number);
              const clickable = previewSelectingFor && selectable;

              return (
                <div key={turn.id} data-turn={turn.turn_number}>
                  <div
                    onClick={() => clickable && handlePreviewTurnSelected(turn.turn_number)}
                    className={`group relative rounded-md border border-transparent px-3 py-2 transition-colors ${previewGetTurnClasses(turn.turn_number)} ${
                      clickable
                        ? "cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/50"
                        : previewSelectingFor
                          ? "opacity-40"
                          : ""
                    }`}
                  >
                    {isStart && (
                      <span className="absolute right-0 top-0 z-10 rounded-bl bg-green-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        EARLIEST
                      </span>
                    )}
                    {isEnd && (
                      <span
                        className="absolute top-0 z-10 rounded-bl bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white"
                        style={{ right: isStart ? '3.5rem' : '0' }}
                      >
                        LATEST
                      </span>
                    )}
                    {isBest && (
                      <span className="absolute bottom-0 right-0 z-10 rounded-tl bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        BEST
                      </span>
                    )}

                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 text-xs font-mono text-gray-400">
                        #{turn.turn_number}
                      </span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${color.bg} ${color.text}`}>
                        {turn.speaker_name}
                      </span>
                      <p className="flex-1 text-sm leading-relaxed text-gray-700">
                        {turn.text}
                      </p>
                    </div>
                  </div>

                  {/* Insert knowledge item preview after the best turn */}
                  {isBest && (
                    <div className="my-2 ml-8 mr-4">
                      <div className="rounded-lg bg-violet-600 px-4 py-3 shadow-sm">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="shrink-0 rounded bg-violet-500 px-1.5 py-0.5 text-xs font-semibold text-white">
                            AI Agent
                          </span>
                          <span className="text-xs text-violet-200">Your Inserted Message</span>
                        </div>
                        <p className="text-sm leading-relaxed text-white whitespace-pre-wrap [&_a]:text-violet-200 [&_a]:underline hover:[&_a]:text-white">
                          {renderMarkdown(draft.raw_ideal_response)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Placement controls + Bottom action bar */}
        <div className="shrink-0 border-t-2 border-indigo-200 bg-indigo-50 px-4 py-3">
          <div className="flex flex-col gap-1.5 mb-3">
            <div
              onClick={() => setPreviewSelectingFor(previewSelectingFor === "start" ? null : "start")}
              className={`cursor-pointer rounded-lg border-2 px-3 py-1.5 flex items-center gap-3 transition-all ${
                previewSelectingFor === "start"
                  ? "border-green-500 bg-green-50 shadow-md ring-2 ring-green-300"
                  : "border-gray-200 bg-white hover:border-green-300 hover:shadow-sm"
              }`}
            >
              <span className={`shrink-0 h-2.5 w-2.5 rounded-full bg-green-500 ${previewSelectingFor === "start" ? "animate-pulse" : ""}`} />
              <span className="text-xs font-bold text-gray-800 uppercase tracking-wide w-14">Earliest</span>
              <span className="font-mono text-sm font-bold text-green-700 bg-green-100 rounded px-2 py-0.5">#{previewWindow.startTurn}</span>
              <span className="text-xs text-gray-500 flex-1">First turn where this message becomes relevant</span>
              <span className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold ${
                previewSelectingFor === "start"
                  ? "bg-green-600 text-white"
                  : "bg-gray-100 text-gray-600"
              }`}>
                {previewSelectingFor === "start" ? "Click a turn above..." : "Change"}
              </span>
            </div>
            <div
              onClick={() => setPreviewSelectingFor(previewSelectingFor === "end" ? null : "end")}
              className={`cursor-pointer rounded-lg border-2 px-3 py-1.5 flex items-center gap-3 transition-all ${
                previewSelectingFor === "end"
                  ? "border-red-500 bg-red-50 shadow-md ring-2 ring-red-300"
                  : "border-gray-200 bg-white hover:border-red-300 hover:shadow-sm"
              }`}
            >
              <span className={`shrink-0 h-2.5 w-2.5 rounded-full bg-red-500 ${previewSelectingFor === "end" ? "animate-pulse" : ""}`} />
              <span className="text-xs font-bold text-gray-800 uppercase tracking-wide w-14">Latest</span>
              <span className="font-mono text-sm font-bold text-red-700 bg-red-100 rounded px-2 py-0.5">#{previewWindow.endTurn}</span>
              <span className="text-xs text-gray-500 flex-1">Last turn where inserting would still help</span>
              <span className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold ${
                previewSelectingFor === "end"
                  ? "bg-red-600 text-white"
                  : "bg-gray-100 text-gray-600"
              }`}>
                {previewSelectingFor === "end" ? "Click a turn above..." : "Change"}
              </span>
            </div>
            <div
              onClick={() => setPreviewSelectingFor(previewSelectingFor === "best" ? null : "best")}
              className={`cursor-pointer rounded-lg border-2 px-3 py-1.5 flex items-center gap-3 transition-all ${
                previewSelectingFor === "best"
                  ? "border-amber-500 bg-amber-50 shadow-md ring-2 ring-amber-300"
                  : "border-gray-200 bg-white hover:border-amber-300 hover:shadow-sm"
              }`}
            >
              <span className={`shrink-0 h-2.5 w-2.5 rounded-full bg-amber-500 ${previewSelectingFor === "best" ? "animate-pulse" : ""}`} />
              <span className="text-xs font-bold text-gray-800 uppercase tracking-wide w-14">Best</span>
              <span className="font-mono text-sm font-bold text-amber-700 bg-amber-100 rounded px-2 py-0.5">#{previewWindow.bestTurn}</span>
              <span className="text-xs text-gray-500 flex-1">Ideal insertion point</span>
              <span className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold ${
                previewSelectingFor === "best"
                  ? "bg-amber-600 text-white"
                  : "bg-gray-100 text-gray-600"
              }`}>
                {previewSelectingFor === "best" ? "Click a turn above..." : "Change"}
              </span>
            </div>
          </div>
          {saveError && (
            <p className="mb-2 text-sm text-red-600">{saveError}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleSaveDraft}
              disabled={saving || previewWindow.startTurn === null || previewWindow.endTurn === null || previewWindow.bestTurn === null}
              className="flex-1 rounded-md bg-green-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-500 disabled:bg-gray-300 disabled:text-gray-500 disabled:shadow-none disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : draft.editingItemId ? "Confirm & Update" : "Confirm & Save"}
            </button>
            <button
              type="button"
              onClick={() => setShowPreview(false)}
              className="rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Back to Edit
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* Left: Transcript */}
      <div className="flex h-1/2 flex-col border-b border-gray-200 lg:h-full lg:w-1/2 lg:border-b-0 lg:border-r">
        <div className="shrink-0 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-800">Transcript</h2>
          <span className="text-xs text-gray-400">
            {turns.length} turn{turns.length !== 1 && "s"}
          </span>
        </div>
        <div className="flex-1 overflow-hidden">
          <TranscriptReview
            turns={turns}
            speakerMap={speakerMap}
            window={draft?.window ?? { startTurn: null, endTurn: null, bestTurn: null }}
            selectingFor={selectingFor}
            onTurnSelected={handleTurnSelected}
            highlightedItems={[]}
            scrollToTurn={scrollToTurn}
            onScrollComplete={() => setScrollToTurn(null)}
          />
        </div>
      </div>

      {/* Right: Construction form */}
      <div className="flex h-1/2 flex-col lg:h-full lg:w-1/2">
        <div className="shrink-0 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-800">
            Create Messages
          </h2>
          <div className="flex gap-2">
            {!showDraft && (
              <button
                onClick={handleNewItem}
                className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                  <path d="M8.75 3.75a.75.75 0 00-1.5 0v3.5h-3.5a.75.75 0 000 1.5h3.5v3.5a.75.75 0 001.5 0v-3.5h3.5a.75.75 0 000-1.5h-3.5v-3.5z" />
                </svg>
                New Message
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {showDraft && draft ? (
            <div className="flex flex-col gap-4">
              {saveError && (
                <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {saveError}
                </div>
              )}

              {/* Step 1: Placement window (FIRST) */}
              <div className="rounded-lg border-2 border-indigo-200 bg-indigo-50 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`shrink-0 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                    windowComplete ? "bg-green-500 text-white" : "bg-indigo-600 text-white"
                  }`}>
                    {windowComplete ? "✓" : "1"}
                  </span>
                  <p className="text-sm font-semibold text-gray-900">
                    Select placement window <span className="text-red-500">*</span>
                  </p>
                </div>
                <p className="text-xs text-gray-700 pl-8 mb-2">
                  Click the buttons below, then click a turn in the transcript to set each marker.
                </p>
                <div className="pl-8 space-y-2">
                  {/* Start turn */}
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
                    <span className="text-sm font-medium text-gray-700 whitespace-nowrap">First relevant:</span>
                    <span className="font-mono text-sm font-semibold text-gray-800 w-8">
                      {draft.window.startTurn !== null ? `#${draft.window.startTurn}` : "--"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectingFor(selectingFor === "start" ? null : "start")}
                      className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                        selectingFor === "start"
                          ? "border-green-400 bg-green-100 text-green-700"
                          : "border-gray-300 text-gray-600 hover:bg-gray-100"
                      }`}
                    >
                      {selectingFor === "start" ? "Selecting..." : draft.window.startTurn !== null ? "Change" : "Select"}
                    </button>
                    <span className="text-xs text-gray-400">Earliest turn where this message becomes relevant</span>
                  </div>

                  {/* End turn */}
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
                    <span className="text-sm font-medium text-gray-700 whitespace-nowrap">Last useful:</span>
                    <span className="font-mono text-sm font-semibold text-gray-800 w-8">
                      {draft.window.endTurn !== null ? `#${draft.window.endTurn}` : "--"}
                    </span>
                    <button
                      type="button"
                      disabled={draft.window.startTurn === null}
                      onClick={() => setSelectingFor(selectingFor === "end" ? null : "end")}
                      className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                        selectingFor === "end"
                          ? "border-red-400 bg-red-100 text-red-700"
                          : "border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      }`}
                    >
                      {selectingFor === "end" ? "Selecting..." : draft.window.endTurn !== null ? "Change" : "Select"}
                    </button>
                    <span className="text-xs text-gray-400">Latest turn where inserting would still help</span>
                  </div>

                  {/* Best turn */}
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                    <span className="text-sm font-medium text-gray-700 whitespace-nowrap">Best placement:</span>
                    <span className="font-mono text-sm font-semibold text-gray-800 w-8">
                      {draft.window.bestTurn !== null ? `#${draft.window.bestTurn}` : "--"}
                    </span>
                    <button
                      type="button"
                      disabled={draft.window.startTurn === null || draft.window.endTurn === null}
                      onClick={() => setSelectingFor(selectingFor === "best" ? null : "best")}
                      className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                        selectingFor === "best"
                          ? "border-amber-400 bg-amber-100 text-amber-700"
                          : "border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      }`}
                    >
                      {selectingFor === "best" ? "Selecting..." : draft.window.bestTurn !== null ? "Change" : "Select"}
                    </button>
                    <span className="text-xs text-gray-400">Ideal insertion point</span>
                  </div>
                </div>
              </div>

              {/* Step 2: AI Intention Tags */}
              {windowComplete ? (
                <div className={`rounded-md border p-3 ${intentionSelected ? "border-green-200 bg-green-50/50" : "border-gray-200 bg-gray-50"}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`shrink-0 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                      intentionSelected ? "bg-green-500 text-white" : "bg-indigo-600 text-white"
                    }`}>
                      {intentionSelected ? "✓" : "2"}
                    </span>
                    <p className="text-sm font-semibold text-gray-900">
                      Choose a direction <span className="text-red-500">*</span>
                    </p>
                  </div>
                  <p className="text-xs text-gray-700 pl-8 mb-2">
                    Select a suggested direction for your message, or type your own.
                  </p>
                  <div className="pl-8">
                    <IntentionTags
                      conversationId={conversationId!}
                      window={draft.window}
                      selectedTag={draft.intentionTag}
                      pinnedTag={draft.pinnedIntentionTag}
                      onSelect={handleIntentionSelect}
                    />
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-gray-200 bg-gray-100 p-3 opacity-50">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold bg-gray-300 text-gray-500">2</span>
                    <p className="text-sm font-medium text-gray-400">Choose a direction</p>
                  </div>
                </div>
              )}

              {/* Step 3: Source Search */}
              {windowComplete && intentionSelected ? (
                <div className={`rounded-md border p-3 ${sourcesAdded ? "border-green-200 bg-green-50/50" : "border-gray-200 bg-gray-50"}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`shrink-0 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                      sourcesAdded ? "bg-green-500 text-white" : "bg-indigo-600 text-white"
                    }`}>
                      {sourcesAdded ? "✓" : "3"}
                    </span>
                    <p className="text-sm font-semibold text-gray-900">
                      Add sources <span className="text-red-500">*</span>
                    </p>
                  </div>
                  <div className="pl-8 space-y-2">
                    {/* Search mode tabs */}
                    <div className="flex items-center gap-1 rounded-md bg-white border border-gray-300 p-0.5">
                      <button
                        onClick={() => setSearchMode("ai")}
                        className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          searchMode === "ai"
                            ? "bg-violet-600 text-white shadow-sm"
                            : "text-gray-600 hover:text-gray-800"
                        }`}
                      >
                        AI Finder
                      </button>
                      <button
                        onClick={() => setSearchMode("scholar")}
                        className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          searchMode === "scholar"
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "text-gray-600 hover:text-gray-800"
                        }`}
                      >
                        Scholar
                      </button>
                      <button
                        onClick={() => setSearchMode("web")}
                        className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          searchMode === "web"
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "text-gray-600 hover:text-gray-800"
                        }`}
                      >
                        Web
                      </button>
                      <button
                        onClick={() => setSearchMode("manual")}
                        className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          searchMode === "manual"
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "text-gray-600 hover:text-gray-800"
                        }`}
                      >
                        Manual
                      </button>
                    </div>

                    {/* AI Source Finder */}
                    {searchMode === "ai" && (
                      <AISourceFinder
                        conversationId={conversationId!}
                        window={draft.window}
                        intentionTag={draft.intentionTag!.tag}
                        contributionType={draft.intentionTag!.category}
                        onInsertResource={insertResourceFromAI}
                        insertedResourceIds={new Set(draft.insertedResources.map(r => r.id))}
                        state={aiFinderState}
                        onStateChange={setAiFinderState}
                      />
                    )}

                    {/* Scholar/Web search */}
                    {(searchMode === "scholar" || searchMode === "web") && (
                      <>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                            placeholder={searchMode === "scholar" ? "Search academic papers..." : "Search the web..."}
                            className="flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                          />
                          <button
                            onClick={handleSearch}
                            disabled={searching || !searchQuery.trim()}
                            className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                          >
                            {searching ? "..." : "Search"}
                          </button>
                        </div>
                        {searching && (
                          <p className="text-xs text-gray-500 italic">Searching...</p>
                        )}
                        {(() => {
                          const currentResults = searchMode === "web" ? webResults : scholarResults;
                          const searchPerformed = searchMode === "web" ? webSearchPerformed : scholarSearchPerformed;
                          if (!searching && currentResults.length === 0 && searchPerformed) {
                            return <p className="text-xs text-gray-500 italic">No results found.</p>;
                          }
                          if (currentResults.length > 0) {
                            return (
                              <div className="max-h-64 overflow-y-auto space-y-1.5">
                                {currentResults.map((r) => {
                                  const meta = r.result_metadata ?? {};
                                  const authors = (meta.authors as string[] | undefined) ?? [];
                                  const year = meta.year as number | undefined;
                                  const citations = meta.citation_count as number | undefined;
                                  const tldr = (meta.tldr as string | undefined) || "";
                                  const isInserted = draft.insertedResources.some((res) => res.id === r.id);
                                  return (
                                    <div key={r.id} className="rounded-md border border-gray-200 bg-white px-3 py-2">
                                      <div className="min-w-0 flex-1">
                                        <p className="text-xs font-semibold text-gray-800">{r.result_title || r.query}</p>
                                        {authors.length > 0 && (
                                          <p className="mt-0.5 text-xs text-gray-600">
                                            {authors.slice(0, 3).join(", ")}{authors.length > 3 && " et al."}
                                          </p>
                                        )}
                                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                                          {year && <span>{year}</span>}
                                          {citations !== undefined && <span>{citations} citations</span>}
                                        </div>
                                        {tldr ? (
                                          <p className="mt-1 text-xs text-gray-700 italic">{tldr}</p>
                                        ) : r.result_snippet ? (
                                          <p className="mt-1 text-xs text-gray-500 line-clamp-3">{r.result_snippet}</p>
                                        ) : null}
                                      </div>
                                      <div className="mt-2 flex items-center gap-2">
                                        <button
                                          onClick={() => insertSearchResult(r)}
                                          disabled={isInserted}
                                          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                                            isInserted
                                              ? "bg-green-100 text-green-700 border border-green-300 cursor-not-allowed"
                                              : "bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm"
                                          }`}
                                        >
                                          {isInserted ? (
                                            <>
                                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                                                <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                                              </svg>
                                              Inserted
                                            </>
                                          ) : (
                                            <>
                                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                                                <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
                                              </svg>
                                              Add Source
                                            </>
                                          )}
                                        </button>
                                        {r.result_url && (
                                          <button
                                            onClick={() => window.open(r.result_url!, "_blank", "noopener,noreferrer")}
                                            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-gray-800 transition-colors"
                                            title="Open in new tab"
                                          >
                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                                              <path fillRule="evenodd" d="M4.22 11.78a.75.75 0 0 1 0-1.06L9.44 5.5H5.75a.75.75 0 0 1 0-1.5h5.5a.75.75 0 0 1 .75.75v5.5a.75.75 0 0 1-1.5 0V6.56l-5.22 5.22a.75.75 0 0 1-1.06 0Z" clipRule="evenodd" />
                                            </svg>
                                            Open
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          }
                          return null;
                        })()}
                      </>
                    )}

                    {/* Manual source */}
                    {searchMode === "manual" && (
                      <div className="space-y-2">
                        <p className="text-xs text-gray-600">
                          Add a source you already have in mind (e.g., a fact, reference, or link).
                        </p>
                        <input
                          type="text"
                          value={manualSourceTitle}
                          onChange={(e) => setManualSourceTitle(e.target.value)}
                          placeholder="Source title or brief description..."
                          className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                        />
                        <textarea
                          rows={3}
                          value={manualSourceContent}
                          onChange={(e) => setManualSourceContent(e.target.value)}
                          placeholder="Paste content, URL, or notes about this source (optional)..."
                          className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                        />
                        <button
                          onClick={handleAddManualSource}
                          disabled={!manualSourceTitle.trim()}
                          className="w-full rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                        >
                          Add Source
                        </button>
                      </div>
                    )}

                    <InsertedResourcesList />
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-gray-200 bg-gray-100 p-3 opacity-50">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold bg-gray-300 text-gray-500">3</span>
                    <p className="text-sm font-medium text-gray-400">Add sources</p>
                  </div>
                </div>
              )}

              {/* Step 4: Importance */}
              {windowComplete && intentionSelected && sourcesAdded ? (
                <div className={`rounded-md border p-3 ${importanceSelected ? "border-green-200 bg-green-50/50" : "border-gray-200 bg-gray-50"}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`shrink-0 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                      importanceSelected ? "bg-green-500 text-white" : "bg-indigo-600 text-white"
                    }`}>
                      {importanceSelected ? "✓" : "4"}
                    </span>
                    <p className="text-sm font-semibold text-gray-900">
                      Rate importance <span className="text-red-500">*</span>
                    </p>
                  </div>
                  <div className="pl-8 space-y-1.5">
                    {PERTINENCE_LEVELS.map((level) => (
                      <label
                        key={level.value}
                        className={`flex items-start gap-2.5 rounded-md border px-3 py-2 cursor-pointer transition-colors ${
                          draft.pertinence === level.value
                            ? "border-indigo-400 bg-indigo-50"
                            : "border-gray-200 bg-white hover:border-gray-300"
                        }`}
                      >
                        <input
                          type="radio"
                          name="pertinence"
                          checked={draft.pertinence === level.value}
                          onChange={() => setDraft({ ...draft, pertinence: level.value })}
                          className="mt-0.5 h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
                        />
                        <span className="text-sm text-gray-700">
                          <span className="font-semibold">{level.title}</span> — {level.description}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-gray-200 bg-gray-100 p-3 opacity-50">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold bg-gray-300 text-gray-500">4</span>
                    <p className="text-sm font-medium text-gray-400">Rate importance</p>
                  </div>
                </div>
              )}

              {/* Step 5: Write Message */}
              {windowComplete && intentionSelected && sourcesAdded && importanceSelected ? (
                <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`shrink-0 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                      draft.raw_ideal_response.trim() ? "bg-green-500 text-white" : "bg-indigo-600 text-white"
                    }`}>
                      {draft.raw_ideal_response.trim() ? "✓" : "5"}
                    </span>
                    <p className="text-sm font-semibold text-gray-900">
                      Create message <span className="text-red-500">*</span>
                    </p>
                    <p className="text-xs text-gray-500 ml-1">This message will be inserted into the conversation at the placement point.</p>
                  </div>
                  <div className="pl-8">
                    <MessageCreator
                      conversationId={conversationId!}
                      window={draft.window}
                      intentionTag={draft.intentionTag!.tag}
                      contributionType={draft.intentionTag!.category}
                      pertinence={draft.pertinence!}
                      insertedResources={draft.insertedResources}
                      value={draft.raw_ideal_response}
                      onChange={(val) => setDraft(prev => prev ? { ...prev, raw_ideal_response: val } : prev)}
                      aiInteractionLog={draft.aiInteractionLog}
                      onAiInteractionLog={(log) => setDraft(prev => prev ? { ...prev, aiInteractionLog: log } : prev)}
                    />
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-gray-200 bg-gray-100 p-3 opacity-50">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold bg-gray-300 text-gray-500">5</span>
                    <p className="text-sm font-medium text-gray-400">Create message</p>
                  </div>
                </div>
              )}

              {/* Notes (optional, always visible when draft is open) */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Notes (optional)
                </label>
                <textarea
                  rows={3}
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  placeholder="Any additional thoughts, context, or reasoning about this message..."
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
            </div>
          ) : (
            /* No draft open — show summary + saved items in right pane */
            <div className="flex h-full flex-col">
              <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
                {items.length > 0 ? (
                  <>
                    {/* Status header */}
                    <div className="flex items-center gap-3">
                      <div className="rounded-full bg-green-100 p-2">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5 text-green-600">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-700">
                          {items.length} message{items.length !== 1 && "s"} created
                        </p>
                      </div>
                      <button
                        onClick={handleFinish}
                        className="shrink-0 rounded-md bg-green-600 px-4 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-green-500 transition-colors"
                      >
                        Done. Advance to Annotation.
                      </button>
                    </div>

                    {/* Next-item suggestions */}
                    {nextSuggestions.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Create another message from one of the suggested directions
                        </p>
                        <div className="space-y-1.5">
                          {nextSuggestions.map((suggestion, i) => (
                            <button
                              key={i}
                              onClick={() => handleSuggestionClick(suggestion)}
                              className="w-full text-left rounded-md border border-gray-200 bg-white px-3 py-2.5 hover:border-indigo-300 hover:bg-indigo-50 transition-colors group"
                            >
                              <div className="flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4 shrink-0 text-indigo-400 group-hover:text-indigo-600 transition-colors">
                                  <path fillRule="evenodd" d="M2 8a.75.75 0 0 1 .75-.75h8.69L8.22 4.03a.75.75 0 0 1 1.06-1.06l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 0 1-1.06-1.06l3.22-3.22H2.75A.75.75 0 0 1 2 8Z" clipRule="evenodd" />
                                </svg>
                                <div className="min-w-0 flex-1">
                                  <span className="text-sm font-medium text-gray-800 group-hover:text-indigo-700">{suggestion.direction}</span>
                                  <span className="ml-2 text-xs text-gray-400">turn {suggestion.best_turn}</span>
                                </div>
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 shrink-0 text-gray-300 group-hover:text-indigo-400 transition-colors">
                                  <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                                </svg>
                              </div>
                              {suggestion.detail && (
                                <p className="mt-1 pl-6 text-xs text-gray-500 line-clamp-2">{suggestion.detail}</p>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {(suggestionsLoading || pendingFetchInProgress) && nextSuggestions.length === 0 && (
                      <div className="flex items-center gap-2 py-2">
                        <svg className="h-3.5 w-3.5 animate-spin text-indigo-400" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span className="text-xs text-gray-400">Generating suggestions for your next message...</span>
                      </div>
                    )}

                    {/* Start blank */}
                    <button
                      onClick={handleNewItem}
                      className="w-full rounded-md border border-dashed border-gray-300 px-3 py-2.5 text-left hover:border-gray-400 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4 text-gray-400">
                          <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
                        </svg>
                        <span className="text-sm text-gray-600">New blank message</span>
                      </div>
                    </button>
                  </>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
                    <div className="rounded-full bg-gray-100 p-4">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-8 w-8 text-gray-400">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700">
                        Review the transcript and identify where outside knowledge (e.g., a source, a fact, a recommendation, etc.) would have helped your conversation.
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        Click "New Message" to get started.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Saved items list — shown at bottom of right pane when no draft is open */}
              {items.length > 0 && (
                <div className="shrink-0 border-t border-gray-200 bg-gray-50 px-4 py-2.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Created Messages ({items.length})
                  </p>
                  <div className="mt-1 space-y-1">
                    {items.map((it, idx) => (
                      <div
                        key={it.id}
                        className="flex items-stretch rounded-md border border-gray-200 bg-white transition-colors"
                      >
                        <button
                          onClick={() => handleEditItem(it)}
                          className="flex-1 min-w-0 text-left px-3 py-1.5 text-xs"
                        >
                          <div className="flex items-baseline gap-1 flex-wrap">
                            <span className="font-semibold text-indigo-600">{idx + 1}.</span>
                            {it.contribution_type_detail && (
                              <span className="text-gray-500">({it.contribution_type_detail})</span>
                            )}
                            <span className="text-gray-500">— turns {it.window_start_turn_number}–{it.window_end_turn_number}</span>
                          </div>
                          <p className="mt-0.5 text-gray-500 truncate">{renderMarkdown(it.raw_ideal_response)}</p>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteItem(it);
                          }}
                          className="shrink-0 flex items-center px-2.5 text-red-600 hover:bg-red-50 rounded-r-md transition-colors border-l border-gray-200"
                          title="Delete message"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
                            <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5a.75.75 0 0 1 .786-.711Z" clipRule="evenodd" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Pinned action bar */}
        {showDraft && draft && !showPreview && (
          <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3">
            <div className="flex gap-2">
              <button
                onClick={handleOpenPreview}
                disabled={!windowComplete || !intentionSelected || !sourcesAdded || !importanceSelected || !draft.raw_ideal_response.trim()}
                className="flex-1 rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:bg-gray-300 disabled:text-gray-500 disabled:shadow-none disabled:cursor-not-allowed"
              >
                Review & Place
              </button>
              <button
                type="button"
                onClick={handleCancelDraft}
                className="rounded-md border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Finish confirmation modal */}
      {showFinishPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">
              Are you sure you've created all messages possible for the conversation?
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              You've created <strong>{items.length}</strong> message{items.length !== 1 && "s"} so far.
              Take a moment to consider whether there are any other points in the conversation
              where external information could have helped the group.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => {
                  setShowFinishPrompt(false);
                  handleNewItem();
                }}
                className="flex-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 transition-colors"
              >
                Construct More Items
              </button>
              <button
                onClick={async () => {
                  setShowFinishPrompt(false);
                  if (conversationId) {
                    try {
                      await markConstructionDone(conversationId);
                    } catch { /* best effort */ }
                  }
                  navigate("/my-groups");
                }}
                className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Yes, I'm Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bookmark warning modal */}
      {showBookmarkWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-amber-500">
                <path
                  fillRule="evenodd"
                  d="M10 2c-1.716 0-3.408.106-5.07.31C3.806 2.45 3 3.414 3 4.517v11.907a.75.75 0 001.159.63L10 13.177l5.841 3.876A.75.75 0 0017 16.423V4.517c0-1.103-.806-2.068-1.93-2.207A41.403 41.403 0 0010 2z"
                  clipRule="evenodd"
                />
              </svg>
              <h3 className="text-lg font-semibold text-gray-900">
                Uncovered bookmarks
              </h3>
            </div>
            <p className="mt-2 text-sm text-gray-600">
              Are you sure? You haven't created anything related to your bookmarked turns.
              Some turns you marked during the conversation are not covered by any of your messages.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => {
                  setShowBookmarkWarning(false);
                  handleNewItem();
                }}
                className="flex-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 transition-colors"
              >
                Go Back & Construct
              </button>
              <button
                onClick={() => {
                  setShowBookmarkWarning(false);
                  setShowFinishPrompt(true);
                }}
                className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Proceed Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {itemToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">
              Delete Message?
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              Are you sure you want to delete this message? This action cannot be undone.
            </p>
            <div className="mt-3 rounded-md bg-gray-50 border border-gray-200 p-3">
              <p className="text-xs font-medium text-gray-500 mb-1">
                <span className="capitalize">{itemToDelete.contribution_type.replace(/_/g, " ")}</span>
                {" — "}
                <span>turns {itemToDelete.window_start_turn_number}–{itemToDelete.window_end_turn_number}</span>
              </p>
              <p className="text-xs text-gray-700 line-clamp-2">{renderMarkdown(itemToDelete.raw_ideal_response)}</p>
            </div>
            <div className="mt-5 flex gap-3">
              <button
                onClick={handleCancelDelete}
                disabled={deleting}
                className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="flex-1 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-500 disabled:opacity-50 transition-colors"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
