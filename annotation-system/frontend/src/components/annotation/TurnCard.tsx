import type { Turn } from "@/types";
import { getSpeakerColor } from "@/components/chat/ChatMessage";

interface TurnCardProps {
  turn: Turn;
  speakerIndex: number;
  onClick: (turnNumber: number) => void;
  isInWindow: boolean;
  isBestTurn: boolean;
  isWindowStart: boolean;
  isWindowEnd: boolean;
  isStartOnly: boolean;
  clickable?: boolean;
  dimmed?: boolean;
  highlighted?: boolean;
}

export default function TurnCard({
  turn,
  speakerIndex,
  onClick,
  isInWindow,
  isBestTurn,
  isWindowStart,
  isWindowEnd,
  isStartOnly,
  clickable = true,
  dimmed = false,
  highlighted = false,
}: TurnCardProps) {
  const color = getSpeakerColor(speakerIndex);

  let bgClass = "";
  if (highlighted) {
    bgClass = "bg-indigo-50 ring-1 ring-indigo-300";
  } else if (isInWindow) {
    bgClass = "bg-blue-50 ring-1 ring-blue-200";
  } else if (isStartOnly) {
    bgClass = "bg-green-50 ring-1 ring-green-400";
  }

  return (
    <div
      data-testid={`turn-card-${turn.turn_number}`}
      onClick={() => clickable && onClick(turn.turn_number)}
      className={`group relative rounded-md border border-transparent px-3 py-2 transition-colors ${bgClass} ${
        clickable
          ? "cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/50"
          : dimmed
            ? "opacity-40"
            : ""
      }`}
    >
      {isWindowStart && (
        <span className="absolute right-0 top-0 z-10 rounded-bl bg-green-500 px-1.5 py-0.5 text-[10px] font-bold text-white" title="Earliest point: the message could be inserted after this turn">
          EARLIEST
        </span>
      )}
      {isWindowEnd && (
        <span
          className="absolute top-0 z-10 rounded-bl bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white"
          style={{ right: isWindowStart ? '3rem' : '0' }}
          title="Latest point: the message would still be useful after this turn"
        >
          LATEST
        </span>
      )}
      {isBestTurn && (
        <span className="absolute bottom-0 right-0 z-10 rounded-tl bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white" title="Best point: the ideal moment to insert the message">
          BEST
        </span>
      )}

      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 font-mono text-xs text-gray-400">
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
  );
}
