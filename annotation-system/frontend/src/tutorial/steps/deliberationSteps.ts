import type { TutorialStep } from "./types";

export const deliberationSteps: TutorialStep[] = [
  {
    id: "delib-purpose",
    stage: "deliberation",
    target: "delib-top-bar",
    instruction:
      "This is the **Review & Revise** stage. Here you'll see how your peers placed the same message and compare their reasoning with yours. You can then revise your annotation if you find their arguments compelling — or keep your original if you still believe it's correct.",
    position: "bottom",
    action: "observe",
    advanceOn: "click-target",
  },
  {
    id: "delib-intro",
    stage: "deliberation",
    target: "peer-overlays",
    instruction:
      "The colored bars show where **other participants** placed this message. Each color represents a different person's placement window.",
    position: "bottom",
    action: "observe",
    advanceOn: "click-target",
  },
  {
    id: "delib-peer-cards",
    stage: "deliberation",
    target: "peer-cards-panel",
    instruction:
      "Here you can see each peer's reasoning — their chosen placement, best turn, importance rating, and rationale.",
    position: "left",
    action: "observe",
    advanceOn: "click-target",
  },
  {
    id: "delib-own-annotation",
    stage: "deliberation",
    target: "own-annotation-card",
    instruction:
      "This is **your** original placement. Compare it with what others chose. You can revise if you find their reasoning compelling.",
    position: "left",
    action: "observe",
    advanceOn: "click-target",
  },
  {
    id: "delib-save-revision",
    stage: "deliberation",
    target: "save-revision-btn",
    instruction:
      "Click **Save Revision** to keep or update your annotation. Don't feel pressured to change — only revise if you genuinely agree.",
    position: "top",
    action: "click",
    advanceOn: "click-target",
  },
  // Ranking review steps
  {
    id: "delib-ranking-intro",
    stage: "deliberation",
    target: "ranking-review-header",
    instruction:
      "After reviewing individual placements, you'll also review the **overall ranking**. Here you compare how you ranked the messages against your peers' rankings.",
    position: "bottom",
    action: "observe",
    advanceOn: "click-target",
  },
  {
    id: "delib-ranking-legend",
    stage: "deliberation",
    target: "ranking-review-legend",
    instruction:
      "The colored badges show each person's rank for that item. Your original ranking is in **gray** and your peers' rankings are color-coded.",
    position: "bottom",
    action: "observe",
    advanceOn: "click-target",
  },
  {
    id: "delib-ranking-reorder",
    stage: "deliberation",
    target: "ranking-review-move-up",
    instruction:
      "You can reorder items if you've changed your mind after seeing peers' rankings. Try clicking the **up arrow** to move this item up.",
    position: "left",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "delib-ranking-save",
    stage: "deliberation",
    target: "ranking-review-save-btn",
    instruction:
      "Click **Save ranking & complete** to finalize your revised ranking and finish the review stage.",
    position: "top",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "delib-complete",
    stage: "deliberation",
    target: "tutorial-complete-btn",
    instruction:
      "You've completed the tutorial! You now know the full PITCH workflow. Click to finish.",
    position: "top",
    action: "click",
    advanceOn: "click-target",
  },
];
