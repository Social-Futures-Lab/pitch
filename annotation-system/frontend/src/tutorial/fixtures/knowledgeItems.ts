export interface TutorialKnowledgeItem {
  id: string;
  author: string;
  ideal_response: string;
  contribution_type: string;
  pertinence: number;
  window_start: number;
  window_end: number;
  best_turn: number;
  sources: TutorialSource[];
}

export interface TutorialSource {
  title: string;
  url: string;
  type: "scholar" | "web" | "manual";
}

/** The knowledge item the user will create during the construction tutorial */
export const CONSTRUCTION_ITEM: TutorialKnowledgeItem = {
  id: "tutorial-item-1",
  author: "You",
  ideal_response:
    "The Rattlesnake Ledge trail is one of the most popular hikes near Seattle — it's about 40 minutes from the city, 4 miles round trip with 1,160 ft elevation gain, and the ledge at the top has panoramic views of Rattlesnake Lake and the surrounding Cascades. It gets crowded on weekends so arriving early (before 9am) is recommended.",
  contribution_type: "Heads-up",
  pertinence: 0.5,
  window_start: 3,
  window_end: 7,
  best_turn: 5,
  sources: [
    {
      title: "Washington Trails Association - Rattlesnake Ledge",
      url: "https://www.wta.org/go-hiking/hikes/rattle-snake-ledge",
      type: "web",
    },
    {
      title: "AllTrails - Rattlesnake Ledge Trail",
      url: "https://www.alltrails.com/trail/us/washington/rattlesnake-ledge",
      type: "manual",
    },
  ],
};

/** Hardcoded placement targets for the construction tutorial */
export const CONSTRUCTION_TARGETS = {
  windowStart: 3,
  windowEnd: 7,
  bestTurn: 5,
  contributionType: "Heads-up",
  pertinence: 0.5,
};

/** Hardcoded source search for the construction tutorial */
export const TUTORIAL_SOURCE_SEARCH = {
  query: "best day hikes near Seattle",
  result: {
    title: "Washington Trails Association - Rattlesnake Ledge",
    url: "https://www.wta.org/go-hiking/hikes/rattle-snake-ledge",
    snippet:
      "Rattlesnake Ledge is a 4.0 mile out and back trail near North Bend, WA. The trail offers stunning views of Rattlesnake Lake and the surrounding Cascade foothills...",
    type: "web" as const,
  },
};

export const TUTORIAL_MANUAL_SOURCE = {
  title: "AllTrails - Rattlesnake Ledge Trail",
  url: "https://www.alltrails.com/trail/us/washington/rattlesnake-ledge",
};

/** Knowledge item from a "peer" used in the cross-annotation tutorial */
export const ANNOTATION_PEER_ITEM: TutorialKnowledgeItem = {
  id: "tutorial-peer-item-1",
  author: "Jordan",
  ideal_response:
    "Seattle's average summer temperatures (June–August) are 60–75°F with less than 1 inch of rain per month — it's actually drier than most East Coast cities in summer. The 'rainy Seattle' reputation comes from the frequent light drizzle October through April.",
  contribution_type: "Suggestion",
  pertinence: 0.75,
  window_start: 1,
  window_end: 5,
  best_turn: 3,
  sources: [
    {
      title: "US Climate Data - Seattle, Washington",
      url: "https://www.usclimatedata.com/climate/seattle/washington/united-states/uswa0395",
      type: "web",
    },
  ],
};

/** Target placements for the annotation tutorial */
export const ANNOTATION_TARGETS = {
  windowStart: 1,
  windowEnd: 5,
  bestTurn: 3,
  pertinence: 0.75,
};
