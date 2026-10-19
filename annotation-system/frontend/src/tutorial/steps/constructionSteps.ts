import type { TutorialStep } from "./types";

export const constructionSteps: TutorialStep[] = [
  {
    id: "const-intro",
    stage: "construction",
    target: "construction-transcript",
    instruction:
      "This is your group's conversation. Now you'll create a new message that would have helped the discussion. Let's start by selecting where it fits.",
    position: "right",
    action: "observe",
    advanceOn: "click-target",
  },
  {
    id: "const-placement-intro",
    stage: "construction",
    target: "placement-window-section",
    instruction:
      "This is the **placement window** section. You'll set three markers to define where your message fits in the conversation: the earliest relevant point, the latest useful point, and the single best spot.",
    position: "left",
    action: "observe",
    advanceOn: "click-target",
  },
  {
    id: "const-select-start-btn",
    stage: "construction",
    target: "select-start-btn",
    instruction:
      "Click **Select** to begin choosing the first relevant turn in the transcript.",
    position: "left",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "const-start-turn",
    stage: "construction",
    target: "turn-3",
    instruction:
      "Click this turn to set the **first relevant** position — the earliest point where your message would make sense.",
    position: "right",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "const-select-end-btn",
    stage: "construction",
    target: "select-end-btn",
    instruction:
      "Click **Select** to begin choosing the last useful turn.",
    position: "left",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "const-end-turn",
    stage: "construction",
    target: "turn-7",
    instruction:
      "Click this turn to set the **last useful** position — the latest point where your message is still relevant.",
    position: "right",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "const-select-best-btn",
    stage: "construction",
    target: "select-best-btn",
    instruction:
      "Click **Select** to begin choosing the best placement turn.",
    position: "left",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "const-best-turn",
    stage: "construction",
    target: "turn-5",
    instruction:
      "Click this turn to set the **best placement** — the single best spot to insert your message.",
    position: "right",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "const-contribution-type",
    stage: "construction",
    target: "intention-tag-heads-up",
    instruction:
      "These are AI-suggested directions for your message. Click **\"Share: specific trail recommendations near Seattle\"** — we'll create a message that shares relevant information with the group.",
    position: "bottom",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "const-source-search",
    stage: "construction",
    target: "source-search-btn",
    instruction:
      "Search for sources to support your message. The search query is pre-filled. Click **Search** to find sources.",
    position: "bottom",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "const-source-select",
    stage: "construction",
    target: "source-result-0",
    instruction:
      "Click this result to add it as a source for your knowledge item.",
    position: "bottom",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "const-manual-source-tab",
    stage: "construction",
    target: "manual-source-tab",
    instruction:
      "You can also add sources manually. Click the **Manual** tab.",
    position: "bottom",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "const-manual-source-submit",
    stage: "construction",
    target: "manual-source-submit",
    instruction:
      'Enter the source URL: **https://www.alltrails.com/trail/us/washington/rattlesnake-ledge** and title: **"AllTrails - Rattlesnake Ledge Trail"**, then click Submit.',
    position: "bottom",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "const-importance",
    stage: "construction",
    target: "pertinence-important",
    instruction:
      'Rate how important this contribution would be. Click **"Important"** — the information is useful but the conversation could proceed without it.',
    position: "left",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "const-message-intro",
    stage: "construction",
    target: "message-creator",
    instruction:
      "This is where you create the message to insert into the conversation. You can **Generate with AI** (recommended) or switch to **Write manually**. Let's try generating one.",
    position: "left",
    action: "observe",
    advanceOn: "click-target",
  },
  {
    id: "const-generate-btn",
    stage: "construction",
    target: "generate-message-btn",
    instruction:
      "Click **Generate Message** to have AI draft a message based on your placement, direction, and sources.",
    position: "left",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "const-accept-ai",
    stage: "construction",
    target: "accept-ai-btn",
    instruction:
      "The AI has drafted a message. Review it — if it looks good, click **Accept** to use it. You can always edit it afterwards.",
    position: "left",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "const-review",
    stage: "construction",
    target: "review-place-btn",
    instruction:
      "When all steps are complete, click **Review & Place** to preview your knowledge item before saving.",
    position: "top",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "const-preview-transcript",
    stage: "construction",
    target: "review-transcript",
    instruction:
      "This is a preview of your message inserted into the conversation. Check that it reads naturally at this position and makes sense in context.",
    position: "right",
    action: "observe",
    advanceOn: "click-target",
  },
  {
    id: "const-preview-controls",
    stage: "construction",
    target: "review-placement-controls",
    instruction:
      "These controls show your current placement. If the message doesn't fit well, click **Change** on any marker to adjust it. Let's try adjusting the **Best** placement.",
    position: "top",
    action: "observe",
    advanceOn: "click-target",
  },
  {
    id: "const-change-best",
    stage: "construction",
    target: "review-change-best-btn",
    instruction:
      "Click **Change** to select a different best placement turn.",
    position: "top",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "const-adjust-best-turn",
    stage: "construction",
    target: "review-turn-4",
    instruction:
      "Click turn #4 to move your message earlier in the conversation. Notice how the preview updates.",
    position: "right",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "const-confirm",
    stage: "construction",
    target: "confirm-save-btn",
    instruction:
      "Your placement has been adjusted. When you're satisfied, click **Confirm & Save** to finalize.",
    position: "top",
    action: "click",
    advanceOn: "click-target",
  },
  {
    id: "const-suggestions",
    stage: "construction",
    target: "next-suggestions",
    instruction:
      "After saving, the system generates **suggested directions** for additional messages you could create. In the real study, you'd pick one of these and repeat the process to create more messages. You can also start a blank message from scratch.",
    position: "left",
    action: "observe",
    advanceOn: "click-target",
  },
  {
    id: "const-advance",
    stage: "construction",
    target: "advance-stage-btn",
    instruction:
      "For this tutorial, we'll move on. Click **Done. Advance to Annotation.** to proceed to the next stage.",
    position: "top",
    action: "click",
    advanceOn: "click-target",
  },
];
