import { useState, useEffect, useRef } from "react";
import type { Turn } from "@/types";
import { getSpeakerColor } from "@/components/chat/ChatMessage";

export interface PlacementWindow {
  startTurn: number | null;
  endTurn: number | null;
  bestTurn: number | null;
}

export type SelectingFor = "start" | "end" | "best" | null;

interface TranscriptReviewProps {
  turns: Turn[];
  speakerMap: Map<string, number>;
  window: PlacementWindow;
  selectingFor?: SelectingFor;
  onTurnSelected?: (turnNumber: number) => void;
  highlightedItems: Array<{
    id: string;
    startTurn: number;
    endTurn: number;
    bestTurn: number;
    colorIndex: number;
  }>;
  scrollToTurn?: number | null;
  onScrollComplete?: () => void;
}

const ITEM_HIGHLIGHT_COLORS = [
  { bg: "bg-blue-50", ring: "ring-blue-300" },
  { bg: "bg-emerald-50", ring: "ring-emerald-300" },
  { bg: "bg-purple-50", ring: "ring-purple-300" },
  { bg: "bg-amber-50", ring: "ring-amber-300" },
  { bg: "bg-rose-50", ring: "ring-rose-300" },
];

export default function TranscriptReview({
  turns,
  speakerMap,
  window: placementWindow,
  selectingFor = null,
  onTurnSelected,
  highlightedItems,
  scrollToTurn = null,
  onScrollComplete,
}: TranscriptReviewProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const turnRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const onScrollCompleteRef = useRef(onScrollComplete);
  onScrollCompleteRef.current = onScrollComplete;

  useEffect(() => {
    if (scrollToTurn === null) return;
    const el = turnRefs.current.get(scrollToTurn);
    const container = scrollContainerRef.current;
    if (!el || !container) return;

    const scrollOffset =
      el.offsetTop - container.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
    container.scrollTo({ top: scrollOffset, behavior: "smooth" });
    onScrollCompleteRef.current?.();
  }, [scrollToTurn]);

  const handleTurnClick = (turnNumber: number) => {
    if (!selectingFor || !onTurnSelected) return;
    onTurnSelected(turnNumber);
  };

  const getTurnClasses = (turnNumber: number) => {
    const classes: string[] = [];

    if (
      placementWindow.startTurn !== null &&
      placementWindow.endTurn !== null &&
      turnNumber >= placementWindow.startTurn &&
      turnNumber <= placementWindow.endTurn
    ) {
      classes.push("bg-indigo-50 ring-1 ring-indigo-300");
    } else if (
      placementWindow.startTurn !== null &&
      placementWindow.endTurn === null &&
      turnNumber === placementWindow.startTurn
    ) {
      classes.push("bg-green-50 ring-1 ring-green-400");
    }

    for (const item of highlightedItems) {
      if (turnNumber >= item.startTurn && turnNumber <= item.endTurn) {
        const color =
          ITEM_HIGHLIGHT_COLORS[item.colorIndex % ITEM_HIGHLIGHT_COLORS.length];
        classes.push(`${color.bg} ${color.ring} ring-1`);
      }
    }

    return classes.join(" ");
  };

  const isSelectable = (turnNumber: number): boolean => {
    if (!selectingFor) return false;
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
    if (!selectingFor) return null;
    switch (selectingFor) {
      case "start":
        return "Click a turn to set as the EARLIEST point — the message could be inserted after this turn";
      case "end":
        return "Click a turn at or after the earliest to set as the LATEST point — the message would still help here";
      case "best":
        return "Click a turn within the range to set as the BEST point — the ideal moment to insert the message";
    }
  };

  const hint = getHintText();

  return (
    <div className="flex h-full flex-col">
      {hint && (
        <div className="shrink-0 border-b border-indigo-200 bg-indigo-50 px-4 py-2">
          <p className="text-xs font-medium text-indigo-700">{hint}</p>
        </div>
      )}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-3">
        <div className="space-y-1.5">
          {turns.map((turn) => {
            const speakerIndex = speakerMap.get(turn.speaker_id) ?? 0;
            const color = getSpeakerColor(speakerIndex);
            const isStart = placementWindow.startTurn === turn.turn_number;
            const isEnd = placementWindow.endTurn === turn.turn_number;
            const isBest = placementWindow.bestTurn === turn.turn_number;
            const selectable = isSelectable(turn.turn_number);
            const clickable = selectingFor && selectable;

            return (
              <div
                key={turn.id}
                ref={(el) => {
                  if (el) turnRefs.current.set(turn.turn_number, el);
                }}
                onClick={() => clickable && handleTurnClick(turn.turn_number)}
                className={`group relative rounded-md border border-transparent px-3 py-2 transition-colors ${getTurnClasses(turn.turn_number)} ${
                  clickable
                    ? "cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/50"
                    : selectingFor
                      ? "opacity-40"
                      : ""
                }`}
              >
                {turn.flagged && (
                  <BookmarkIndicator />
                )}

                {isStart && (
                  <span className="absolute right-0 top-0 z-10 rounded-bl bg-green-500 px-1.5 py-0.5 text-[10px] font-bold text-white" title="Earliest point: the message could be inserted after this turn">
                    EARLIEST
                  </span>
                )}
                {isEnd && (
                  <span
                    className="absolute top-0 z-10 rounded-bl bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white"
                    style={{ right: isStart ? '3rem' : '0' }}
                    title="Latest point: the message would still be useful after this turn"
                  >
                    LATEST
                  </span>
                )}
                {isBest && (
                  <span className="absolute bottom-0 right-0 z-10 rounded-tl bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white" title="Best point: the ideal moment to insert the message">
                    BEST
                  </span>
                )}

                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 text-xs font-mono text-gray-400">
                    #{turn.turn_number}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${color.bg} ${color.text}`}
                  >
                    {turn.speaker_name}
                  </span>
                  <p className="flex-1 text-sm leading-relaxed text-gray-700">
                    {turn.text}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BookmarkIndicator() {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div
      className="absolute -left-1.5 top-1/2 -translate-y-1/2 flex items-center justify-center"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-4 w-4 text-amber-500"
      >
        <path
          fillRule="evenodd"
          d="M10 2c-1.716 0-3.408.106-5.07.31C3.806 2.45 3 3.414 3 4.517v11.907a.75.75 0 001.159.63L10 13.177l5.841 3.876A.75.75 0 0017 16.423V4.517c0-1.103-.806-2.068-1.93-2.207A41.403 41.403 0 0010 2z"
          clipRule="evenodd"
        />
      </svg>
      {showTooltip && (
        <div className="pointer-events-none absolute left-full top-1/2 z-30 ml-1.5 -translate-y-1/2 w-48 rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-medium leading-snug text-white shadow-lg">
          Bookmarked during conversation as a turn worth annotating for external knowledge
          <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900" />
        </div>
      )}
    </div>
  );
}
