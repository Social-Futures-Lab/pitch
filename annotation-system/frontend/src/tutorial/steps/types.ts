export type TutorialStage =
  | "conversation"
  | "construction"
  | "annotation"
  | "deliberation";

export interface TutorialStep {
  id: string;
  stage: TutorialStage;
  /** CSS selector or data-tutorial attribute value to spotlight */
  target: string;
  /** Instruction text shown in the bubble (supports markdown-like bold with **text**) */
  instruction: string;
  /** Where to position the instruction bubble relative to the target */
  position: "top" | "bottom" | "left" | "right";
  /** What the user should do at this step */
  action: "click" | "observe" | "input" | "wait";
  /** What triggers advancement to the next step */
  advanceOn: "click-target" | "timeout" | "custom";
  /** Timeout in ms (for "wait"/"observe" actions with advanceOn: "timeout") */
  timeoutMs?: number;
  /** Extra padding around the spotlight cutout in px */
  highlightPadding?: number;
}
