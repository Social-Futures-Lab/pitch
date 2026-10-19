import { useEffect, useState, useRef } from "react";
import { useTutorial } from "../TutorialProvider";
import { conversationSteps } from "../steps/conversationSteps";
import {
  TUTORIAL_TRANSCRIPT,
  BOOKMARK_TARGET_TURN,
  TUTORIAL_SPEAKERS,
  type TutorialTurn,
} from "../fixtures/transcript";

const SPEAKER_COLORS = [
  { dot: "bg-blue-500", bubble: "bg-blue-50", name: "text-blue-600" },
  { dot: "bg-emerald-500", bubble: "bg-emerald-50", name: "text-emerald-600" },
  { dot: "bg-purple-500", bubble: "bg-purple-50", name: "text-purple-600" },
];

function getSpeakerIndex(speaker: string) {
  return TUTORIAL_SPEAKERS.indexOf(speaker);
}

export default function TutorialConversationPage() {
  const { setSteps, currentStep, advanceStep } = useTutorial();
  const [visibleTurns, setVisibleTurns] = useState<TutorialTurn[]>([]);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [bookmarkedTurns, setBookmarkedTurns] = useState<Set<number>>(
    new Set(),
  );
  const [animationComplete, setAnimationComplete] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setSteps(conversationSteps);
  }, [setSteps]);

  // Start animation only after user dismisses the message area intro step
  const [animationStarted, setAnimationStarted] = useState(false);

  useEffect(() => {
    if (currentStep?.id === "conv-watch" && !animationStarted) {
      setAnimationStarted(true);
    }
  }, [currentStep, animationStarted]);

  // Advance past the "conv-watch" step once animation finishes
  useEffect(() => {
    if (animationComplete && currentStep?.id === "conv-watch") {
      advanceStep();
    }
  }, [animationComplete, currentStep, advanceStep]);

  // Animate messages appearing one by one
  useEffect(() => {
    if (!animationStarted) return;

    let turnIndex = 0;

    const showNext = () => {
      if (turnIndex >= TUTORIAL_TRANSCRIPT.length) {
        setTypingUser(null);
        setAnimationComplete(true);
        return;
      }

      const turn = TUTORIAL_TRANSCRIPT[turnIndex];
      setTypingUser(turn.speaker);

      animationRef.current = setTimeout(() => {
        setVisibleTurns((prev) => [...prev, turn]);
        setTypingUser(null);
        turnIndex++;

        animationRef.current = setTimeout(showNext, 300);
      }, 800);
    };

    animationRef.current = setTimeout(showNext, 500);

    return () => {
      if (animationRef.current) clearTimeout(animationRef.current);
    };
  }, [animationStarted]);

  // Auto-scroll to bottom as messages appear
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visibleTurns, typingUser]);

  const handleBookmark = (turnNumber: number) => {
    setBookmarkedTurns((prev) => {
      const next = new Set(prev);
      if (next.has(turnNumber)) next.delete(turnNumber);
      else next.add(turnNumber);
      return next;
    });
  };

  const currentUserSpeaker = "Alex";
  const displayName = (speaker: string) => speaker === currentUserSpeaker ? "You" : speaker;

  return (
    <div className="mx-auto flex h-full max-w-5xl">
      {/* Main chat column */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Prompt Banner - matches real PromptBanner component */}
        <div
          data-tutorial="prompt-banner"
          className="sticky top-0 z-10 border-b border-indigo-200 bg-indigo-50 px-5 py-3"
        >
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-indigo-500">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-5 w-5"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
                  clipRule="evenodd"
                />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
                Discussion Prompt
              </p>
              <p className="mt-0.5 text-sm leading-relaxed text-indigo-900">
                Plan a group trip to Seattle — what should we prioritize
                and how should we organize it?
              </p>
            </div>
          </div>
        </div>

        {/* Chat messages area */}
        <div
          className="flex-1 overflow-y-auto px-4 py-4"
          data-tutorial="conversation-messages"
        >
          {visibleTurns.map((turn) => {
            const speakerIdx = getSpeakerIndex(turn.speaker);
            const color = SPEAKER_COLORS[speakerIdx];
            const isCurrentUser = turn.speaker === currentUserSpeaker;
            const formattedTime = new Date(turn.timestamp).toLocaleTimeString(
              [],
              { hour: "2-digit", minute: "2-digit", second: "2-digit" },
            );

            return (
              <div
                key={turn.id}
                className={`group/msg flex ${isCurrentUser ? "justify-end" : "justify-start"} mb-2`}
              >
                <div
                  className={`flex max-w-[75%] items-start gap-2 ${isCurrentUser ? "flex-row-reverse" : ""}`}
                >
                  {/* Avatar */}
                  <div
                    className={`mt-0.5 h-6 w-6 shrink-0 rounded-full ${color.dot} flex items-center justify-center`}
                  >
                    <span className="text-[10px] font-semibold text-white">
                      {displayName(turn.speaker).charAt(0).toUpperCase()}
                    </span>
                  </div>

                  <div>
                    {/* Name + time */}
                    <div
                      className={`flex items-baseline gap-1.5 ${isCurrentUser ? "justify-end" : ""} mb-0.5`}
                    >
                      <span className={`text-xs font-medium ${color.name}`}>
                        {displayName(turn.speaker)}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {formattedTime}
                      </span>
                    </div>

                    {/* Bubble + bookmark */}
                    <div className="flex items-end gap-1">
                      {/* Bookmark on left for current user's messages */}
                      {isCurrentUser && (
                        <BookmarkButton
                          turnNumber={turn.turn_number}
                          flagged={bookmarkedTurns.has(turn.turn_number)}
                          onClick={() => handleBookmark(turn.turn_number)}
                          isHighlighted={
                            currentStep?.target ===
                            `bookmark-btn-${turn.turn_number}`
                          }
                        />
                      )}

                      <div
                        className={`rounded-2xl px-3 py-1.5 ${
                          isCurrentUser
                            ? "bg-indigo-600 text-white"
                            : color.bubble
                        }`}
                      >
                        <p
                          className={`whitespace-pre-wrap text-sm leading-snug ${isCurrentUser ? "text-white" : "text-gray-800"}`}
                        >
                          {turn.content}
                        </p>
                      </div>

                      {/* Bookmark on right for other users' messages */}
                      {!isCurrentUser && (
                        <BookmarkButton
                          turnNumber={turn.turn_number}
                          flagged={bookmarkedTurns.has(turn.turn_number)}
                          onClick={() => handleBookmark(turn.turn_number)}
                          isHighlighted={
                            currentStep?.target ===
                            `bookmark-btn-${turn.turn_number}`
                          }
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Typing indicator */}
          {typingUser && (
            <div className="mb-2 flex items-center gap-2 px-2 py-1">
              <span className="text-xs text-gray-500">
                <span className="font-medium">{displayName(typingUser)}</span> is typing
              </span>
              <span className="flex gap-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
              </span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area (disabled, for visual accuracy) */}
        <div className="shrink-0 border-t border-gray-200 bg-white">
          <div className="flex h-3 cursor-row-resize items-center justify-center hover:bg-gray-50">
            <div className="h-1 w-10 rounded-full bg-gray-300" />
          </div>
          <div className="flex h-15 items-end gap-2 px-4 pb-3">
            <textarea
              readOnly
              placeholder="Type a message... (Shift+Enter for newline)"
              className="flex-1 resize-none rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:outline-none bg-gray-50"
              style={{ height: "100%", overflowY: "auto" }}
            />
            <button
              disabled
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm opacity-50 cursor-not-allowed"
            >
              Send
            </button>
          </div>
        </div>
      </div>

      {/* Participant sidebar - matches real ParticipantList */}
      <div className="hidden w-48 shrink-0 border-l border-gray-200 bg-gray-50/50 sm:flex sm:flex-col">
        <div className="px-4 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Participants
            <span className="ml-1 font-normal text-gray-400">(3/3)</span>
          </h3>
          <ul className="mt-2 space-y-1.5">
            {TUTORIAL_SPEAKERS.map((speaker) => (
              <li key={speaker} className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                <span className="truncate text-sm text-gray-800">
                  {displayName(speaker)}
                </span>
                {typingUser === speaker && (
                  <span className="ml-auto flex gap-0.5">
                    <span className="h-1 w-1 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* End conversation button in sidebar - matches real placement */}
        {animationComplete && (
          <div className="px-4 pb-3">
            <button
              data-tutorial="end-conversation-btn"
              onClick={() => {}}
              className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600"
            >
              End conversation
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function BookmarkButton({
  turnNumber,
  flagged,
  onClick,
  isHighlighted,
}: {
  turnNumber: number;
  flagged: boolean;
  onClick: () => void;
  isHighlighted: boolean;
}) {
  return (
    <div className="relative flex shrink-0 self-stretch">
      <button
        type="button"
        data-tutorial={`bookmark-btn-${turnNumber}`}
        onClick={onClick}
        className={`flex w-5 items-center justify-center self-stretch rounded transition-all ${
          flagged
            ? "text-amber-500 opacity-100"
            : isHighlighted
              ? "text-amber-400 opacity-100"
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
    </div>
  );
}
