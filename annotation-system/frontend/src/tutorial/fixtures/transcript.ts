export interface TutorialTurn {
  id: number;
  turn_number: number;
  speaker: string;
  content: string;
  timestamp: string;
}

export const TUTORIAL_SPEAKERS = ["Alex", "Jordan", "Sam"];

export const TUTORIAL_TRANSCRIPT: TutorialTurn[] = [
  {
    id: 1,
    turn_number: 1,
    speaker: "Alex",
    content:
      "So we're planning a group trip to Seattle! I've never been — what should we prioritize? I'm thinking we need a mix of outdoors and food.",
    timestamp: "2025-01-15T10:00:00Z",
  },
  {
    id: 2,
    turn_number: 2,
    speaker: "Jordan",
    content:
      "Definitely Pike Place Market — that's a must. But honestly I think the best part of Seattle is the neighborhoods. Capitol Hill, Fremont, Ballard... each has its own vibe.",
    timestamp: "2025-01-15T10:00:45Z",
  },
  {
    id: 3,
    turn_number: 3,
    speaker: "Sam",
    content:
      "I'd vote for at least one solid hike. I've heard there are trails within an hour of the city that have incredible views of Mount Rainier. Maybe we could do a day trip?",
    timestamp: "2025-01-15T10:01:30Z",
  },
  {
    id: 4,
    turn_number: 4,
    speaker: "Alex",
    content:
      "A day hike sounds great. What about timing though? I know Seattle has a reputation for rain. Should we plan around the weather or just bring layers and deal with it?",
    timestamp: "2025-01-15T10:02:15Z",
  },
  {
    id: 5,
    turn_number: 5,
    speaker: "Jordan",
    content:
      "The rain thing is kind of a myth — it doesn't rain as much as people think, it's just overcast a lot. Summer is actually pretty dry. When are we thinking of going?",
    timestamp: "2025-01-15T10:03:00Z",
  },
  {
    id: 6,
    turn_number: 6,
    speaker: "Sam",
    content:
      "I was thinking late July or August. Also, should we look into the ferry to Bainbridge Island? I've heard the ride itself has amazing skyline views and it's only 35 minutes.",
    timestamp: "2025-01-15T10:03:45Z",
  },
  {
    id: 7,
    turn_number: 7,
    speaker: "Alex",
    content:
      "Oh that sounds awesome! What about accommodation? Are we doing an Airbnb together or separate hotels? I feel like a shared house could be fun but I don't know which area to stay in.",
    timestamp: "2025-01-15T10:04:30Z",
  },
  {
    id: 8,
    turn_number: 8,
    speaker: "Jordan",
    content:
      "I'd say Capitol Hill or Fremont for a shared Airbnb — both are walkable, close to restaurants, and have good transit connections. Downtown is convenient but kind of soulless.",
    timestamp: "2025-01-15T10:05:15Z",
  },
  {
    id: 9,
    turn_number: 9,
    speaker: "Sam",
    content:
      "Agreed on Capitol Hill. Also for food — should we make any restaurant reservations in advance or just wing it? I know some popular spots book up weeks ahead.",
    timestamp: "2025-01-15T10:06:00Z",
  },
  {
    id: 10,
    turn_number: 10,
    speaker: "Alex",
    content:
      "Let's reserve a couple of the harder-to-get spots and leave the rest flexible. So we're looking at: Pike Place, a hike, the ferry, Capitol Hill base, and a few key restaurants. That's a solid start!",
    timestamp: "2025-01-15T10:06:45Z",
  },
];

/** The turn to bookmark during the conversation tutorial */
export const BOOKMARK_TARGET_TURN = 6;
