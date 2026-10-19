import type { TutorialStep } from "./types";

export const conversationSteps: TutorialStep[] = [
  {
    id: "conv-prompt",
    stage: "conversation",
    target: "prompt-banner",
    instruction:
      "This is the **discussion prompt**. Your group's conversation should be centered around this topic. Everyone sees the same prompt and should use it as a guide for the discussion.",
    position: "bottom",
    action: "observe",
    advanceOn: "click-target",
  },
  {
    id: "conv-intro",
    stage: "conversation",
    target: "conversation-messages",
    instruction:
      "This is the message area. In the real study, you'll chat live with your group for ~25 minutes. Here, we'll show a sped-up replay.",
    position: "right",
    action: "observe",
    advanceOn: "click-target",
  },
  {
    id: "conv-watch",
    stage: "conversation",
    target: "conversation-messages",
    instruction:
      "Watch the conversation unfold. Messages will appear one by one, just like a real group chat.",
    position: "right",
    action: "wait",
    advanceOn: "custom",
  },
  {
    id: "conv-bookmark",
    stage: "conversation",
    target: "bookmark-btn-6",
    instruction:
      "**Bookmark** moments where outside knowledge could help the conversation. Hover over messages to reveal the bookmark icon, then click it to mark the turn.",
    position: "left",
    action: "click",
    advanceOn: "click-target",
    highlightPadding: 4,
  },
  {
    id: "conv-end",
    stage: "conversation",
    target: "end-conversation-btn",
    instruction:
      "In the real study, conversations last ~25 minutes. When it's time, any participant can click **End conversation** to proceed to the next stage.",
    position: "left",
    action: "click",
    advanceOn: "click-target",
  },
];
