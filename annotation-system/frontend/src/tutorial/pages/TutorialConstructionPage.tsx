import { useEffect, useState } from "react";
import { useTutorial } from "../TutorialProvider";
import { constructionSteps } from "../steps/constructionSteps";
import { TUTORIAL_TRANSCRIPT, TUTORIAL_SPEAKERS } from "../fixtures/transcript";
import {
  CONSTRUCTION_TARGETS,
  CONSTRUCTION_ITEM,
  TUTORIAL_SOURCE_SEARCH,
  TUTORIAL_MANUAL_SOURCE,
} from "../fixtures/knowledgeItems";
import { getSpeakerColor } from "@/components/chat/ChatMessage";

type SelectingFor = "start" | "end" | "best" | null;
type SearchMode = "ai" | "scholar" | "web" | "manual";

const TUTORIAL_DIRECTIONS = [
  { tag: "Share: specific trail recommendations near Seattle", category: "heads_up" },
  { tag: "Clarify: Seattle's actual weather patterns in summer vs winter", category: "heads_up" },
  { tag: "Challenge: the assumption that downtown is a good base", category: "pushback" },
  { tag: "Support: the suggestion to take the Bainbridge Island ferry", category: "support" },
  { tag: "Suggest: booking popular restaurants in advance", category: "suggestion" },
  { tag: "Recommend: a neighborhood-by-neighborhood itinerary", category: "suggestion" },
];

const NEXT_SUGGESTIONS = [
  {
    direction: "Clarify: Seattle's actual rainfall compared to other cities",
    bestTurn: 5,
    detail: "Jordan claims the rain is a myth — providing actual precipitation data would ground the discussion.",
  },
  {
    direction: "Recommend: specific restaurants to book in advance",
    bestTurn: 9,
    detail: "Sam asks about reservations — sharing specific popular spots with long wait times would help planning.",
  },
  {
    direction: "Share: Bainbridge Island ferry schedule and tips",
    bestTurn: 6,
    detail: "Sam mentions the ferry — adding schedule details and what to do on the island would be practical.",
  },
];

const DIRECTION_CATEGORY_STYLES: Record<string, { selected: string; hover: string }> = {
  heads_up: {
    selected: "bg-blue-50 border-blue-300 text-blue-700 ring-2 ring-indigo-300 ring-offset-1",
    hover: "border-gray-200 bg-white text-gray-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700",
  },
  pushback: {
    selected: "bg-amber-50 border-amber-300 text-amber-700 ring-2 ring-indigo-300 ring-offset-1",
    hover: "border-gray-200 bg-white text-gray-700 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700",
  },
  support: {
    selected: "bg-teal-50 border-teal-300 text-teal-700 ring-2 ring-indigo-300 ring-offset-1",
    hover: "border-gray-200 bg-white text-gray-700 hover:bg-teal-50 hover:border-teal-300 hover:text-teal-700",
  },
  suggestion: {
    selected: "bg-emerald-50 border-emerald-300 text-emerald-700 ring-2 ring-indigo-300 ring-offset-1",
    hover: "border-gray-200 bg-white text-gray-700 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700",
  },
};

const PERTINENCE_LEVELS = [
  { value: 0.0, title: "Nice to have", description: "adds useful context, but the conversation would be fine without it" },
  { value: 0.25, title: "Somewhat important", description: "helps the conversation, but probably would not change its direction" },
  { value: 0.5, title: "Important", description: "meaningfully improves the conversation or fills a clear gap" },
  { value: 0.75, title: "Very important", description: "could shift how the group thinks, decides, or continues" },
  { value: 1.0, title: "Essential", description: "could prevent a major misunderstanding or change the direction of the conversation" },
];

export default function TutorialConstructionPage() {
  const { setSteps, currentStep, advanceStep } = useTutorial();

  const [selectingFor, setSelectingFor] = useState<SelectingFor>(null);
  const [windowStart, setWindowStart] = useState<number | null>(null);
  const [windowEnd, setWindowEnd] = useState<number | null>(null);
  const [bestTurn, setBestTurn] = useState<number | null>(null);
  const [intentionSelected, setIntentionSelected] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>("web");
  const [sourceSearchDone, setSourceSearchDone] = useState(false);
  const [sourceSelected, setSourceSelected] = useState(false);
  const [manualSourceAdded, setManualSourceAdded] = useState(false);
  const [pertinence, setPertinence] = useState<number | null>(null);
  const [messageMode, setMessageMode] = useState<"generate" | "manual">("generate");
  const [aiGenerated, setAiGenerated] = useState(false);
  const [aiAccepted, setAiAccepted] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reviewAdjusting, setReviewAdjusting] = useState<"best" | null>(null);
  const [reviewBestTurn, setReviewBestTurn] = useState<number | null>(null);

  useEffect(() => {
    setSteps(constructionSteps);
  }, [setSteps]);

  // Manage selectingFor state based on current tutorial step
  useEffect(() => {
    if (currentStep?.id === "const-start-turn") setSelectingFor("start");
    else if (currentStep?.id === "const-end-turn") setSelectingFor("end");
    else if (currentStep?.id === "const-best-turn") setSelectingFor("best");
    else setSelectingFor(null);
  }, [currentStep]);

  // Manage review adjusting state
  useEffect(() => {
    if (currentStep?.id === "const-adjust-best-turn") setReviewAdjusting("best");
    else setReviewAdjusting(null);
  }, [currentStep]);

  // Initialize reviewBestTurn when entering preview
  useEffect(() => {
    if (showPreview && reviewBestTurn === null && bestTurn !== null) {
      setReviewBestTurn(bestTurn);
    }
  }, [showPreview, reviewBestTurn, bestTurn]);

  const windowComplete = windowStart !== null && windowEnd !== null && bestTurn !== null;
  const sourcesAdded = sourceSelected && manualSourceAdded;
  const importanceSelected = pertinence !== null;

  const handleTurnClick = (turnNumber: number) => {
    if (!currentStep) return;

    if (currentStep.id === "const-start-turn" && turnNumber === CONSTRUCTION_TARGETS.windowStart) {
      setWindowStart(turnNumber);
    } else if (currentStep.id === "const-end-turn" && turnNumber === CONSTRUCTION_TARGETS.windowEnd) {
      setWindowEnd(turnNumber);
    } else if (currentStep.id === "const-best-turn" && turnNumber === CONSTRUCTION_TARGETS.bestTurn) {
      setBestTurn(turnNumber);
    }
  };

  // Build speakerMap like the real page
  const speakerMap = new Map<string, number>();
  TUTORIAL_SPEAKERS.forEach((s, i) => speakerMap.set(s, i));

  // Transcript turn highlighting (matches TranscriptReview logic)
  const getTurnClasses = (turnNumber: number) => {
    if (windowStart !== null && windowEnd !== null && turnNumber >= windowStart && turnNumber <= windowEnd) {
      return "bg-indigo-50 ring-1 ring-indigo-300";
    }
    if (windowStart !== null && windowEnd === null && turnNumber === windowStart) {
      return "bg-green-50 ring-1 ring-green-400";
    }
    return "";
  };

  const isSelectable = (turnNumber: number) => {
    if (!selectingFor) return false;
    if (selectingFor === "end") return windowStart !== null && turnNumber >= windowStart;
    if (selectingFor === "best") return windowStart !== null && windowEnd !== null && turnNumber >= windowStart && turnNumber <= windowEnd;
    return true;
  };

  const getHintText = () => {
    if (!selectingFor) return null;
    switch (selectingFor) {
      case "start": return "Click a turn to set as the EARLIEST point — the message could be inserted after this turn";
      case "end": return "Click a turn at or after the earliest to set as the LATEST point — the message would still help here";
      case "best": return "Click a turn within the range to set as the BEST point — the ideal moment to insert the message";
    }
  };

  const hint = getHintText();

  // Preview mode
  const effectiveBestTurn = reviewBestTurn ?? bestTurn;

  if (showPreview && !saved) {
    return (
      <div className="flex h-full flex-col">
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
            Your message is shown below, inserted into the conversation after turn #{effectiveBestTurn}.
            Check that it reads naturally at this point.
          </p>
        </div>

        {/* Transcript with inserted message */}
        <div className="flex-1 overflow-y-auto p-4" data-tutorial="review-transcript">
          <div className="mx-auto max-w-3xl space-y-1.5">
            {TUTORIAL_TRANSCRIPT.map((turn) => {
              const speakerIndex = speakerMap.get(turn.speaker) ?? 0;
              const color = getSpeakerColor(speakerIndex);
              const isStart = turn.turn_number === windowStart;
              const isEnd = turn.turn_number === windowEnd;
              const isBest = turn.turn_number === effectiveBestTurn;
              const inWindow = windowStart !== null && windowEnd !== null && turn.turn_number >= windowStart && turn.turn_number <= windowEnd;
              const isClickableForAdjust = reviewAdjusting === "best" && inWindow;

              return (
                <div key={turn.id}>
                  <div
                    data-tutorial={`review-turn-${turn.turn_number}`}
                    onClick={() => {
                      if (isClickableForAdjust && currentStep?.id === "const-adjust-best-turn" && turn.turn_number === 4) {
                        setReviewBestTurn(turn.turn_number);
                      }
                    }}
                    className={`group relative rounded-md border border-transparent px-3 py-2 transition-colors ${inWindow ? "bg-indigo-50 ring-1 ring-indigo-200" : ""} ${
                      isClickableForAdjust ? "cursor-pointer hover:border-amber-400 hover:bg-amber-50/50" : ""
                    }`}
                  >
                    {isStart && (
                      <span className="absolute right-0 top-0 z-10 rounded-bl bg-green-500 px-1.5 py-0.5 text-[10px] font-bold text-white">EARLIEST</span>
                    )}
                    {isEnd && (
                      <span className="absolute top-0 z-10 rounded-bl bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ right: isStart ? '3.5rem' : '0' }}>LATEST</span>
                    )}
                    {isBest && (
                      <span className="absolute bottom-0 right-0 z-10 rounded-tl bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">BEST</span>
                    )}

                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 text-xs font-mono text-gray-400">#{turn.turn_number}</span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${color.bg} ${color.text}`}>{turn.speaker}</span>
                      <p className="flex-1 text-sm leading-relaxed text-gray-700">{turn.content}</p>
                    </div>
                  </div>

                  {/* Insert knowledge item preview after the best turn */}
                  {isBest && (
                    <div className="my-2 ml-8 mr-4">
                      <div className="rounded-lg bg-violet-600 px-4 py-3 shadow-sm">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="shrink-0 rounded bg-violet-500 px-1.5 py-0.5 text-xs font-semibold text-white">AI Agent</span>
                          <span className="text-xs text-violet-200">Your Inserted Message</span>
                        </div>
                        <p className="text-sm leading-relaxed text-white whitespace-pre-wrap">
                          {CONSTRUCTION_ITEM.ideal_response}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Placement controls + action bar */}
        <div className="shrink-0 border-t-2 border-indigo-200 bg-indigo-50 px-4 py-3" data-tutorial="review-placement-controls">
          <div className="flex flex-col gap-1.5 mb-3">
            <div className="rounded-lg border-2 border-gray-200 bg-white px-3 py-1.5 flex items-center gap-3">
              <span className="shrink-0 h-2.5 w-2.5 rounded-full bg-green-500" />
              <span className="text-xs font-bold text-gray-800 uppercase tracking-wide w-14">Earliest</span>
              <span className="font-mono text-sm font-bold text-green-700 bg-green-100 rounded px-2 py-0.5">#{windowStart}</span>
              <span className="text-xs text-gray-500 flex-1">First turn where this message becomes relevant</span>
              <span className="shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold bg-gray-100 text-gray-600">Change</span>
            </div>
            <div className="rounded-lg border-2 border-gray-200 bg-white px-3 py-1.5 flex items-center gap-3">
              <span className="shrink-0 h-2.5 w-2.5 rounded-full bg-red-500" />
              <span className="text-xs font-bold text-gray-800 uppercase tracking-wide w-14">Latest</span>
              <span className="font-mono text-sm font-bold text-red-700 bg-red-100 rounded px-2 py-0.5">#{windowEnd}</span>
              <span className="text-xs text-gray-500 flex-1">Last turn where inserting would still help</span>
              <span className="shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold bg-gray-100 text-gray-600">Change</span>
            </div>
            <div className={`rounded-lg border-2 bg-white px-3 py-1.5 flex items-center gap-3 ${
              reviewAdjusting === "best" ? "border-amber-400" : "border-gray-200"
            }`}>
              <span className="shrink-0 h-2.5 w-2.5 rounded-full bg-amber-500" />
              <span className="text-xs font-bold text-gray-800 uppercase tracking-wide w-14">Best</span>
              <span className="font-mono text-sm font-bold text-amber-700 bg-amber-100 rounded px-2 py-0.5">#{effectiveBestTurn}</span>
              <span className="text-xs text-gray-500 flex-1">Ideal insertion point</span>
              <button
                data-tutorial="review-change-best-btn"
                onClick={() => {}}
                className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                  reviewAdjusting === "best"
                    ? "bg-amber-100 text-amber-700 border border-amber-300"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {reviewAdjusting === "best" ? "Selecting..." : "Change"}
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              data-tutorial="confirm-save-btn"
              onClick={() => setSaved(true)}
              className="flex-1 rounded-md bg-green-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-500"
            >
              Confirm & Save
            </button>
            <button
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

  // Post-save state: show saved item + advance button
  if (saved) {
    return (
      <div className="flex h-full flex-col lg:flex-row">
        <div className="flex h-1/2 flex-col border-b border-gray-200 lg:h-full lg:w-1/2 lg:border-b-0 lg:border-r">
          <div className="shrink-0 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-800">Transcript</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <div className="space-y-1.5">
              {TUTORIAL_TRANSCRIPT.map((turn) => {
                const speakerIndex = speakerMap.get(turn.speaker) ?? 0;
                const color = getSpeakerColor(speakerIndex);
                return (
                  <div key={turn.id} className="rounded-md px-3 py-2">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 text-xs font-mono text-gray-400">#{turn.turn_number}</span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${color.bg} ${color.text}`}>{turn.speaker}</span>
                      <p className="flex-1 text-sm leading-relaxed text-gray-700">{turn.content}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex h-1/2 flex-col lg:h-full lg:w-1/2">
          <div className="shrink-0 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-800">Create Messages</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex flex-col gap-4">
              {/* Status header like real page */}
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-green-100 p-2">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5 text-green-600">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-700">1 message created</p>
                </div>
                <button
                  data-tutorial="advance-stage-btn"
                  onClick={() => {}}
                  className="shrink-0 rounded-md bg-green-600 px-4 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-green-500 transition-colors"
                >
                  Done. Advance to Annotation.
                </button>
              </div>

              {/* Saved item card */}
              <div className="rounded-md border border-gray-200 bg-white px-3 py-2">
                <div className="flex items-baseline gap-1 flex-wrap text-xs">
                  <span className="font-semibold text-indigo-600">1.</span>
                  <span className="text-gray-500">(Heads-up)</span>
                  <span className="text-gray-500">— turns {windowStart}–{windowEnd}</span>
                </div>
                <p className="mt-0.5 text-xs text-gray-500 truncate">{CONSTRUCTION_ITEM.ideal_response}</p>
              </div>

              {/* Next-item suggestions (mirrors real page) */}
              <div className="space-y-2" data-tutorial="next-suggestions">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Create another message from one of the suggested directions
                </p>
                <div className="space-y-1.5">
                  {NEXT_SUGGESTIONS.map((suggestion, i) => (
                    <button
                      key={i}
                      className="w-full text-left rounded-md border border-gray-200 bg-white px-3 py-2.5 hover:border-indigo-300 hover:bg-indigo-50 transition-colors group"
                    >
                      <div className="flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4 shrink-0 text-indigo-400 group-hover:text-indigo-600 transition-colors">
                          <path fillRule="evenodd" d="M2 8a.75.75 0 0 1 .75-.75h8.69L8.22 4.03a.75.75 0 0 1 1.06-1.06l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 0 1-1.06-1.06l3.22-3.22H2.75A.75.75 0 0 1 2 8Z" clipRule="evenodd" />
                        </svg>
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-medium text-gray-800 group-hover:text-indigo-700">{suggestion.direction}</span>
                          <span className="ml-2 text-xs text-gray-400">turn {suggestion.bestTurn}</span>
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

                {/* Start blank option */}
                <button className="w-full rounded-md border border-dashed border-gray-300 px-3 py-2.5 text-left hover:border-gray-400 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4 text-gray-400">
                      <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
                    </svg>
                    <span className="text-sm text-gray-600">Start a new message from scratch</span>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* Left: Transcript (mirrors TranscriptReview component) */}
      <div className="flex h-1/2 flex-col border-b border-gray-200 lg:h-full lg:w-1/2 lg:border-b-0 lg:border-r" data-tutorial="construction-transcript">
        <div className="shrink-0 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-800">Transcript</h2>
          <span className="text-xs text-gray-400">{TUTORIAL_TRANSCRIPT.length} turns</span>
        </div>
        {hint && (
          <div className="shrink-0 border-b border-indigo-200 bg-indigo-50 px-4 py-2">
            <p className="text-xs font-medium text-indigo-700">{hint}</p>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-3">
          <div className="space-y-1.5">
            {TUTORIAL_TRANSCRIPT.map((turn) => {
              const speakerIndex = speakerMap.get(turn.speaker) ?? 0;
              const color = getSpeakerColor(speakerIndex);
              const isStart = turn.turn_number === windowStart;
              const isEnd = turn.turn_number === windowEnd;
              const isBest = turn.turn_number === bestTurn;
              const selectable = isSelectable(turn.turn_number);
              const clickable = selectingFor && selectable;

              return (
                <div
                  key={turn.id}
                  data-tutorial={`turn-${turn.turn_number}`}
                  onClick={() => clickable && handleTurnClick(turn.turn_number)}
                  className={`group relative rounded-md border border-transparent px-3 py-2 transition-colors ${getTurnClasses(turn.turn_number)} ${
                    clickable
                      ? "cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/50"
                      : selectingFor
                        ? "opacity-40"
                        : ""
                  }`}
                >
                  {isStart && <span className="absolute right-0 top-0 z-10 rounded-bl bg-green-500 px-1.5 py-0.5 text-[10px] font-bold text-white">EARLIEST</span>}
                  {isEnd && <span className="absolute top-0 z-10 rounded-bl bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ right: isStart ? '3rem' : '0' }}>LATEST</span>}
                  {isBest && <span className="absolute bottom-0 right-0 z-10 rounded-tl bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">BEST</span>}

                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 text-xs font-mono text-gray-400">#{turn.turn_number}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${color.bg} ${color.text}`}>{turn.speaker}</span>
                    <p className="flex-1 text-sm leading-relaxed text-gray-700">{turn.content}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right: Construction form */}
      <div className="flex h-1/2 min-w-0 flex-col lg:h-full lg:w-1/2">
        <div className="shrink-0 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-800">Create Messages</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4 min-w-0">
          <div className="flex flex-col gap-4 min-w-0">
            {/* Step 1: Placement Window */}
            <div data-tutorial="placement-window-section" className="rounded-lg border-2 border-indigo-200 bg-indigo-50 p-3">
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
                    {windowStart !== null ? `#${windowStart}` : "--"}
                  </span>
                  <button
                    data-tutorial="select-start-btn"
                    onClick={() => {}}
                    className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium ${
                      selectingFor === "start"
                        ? "border-green-400 bg-green-100 text-green-700"
                        : "border-gray-300 text-gray-600"
                    }`}
                  >
                    {selectingFor === "start" ? "Selecting..." : windowStart !== null ? "Change" : "Select"}
                  </button>
                  <span className="text-xs text-gray-400">Earliest turn where this message becomes relevant</span>
                </div>

                {/* End turn */}
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
                  <span className="text-sm font-medium text-gray-700 whitespace-nowrap">Last useful:</span>
                  <span className="font-mono text-sm font-semibold text-gray-800 w-8">
                    {windowEnd !== null ? `#${windowEnd}` : "--"}
                  </span>
                  <button
                    data-tutorial="select-end-btn"
                    onClick={() => {}}
                    className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium ${
                      selectingFor === "end"
                        ? "border-red-400 bg-red-100 text-red-700"
                        : windowStart === null
                          ? "border-gray-300 text-gray-600 opacity-40"
                          : "border-gray-300 text-gray-600"
                    }`}
                  >
                    {selectingFor === "end" ? "Selecting..." : windowEnd !== null ? "Change" : "Select"}
                  </button>
                  <span className="text-xs text-gray-400">Latest turn where inserting would still help</span>
                </div>

                {/* Best turn */}
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                  <span className="text-sm font-medium text-gray-700 whitespace-nowrap">Best placement:</span>
                  <span className="font-mono text-sm font-semibold text-gray-800 w-8">
                    {bestTurn !== null ? `#${bestTurn}` : "--"}
                  </span>
                  <button
                    data-tutorial="select-best-btn"
                    onClick={() => {}}
                    className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium ${
                      selectingFor === "best"
                        ? "border-amber-400 bg-amber-100 text-amber-700"
                        : (windowStart === null || windowEnd === null)
                          ? "border-gray-300 text-gray-600 opacity-40"
                          : "border-gray-300 text-gray-600"
                    }`}
                  >
                    {selectingFor === "best" ? "Selecting..." : bestTurn !== null ? "Change" : "Select"}
                  </button>
                  <span className="text-xs text-gray-400">Ideal insertion point</span>
                </div>
              </div>
            </div>

            {/* Step 2: Direction (AI-generated intention tags) */}
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
                <div className="pl-8 flex flex-col items-start gap-1.5">
                  {TUTORIAL_DIRECTIONS.map((dir) => {
                    const styles = DIRECTION_CATEGORY_STYLES[dir.category];
                    const isSelected = intentionSelected && dir.category === "heads_up" && dir.tag === TUTORIAL_DIRECTIONS[0].tag;
                    return (
                      <button
                        key={dir.tag}
                        data-tutorial={dir === TUTORIAL_DIRECTIONS[0] ? "intention-tag-heads-up" : undefined}
                        onClick={() => {
                          if (dir === TUTORIAL_DIRECTIONS[0]) setIntentionSelected(true);
                        }}
                        className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium text-left transition-all ${
                          isSelected ? styles.selected : styles.hover
                        }`}
                      >
                        {isSelected && (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                            <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                          </svg>
                        )}
                        <span>{dir.tag}</span>
                      </button>
                    );
                  })}

                  {/* "Other" input row */}
                  <div className="flex items-center gap-2 w-full mt-1">
                    <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shrink-0">
                      Other
                    </span>
                    <input
                      type="text"
                      readOnly
                      placeholder="Type your own direction..."
                      className="flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm shadow-sm focus:outline-none bg-gray-50"
                    />
                    <button disabled className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white opacity-50">
                      Use
                    </button>
                  </div>
                </div>

                {intentionSelected && (
                  <div className="pl-8 mt-2 flex items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4 text-indigo-500">
                      <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                    </svg>
                    <span className="text-xs font-medium text-indigo-700">
                      Selected: "{TUTORIAL_DIRECTIONS[0].tag}"
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-md border border-gray-200 bg-gray-100 p-3 opacity-50">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold bg-gray-300 text-gray-500">2</span>
                  <p className="text-sm font-medium text-gray-400">Choose a direction</p>
                </div>
              </div>
            )}

            {/* Step 3: Sources */}
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
                <div className="pl-8 space-y-2 min-w-0">
                  {/* Search mode tabs */}
                  <div className="flex items-center gap-1 rounded-md bg-white border border-gray-300 p-0.5">
                    <button
                      className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        searchMode === "ai" ? "bg-violet-600 text-white shadow-sm" : "text-gray-600 hover:text-gray-800"
                      }`}
                      onClick={() => setSearchMode("ai")}
                    >
                      AI Finder
                    </button>
                    <button
                      className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        searchMode === "scholar" ? "bg-indigo-600 text-white shadow-sm" : "text-gray-600 hover:text-gray-800"
                      }`}
                      onClick={() => setSearchMode("scholar")}
                    >
                      Scholar
                    </button>
                    <button
                      className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        searchMode === "web" ? "bg-indigo-600 text-white shadow-sm" : "text-gray-600 hover:text-gray-800"
                      }`}
                      onClick={() => setSearchMode("web")}
                    >
                      Web
                    </button>
                    <button
                      data-tutorial="manual-source-tab"
                      className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        searchMode === "manual" ? "bg-indigo-600 text-white shadow-sm" : "text-gray-600 hover:text-gray-800"
                      }`}
                      onClick={() => setSearchMode("manual")}
                    >
                      Manual
                    </button>
                  </div>

                  {/* Web search (default view) */}
                  {(searchMode === "web" || searchMode === "scholar") && (
                    <>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={TUTORIAL_SOURCE_SEARCH.query}
                          readOnly
                          className="flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm shadow-sm bg-gray-50 focus:outline-none"
                        />
                        <button
                          data-tutorial="source-search-btn"
                          onClick={() => setSourceSearchDone(true)}
                          className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 transition-colors"
                        >
                          Search
                        </button>
                      </div>

                      {sourceSearchDone && (
                        <div className="max-h-64 overflow-y-auto space-y-1.5">
                          <div
                            data-tutorial="source-result-0"
                            onClick={() => setSourceSelected(true)}
                            className="rounded-md border border-gray-200 bg-white px-3 py-2"
                          >
                            <p className="text-xs font-semibold text-gray-800">{TUTORIAL_SOURCE_SEARCH.result.title}</p>
                            <p className="mt-1 text-xs text-gray-500 line-clamp-3">{TUTORIAL_SOURCE_SEARCH.result.snippet}</p>
                            <div className="mt-2 flex items-center gap-2">
                              <button
                                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                                  sourceSelected
                                    ? "bg-green-100 text-green-700 border border-green-300 cursor-not-allowed"
                                    : "bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm"
                                }`}
                              >
                                {sourceSelected ? (
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
                            </div>
                          </div>
                        </div>
                      )}
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
                        defaultValue={TUTORIAL_MANUAL_SOURCE.title}
                        placeholder="Source title or brief description..."
                        className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                      />
                      <textarea
                        rows={3}
                        defaultValue={TUTORIAL_MANUAL_SOURCE.url}
                        placeholder="Paste content, URL, or notes about this source (optional)..."
                        className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                      />
                      <button
                        data-tutorial="manual-source-submit"
                        onClick={() => setManualSourceAdded(true)}
                        className="w-full rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 transition-colors"
                      >
                        Add Source
                      </button>
                    </div>
                  )}

                  {/* Inserted resources list */}
                  {(sourceSelected || manualSourceAdded) && (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Inserted Sources</p>
                      {sourceSelected && (
                        <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-2 py-1.5">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 text-green-600">
                            <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                          </svg>
                          <span className="text-xs text-gray-700">{TUTORIAL_SOURCE_SEARCH.result.title}</span>
                        </div>
                      )}
                      {manualSourceAdded && (
                        <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-2 py-1.5">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 text-green-600">
                            <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                          </svg>
                          <span className="text-xs text-gray-700">{TUTORIAL_MANUAL_SOURCE.title}</span>
                        </div>
                      )}
                    </div>
                  )}
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
                      data-tutorial={level.value === 0.5 ? "pertinence-important" : undefined}
                      className={`flex items-start gap-2.5 rounded-md border px-3 py-2 cursor-pointer transition-colors ${
                        pertinence === level.value
                          ? "border-indigo-400 bg-indigo-50"
                          : "border-gray-200 bg-white hover:border-gray-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name="pertinence"
                        checked={pertinence === level.value}
                        onChange={() => {
                          if (level.value === CONSTRUCTION_TARGETS.pertinence) setPertinence(level.value);
                        }}
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
              <div className="rounded-md border border-gray-200 bg-gray-50 p-3" data-tutorial="message-creator">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`shrink-0 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                    aiAccepted ? "bg-green-500 text-white" : "bg-indigo-600 text-white"
                  }`}>
                    {aiAccepted ? "✓" : "5"}
                  </span>
                  <p className="text-sm font-semibold text-gray-900">
                    Create message <span className="text-red-500">*</span>
                  </p>
                </div>
                <div className="pl-8 space-y-3">
                  {/* Mode toggle (mirrors real MessageCreator) */}
                  <div className="flex items-center gap-1 rounded-md bg-white border border-gray-300 p-0.5">
                    <button
                      onClick={() => setMessageMode("generate")}
                      className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        messageMode === "generate"
                          ? "bg-violet-600 text-white shadow-sm"
                          : "text-gray-600 hover:text-gray-800"
                      }`}
                    >
                      Generate with AI
                    </button>
                    <button
                      onClick={() => setMessageMode("manual")}
                      className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        messageMode === "manual"
                          ? "bg-violet-600 text-white shadow-sm"
                          : "text-gray-600 hover:text-gray-800"
                      }`}
                    >
                      Write manually
                    </button>
                  </div>

                  {messageMode === "generate" ? (
                    <div className="space-y-3">
                      {/* Generate button (before generation) */}
                      {!aiGenerated && !aiAccepted && (
                        <button
                          data-tutorial="generate-message-btn"
                          onClick={() => { if (currentStep?.id === "const-generate-btn") setAiGenerated(true); }}
                          className="w-full rounded-md bg-violet-600 px-4 py-3 text-sm font-medium text-white hover:bg-violet-500 transition-colors"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                              <path d="M15.98 1.804a1 1 0 00-1.96 0l-.24 1.192a1 1 0 01-.784.784l-1.192.24a1 1 0 000 1.96l1.192.24a1 1 0 01.784.784l.24 1.192a1 1 0 001.96 0l.24-1.192a1 1 0 01.784-.784l1.192-.24a1 1 0 000-1.96l-1.192-.24a1 1 0 01-.784-.784l-.24-1.192zM5.98 7.804a1 1 0 00-1.96 0l-.24 1.192a1 1 0 01-.784.785l-1.192.24a1 1 0 000 1.958l1.192.24a1 1 0 01.784.785l.24 1.192a1 1 0 001.96 0l.24-1.192a1 1 0 01.784-.785l1.192-.24a1 1 0 000-1.958l-1.192-.24a1 1 0 01-.784-.785l-.24-1.192z" />
                            </svg>
                            Generate Message
                          </span>
                        </button>
                      )}

                      {/* AI Preview (after generation, before accept) */}
                      {aiGenerated && !aiAccepted && (
                        <div className="rounded-md border border-violet-200 bg-violet-50 p-3 space-y-2">
                          <p className="text-xs font-semibold text-violet-700">AI-Generated Message:</p>
                          <div className="rounded-md border border-gray-200 bg-white p-3">
                            <p className="text-sm text-gray-800 whitespace-pre-wrap">{CONSTRUCTION_ITEM.ideal_response}</p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              data-tutorial="accept-ai-btn"
                              onClick={() => setAiAccepted(true)}
                              className="flex-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 transition-colors"
                            >
                              Accept
                            </button>
                            <button
                              className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Accepted text editor (after accept) */}
                      {aiAccepted && (
                        <div>
                          <p className="mb-1 text-xs text-gray-500">You can edit the accepted message below:</p>
                          <textarea
                            readOnly
                            value={CONSTRUCTION_ITEM.ideal_response}
                            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm h-28 bg-white focus:outline-none"
                          />
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-xs text-gray-400">Regenerate from scratch</span>
                          </div>
                        </div>
                      )}

                      {/* Follow-up prompt (shown after generation) */}
                      {(aiGenerated || aiAccepted) && (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            readOnly
                            placeholder="Ask AI to adjust (e.g., 'make it shorter', 'add more citations')..."
                            className="flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm shadow-sm bg-gray-50 focus:outline-none"
                          />
                          <button
                            disabled
                            className="shrink-0 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white opacity-50"
                          >
                            Send
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Manual mode */
                    <div className="space-y-2">
                      <textarea
                        readOnly
                        placeholder="Write a message that you think would actually help the group..."
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm h-28 placeholder:text-gray-400 bg-white focus:outline-none"
                      />
                    </div>
                  )}
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
          </div>
        </div>

        {/* Pinned action bar (mirrors real page) */}
        {windowComplete && intentionSelected && sourcesAdded && importanceSelected && (
          <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3">
            <div className="flex gap-2">
              <button
                data-tutorial="review-place-btn"
                onClick={() => setShowPreview(true)}
                className="flex-1 rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500"
              >
                Review & Place
              </button>
              <button
                className="rounded-md border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
