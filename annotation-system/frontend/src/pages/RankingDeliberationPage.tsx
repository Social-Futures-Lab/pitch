import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  getPeerRankings,
  saveRankingRevision,
  completeRankingDeliberation,
  type PeerRankingsResponse,
  type PeerRankedItem,
} from "@/api/rankingDeliberation";
import { renderMarkdown } from "@/components/common/renderMarkdown";

// Stable colors for peer annotators
const PEER_COLORS = [
  { bg: "bg-blue-100", text: "text-blue-700", border: "border-blue-300" },
  { bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-300" },
  { bg: "bg-purple-100", text: "text-purple-700", border: "border-purple-300" },
  { bg: "bg-amber-100", text: "text-amber-700", border: "border-amber-300" },
];

type RankCardItem = { knowledge_item_id: string; neutralized_ideal_response: string; best_turn_number: number | null; do_not_surface?: boolean };

function RankCardContent({
  item,
  rank,
  originalRank,
  peerRanks,
  peerLabels,
}: {
  item: RankCardItem;
  rank: number;
  originalRank: number | null;
  peerRanks: (number | null)[];
  peerLabels: string[];
}) {
  const isGrayed = item.do_not_surface;
  return (
    <div className="flex items-start gap-3">
      <button
        className="mt-0.5 shrink-0 cursor-grab touch-none text-gray-400 hover:text-gray-600 active:cursor-grabbing"
        aria-label={`Reorder item ranked ${rank}`}
        tabIndex={-1}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
          <path fillRule="evenodd" d="M2 3.75A.75.75 0 0 1 2.75 3h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 3.75ZM2 8a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 8Zm0 4.25a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
        </svg>
      </button>

      <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
        isGrayed ? "bg-gray-400" : "bg-indigo-600"
      }`}>
        {rank}
      </div>

      <div className="min-w-0 flex-1">
        <div className={`text-sm leading-relaxed ${isGrayed ? "text-gray-400" : "text-gray-700"}`}>
          {renderMarkdown(item.neutralized_ideal_response)}
        </div>
        {isGrayed && (
          <span className="mt-1 inline-block rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
            should not appear
          </span>
        )}
      </div>

      {/* Rank comparison tags */}
      <div className="flex shrink-0 items-center gap-1">
        {originalRank !== null && (
          <div
            className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-600 text-[10px] font-bold text-white"
            title={`Your original: rank ${originalRank}`}
          >
            {originalRank}
          </div>
        )}
        {peerRanks.map((peerRank, idx) => {
          const color = PEER_COLORS[idx % PEER_COLORS.length];
          return (
            <div
              key={peerLabels[idx]}
              className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-bold ${color.bg} ${color.text} ${color.border}`}
              title={`${peerLabels[idx]}: rank ${peerRank ?? "—"}`}
            >
              {peerRank ?? "—"}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SortableRankCard({
  item,
  rank,
  originalRank,
  peerRanks,
  peerLabels,
}: {
  item: RankCardItem;
  rank: number;
  originalRank: number | null;
  peerRanks: (number | null)[];
  peerLabels: string[];
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.knowledge_item_id });

  const style = {
    transform: transform
      ? `translate3d(0, ${Math.round(transform.y)}px, 0)`
      : undefined,
    transition: transition ?? undefined,
    opacity: isDragging ? 0.4 : undefined,
  };

  const isGrayed = item.do_not_surface;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-lg border px-4 py-3 shadow-sm ${
        isDragging
          ? "border-indigo-200 bg-indigo-50/50"
          : isGrayed
          ? "border-gray-200 bg-gray-100 opacity-60 hover:shadow-md"
          : "border-gray-200 bg-white hover:shadow-md"
      }`}
      {...attributes}
      {...listeners}
    >
      <RankCardContent item={item} rank={rank} originalRank={originalRank} peerRanks={peerRanks} peerLabels={peerLabels} />
    </div>
  );
}

export default function RankingDeliberationPage() {
  const { excerptId } = useParams<{ excerptId: string }>();
  const [searchParams] = useSearchParams();
  const conversationScope = searchParams.get("conversation");
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PeerRankingsResponse | null>(null);
  const [orderedItems, setOrderedItems] = useState<PeerRankedItem[]>([]);
  const [savedOrder, setSavedOrder] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Load peer rankings for this excerpt
  useEffect(() => {
    if (!excerptId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await getPeerRankings(excerptId!);
        if (cancelled) return;
        setData(result);
        // Initialize order from own ranking
        setOrderedItems([...result.own_ranking.ranked_items]);
        setSavedOrder(result.own_ranking.ranked_items.map((r) => r.knowledge_item_id));
        setSaved(false);
      } catch {
        if (!cancelled) setError("Failed to load ranking data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [excerptId]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setOrderedItems((prev) => {
        const oldIndex = prev.findIndex((i) => i.knowledge_item_id === active.id);
        const newIndex = prev.findIndex((i) => i.knowledge_item_id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
      setSaved(false);
    }
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!excerptId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const ranked = orderedItems.map((item, idx) => ({
        knowledge_item_id: item.knowledge_item_id,
        rank: idx + 1,
        chosen_best_turn_number: item.chosen_best_turn_number,
      }));
      await saveRankingRevision(excerptId, ranked);
      await completeRankingDeliberation();
      setSaved(true);
      setSavedOrder(orderedItems.map((i) => i.knowledge_item_id));
      navigate(conversationScope ? `/ranking-deliberation/summary?conversation=${conversationScope}` : "/ranking-deliberation/summary");
    } catch {
      setSaveError("Failed to save ranking. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [excerptId, orderedItems, navigate, conversationScope]);

  const peerLabels = useMemo(
    () => data?.peers.map((p) => p.annotator_label) ?? [],
    [data]
  );

  // For each item in our current order, get what rank each peer assigned
  const getPeerRanksForItem = useCallback(
    (knowledgeItemId: string): (number | null)[] => {
      if (!data) return [];
      return data.peers.map((peer) => peer.item_rank_map[knowledgeItemId] ?? null);
    },
    [data]
  );

  // Get the user's original rank for an item
  const getOriginalRankForItem = useCallback(
    (knowledgeItemId: string): number | null => {
      if (!data) return null;
      const item = data.original_ranking.ranked_items.find(
        (r) => r.knowledge_item_id === knowledgeItemId
      );
      return item?.rank ?? null;
    },
    [data]
  );

  // Check if current ranking differs from original
  const hasChanges = useMemo(() => {
    if (!data) return false;
    const originalOrder = data.original_ranking.ranked_items.map((r) => r.knowledge_item_id);
    const currentOrder = orderedItems.map((r) => r.knowledge_item_id);
    return JSON.stringify(originalOrder) !== JSON.stringify(currentOrder);
  }, [data, orderedItems]);

  // Check if current order differs from last saved order
  const hasUnsavedChanges = useMemo(() => {
    const currentOrder = orderedItems.map((r) => r.knowledge_item_id);
    return JSON.stringify(currentOrder) !== JSON.stringify(savedOrder);
  }, [orderedItems, savedOrder]);

  const summaryPath = conversationScope
    ? `/ranking-deliberation/summary?conversation=${conversationScope}`
    : "/ranking-deliberation/summary";

  const handleGoToSummary = useCallback(() => {
    if (hasUnsavedChanges) {
      setShowUnsavedWarning(true);
    } else {
      navigate(summaryPath);
    }
  }, [hasUnsavedChanges, navigate, summaryPath]);

  const handleSaveAndGoToSummary = useCallback(async () => {
    if (!excerptId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const ranked = orderedItems.map((item, idx) => ({
        knowledge_item_id: item.knowledge_item_id,
        rank: idx + 1,
        chosen_best_turn_number: item.chosen_best_turn_number,
      }));
      await saveRankingRevision(excerptId, ranked);
      setSavedOrder(orderedItems.map((i) => i.knowledge_item_id));
      setShowUnsavedWarning(false);
      navigate(summaryPath);
    } catch {
      setSaveError("Failed to save ranking. Please try again.");
      setShowUnsavedWarning(false);
    } finally {
      setSaving(false);
    }
  }, [excerptId, orderedItems, navigate, summaryPath]);


  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-3 text-gray-400">
          <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading ranking data...
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">{error ?? "No data available"}</p>
          <button onClick={() => window.location.reload()} className="mt-3 text-sm text-indigo-600 hover:underline">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Sticky header with title + legend */}
      <div className="shrink-0 border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Ranking Review</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              Compare your ranking with peers and revise if needed. Drag items to reorder.
            </p>
          </div>
          {hasChanges && (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
              Modified
            </span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Legend:</span>
          <div className="flex items-center gap-1.5">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">
              #
            </div>
            <span className="text-xs text-gray-600">Your current rank</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-600 text-[10px] font-bold text-white">
              #
            </div>
            <span className="text-xs text-gray-600">Your original</span>
          </div>
          {peerLabels.map((label, idx) => {
            const color = PEER_COLORS[idx % PEER_COLORS.length];
            return (
              <div key={label} className="flex items-center gap-1.5">
                <div className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold ${color.bg} ${color.text} ${color.border}`}>
                  #
                </div>
                <span className="text-xs text-gray-600">{label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
        <div className="mx-auto max-w-3xl space-y-4">

            {/* Direction indicator */}
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-green-600">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                <path fillRule="evenodd" d="M8 14a.75.75 0 0 1-.75-.75V4.56L4.03 7.78a.75.75 0 0 1-1.06-1.06l4.5-4.5a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1-1.06 1.06L8.75 4.56v8.69A.75.75 0 0 1 8 14Z" clipRule="evenodd" />
              </svg>
              Most valuable
            </div>

            {/* Sortable ranking list */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <SortableContext
                items={orderedItems.map((i) => i.knowledge_item_id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {orderedItems.map((item, idx) => {
                    const info = data.items_info[item.knowledge_item_id];
                    return (
                      <SortableRankCard
                        key={item.knowledge_item_id}
                        item={{
                          knowledge_item_id: item.knowledge_item_id,
                          neutralized_ideal_response: info?.neutralized_ideal_response ?? "Unknown item",
                          best_turn_number: info?.best_turn_number ?? null,
                          do_not_surface: info?.do_not_surface,
                        }}
                        rank={idx + 1}
                        originalRank={getOriginalRankForItem(item.knowledge_item_id)}
                        peerRanks={getPeerRanksForItem(item.knowledge_item_id)}
                        peerLabels={peerLabels}
                      />
                    );
                  })}
                </div>
              </SortableContext>

              <DragOverlay dropAnimation={null}>
                {activeId && (() => {
                  const activeIdx = orderedItems.findIndex((i) => i.knowledge_item_id === activeId);
                  const activeItem = orderedItems[activeIdx];
                  if (!activeItem) return null;
                  const info = data.items_info[activeItem.knowledge_item_id];
                  return (
                    <div className="rounded-lg border border-indigo-300 bg-white px-4 py-3 shadow-xl">
                      <RankCardContent
                        item={{
                          knowledge_item_id: activeItem.knowledge_item_id,
                          neutralized_ideal_response: info?.neutralized_ideal_response ?? "Unknown item",
                          best_turn_number: info?.best_turn_number ?? null,
                          do_not_surface: info?.do_not_surface,
                        }}
                        rank={activeIdx + 1}
                        originalRank={getOriginalRankForItem(activeItem.knowledge_item_id)}
                        peerRanks={getPeerRanksForItem(activeItem.knowledge_item_id)}
                        peerLabels={peerLabels}
                      />
                    </div>
                  );
                })()}
              </DragOverlay>
            </DndContext>

            {/* Direction indicator */}
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                <path fillRule="evenodd" d="M8 2a.75.75 0 0 1 .75.75v8.69l3.22-3.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.22 3.22V2.75A.75.75 0 0 1 8 2Z" clipRule="evenodd" />
              </svg>
              Least valuable
            </div>
          </div>
        </div>

      {/* Footer with save + complete */}
      <div className="shrink-0 border-t border-gray-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-end gap-3">
          {saved && <span className="text-xs font-medium text-green-600">Saved!</span>}
          {saveError && <span className="text-xs font-medium text-red-600">{saveError}</span>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save ranking and complete review"}
          </button>
        </div>
      </div>

    </div>
  );
}
