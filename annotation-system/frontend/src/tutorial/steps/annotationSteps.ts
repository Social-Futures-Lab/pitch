import type { TutorialStep } from "./types";

export const annotationSteps: TutorialStep[] = [
  {
    id: "annot-intro",
    stage: "annotation",
    target: "peer-item-card",
    instruction:
      "This is a **Proposed Inserted Message** created by another participant. Your job is to decide where it fits best in the conversation and rate its importance.",
    position: "left",
    action: "observe",
    advanceOn: "click-target",
  },
  {
    id: "annot-should-not-appear",
    stage: "annotation",
    target: "should-not-appear-btn",
    instruction:
      "If you believe a message would **not** be useful at any point in the conversation, click **Should not appear**. Let's try it — click it now.",
    position: "left",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "annot-should-not-appear-explain",
    stage: "annotation",
    target: "should-not-appear-btn",
    instruction:
      "When selected, you skip placement entirely and mark the message as not belonging in the conversation. This is useful for messages that are irrelevant or unhelpful. Since this message **is** useful, click it again to deselect.",
    position: "left",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "annot-start-turn",
    stage: "annotation",
    target: "turn-1",
    instruction:
      "Click this turn to set the **first relevant** position — the earliest point where this message would make sense.",
    position: "right",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "annot-end-turn",
    stage: "annotation",
    target: "turn-5",
    instruction:
      "Click this turn to set the **last useful** position — the latest point where inserting would still help.",
    position: "right",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "annot-best-turn",
    stage: "annotation",
    target: "turn-3",
    instruction:
      "Click this turn to set the **best placement** — the ideal moment to insert this message.",
    position: "right",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "annot-importance",
    stage: "annotation",
    target: "pertinence-very-important",
    instruction:
      'Rate how important this message is. Click **"Very important"** — the weather data could shift how the group plans the timing of their trip.',
    position: "left",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "annot-save",
    stage: "annotation",
    target: "save-annotation-btn",
    instruction:
      "Click **Save Annotation** to submit your placement and rating for this item.",
    position: "top",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "annot-next",
    stage: "annotation",
    target: "annot-next-btn",
    instruction:
      "Your annotation has been saved. Notice the progress bar updated — you've completed 1 of 4 items. Click **Next** to move to the next item.",
    position: "bottom",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "annot-item2-next",
    stage: "annotation",
    target: "annot-item2-next-btn",
    instruction:
      "In the real study you'd annotate each item one by one. This item is already completed for the tutorial. After all items are annotated, you'll proceed to ranking. Click **Next** to continue.",
    position: "bottom",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "annot-ranking-intro",
    stage: "annotation",
    target: "ranking-panel",
    instruction:
      "After placing all items, you **rank** them by value — if only one message could appear, which would be most valuable? Items marked \"should not appear\" are separated at the bottom. Use the arrows or drag to reorder.",
    position: "left",
    action: "observe",
    advanceOn: "click-target",
  },
  {
    id: "annot-ranking-swap",
    stage: "annotation",
    target: "ranking-move-up-btn",
    instruction:
      "Try reordering: click the **up arrow** to move this item up in the ranking. In the real study you'd drag to reorder.",
    position: "left",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "annot-ranking-save",
    stage: "annotation",
    target: "save-ranking-btn",
    instruction:
      "Click **Submit ranking** to finalize your ordering and proceed to the next stage.",
    position: "top",
    action: "click",
    advanceOn: "click-target",
  },
];
