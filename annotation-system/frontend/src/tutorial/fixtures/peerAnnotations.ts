export interface TutorialPeerAnnotation {
  annotator: string;
  color: string;
  window_start: number;
  window_end: number;
  best_turn: number;
  pertinence: number;
  rationale: string;
}

/** Peer annotations shown during the deliberation tutorial (excludes the user, who is Alex) */
export const DELIBERATION_PEER_ANNOTATIONS: TutorialPeerAnnotation[] = [
  {
    annotator: "Sam",
    color: "#f59e0b", // amber
    window_start: 2,
    window_end: 6,
    best_turn: 4,
    pertinence: 0.5,
    rationale:
      "The climate info fits best after Alex directly asks about rain and weather planning. It directly answers their question with concrete data.",
  },
  {
    annotator: "Jordan",
    color: "#10b981", // emerald
    window_start: 1,
    window_end: 5,
    best_turn: 3,
    pertinence: 0.75,
    rationale:
      "Placing the weather data before the rain discussion lets the group skip the speculation and plan with real information from the start.",
  },
];

/** The user's own annotation shown during deliberation */
export const DELIBERATION_OWN_ANNOTATION = {
  window_start: 1,
  window_end: 5,
  best_turn: 3,
  pertinence: 0.75,
};
