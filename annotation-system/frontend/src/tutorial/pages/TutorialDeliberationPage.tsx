import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTutorial } from "../TutorialProvider";
import { deliberationSteps } from "../steps/deliberationSteps";
import { TUTORIAL_TRANSCRIPT, TUTORIAL_SPEAKERS } from "../fixtures/transcript";
import { ANNOTATION_PEER_ITEM, ANNOTATION_TARGETS, CONSTRUCTION_ITEM } from "../fixtures/knowledgeItems";
import {
  DELIBERATION_PEER_ANNOTATIONS,
  DELIBERATION_OWN_ANNOTATION,
} from "../fixtures/peerAnnotations";
import { getSpeakerColor } from "@/components/chat/ChatMessage";

const PEER_COLORS = [
  { fill: "rgba(249, 115, 22, 0.25)", dot: "#f97316", border: "#f97316" },
  { fill: "rgba(16, 185, 129, 0.25)", dot: "#10b981", border: "#10b981" },
];

const OWN_COLOR = { fill: "rgba(251, 191, 36, 0.25)", dot: "#f59e0b", border: "#f59e0b" };

const RANKING_PEER_COLORS = [
  { bg: "bg-blue-100", text: "text-blue-700", border: "border-blue-300" },
  { bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-300" },
];

type Phase = "annotation-review" | "ranking-review";

// Ranking review data
const RANKING_ITEMS = [
  {
    id: "item-weather",
    text: ANNOTATION_PEER_ITEM.ideal_response,
    bestTurn: ANNOTATION_TARGETS.bestTurn,
    doNotSurface: false,
  },
  {
    id: "item-trails",
    text: CONSTRUCTION_ITEM.ideal_response,
    bestTurn: 5,
    doNotSurface: false,
  },
  {
    id: "item-mopop",
    text: "The Museum of Pop Culture (MoPOP) has a really cool exhibit on indie game design right now — if any of you are into that kind of thing it's open through August and it's right next to the Space Needle.",
    bestTurn: 7,
    doNotSurface: false,
  },
  {
    id: "item-coffee",
    text: "I heard there's a new coffee shop opening downtown, but I'm not sure when exactly.",
    bestTurn: null,
    doNotSurface: true,
  },
];

const PEER_RANKINGS = [
  { label: "Sam", order: ["item-trails", "item-weather", "item-mopop", "item-coffee"] },
  { label: "Jordan", order: ["item-weather", "item-trails", "item-mopop", "item-coffee"] },
];

const ORIGINAL_ORDER = ["item-weather", "item-trails", "item-mopop", "item-coffee"];

export default function TutorialDeliberationPage() {
  const { setSteps, currentStep, completeTutorial } = useTutorial();
  const navigate = useNavigate();
  const [revisionSaved, setRevisionSaved] = useState(false);
  const [phase, setPhase] = useState<Phase>("annotation-review");
  const [rankingOrder, setRankingOrder] = useState<string[]>([...ORIGINAL_ORDER]);
  const [rankingSaved, setRankingSaved] = useState(false);

  useEffect(() => {
    setSteps(deliberationSteps);
  }, [setSteps]);

  // Sync phase with current step for HMR/reload
  useEffect(() => {
    if (currentStep?.id.startsWith("delib-ranking")) {
      setPhase("ranking-review");
    }
  }, [currentStep]);

  const handleSaveRevision = () => {
    setRevisionSaved(true);
    setPhase("ranking-review");
  };

  const handleComplete = () => {
    completeTutorial();
    navigate("/my-groups", { replace: true });
  };

  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    const newOrder = [...rankingOrder];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    setRankingOrder(newOrder);
  };

  const handleSaveRanking = () => {
    setRankingSaved(true);
  };

  const getOriginalRank = (itemId: string): number => {
    return ORIGINAL_ORDER.indexOf(itemId) + 1;
  };

  const getPeerRank = (peerIndex: number, itemId: string): number | null => {
    const idx = PEER_RANKINGS[peerIndex].order.indexOf(itemId);
    return idx >= 0 ? idx + 1 : null;
  };

  const speakerMap = new Map<string, number>();
  TUTORIAL_SPEAKERS.forEach((s, i) => speakerMap.set(s, i));

  // Ranking review phase
  if (phase === "ranking-review") {
    return (
      <div className="flex h-full flex-col">
        {/* Header */}
        <div data-tutorial="ranking-review-header" className="shrink-0 border-b border-gray-200 bg-white px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Ranking Review</h1>
              <p className="mt-0.5 text-sm text-gray-500">
                Compare your ranking with peers and revise if needed. Use arrows to reorder.
              </p>
            </div>
          </div>
          <div data-tutorial="ranking-review-legend" className="mt-3 flex flex-wrap items-center gap-3">
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
            {PEER_RANKINGS.map((peer, idx) => {
              const color = RANKING_PEER_COLORS[idx];
              return (
                <div key={peer.label} className="flex items-center gap-1.5">
                  <div className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold ${color.bg} ${color.text} ${color.border}`}>
                    #
                  </div>
                  <span className="text-xs text-gray-600">{peer.label}</span>
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

            {/* Ranking cards */}
            <div className="space-y-2">
              {rankingOrder.filter(id => !RANKING_ITEMS.find(i => i.id === id)?.doNotSurface).map((itemId, index) => {
                const item = RANKING_ITEMS.find(i => i.id === itemId)!;
                const originalRank = getOriginalRank(itemId);
                return (
                  <div
                    key={itemId}
                    className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm hover:shadow-md"
                  >
                    <div className="flex items-start gap-3">
                      {/* Drag handle (visual only) */}
                      <button
                        className="mt-0.5 shrink-0 text-gray-400"
                        tabIndex={-1}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
                          <path fillRule="evenodd" d="M2 3.75A.75.75 0 0 1 2.75 3h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 3.75ZM2 8a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 8Zm0 4.25a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
                        </svg>
                      </button>

                      {/* Reorder arrows */}
                      <div className="flex flex-col gap-0.5">
                        <button
                          data-tutorial={index === 1 ? "ranking-review-move-up" : undefined}
                          onClick={() => handleMoveUp(index)}
                          disabled={index === 0}
                          className={`rounded p-0.5 transition-colors ${
                            index === 0
                              ? "text-gray-200 cursor-not-allowed"
                              : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                          }`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                            <path fillRule="evenodd" d="M8 14a.75.75 0 0 1-.75-.75V4.56L4.03 7.78a.75.75 0 0 1-1.06-1.06l4.5-4.5a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1-1.06 1.06L8.75 4.56v8.69A.75.75 0 0 1 8 14Z" clipRule="evenodd" />
                          </svg>
                        </button>
                        <button
                          disabled={index === rankingOrder.filter(id => !RANKING_ITEMS.find(i => i.id === id)?.doNotSurface).length - 1}
                          className={`rounded p-0.5 transition-colors ${
                            index === rankingOrder.filter(id => !RANKING_ITEMS.find(i => i.id === id)?.doNotSurface).length - 1
                              ? "text-gray-200 cursor-not-allowed"
                              : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                          }`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                            <path fillRule="evenodd" d="M8 2a.75.75 0 0 1 .75.75v8.69l3.22-3.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.22 3.22V2.75A.75.75 0 0 1 8 2Z" clipRule="evenodd" />
                          </svg>
                        </button>
                      </div>

                      {/* Current rank badge */}
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
                        {index + 1}
                      </div>

                      {/* Item text */}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-relaxed text-gray-700 line-clamp-2">{item.text}</p>
                        {item.bestTurn && (
                          <p className="mt-1 text-xs text-gray-400">Would appear after turn #{item.bestTurn}</p>
                        )}
                      </div>

                      {/* Rank comparison badges */}
                      <div className="flex shrink-0 items-center gap-1">
                        <div
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-600 text-[10px] font-bold text-white"
                          title={`Your original: rank ${originalRank}`}
                        >
                          {originalRank}
                        </div>
                        {PEER_RANKINGS.map((peer, peerIdx) => {
                          const color = RANKING_PEER_COLORS[peerIdx];
                          const peerRank = getPeerRank(peerIdx, itemId);
                          return (
                            <div
                              key={peer.label}
                              className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-bold ${color.bg} ${color.text} ${color.border}`}
                              title={`${peer.label}: rank ${peerRank ?? "—"}`}
                            >
                              {peerRank ?? "—"}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Direction indicator */}
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                <path fillRule="evenodd" d="M8 2a.75.75 0 0 1 .75.75v8.69l3.22-3.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.22 3.22V2.75A.75.75 0 0 1 8 2Z" clipRule="evenodd" />
              </svg>
              Least valuable
            </div>

            {/* Should not appear section */}
            <div className="border-t border-gray-200 pt-4">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
                Should not appear
              </div>
              {rankingOrder.filter(id => RANKING_ITEMS.find(i => i.id === id)?.doNotSurface).map((itemId) => {
                const item = RANKING_ITEMS.find(i => i.id === itemId)!;
                return (
                  <div key={itemId} className="rounded-lg border border-dashed border-gray-300 bg-gray-100 px-4 py-3 opacity-60">
                    <div className="flex items-start gap-3">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-400 text-xs font-bold text-white">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                          <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-relaxed text-gray-500 line-clamp-2">{item.text}</p>
                        <span className="mt-1 inline-block rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                          should not appear
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {PEER_RANKINGS.map((peer, peerIdx) => {
                          const color = RANKING_PEER_COLORS[peerIdx];
                          const peerRank = getPeerRank(peerIdx, itemId);
                          return (
                            <div
                              key={peer.label}
                              className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-bold ${color.bg} ${color.text} ${color.border}`}
                              title={`${peer.label}: rank ${peerRank ?? "—"}`}
                            >
                              {peerRank ?? "—"}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-gray-200 bg-white px-6 py-4">
          <div className="mx-auto flex max-w-3xl items-center justify-end gap-3">
            {rankingSaved && <span className="text-xs font-medium text-green-600">Saved!</span>}
            <button
              data-tutorial="ranking-review-save-btn"
              onClick={handleSaveRanking}
              className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
            >
              Save ranking & complete review
            </button>
          </div>
        </div>

        {/* Tutorial complete */}
        {rankingSaved && (
          <div className="absolute inset-x-0 bottom-20 mx-auto max-w-sm rounded-lg border border-green-200 bg-green-50 p-4 text-center shadow-lg">
            <p className="text-sm font-medium text-green-800 mb-2">
              Tutorial complete!
            </p>
            <p className="text-xs text-green-700 mb-3">
              You've practiced the full PITCH workflow. You're ready for the real study.
            </p>
            <button
              data-tutorial="tutorial-complete-btn"
              onClick={handleComplete}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              Finish Tutorial
            </button>
          </div>
        )}
      </div>
    );
  }

  // Annotation review phase (original layout)
  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div data-tutorial="delib-top-bar" className="shrink-0 border-b border-gray-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-4">
          <button className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path fillRule="evenodd" d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
            </svg>
            List
          </button>

          <button
            disabled
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path fillRule="evenodd" d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
            </svg>
            Prev
          </button>

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center justify-between text-xs text-gray-600">
              <span>Item 1 of 3</span>
              <span>0% complete</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
              <div className="h-full rounded-full bg-indigo-500 transition-all duration-300" style={{ width: "0%" }} />
            </div>
          </div>

          <button className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50">
            Next
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main split layout */}
      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Left: Transcript with peer overlays */}
        <div className="flex h-1/2 flex-col border-b border-gray-200 lg:h-full lg:w-[55%] lg:border-b-0 lg:border-r">
          <div className="shrink-0 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-800">Transcript</h2>
            <span className="text-xs text-gray-400">{TUTORIAL_TRANSCRIPT.length} turns</span>
          </div>

          {/* Legend */}
          <div className="shrink-0 border-b border-gray-200 bg-gray-50 px-4 py-2" data-tutorial="peer-overlays">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="font-medium text-gray-600">Annotations:</span>
              {/* Own annotation */}
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-flex h-4 w-3 items-center justify-center rounded-sm"
                  style={{ backgroundColor: OWN_COLOR.fill, borderLeft: `3px solid ${OWN_COLOR.border}` }}
                >
                  <span className="text-[7px] font-bold" style={{ color: OWN_COLOR.dot }}>Y</span>
                </span>
                <span className="text-gray-700">= Your original</span>
              </span>
              {/* Peer annotations */}
              {DELIBERATION_PEER_ANNOTATIONS.map((peer, idx) => {
                const color = PEER_COLORS[idx];
                const initial = peer.annotator.charAt(0);
                return (
                  <span key={peer.annotator} className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-flex h-4 w-3 items-center justify-center rounded-sm"
                      style={{ backgroundColor: color.fill, borderLeft: `3px solid ${color.border}` }}
                    >
                      <span className="text-[7px] font-bold" style={{ color: color.dot }}>{initial}</span>
                    </span>
                    <span className="text-gray-700">= {peer.annotator}</span>
                  </span>
                );
              })}
            </div>
          </div>

          {/* Transcript with overlay stripes */}
          <div className="flex-1 overflow-y-auto p-3">
            <div className="space-y-1.5">
              {TUTORIAL_TRANSCRIPT.map((turn) => {
                const speakerIndex = speakerMap.get(turn.speaker) ?? 0;
                const color = getSpeakerColor(speakerIndex);
                const tn = turn.turn_number;

                const ownInRange = tn >= DELIBERATION_OWN_ANNOTATION.window_start && tn <= DELIBERATION_OWN_ANNOTATION.window_end;
                const ownIsBest = tn === DELIBERATION_OWN_ANNOTATION.best_turn;

                const peerStripes = DELIBERATION_PEER_ANNOTATIONS.map((peer, idx) => ({
                  inRange: tn >= peer.window_start && tn <= peer.window_end,
                  isBest: tn === peer.best_turn,
                  isStart: tn === peer.window_start,
                  color: PEER_COLORS[idx],
                  initial: peer.annotator.charAt(0),
                }));

                return (
                  <div key={turn.id} className="relative rounded-md border border-transparent px-3 py-2">
                    {/* Peer overlay stripes on left */}
                    <div className="absolute left-0 top-0 bottom-0 flex">
                      {/* Own annotation stripe */}
                      {ownInRange && (
                        <div
                          className="w-5 flex items-start justify-center pt-1 relative"
                          style={{ backgroundColor: OWN_COLOR.fill, borderLeft: `3px solid ${OWN_COLOR.border}` }}
                        >
                          {tn === DELIBERATION_OWN_ANNOTATION.window_start && (
                            <span className="text-[7px] font-bold" style={{ color: OWN_COLOR.dot }}>Y</span>
                          )}
                          {ownIsBest && (
                            <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px]" style={{ color: OWN_COLOR.dot }}>★</span>
                          )}
                        </div>
                      )}
                      {!ownInRange && <div className="w-5" />}

                      {/* Peer stripes */}
                      {peerStripes.map((ps, idx) => (
                        <div
                          key={idx}
                          className="w-5 flex items-start justify-center pt-1 relative"
                          style={ps.inRange ? { backgroundColor: ps.color.fill, borderLeft: `3px solid ${ps.color.border}` } : undefined}
                        >
                          {ps.inRange && ps.isStart && (
                            <span className="text-[7px] font-bold" style={{ color: ps.color.dot }}>{ps.initial}</span>
                          )}
                          {ps.inRange && ps.isBest && (
                            <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px]" style={{ color: ps.color.dot }}>★</span>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Turn content */}
                    <div className="pl-25">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 shrink-0 text-xs font-mono text-gray-400">#{tn}</span>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${color.bg} ${color.text}`}>{turn.speaker}</span>
                        <p className="flex-1 text-sm leading-relaxed text-gray-700">{turn.content}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Resize handle (visual only) */}
        <div className="hidden w-1.5 shrink-0 items-center justify-center bg-gray-100 lg:flex">
          <div className="flex flex-col gap-0.5">
            <span className="h-1 w-1 rounded-full bg-gray-400" />
            <span className="h-1 w-1 rounded-full bg-gray-400" />
            <span className="h-1 w-1 rounded-full bg-gray-400" />
          </div>
        </div>

        {/* Right: Review & Revise sidebar */}
        <div className="flex h-1/2 flex-col lg:h-full lg:flex-1">
          <div className="shrink-0 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-800">Review & Revise</h2>
            <span className="text-xs text-gray-400">Alex</span>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex flex-col gap-5">
              {/* Proposed Inserted Message */}
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Proposed Inserted Message
                </p>
                <p className="text-sm leading-relaxed text-gray-700">
                  {ANNOTATION_PEER_ITEM.ideal_response}
                </p>
                <p className="mt-2 text-xs italic text-gray-400">
                  You may imagine small wording changes when deciding where this message should appear.
                </p>
              </div>

              {/* Annotations panel */}
              <div className="rounded-lg border border-gray-200 bg-white p-4" data-tutorial="peer-cards-panel">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Annotations
                </p>

                <div className="space-y-3">
                  {/* Own original annotation */}
                  <div
                    className="rounded-lg bg-amber-50/30 p-3 shadow-sm"
                    style={{ borderLeft: `4px solid ${OWN_COLOR.border}` }}
                    data-tutorial="own-annotation-card"
                  >
                    <div className="flex items-center gap-2.5 mb-2">
                      <span
                        className="inline-flex h-5 w-3.5 shrink-0 items-start justify-center rounded-sm pt-0.5"
                        style={{ backgroundColor: OWN_COLOR.fill, borderLeft: `3px solid ${OWN_COLOR.border}` }}
                      >
                        <span className="text-[8px] font-bold leading-none" style={{ color: OWN_COLOR.dot }}>Y</span>
                      </span>
                      <span className="text-sm font-semibold text-gray-800">Your Original Annotation</span>
                      <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                        Locked Original
                      </span>
                    </div>
                    <div className="ml-6 space-y-1.5 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-600">Window:</span>
                        <span className="font-mono text-gray-800">#{DELIBERATION_OWN_ANNOTATION.window_start} - #{DELIBERATION_OWN_ANNOTATION.window_end}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-600">Best turn:</span>
                        <span className="font-mono text-gray-800">#{DELIBERATION_OWN_ANNOTATION.best_turn}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-600">Importance:</span>
                        <span className="text-gray-800">Very important</span>
                      </div>
                      <div className="mt-2 pt-2 border-t border-gray-100">
                        <div className="text-xs font-medium text-gray-600 mb-1.5">Rationale:</div>
                        <div className="rounded bg-gray-50 px-2.5 py-2 text-xs text-gray-700 leading-relaxed">
                          <p className="italic text-gray-400">(No rationale provided)</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Peer annotation cards */}
                  {DELIBERATION_PEER_ANNOTATIONS.map((peer, idx) => {
                    const peerColor = PEER_COLORS[idx];
                    const initial = peer.annotator.charAt(0);
                    return (
                      <div
                        key={peer.annotator}
                        className="rounded-lg bg-white p-3 shadow-sm"
                        style={{ borderLeft: `4px solid ${peerColor.border}` }}
                      >
                        <div className="flex items-center gap-2.5 mb-2">
                          <span
                            className="inline-flex h-5 w-3.5 shrink-0 items-start justify-center rounded-sm pt-0.5"
                            style={{ backgroundColor: peerColor.fill, borderLeft: `3px solid ${peerColor.border}` }}
                          >
                            <span className="text-[8px] font-bold leading-none" style={{ color: peerColor.dot }}>{initial}</span>
                          </span>
                          <span className="text-sm font-semibold text-gray-800">Annotator {initial}</span>
                        </div>
                        <div className="ml-6 space-y-1.5 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-600">Window:</span>
                            <span className="font-mono text-gray-800">#{peer.window_start} - #{peer.window_end}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-600">Best turn:</span>
                            <span className="font-mono text-gray-800">#{peer.best_turn}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-600">Importance:</span>
                            <span className="text-gray-800">{peer.pertinence === 0.75 ? "Very important" : "Important"}</span>
                          </div>
                          <div className="mt-2 pt-2 border-t border-gray-100">
                            <div className="text-xs font-medium text-gray-600 mb-1.5">Rationale:</div>
                            <div className="rounded bg-gray-50 px-2.5 py-2 text-xs text-gray-700 leading-relaxed">
                              <p className="whitespace-pre-wrap">{peer.rationale}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Your Annotation (editable) */}
              <div className="rounded-lg border-2 border-indigo-200 bg-white p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-indigo-600">
                  Your Annotation
                </p>

                {/* Placement window controls */}
                <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                  <p className="mb-2 text-sm font-medium text-gray-700">
                    Choose the turns after which this message could appear
                  </p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
                      <span className="text-sm font-medium text-gray-700 whitespace-nowrap">First relevant:</span>
                      <span className="font-mono text-sm font-semibold text-gray-800 w-8">#{ANNOTATION_TARGETS.windowStart}</span>
                      <span className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600">Change</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
                      <span className="text-sm font-medium text-gray-700 whitespace-nowrap">Last useful:</span>
                      <span className="font-mono text-sm font-semibold text-gray-800 w-8">#{ANNOTATION_TARGETS.windowEnd}</span>
                      <span className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600">Change</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                      <span className="text-sm font-medium text-gray-700 whitespace-nowrap">Best placement:</span>
                      <span className="font-mono text-sm font-semibold text-gray-800 w-8">#{ANNOTATION_TARGETS.bestTurn}</span>
                      <span className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600">Change</span>
                    </div>
                  </div>
                </div>

                {/* Pertinence */}
                <div className="mt-3">
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    How important would this message be for the conversation?
                  </label>
                  <div className="space-y-1.5">
                    <label className="flex items-start gap-2.5 rounded-md border border-gray-200 bg-white px-3 py-2 cursor-pointer">
                      <input type="radio" name="delib_pertinence" className="mt-0.5 h-4 w-4 text-indigo-600 border-gray-300" readOnly />
                      <span className="text-sm text-gray-700"><span className="font-semibold">Important</span> — meaningfully improves the conversation or fills a clear gap</span>
                    </label>
                    <label className="flex items-start gap-2.5 rounded-md border border-indigo-400 bg-indigo-50 px-3 py-2 cursor-pointer">
                      <input type="radio" name="delib_pertinence" checked readOnly className="mt-0.5 h-4 w-4 text-indigo-600 border-gray-300" />
                      <span className="text-sm text-gray-700"><span className="font-semibold">Very important</span> — could shift how the group thinks, decides, or continues</span>
                    </label>
                    <label className="flex items-start gap-2.5 rounded-md border border-gray-200 bg-white px-3 py-2 cursor-pointer">
                      <input type="radio" name="delib_pertinence" className="mt-0.5 h-4 w-4 text-indigo-600 border-gray-300" readOnly />
                      <span className="text-sm text-gray-700"><span className="font-semibold">Essential</span> — could prevent a major misunderstanding or change the direction</span>
                    </label>
                  </div>
                </div>

                {/* Rationale */}
                <div className="mt-3">
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Rationale (optional)
                  </label>
                  <textarea
                    readOnly
                    rows={3}
                    placeholder="Explain your reasoning, especially if you changed your annotation after seeing what your peers put..."
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>

                {/* Save button */}
                {revisionSaved && (
                  <p className="mt-2 text-xs text-green-600">Revision saved successfully.</p>
                )}
                <button
                  data-tutorial="save-revision-btn"
                  onClick={handleSaveRevision}
                  className="mt-3 w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save Revision
                </button>
              </div>

              {/* Changes from Original */}
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Changes from Original
                </p>
                <p className="text-sm text-gray-400">No changes yet.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
