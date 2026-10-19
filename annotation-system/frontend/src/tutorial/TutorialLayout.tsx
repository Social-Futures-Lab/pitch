import { Outlet } from "react-router-dom";
import { TutorialProvider, useTutorial } from "./TutorialProvider";
import { TutorialOverlay } from "./TutorialOverlay";
import type { TutorialStage } from "./steps/types";

const STAGES: { key: TutorialStage; label: string }[] = [
  { key: "conversation", label: "Conversation" },
  { key: "construction", label: "Construction" },
  { key: "annotation", label: "Annotation" },
  { key: "deliberation", label: "Review & Revise" },
];

function StageProgress() {
  const { currentStage, goToStage } = useTutorial();
  const currentIdx = STAGES.findIndex((s) => s.key === currentStage);

  return (
    <div className="flex items-center gap-2">
      {STAGES.map((stage, i) => {
        const isActive = i === currentIdx;
        const isDone = i < currentIdx;
        const canNavigate = isDone || isActive;
        return (
          <div key={stage.key} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => canNavigate && goToStage(stage.key)}
              disabled={!canNavigate}
              className={`flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
                isActive
                  ? "bg-indigo-100 text-indigo-700"
                  : isDone
                    ? "bg-green-100 text-green-700 hover:bg-green-200 cursor-pointer"
                    : "bg-gray-100 text-gray-500 cursor-not-allowed"
              }`}
            >
              {isDone && (
                <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M10.28 2.28a.75.75 0 00-1.06-1.06L4.5 5.94 2.78 4.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l5.25-5.25z" />
                </svg>
              )}
              {stage.label}
            </button>
            {i < STAGES.length - 1 && (
              <div
                className={`h-px w-4 ${isDone ? "bg-green-300" : "bg-gray-200"}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function TutorialHeader() {
  const { skipTutorial } = useTutorial();

  return (
    <header data-tutorial-header className="relative z-110 flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6">
      <div className="flex items-center gap-6">
        <span className="text-lg font-semibold text-gray-900">
          PITCH Tutorial
        </span>
        <StageProgress />
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={skipTutorial}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        >
          Exit Tutorial
        </button>
      </div>
    </header>
  );
}

export default function TutorialLayout() {
  return (
    <TutorialProvider>
      <div className="flex h-screen flex-col bg-gray-50">
        <TutorialHeader />
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
      <TutorialOverlay />
    </TutorialProvider>
  );
}
