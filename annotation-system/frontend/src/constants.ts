export const PERTINENCE_LEVELS = [
  { value: 0.0, title: "Nice to have", description: "adds useful context, but the conversation would be fine without it" },
  { value: 0.25, title: "Somewhat important", description: "helps the conversation, but probably would not change its direction" },
  { value: 0.5, title: "Important", description: "meaningfully improves the conversation or fills a clear gap" },
  { value: 0.75, title: "Very important", description: "could shift how the group thinks, decides, or continues" },
  { value: 1.0, title: "Essential", description: "could prevent a major misunderstanding or change the direction of the conversation" },
];

export const PERTINENCE_LABELS: Record<number, string> = {
  0.0: "Nice to have",
  0.25: "Somewhat important",
  0.5: "Important",
  0.75: "Very important",
  1.0: "Essential",
};
