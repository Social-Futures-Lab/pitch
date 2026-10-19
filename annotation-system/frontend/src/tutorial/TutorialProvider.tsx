import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import type { TutorialStage, TutorialStep } from "./steps/types";

const STAGE_ORDER: TutorialStage[] = [
  "conversation",
  "construction",
  "annotation",
  "deliberation",
];

const STAGE_ROUTES: Record<TutorialStage, string> = {
  conversation: "/tutorial/interactive/conversation",
  construction: "/tutorial/interactive/construction",
  annotation: "/tutorial/interactive/annotation",
  deliberation: "/tutorial/interactive/deliberation",
};

interface TutorialContextValue {
  currentStage: TutorialStage;
  currentStepIndex: number;
  currentStep: TutorialStep | null;
  steps: TutorialStep[];
  tutorialActive: boolean;
  advanceStep: () => void;
  goToStage: (stage: TutorialStage) => void;
  setSteps: (steps: TutorialStep[]) => void;
  skipTutorial: () => void;
  completeTutorial: () => void;
}

const TutorialContext = createContext<TutorialContextValue | null>(null);

export function useTutorial() {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error("useTutorial must be used within TutorialProvider");
  return ctx;
}

interface TutorialProviderProps {
  children: ReactNode;
}

export function TutorialProvider({ children }: TutorialProviderProps) {
  const navigate = useNavigate();

  const [currentStage, setCurrentStage] = useState<TutorialStage>(() => {
    const saved = localStorage.getItem("pitch-tutorial-current-stage");
    return (saved as TutorialStage) || "conversation";
  });

  const [currentStepIndex, setCurrentStepIndex] = useState<number>(() => {
    const saved = localStorage.getItem("pitch-tutorial-current-step");
    return saved ? parseInt(saved, 10) : 0;
  });

  const [steps, setStepsInternal] = useState<TutorialStep[]>([]);
  const [tutorialActive, setTutorialActive] = useState(true);
  const tutorialActiveRef = useRef(true);

  const stepsRef = useRef<TutorialStep[]>([]);

  const setSteps = useCallback((newSteps: TutorialStep[]) => {
    // Only reset step index if the steps actually changed (new page/stage)
    if (stepsRef.current !== newSteps) {
      stepsRef.current = newSteps;
      setStepsInternal(newSteps);
      setCurrentStepIndex(0);
    }
  }, []);

  useEffect(() => {
    if (tutorialActive) {
      localStorage.setItem("pitch-tutorial-current-stage", currentStage);
    }
  }, [currentStage, tutorialActive]);

  useEffect(() => {
    if (tutorialActive) {
      localStorage.setItem(
        "pitch-tutorial-current-step",
        String(currentStepIndex),
      );
    }
  }, [currentStepIndex, tutorialActive]);

  const currentStep =
    steps.length > 0 && currentStepIndex < steps.length
      ? steps[currentStepIndex]
      : null;

  const advanceStep = useCallback(() => {
    if (!tutorialActiveRef.current) return;
    const next = currentStepIndex + 1;
    if (next >= steps.length) {
      const stageIdx = STAGE_ORDER.indexOf(currentStage);
      if (stageIdx < STAGE_ORDER.length - 1) {
        const nextStage = STAGE_ORDER[stageIdx + 1];
        setCurrentStage(nextStage);
        setCurrentStepIndex(0);
        navigate(STAGE_ROUTES[nextStage]);
      } else {
        setTutorialActive(false);
        tutorialActiveRef.current = false;
        localStorage.setItem("pitch-tutorial-completed", "true");
      }
    } else {
      setCurrentStepIndex(next);
    }
  }, [currentStepIndex, steps.length, currentStage, navigate]);

  const goToStage = useCallback(
    (stage: TutorialStage) => {
      setCurrentStage(stage);
      setCurrentStepIndex(0);
      navigate(STAGE_ROUTES[stage]);
    },
    [navigate],
  );

  const skipTutorial = useCallback(() => {
    tutorialActiveRef.current = false;
    setTutorialActive(false);
    localStorage.removeItem("pitch-tutorial-current-stage");
    localStorage.removeItem("pitch-tutorial-current-step");
    navigate("/my-groups", { replace: true });
  }, [navigate]);

  const completeTutorial = useCallback(() => {
    tutorialActiveRef.current = false;
    setTutorialActive(false);
    localStorage.setItem("pitch-tutorial-completed", "true");
    localStorage.removeItem("pitch-tutorial-current-stage");
    localStorage.removeItem("pitch-tutorial-current-step");
  }, []);

  return (
    <TutorialContext.Provider
      value={{
        currentStage,
        currentStepIndex,
        currentStep,
        steps,
        tutorialActive,
        advanceStep,
        goToStage,
        setSteps,
        skipTutorial,
        completeTutorial,
      }}
    >
      {children}
    </TutorialContext.Provider>
  );
}
