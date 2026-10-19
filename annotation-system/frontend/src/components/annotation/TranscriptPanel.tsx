import { useMemo, useEffect, useRef } from "react";
import type { Turn } from "@/types";
import TurnCard from "@/components/annotation/TurnCard";
import { renderMarkdown } from "@/components/common/renderMarkdown";

export interface PlacementWindow {
  startTurn: number | null;
  endTurn: number | null;
  bestTurn: number | null;
}

export type SelectingFor = "start" | "end" | "best" | null;

export interface ItemMarker {
  itemId: string;
  turnNumber: number;
  rank: number;
  label: string;
  doNotSurface?: boolean;
}

interface TranscriptPanelProps {
  turns: Turn[];
  placementWindow: PlacementWindow;
  selectingFor?: SelectingFor;
  onTurnSelected?: (turnNumber: number) => void;
  disabled?: boolean;
  knowledgeItemText?: string | null;
  itemMarkers?: ItemMarker[];
  highlightedItemId?: string | null;
  onMarkerHover?: (itemId: string | null) => void;
  scrollToItemId?: string | null;
}

export default function TranscriptPanel({
  turns,
  placementWindow,
  selectingFor = null,
  onTurnSelected,
  disabled = false,
  knowledgeItemText = null,
  itemMarkers = [],
  highlightedItemId = null,
  onMarkerHover,
  scrollToItemId = null,
}: TranscriptPanelProps) {
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

  const markersByTurn = useMemo(() => {
    const map = new Map<number, ItemMarker[]>();
    for (const marker of itemMarkers) {
      const existing = map.get(marker.turnNumber) ?? [];
      existing.push(marker);
      map.set(marker.turnNumber, existing);
    }
    return map;
  }, [itemMarkers]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (!scrollToItemId) return;
    const el = markerRefs.current.get(scrollToItemId);
    if (el && scrollContainerRef.current) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [scrollToItemId]);

  const handleTurnClick = (turnNumber: number) => {
    if (disabled || !selectingFor || !onTurnSelected) return;
    onTurnSelected(turnNumber);
  };

  const isSelectable = (turnNumber: number): boolean => {
    if (!selectingFor || disabled) return false;
    if (selectingFor === "end") {
      return placementWindow.startTurn !== null && turnNumber >= placementWindow.startTurn;
    }
    if (selectingFor === "best") {
      return (
        placementWindow.startTurn !== null &&
        placementWindow.endTurn !== null &&
        turnNumber >= placementWindow.startTurn &&
        turnNumber <= placementWindow.endTurn
      );
    }
    return true;
  };

  const getHintText = () => {
    if (disabled && itemMarkers.length === 0) return "Placement disabled (item marked as should not appear)";
    if (!selectingFor) return null;
    switch (selectingFor) {
      case "start":
        return "Click a turn to set as the FIRST RELEVANT point — the message could be inserted after this turn";
      case "end":
        return "Click a turn at or after the first relevant to set as the LAST USEFUL point — the message would still help here";
      case "best":
        return "Click a turn within the range to set as the BEST PLACEMENT point — the ideal moment to insert the message";
    }
  };

  const hint = getHintText();

  return (
    <div className="flex h-full flex-col">
      {hint && (
        <div className={`shrink-0 border-b px-4 py-2 ${disabled ? "border-gray-200 bg-gray-50" : "border-indigo-200 bg-indigo-50"}`}>
          <p className={`text-xs font-medium ${disabled ? "text-gray-400" : "text-indigo-700"}`}>
            {hint}
          </p>
        </div>
      )}

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-3">
        <div className="space-y-2">
          <div className="space-y-1.5">
            {turns.map((turn) => {
              const speakerIndex = speakerMap.get(turn.speaker_id) ?? 0;
              const { startTurn, endTurn, bestTurn } = placementWindow;

              const showPlacement = !disabled;

              const isInWindow =
                showPlacement &&
                startTurn !== null &&
                endTurn !== null &&
                turn.turn_number >= startTurn &&
                turn.turn_number <= endTurn;

              const isStartOnly =
                showPlacement &&
                startTurn !== null &&
                endTurn === null &&
                turn.turn_number === startTurn;

              const selectable = isSelectable(turn.turn_number);
              const clickable = !!selectingFor && selectable && !disabled;

              const isBest = showPlacement && bestTurn === turn.turn_number;

              const turnMarkers = markersByTurn.get(turn.turn_number) ?? [];

              return (
                <div key={turn.id}>
                  <TurnCard
                    turn={turn}
                    speakerIndex={speakerIndex}
                    onClick={handleTurnClick}
                    isInWindow={isInWindow}
                    isBestTurn={isBest}
                    isWindowStart={showPlacement && startTurn === turn.turn_number && endTurn !== null}
                    isWindowEnd={showPlacement && endTurn === turn.turn_number}
                    isStartOnly={isStartOnly}
                    clickable={clickable}
                    dimmed={!!selectingFor && !selectable}
                    highlighted={turnMarkers.some((m) => m.itemId === highlightedItemId)}
                  />
                  {isBest && knowledgeItemText && (
                    <div className="my-1.5 ml-8 mr-4">
                      <div className="rounded-lg bg-violet-600 px-4 py-3 shadow-sm">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="shrink-0 rounded bg-violet-500 px-1.5 py-0.5 text-xs font-semibold text-white">
                            AI Agent
                          </span>
                          <span className="text-xs text-violet-200">Proposed Inserted Message</span>
                        </div>
                        <p className="text-sm leading-relaxed text-white whitespace-pre-wrap [&_a]:text-violet-200 [&_a]:underline hover:[&_a]:text-white">
                          {renderMarkdown(knowledgeItemText)}
                        </p>
                      </div>
                    </div>
                  )}
                  {turnMarkers.length > 0 && (
                    <div className="my-1 ml-8 mr-4 flex flex-wrap gap-1.5">
                      {turnMarkers.map((marker) => {
                        const isHighlighted = highlightedItemId === marker.itemId;
                        return (
                          <div
                            key={marker.itemId}
                            ref={(el) => {
                              if (el) markerRefs.current.set(marker.itemId, el);
                              else markerRefs.current.delete(marker.itemId);
                            }}
                            onMouseEnter={() => onMarkerHover?.(marker.itemId)}
                            onMouseLeave={() => onMarkerHover?.(null)}
                            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-all cursor-default ${
                              isHighlighted
                                ? "border-indigo-400 bg-indigo-50 shadow-sm ring-1 ring-indigo-300"
                                : marker.doNotSurface
                                ? "border-gray-200 bg-gray-50 opacity-60"
                                : "border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/50"
                            }`}
                          >
                            <span className={`flex h-4.5 w-4.5 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                              isHighlighted ? "bg-indigo-600" : marker.doNotSurface ? "bg-gray-400" : "bg-indigo-500"
                            }`}>
                              {marker.rank}
                            </span>
                            <span className={`max-w-[180px] truncate ${
                              isHighlighted ? "font-medium text-indigo-800" : marker.doNotSurface ? "text-gray-400" : "text-gray-600"
                            }`}>
                              {marker.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
