import { useState, useCallback, useEffect, useRef } from "react";
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
import { renderMarkdown } from "@/components/common/renderMarkdown";

export interface RankableItem {
  knowledge_item_id: string;
  neutralized_ideal_response: string;
  contribution_type: string;
  best_turn_number: number;
  best_turn_text?: string;
  best_turn_speaker?: string;
  is_own_item?: boolean;
  do_not_surface?: boolean;
}

interface RankingPanelProps {
  items: RankableItem[];
  onSave: (
    ranked: Array<{
      knowledge_item_id: string;
      rank: number;
      chosen_best_turn_number: number;
    }>
  ) => Promise<void>;
  onSubmit: () => void;
  highlightedItemId?: string | null;
  onItemHover?: (itemId: string | null) => void;
  scrollToItemId?: string | null;
  onReorder?: (items: RankableItem[]) => void;
}

function CardContent({
  item,
  rank,
  highlighted,
  isGrayed,
}: {
  item: RankableItem;
  rank: number;
  highlighted?: boolean;
  isGrayed?: boolean;
}) {
  return (
    <>
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
        highlighted ? "bg-indigo-600" : isGrayed ? "bg-gray-400" : "bg-indigo-600"
      }`}>
        {rank}
      </div>

      <div className="min-w-0 flex-1">
        <div className={`text-sm leading-relaxed ${isGrayed && !highlighted ? "text-gray-400" : "text-gray-700"}`}>
          {renderMarkdown(item.neutralized_ideal_response)}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
          <span>Would appear after turn #{item.best_turn_number}</span>
          {isGrayed && (
            <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
              marked should not appear
            </span>
          )}
        </div>
      </div>
    </>
  );
}

function SortableCard({
  item,
  rank,
  highlighted,
  onHover,
  cardRef,
}: {
  item: RankableItem;
  rank: number;
  highlighted?: boolean;
  onHover?: (itemId: string | null) => void;
  cardRef?: (el: HTMLDivElement | null) => void;
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
      ref={(el) => {
        setNodeRef(el);
        cardRef?.(el);
      }}
      style={style}
      data-testid={`ranking-card-${rank}`}
      onMouseEnter={() => !isDragging && onHover?.(item.knowledge_item_id)}
      onMouseLeave={() => onHover?.(null)}
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 shadow-sm ${
        isDragging
          ? "border-indigo-200 bg-indigo-50/50"
          : highlighted
          ? "border-indigo-400 bg-indigo-50 shadow-md ring-1 ring-indigo-300"
          : isGrayed
          ? "border-gray-200 bg-gray-100 opacity-60 hover:shadow-md"
          : "border-gray-200 bg-white hover:shadow-md"
      }`}
      {...attributes}
      {...listeners}
    >
      <CardContent item={item} rank={rank} highlighted={highlighted} isGrayed={isGrayed} />
    </div>
  );
}

export default function RankingPanel({ items, onSave, onSubmit, highlightedItemId, onItemHover, scrollToItemId, onReorder }: RankingPanelProps) {
  const [orderedItems, setOrderedItems] = useState<RankableItem[]>(items);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSubmitWarning, setShowSubmitWarning] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const lastItemIdsRef = useRef<string>("");

  // Only sync from parent when the item set itself changes (initial load / refetch),
  // not when order changes due to our own drag bubbling back via onReorder.
  useEffect(() => {
    const incomingIds = items.map((i) => i.knowledge_item_id).join(",");
    if (incomingIds !== lastItemIdsRef.current) {
      lastItemIdsRef.current = incomingIds;
      setOrderedItems(items);
    }
  }, [items]);

  useEffect(() => {
    if (!scrollToItemId) return;
    const el = cardRefs.current.get(scrollToItemId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [scrollToItemId]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setOrderedItems((prev) => {
        const activeItem = prev.find((i) => i.knowledge_item_id === active.id);
        const overItem = prev.find((i) => i.knowledge_item_id === over.id);
        if (!activeItem || !overItem) return prev;
        // Only allow reordering within the same section
        if (!!activeItem.do_not_surface !== !!overItem.do_not_surface) return prev;
        const oldIndex = prev.findIndex((i) => i.knowledge_item_id === active.id);
        const newIndex = prev.findIndex((i) => i.knowledge_item_id === over.id);
        const next = arrayMove(prev, oldIndex, newIndex);
        onReorder?.(next);
        return next;
      });
      setSaved(false);
      setDirty(true);
    }
  }, [onReorder]);

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const ranked = orderedItems.map((item, idx) => ({
        knowledge_item_id: item.knowledge_item_id,
        rank: idx + 1,
        chosen_best_turn_number: item.best_turn_number,
      }));
      await onSave(ranked);
      setSaved(true);
      setDirty(false);
    } catch {
      setError("Failed to save ranking. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [orderedItems, onSave]);

  const handleSubmitClick = useCallback(() => {
    if (dirty) {
      setShowSubmitWarning(true);
    } else {
      const doSubmit = async () => {
        setSaving(true);
        try {
          const ranked = orderedItems.map((item, idx) => ({
            knowledge_item_id: item.knowledge_item_id,
            rank: idx + 1,
            chosen_best_turn_number: item.best_turn_number,
          }));
          await onSave(ranked);
          onSubmit();
        } catch {
          setError("Failed to save ranking. Please try again.");
        } finally {
          setSaving(false);
        }
      };
      doSubmit();
    }
  }, [dirty, orderedItems, onSave, onSubmit]);

  const handleSubmitConfirm = useCallback(async () => {
    setShowSubmitWarning(false);
    setSaving(true);
    try {
      const ranked = orderedItems.map((item, idx) => ({
        knowledge_item_id: item.knowledge_item_id,
        rank: idx + 1,
        chosen_best_turn_number: item.best_turn_number,
      }));
      await onSave(ranked);
      setDirty(false);
      onSubmit();
    } catch {
      setError("Failed to save ranking. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [orderedItems, onSave, onSubmit]);

  // Find the active item for the overlay
  const activeItem = activeId ? orderedItems.find((i) => i.knowledge_item_id === activeId) : null;
  const activeRank = activeItem ? orderedItems.indexOf(activeItem) + 1 : 0;

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center">
        <p className="text-sm text-gray-500">
          No messages to rank. All messages were marked as should not appear.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/50">
      <div className="border-b border-indigo-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-indigo-900">
          Rank the messages
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-indigo-700">
          Considering all messages (including ones you created) if only one
          could be shared during this conversation, which would be most valuable
          to the group? Drag them into order from most to least valuable.
        </p>
      </div>

      <div className="p-4">
        <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-green-600">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
            <path fillRule="evenodd" d="M8 14a.75.75 0 0 1-.75-.75V4.56L4.03 7.78a.75.75 0 0 1-1.06-1.06l4.5-4.5a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1-1.06 1.06L8.75 4.56v8.69A.75.75 0 0 1 8 14Z" clipRule="evenodd" />
          </svg>
          Most valuable
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          {(() => {
            const surfaceItems = orderedItems.filter((i) => !i.do_not_surface);
            const doNotSurfaceItems = orderedItems.filter((i) => i.do_not_surface);
            const surfaceOffset = 0;
            const doNotSurfaceOffset = surfaceItems.length;

            return (
              <>
                <SortableContext items={surfaceItems.map((i) => i.knowledge_item_id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {surfaceItems.map((item, idx) => (
                      <SortableCard
                        key={item.knowledge_item_id}
                        item={item}
                        rank={surfaceOffset + idx + 1}
                        highlighted={highlightedItemId === item.knowledge_item_id}
                        onHover={onItemHover}
                        cardRef={(el) => {
                          if (el) cardRefs.current.set(item.knowledge_item_id, el);
                          else cardRefs.current.delete(item.knowledge_item_id);
                        }}
                      />
                    ))}
                  </div>
                </SortableContext>

                {doNotSurfaceItems.length > 0 && (
                  <>
                    <div className="my-4 flex items-center gap-3">
                      <div className="flex-1 border-t border-gray-300" />
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                        Should not appear
                      </span>
                      <div className="flex-1 border-t border-gray-300" />
                    </div>

                    <SortableContext items={doNotSurfaceItems.map((i) => i.knowledge_item_id)} strategy={verticalListSortingStrategy}>
                      <div className="space-y-2">
                        {doNotSurfaceItems.map((item, idx) => (
                          <SortableCard
                            key={item.knowledge_item_id}
                            item={item}
                            rank={doNotSurfaceOffset + idx + 1}
                            highlighted={highlightedItemId === item.knowledge_item_id}
                            onHover={onItemHover}
                            cardRef={(el) => {
                              if (el) cardRefs.current.set(item.knowledge_item_id, el);
                              else cardRefs.current.delete(item.knowledge_item_id);
                            }}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </>
                )}
              </>
            );
          })()}

          <DragOverlay dropAnimation={null}>
            {activeItem && (
              <div className="flex items-start gap-3 rounded-lg border border-indigo-300 bg-white px-4 py-3 shadow-xl">
                <CardContent
                  item={activeItem}
                  rank={activeRank}
                  isGrayed={activeItem.do_not_surface}
                />
              </div>
            )}
          </DragOverlay>
        </DndContext>

        <div className="mt-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
            <path fillRule="evenodd" d="M8 2a.75.75 0 0 1 .75.75v8.69l3.22-3.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.22 3.22V2.75A.75.75 0 0 1 8 2Z" clipRule="evenodd" />
          </svg>
          Least valuable
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <button
              data-testid="save-ranking-button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-md border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm transition-colors hover:bg-indigo-50 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save ranking"}
            </button>
            <button
              data-testid="submit-ranking-button"
              onClick={handleSubmitClick}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-50"
            >
              Submit ranking
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
          {saved && <span className="text-xs font-medium text-green-600">Ranking saved!</span>}
          {error && <span className="text-xs font-medium text-red-600">{error}</span>}
        </div>
      </div>

      {showSubmitWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="mx-4 w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">Unsaved changes</h3>
            <p className="mt-2 text-sm text-gray-600">
              You've changed your ranking since the last save. Would you like to save before submitting?
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowSubmitWarning(false)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Go back
              </button>
              <button
                onClick={handleSubmitConfirm}
                disabled={saving}
                className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save & submit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
