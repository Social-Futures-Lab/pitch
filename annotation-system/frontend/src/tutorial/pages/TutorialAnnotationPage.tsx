import { useEffect, useState } from "react";
import { useTutorial } from "../TutorialProvider";
import { annotationSteps } from "../steps/annotationSteps";
import { TUTORIAL_TRANSCRIPT, TUTORIAL_SPEAKERS } from "../fixtures/transcript";
import {
  ANNOTATION_PEER_ITEM,
  ANNOTATION_TARGETS,
  CONSTRUCTION_ITEM,
} from "../fixtures/knowledgeItems";
import { getSpeakerColor } from "@/components/chat/ChatMessage";

type SelectingFor = "start" | "end" | "best" | null;
type Phase = "annotating" | "saved" | "item2" | "ranking";

const PERTINENCE_LEVELS = [
  { value: 0.0, title: "Nice to have", description: "adds useful context, but the conversation would be fine without it" },
  { value: 0.25, title: "Somewhat important", description: "helps the conversation, but probably would not change its direction" },
  { value: 0.5, title: "Important", description: "meaningfully improves the conversation or fills a clear gap" },
  { value: 0.75, title: "Very important", description: "could shift how the group thinks, decides, or continues" },
  { value: 1.0, title: "Essential", description: "could prevent a major misunderstanding or change the direction of the conversation" },
];

export default function TutorialAnnotationPage() {
  const { setSteps, currentStep } = useTutorial();

  const [selectingFor, setSelectingFor] = useState<SelectingFor>(null);
  const [windowStart, setWindowStart] = useState<number | null>(null);
  const [windowEnd, setWindowEnd] = useState<number | null>(null);
  const [bestTurn, setBestTurn] = useState<number | null>(null);
  const [pertinence, setPertinence] = useState<number | null>(null);
  const [shouldNotAppear, setShouldNotAppear] = useState(false);
  const [phase, setPhase] = useState<Phase>("annotating");
  const [rankingOrder, setRankingOrder] = useState<string[]>(["peer", "own", "peer2"]);
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);

  useEffect(() => {
    setSteps(annotationSteps);
  }, [setSteps]);

  // Sync phase with current step (handles HMR/reload edge cases)
  useEffect(() => {
    if (currentStep?.id.startsWith("annot-ranking")) {
      setPhase("ranking");
    } else if (currentStep?.id === "annot-next") {
      setPhase("saved");
      setCompletedCount(1);
    } else if (currentStep?.id === "annot-item2-next") {
      setPhase("item2");
      setCurrentItemIndex(1);
      setCompletedCount(2);
    }
  }, [currentStep]);

  // Manage selectingFor state based on current tutorial step
  useEffect(() => {
    if (currentStep?.id === "annot-start-turn") setSelectingFor("start");
    else if (currentStep?.id === "annot-end-turn") setSelectingFor("end");
    else if (currentStep?.id === "annot-best-turn") setSelectingFor("best");
    else setSelectingFor(null);
  }, [currentStep]);

  // Ensure pertinence is set when advancing past the importance step
  // (handles case where user clicks highlight padding area but misses the radio)
  useEffect(() => {
    if (currentStep?.id === "annot-save" && pertinence === null) {
      setPertinence(ANNOTATION_TARGETS.pertinence);
    }
  }, [currentStep, pertinence]);

  const handleTurnClick = (turnNumber: number) => {
    if (!currentStep) return;

    if (currentStep.id === "annot-start-turn" && turnNumber === ANNOTATION_TARGETS.windowStart) {
      setWindowStart(turnNumber);
    } else if (currentStep.id === "annot-end-turn" && turnNumber === ANNOTATION_TARGETS.windowEnd) {
      setWindowEnd(turnNumber);
    } else if (currentStep.id === "annot-best-turn" && turnNumber === ANNOTATION_TARGETS.bestTurn) {
      setBestTurn(turnNumber);
    }
  };

  const windowComplete = windowStart !== null && windowEnd !== null && bestTurn !== null;

  // Build speakerMap
  const speakerMap = new Map<string, number>();
  TUTORIAL_SPEAKERS.forEach((s, i) => speakerMap.set(s, i));

  const isSelectable = (turnNumber: number): boolean => {
    if (!selectingFor) return false;
    if (selectingFor === "end") return windowStart !== null && turnNumber >= windowStart;
    if (selectingFor === "best") return windowStart !== null && windowEnd !== null && turnNumber >= windowStart && turnNumber <= windowEnd;
    return true;
  };

  const getHintText = () => {
    if (!selectingFor) return null;
    switch (selectingFor) {
      case "start": return "Click a turn to set as the FIRST RELEVANT point — the message could be inserted after this turn";
      case "end": return "Click a turn at or after the first relevant to set as the LAST USEFUL point — the message would still help here";
      case "best": return "Click a turn within the range to set as the BEST PLACEMENT point — the ideal moment to insert the message";
    }
  };

  const hint = getHintText();

  const getTurnClasses = (turnNumber: number) => {
    if (windowStart !== null && windowEnd !== null && turnNumber >= windowStart && turnNumber <= windowEnd) {
      return "bg-blue-50 ring-1 ring-blue-200";
    }
    if (windowStart !== null && windowEnd === null && turnNumber === windowStart) {
      return "bg-green-50 ring-1 ring-green-400";
    }
    return "";
  };

  // Ranking items data
  const RANKING_ITEMS: Record<string, { id: string; text: string; bestTurn: number; author: string }> = {
    peer: {
      id: "peer",
      text: ANNOTATION_PEER_ITEM.ideal_response,
      bestTurn: ANNOTATION_TARGETS.bestTurn,
      author: "Jordan",
    },
    own: {
      id: "own",
      text: CONSTRUCTION_ITEM.ideal_response,
      bestTurn: 5,
      author: "You",
    },
    peer2: {
      id: "peer2",
      text: "The Museum of Pop Culture (MoPOP) has a really cool exhibit on indie game design right now — if any of you are into that kind of thing it's open through August and it's right next to the Space Needle.",
      bestTurn: 7,
      author: "Sam",
    },
  };

  const SHOULD_NOT_APPEAR_ITEM = {
    id: "excluded",
    text: "I heard there's a new coffee shop opening downtown, but I'm not sure when exactly.",
    bestTurn: null,
    author: "Jordan",
  };

  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    const newOrder = [...rankingOrder];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    setRankingOrder(newOrder);
  };

  // Ranking view
  if (phase === "ranking") {
    return (
      <div className="relative flex h-full flex-col">
        {/* Top bar */}
        <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-2.5">
          <div className="flex items-center gap-4">
            <button
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                <path fillRule="evenodd" d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
              </svg>
              Back to items
            </button>
            <div className="flex-1">
              <span className="text-sm font-semibold text-gray-800">Rank the messages</span>
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
          {/* Left panel: Transcript (read-only with item markers) */}
          <div className="flex h-1/2 flex-col border-b border-gray-200 lg:h-full lg:w-1/2 lg:border-b-0 lg:border-r">
            <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-800">Transcript</h2>
                <span className="text-xs text-gray-400">{TUTORIAL_TRANSCRIPT.length} turns</span>
              </div>
              <p className="mt-0.5 text-[11px] text-gray-400">
                Hover items below or in the ranking to see where they appear
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <div className="space-y-1.5">
                {TUTORIAL_TRANSCRIPT.map((turn) => {
                  const speakerIndex = speakerMap.get(turn.speaker) ?? 0;
                  const color = getSpeakerColor(speakerIndex);
                  return (
                    <div key={turn.id} className="relative rounded-md border border-transparent px-3 py-2">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 shrink-0 text-xs font-mono text-gray-400">#{turn.turn_number}</span>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${color.bg} ${color.text}`}>{turn.speaker}</span>
                        <p className="flex-1 text-sm leading-relaxed text-gray-700">{turn.content}</p>
                      </div>
                      {/* Item markers at best turns */}
                      {turn.turn_number === ANNOTATION_TARGETS.bestTurn && (
                        <div className="my-1 ml-8 mr-4 flex flex-wrap gap-1.5">
                          <div className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs">
                            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-[10px] font-bold text-white">
                              {rankingOrder.indexOf("peer") + 1}
                            </span>
                            <span className="max-w-[180px] truncate text-gray-600">{ANNOTATION_PEER_ITEM.ideal_response.slice(0, 40)}...</span>
                          </div>
                        </div>
                      )}
                      {turn.turn_number === 5 && (
                        <div className="my-1 ml-8 mr-4 flex flex-wrap gap-1.5">
                          <div className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs">
                            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-[10px] font-bold text-white">
                              {rankingOrder.indexOf("own") + 1}
                            </span>
                            <span className="max-w-[180px] truncate text-gray-600">{CONSTRUCTION_ITEM.ideal_response.slice(0, 40)}...</span>
                          </div>
                        </div>
                      )}
                      {turn.turn_number === 7 && (
                        <div className="my-1 ml-8 mr-4 flex flex-wrap gap-1.5">
                          <div className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs">
                            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-[10px] font-bold text-white">
                              {rankingOrder.indexOf("peer2") + 1}
                            </span>
                            <span className="max-w-[180px] truncate text-gray-600">The Museum of Pop Culture (MoPOP)...</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right panel: Ranking */}
          <div className="flex h-1/2 flex-col lg:h-full lg:w-1/2" data-tutorial="ranking-panel">
            <div className="flex-1 overflow-y-auto p-4">
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/50">
                <div className="border-b border-indigo-200 px-4 py-3">
                  <h3 className="text-sm font-semibold text-indigo-900">Rank the messages</h3>
                  <p className="mt-1 text-xs leading-relaxed text-indigo-700">
                    Considering all messages (including ones you created) if only one could be shared during this conversation, which would be most valuable to the group? Drag them into order from most to least valuable.
                  </p>
                </div>

                <div className="p-4">
                  <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-green-600">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                      <path fillRule="evenodd" d="M8 14a.75.75 0 0 1-.75-.75V4.56L4.03 7.78a.75.75 0 0 1-1.06-1.06l4.5-4.5a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1-1.06 1.06L8.75 4.56v8.69A.75.75 0 0 1 8 14Z" clipRule="evenodd" />
                    </svg>
                    Most valuable
                  </div>

                  <div className="space-y-2">
                    {rankingOrder.map((itemId, index) => {
                      const item = RANKING_ITEMS[itemId];
                      if (!item) return null;
                      const isSecondItem = index === 1;
                      return (
                        <div
                          key={item.id}
                          className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm hover:shadow-md"
                        >
                          <div className="flex shrink-0 flex-col items-center gap-0.5">
                            <button
                              data-tutorial={isSecondItem ? "ranking-move-up-btn" : undefined}
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
                            <button className="mt-0.5 shrink-0 cursor-grab text-gray-400 hover:text-gray-600">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
                                <path fillRule="evenodd" d="M2 3.75A.75.75 0 0 1 2.75 3h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 3.75ZM2 8a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 8Zm0 4.25a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
                              </svg>
                            </button>
                            <button
                              onClick={() => {}}
                              disabled={index === rankingOrder.length - 1}
                              className={`rounded p-0.5 transition-colors ${
                                index === rankingOrder.length - 1
                                  ? "text-gray-200 cursor-not-allowed"
                                  : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                              }`}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                                <path fillRule="evenodd" d="M8 2a.75.75 0 0 1 .75.75v8.69l3.22-3.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.22 3.22V2.75A.75.75 0 0 1 8 2Z" clipRule="evenodd" />
                              </svg>
                            </button>
                          </div>
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">{index + 1}</div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm leading-relaxed text-gray-700 line-clamp-2">{item.text}</p>
                            <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                              <span>By {item.author}</span>
                              <span className="text-gray-300">|</span>
                              <span>Would appear after turn #{item.bestTurn}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                      <path fillRule="evenodd" d="M8 2a.75.75 0 0 1 .75.75v8.69l3.22-3.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.22 3.22V2.75A.75.75 0 0 1 8 2Z" clipRule="evenodd" />
                    </svg>
                    Least valuable
                  </div>

                  {/* Should Not Appear section */}
                  <div className="mt-4 border-t border-gray-200 pt-4">
                    <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
                        <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                      </svg>
                      Should not appear
                    </div>
                    <div className="flex items-start gap-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-400 text-xs font-bold text-white">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                          <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-relaxed text-gray-500 line-clamp-2">{SHOULD_NOT_APPEAR_ITEM.text}</p>
                        <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                          <span>By {SHOULD_NOT_APPEAR_ITEM.author}</span>
                          <span className="text-gray-300">|</span>
                          <span className="italic text-gray-400">Excluded from ranking</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-3">
                    <button
                      className="inline-flex items-center gap-2 rounded-md border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm transition-colors hover:bg-indigo-50"
                    >
                      Save ranking
                    </button>
                    <button
                      data-tutorial="save-ranking-btn"
                      onClick={() => {}}
                      className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
                    >
                      Submit ranking
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                        <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const TOTAL_ITEMS = 4;
  const progressPercentage = Math.round((completedCount / TOTAL_ITEMS) * 100);
  const nextEnabled = phase === "saved" || phase === "item2";

  // Item 2 view (pre-completed second item before ranking)
  if (phase === "item2") {
    return (
      <div className="relative flex h-full flex-col">
        {/* Top bar */}
        <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-2.5">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-4">
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
                    <span>Item 2 of {TOTAL_ITEMS}</span>
                    <span>{completedCount} of {TOTAL_ITEMS} complete ({progressPercentage}%)</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                    <div className="h-full rounded-full bg-indigo-500 transition-all duration-300" style={{ width: `${progressPercentage}%` }} />
                  </div>
                </div>
                <button
                  data-tutorial="annot-item2-next-btn"
                  onClick={() => setPhase("ranking")}
                  className="inline-flex items-center gap-1 rounded-md bg-gray-700 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-gray-600"
                >
                  Next
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                    <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
          {/* Left panel: Transcript (read-only) */}
          <div className="flex h-1/2 flex-col border-b border-gray-200 lg:h-full lg:w-1/2 lg:border-b-0 lg:border-r">
            <div className="shrink-0 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2.5">
              <h2 className="text-sm font-semibold text-gray-800">Transcript</h2>
              <span className="text-xs text-gray-400">{TUTORIAL_TRANSCRIPT.length} turns</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <div className="space-y-1.5">
                {TUTORIAL_TRANSCRIPT.map((turn) => {
                  const speakerIndex = speakerMap.get(turn.speaker) ?? 0;
                  const color = getSpeakerColor(speakerIndex);
                  return (
                    <div key={turn.id}>
                      <div className={`relative rounded-md border border-transparent px-3 py-2 ${
                        turn.turn_number >= 3 && turn.turn_number <= 7 ? "bg-blue-50 ring-1 ring-blue-200" : ""
                      }`}>
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 shrink-0 text-xs font-mono text-gray-400">#{turn.turn_number}</span>
                          <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${color.bg} ${color.text}`}>{turn.speaker}</span>
                          <p className="flex-1 text-sm leading-relaxed text-gray-700">{turn.content}</p>
                        </div>
                      </div>
                      {turn.turn_number === 5 && (
                        <div className="my-1.5 ml-8 mr-4">
                          <div className="rounded-lg bg-violet-600 px-4 py-3 shadow-sm">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="shrink-0 rounded bg-violet-500 px-1.5 py-0.5 text-xs font-semibold text-white">AI Agent</span>
                              <span className="text-xs text-violet-200">Proposed Inserted Message</span>
                            </div>
                            <p className="text-sm leading-relaxed text-white">{CONSTRUCTION_ITEM.ideal_response}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right panel: Pre-completed annotation */}
          <div className="flex h-1/2 flex-col lg:h-full lg:w-1/2">
            <div className="shrink-0 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2.5">
              <h2 className="text-sm font-semibold text-gray-800">Annotation</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="flex flex-col gap-4">
                {/* Knowledge Item Card - already placed */}
                <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
                  <div className="border-b border-gray-100 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-gray-800">Proposed Inserted Message</h3>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                        Placed
                      </span>
                    </div>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-sm leading-relaxed text-gray-700">{CONSTRUCTION_ITEM.ideal_response}</p>
                  </div>
                </div>

                {/* Pre-filled placement */}
                <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                  <p className="mb-2 text-sm font-medium text-gray-700">1. Placement window</p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
                      <span className="text-sm font-medium text-gray-700">First relevant:</span>
                      <span className="font-mono text-sm font-semibold text-gray-800">#3</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
                      <span className="text-sm font-medium text-gray-700">Last useful:</span>
                      <span className="font-mono text-sm font-semibold text-gray-800">#7</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                      <span className="text-sm font-medium text-gray-700">Best placement:</span>
                      <span className="font-mono text-sm font-semibold text-gray-800">#5</span>
                    </div>
                  </div>
                </div>

                {/* Pre-filled pertinence */}
                <div>
                  <p className="mb-2 text-sm font-medium text-gray-700">2. Importance</p>
                  <div className="rounded-md border border-indigo-400 bg-indigo-50 px-3 py-2">
                    <span className="text-sm text-gray-700">
                      <span className="font-semibold">Important</span> — meaningfully improves the conversation or fills a clear gap
                    </span>
                  </div>
                </div>

                {/* Saved indicator */}
                <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4 text-green-600">
                    <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                  </svg>
                  <span className="text-sm font-medium text-green-700">Annotation saved</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Main annotation view
  return (
    <div className="relative flex h-full flex-col">
      {/* Top bar: progress indicator */}
      <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-4">
              {/* Prev button */}
              <button
                disabled
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                  <path fillRule="evenodd" d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
                </svg>
                Prev
              </button>

              {/* Progress info */}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center justify-between text-xs text-gray-600">
                  <span>Item {currentItemIndex + 1} of {TOTAL_ITEMS}</span>
                  <span>{completedCount} of {TOTAL_ITEMS} complete ({progressPercentage}%)</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                  <div className="h-full rounded-full bg-indigo-500 transition-all duration-300" style={{ width: `${progressPercentage}%` }} />
                </div>
              </div>

              {/* Next button */}
              <button
                data-tutorial="annot-next-btn"
                disabled={!nextEnabled}
                onClick={() => {
                  setCurrentItemIndex(1);
                  setCompletedCount(2);
                  setPhase("item2");
                }}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors ${
                  nextEnabled
                    ? "bg-gray-700 text-white hover:bg-gray-600"
                    : "bg-gray-300 text-gray-500 cursor-not-allowed"
                }`}
              >
                Next
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                  <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main split layout */}
      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Left panel: Transcript */}
        <div className="flex h-1/2 flex-col border-b border-gray-200 lg:h-full lg:w-1/2 lg:border-b-0 lg:border-r">
          <div className="shrink-0 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2.5">
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
                const isStart = turn.turn_number === windowStart && windowEnd !== null;
                const isEnd = turn.turn_number === windowEnd;
                const isBest = turn.turn_number === bestTurn;
                const selectable = isSelectable(turn.turn_number);
                const clickable = !!selectingFor && selectable;

                return (
                  <div key={turn.id}>
                    <div
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

                    {/* Show proposed message preview at best turn */}
                    {isBest && (
                      <div className="my-1.5 ml-8 mr-4">
                        <div className="rounded-lg bg-violet-600 px-4 py-3 shadow-sm">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="shrink-0 rounded bg-violet-500 px-1.5 py-0.5 text-xs font-semibold text-white">AI Agent</span>
                            <span className="text-xs text-violet-200">Proposed Inserted Message</span>
                          </div>
                          <p className="text-sm leading-relaxed text-white">{ANNOTATION_PEER_ITEM.ideal_response}</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right panel: Annotation form */}
        <div className="flex h-1/2 flex-col lg:h-full lg:w-1/2">
          <div className="shrink-0 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2.5">
            <h2 className="text-sm font-semibold text-gray-800">Annotation</h2>
          </div>

          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4">
              <div className="flex flex-col gap-4">
                {/* Knowledge Item Card */}
                <div data-tutorial="peer-item-card" className="rounded-lg border border-gray-200 bg-white shadow-sm">
                  <div className="border-b border-gray-100 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-gray-800">Proposed Inserted Message</h3>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        Pending
                      </span>
                    </div>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-sm leading-relaxed text-gray-700">{ANNOTATION_PEER_ITEM.ideal_response}</p>
                  </div>
                  <div className="border-t border-gray-100 px-4 py-2.5">
                    <p className="text-xs italic text-gray-400">You may imagine small wording changes when deciding where this message should appear.</p>
                  </div>
                </div>

                {/* Do Not Surface Zone (matches real DoNotSurfaceZone component) */}
                <div
                  data-tutorial="should-not-appear-btn"
                  className={`rounded-lg border-2 transition-colors ${
                    shouldNotAppear
                      ? "border-gray-400 bg-gray-100"
                      : "border-dashed border-gray-300 bg-white hover:border-gray-400 hover:bg-gray-50"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (currentStep?.id === "annot-should-not-appear" || currentStep?.id === "annot-should-not-appear-explain") {
                        setShouldNotAppear(!shouldNotAppear);
                      }
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  >
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
                      shouldNotAppear ? "bg-gray-600 text-white" : "bg-gray-200 text-gray-500"
                    }`}>
                      {shouldNotAppear ? (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                          <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Z" clipRule="evenodd" />
                          <path fillRule="evenodd" d="M6.194 12.753a.75.75 0 0 0 1.06.053L16.5 4.44v2.81a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-.75-.75h-4.5a.75.75 0 0 0 0 1.5h2.553l-9.056 8.194a.75.75 0 0 0-.053 1.06Z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                          <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${shouldNotAppear ? "text-gray-800" : "text-gray-600"}`}>
                        {shouldNotAppear ? "Marked as should not appear" : "Should not appear"}
                      </p>
                      <p className="text-xs text-gray-500">
                        {shouldNotAppear
                          ? "This message is excluded from placement. Click to add it back to the conversation."
                          : "Choose this if the message would not be relevant, useful, or appropriate at any point in the transcript"}
                      </p>
                    </div>
                    {shouldNotAppear && (
                      <span className="shrink-0 rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
                        Add back to conversation
                      </span>
                    )}
                  </button>

                  {shouldNotAppear && (
                    <div className="border-t border-gray-300 px-4 py-3">
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-600">
                          Rationale (optional)
                        </span>
                        <textarea
                          readOnly
                          placeholder="Why should this message not appear here?"
                          rows={2}
                          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        />
                      </label>
                    </div>
                  )}
                </div>

                {/* Step 1: Placement window */}
                <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                  <p className="mb-2 text-sm font-medium text-gray-700">
                    1. Choose the turns after which this message could appear <span className="text-red-500">*</span>
                  </p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
                      <span className="text-sm font-medium text-gray-700 whitespace-nowrap">First relevant:</span>
                      <span className="font-mono text-sm font-semibold text-gray-800 w-8">
                        {windowStart !== null ? `#${windowStart}` : "--"}
                      </span>
                      <span className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium ${
                        selectingFor === "start"
                          ? "border-green-400 bg-green-100 text-green-700"
                          : "border-gray-300 text-gray-600"
                      }`}>
                        {selectingFor === "start" ? "Selecting..." : windowStart !== null ? "Change" : "Select"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
                      <span className="text-sm font-medium text-gray-700 whitespace-nowrap">Last useful:</span>
                      <span className="font-mono text-sm font-semibold text-gray-800 w-8">
                        {windowEnd !== null ? `#${windowEnd}` : "--"}
                      </span>
                      <span className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium ${
                        selectingFor === "end"
                          ? "border-red-400 bg-red-100 text-red-700"
                          : windowStart === null
                            ? "border-gray-300 text-gray-600 opacity-40"
                            : "border-gray-300 text-gray-600"
                      }`}>
                        {selectingFor === "end" ? "Selecting..." : windowEnd !== null ? "Change" : "Select"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                      <span className="text-sm font-medium text-gray-700 whitespace-nowrap">Best placement:</span>
                      <span className="font-mono text-sm font-semibold text-gray-800 w-8">
                        {bestTurn !== null ? `#${bestTurn}` : "--"}
                      </span>
                      <span className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium ${
                        selectingFor === "best"
                          ? "border-amber-400 bg-amber-100 text-amber-700"
                          : (windowStart === null || windowEnd === null)
                            ? "border-gray-300 text-gray-600 opacity-40"
                            : "border-gray-300 text-gray-600"
                      }`}>
                        {selectingFor === "best" ? "Selecting..." : bestTurn !== null ? "Change" : "Select"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Step 2: Pertinence */}
                {windowComplete && (
                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">
                      2. How important would this message be for the conversation? <span className="text-red-500">*</span>
                    </label>
                    <div className="space-y-1.5">
                      {PERTINENCE_LEVELS.map((level) => (
                        <label
                          key={level.value}
                          data-tutorial={level.value === 0.75 ? "pertinence-very-important" : undefined}
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
                              if (level.value === ANNOTATION_TARGETS.pertinence) setPertinence(level.value);
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
                )}

                {/* Step 3: Rationale */}
                {windowComplete && pertinence !== null && (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                      3. Rationale (optional)
                    </label>
                    <textarea
                      readOnly
                      placeholder="Why did you choose this placement and these ratings?"
                      rows={3}
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Pinned save button at bottom */}
            <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3">
              {phase === "saved" ? (
                <div className="flex w-full items-center justify-center gap-2 rounded-md bg-green-50 border border-green-200 px-4 py-2.5">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4 text-green-600">
                    <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                  </svg>
                  <span className="text-sm font-medium text-green-700">Saved!</span>
                </div>
              ) : (
                <button
                  data-tutorial="save-annotation-btn"
                  disabled={!windowComplete || pertinence === null}
                  onClick={() => {
                    setPhase("saved");
                    setCompletedCount(1);
                  }}
                  className={`w-full rounded-md px-4 py-2.5 text-sm font-medium shadow-sm transition-all duration-200 ${
                    windowComplete && pertinence !== null
                      ? "bg-indigo-600 text-white hover:bg-indigo-500"
                      : "bg-gray-300 text-gray-500 cursor-not-allowed"
                  }`}
                >
                  Save Annotation
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
