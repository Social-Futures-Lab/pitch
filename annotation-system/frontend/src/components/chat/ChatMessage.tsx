import { useRef, useState } from "react";
import type { Turn } from "@/types";

const SPEAKER_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-purple-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-fuchsia-500",
];

const BUBBLE_COLORS = [
  "bg-blue-50",
  "bg-emerald-50",
  "bg-purple-50",
  "bg-amber-50",
  "bg-rose-50",
  "bg-cyan-50",
  "bg-orange-50",
  "bg-fuchsia-50",
];

const NAME_COLORS = [
  "text-blue-600",
  "text-emerald-600",
  "text-purple-600",
  "text-amber-600",
  "text-rose-600",
  "text-cyan-600",
  "text-orange-600",
  "text-fuchsia-600",
];

export function getSpeakerColor(speakerIndex: number) {
  const i = speakerIndex % SPEAKER_COLORS.length;
  return {
    bg: BUBBLE_COLORS[i],
    bubble: BUBBLE_COLORS[i],
    dot: SPEAKER_COLORS[i],
    text: NAME_COLORS[i],
    name: NAME_COLORS[i],
    ring: SPEAKER_COLORS[i].replace("bg-", "ring-"),
  };
}

interface ChatMessageProps {
  turn: Turn;
  speakerIndex: number;
  isCurrentUser: boolean;
  onToggleFlag?: (turnId: string, flagged: boolean) => void;
}

export default function ChatMessage({
  turn,
  speakerIndex,
  isCurrentUser,
  onToggleFlag,
}: ChatMessageProps) {
  const color = getSpeakerColor(speakerIndex);
  const formattedTime = new Date(turn.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div
      data-testid={`chat-message-${turn.turn_number}`}
      className={`group/msg flex ${isCurrentUser ? "justify-end" : "justify-start"} mb-2`}
    >
      <div className={`flex max-w-[75%] items-start gap-2 ${isCurrentUser ? "flex-row-reverse" : ""}`}>
        <div className={`mt-0.5 h-6 w-6 shrink-0 rounded-full ${color.dot} flex items-center justify-center`}>
          <span className="text-[10px] font-semibold text-white">
            {turn.speaker_name.charAt(0).toUpperCase()}
          </span>
        </div>
        <div>
          <div className={`flex items-baseline gap-1.5 ${isCurrentUser ? "justify-end" : ""} mb-0.5`}>
            <span className={`text-xs font-medium ${color.name}`}>
              {turn.speaker_name}
            </span>
            <span className="text-[10px] text-gray-400">{formattedTime}</span>
          </div>
          <div className="flex items-end gap-1">
            {isCurrentUser && onToggleFlag && (
              <BookmarkButton
                flagged={!!turn.flagged}
                side="right"
                onClick={() => onToggleFlag(turn.id, !turn.flagged)}
              />
            )}
            <div
              className={`rounded-2xl px-3 py-1.5 ${
                isCurrentUser ? "bg-indigo-600 text-white" : color.bubble
              }`}
            >
              <p className={`whitespace-pre-wrap text-sm leading-snug ${isCurrentUser ? "text-white" : "text-gray-800"}`}>
                {turn.text}
              </p>
            </div>
            {!isCurrentUser && onToggleFlag && (
              <BookmarkButton
                flagged={!!turn.flagged}
                side="left"
                onClick={() => onToggleFlag(turn.id, !turn.flagged)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BookmarkButton({
  flagged,
  side,
  onClick,
}: {
  flagged: boolean;
  side: "left" | "right";
  onClick: () => void;
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [flipBelow, setFlipBelow] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const label = flagged
    ? "Remove bookmark"
    : "Mark this turn if outside knowledge could be helpful here";

  const tooltipPosition =
    side === "left"
      ? "left-0"
      : "right-0";
  const arrowPosition =
    side === "left"
      ? "left-2"
      : "right-2";

  function handleMouseEnter() {
    if (containerRef.current) {
      const scrollParent = containerRef.current.closest("[class*='overflow-y']");
      if (scrollParent) {
        const btnRect = containerRef.current.getBoundingClientRect();
        const parentRect = scrollParent.getBoundingClientRect();
        // If less than 60px between the button top and the scroll container top, flip below
        setFlipBelow(btnRect.top - parentRect.top < 60);
      }
    }
    setShowTooltip(true);
  }

  return (
    <div
      ref={containerRef}
      className="relative flex shrink-0 self-stretch"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <button
        type="button"
        onClick={onClick}
        className={`flex w-5 items-center justify-center self-stretch rounded transition-all ${
          flagged
            ? "text-amber-500 opacity-100"
            : "text-gray-300 opacity-0 group-hover/msg:opacity-100 hover:text-amber-400"
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-5 w-5"
        >
          {flagged ? (
            <path
              fillRule="evenodd"
              d="M10 2c-1.716 0-3.408.106-5.07.31C3.806 2.45 3 3.414 3 4.517v11.907a.75.75 0 001.159.63L10 13.177l5.841 3.876A.75.75 0 0017 16.423V4.517c0-1.103-.806-2.068-1.93-2.207A41.403 41.403 0 0010 2z"
              clipRule="evenodd"
            />
          ) : (
            <path d="M10 2c-1.716 0-3.408.106-5.07.31C3.806 2.45 3 3.414 3 4.517v11.907a.75.75 0 001.159.63L10 13.177l5.841 3.876A.75.75 0 0017 16.423V4.517c0-1.103-.806-2.068-1.93-2.207A41.403 41.403 0 0010 2zm0 1.5c1.619 0 3.214.1 4.78.292.468.058.72.39.72.725v10.463l-5.091-3.378a.75.75 0 00-.818 0L4.5 14.98V4.517c0-.336.252-.667.72-.725A39.898 39.898 0 0110 3.5z" />
          )}
        </svg>
      </button>
      {showTooltip && (
        flipBelow ? (
          <div className={`pointer-events-none absolute top-full ${tooltipPosition} z-30 mt-1.5 w-48 rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-medium leading-snug text-white shadow-lg`}>
            <div className={`absolute ${arrowPosition} bottom-full border-4 border-transparent border-b-gray-900`} />
            {label}
          </div>
        ) : (
          <div className={`pointer-events-none absolute bottom-full ${tooltipPosition} z-30 mb-1.5 w-48 rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-medium leading-snug text-white shadow-lg`}>
            {label}
            <div className={`absolute ${arrowPosition} top-full border-4 border-transparent border-t-gray-900`} />
          </div>
        )
      )}
    </div>
  );
}
