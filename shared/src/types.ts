// Shared types imported by both server and client so message shapes can't drift.

export type RegionId = "azure" | "crimson" | "amber" | "verdant";

export interface CityDef {
  id: string;
  name: string;
  region: RegionId;
  lat: number;
  lon: number;
  x: number; // equirectangular projection of lat/lon (see boardData.ts)
  y: number;
  major: boolean; // shown at low zoom; others reveal on zoom-in
  connections: string[];
}

export type RoleId =
  | "logistics-chief"
  | "field-medic"
  | "virologist"
  | "courier"
  | "liaison-officer"
  | "archivist"
  | "quartermaster";

export interface RoleDef {
  id: RoleId;
  name: string;
  description: string;
}

export type EventId =
  | "government-grant"
  | "airlift"
  | "forecast"
  | "resilient-population"
  | "one-quiet-night";

export interface EventDef {
  id: EventId;
  name: string;
  description: string;
}

// One copy of each — matches the real game's 5 Event cards, mixed into the
// player deck alongside city cards (and, like city cards, can be dealt into
// a starting hand or drawn later).
export const EVENTS: EventDef[] = [
  {
    id: "government-grant",
    name: "Government Grant",
    description: "Build a research station in any city, no card required.",
  },
  {
    id: "airlift",
    name: "Airlift",
    description: "Move any player to any city.",
  },
  {
    id: "forecast",
    name: "Forecast",
    description:
      "Look at the top 6 cards of the Infection Deck and rearrange them in any order.",
  },
  {
    id: "resilient-population",
    name: "Resilient Population",
    description:
      "Remove any one card in the Infection Discard Pile from the game.",
  },
  {
    id: "one-quiet-night",
    name: "One Quiet Night",
    description: "Skip the next infection step entirely.",
  },
];

export interface PlayerCardCity {
  type: "city";
  city: string;
}
export interface PlayerCardEpidemic {
  type: "epidemic";
}
export interface PlayerCardEvent {
  type: "event";
  event: EventId;
}
export type PlayerCard = (
  | PlayerCardCity
  | PlayerCardEpidemic
  | PlayerCardEvent
) & {
  uid: string;
};

export interface Player {
  id: string;
  name: string;
  role: RoleId | null;
  location: string;
  hand: PlayerCard[];
  connected: boolean;
}

export type DiseaseState = "active" | "cured" | "eradicated";

// Epidemic card count selects difficulty, same as the physical game.
export interface DifficultyDef {
  epidemicCount: number;
  label: string;
  description: string;
}
export const DIFFICULTIES: DifficultyDef[] = [
  {
    epidemicCount: 4,
    label: "Introductory",
    description: "4 Epidemic cards — gentlest pace.",
  },
  {
    epidemicCount: 5,
    label: "Standard",
    description: "5 Epidemic cards — the default challenge.",
  },
  {
    epidemicCount: 6,
    label: "Heroic",
    description: "6 Epidemic cards — brutal escalation.",
  },
];
export const DEFAULT_EPIDEMIC_COUNT = 5;

export interface GameState {
  roomId: string;
  phase: "lobby" | "playing" | "won" | "lost";
  players: Player[];
  turnOrder: string[];
  currentPlayerIndex: number;
  actionsRemaining: number;
  turnsPlayed: number; // fully-completed turns (end-game summary)
  cityCubes: Record<string, Partial<Record<RegionId, number>>>;
  cubesRemaining: Record<RegionId, number>;
  diseaseState: Record<RegionId, DiseaseState>;
  researchStations: string[]; // first is the starting hub
  infectionRate: number;
  infectionRateTrack: number[];
  infectionRateIndex: number;
  outbreakCounter: number;
  outbreakMax: number;
  playerDeckSize: number;
  playerDiscard: PlayerCard[];
  infectionDeckSize: number;
  infectionDiscard: string[];
  log: LogEntry[];
  lossReason?: string;
  pendingDiscard?: { playerId: string; mustDiscardTo: number } | null;
  epidemicsResolved: number;
  epidemicCount: number; // chosen difficulty; editable in the lobby, fixed once playing
  oneQuietNightActive: boolean; // next infection step will be skipped
  // Forecast: top-of-deck cities revealed (draw order, [0] drawn next) for
  // the acting player to rearrange before it's applied.
  pendingForecast: { playerId: string; cities: string[] } | null;
  // How many of the active player's turn actions can be undone (0 = none).
  undoCount: number;
  // Bumped each time a finished game is restarted, so clients can detect it.
  restartNonce: number;
}

export interface LogEntry {
  id: string;
  ts: number;
  text: string;
  // Structured ref so the client needn't parse log text (avoids name-collision bugs).
  cityId?: string;
}

// ---------------------------------------------------------------------------
// Player actions. Server validates & applies; client is optimistic-only.
// ---------------------------------------------------------------------------

export type PlayerAction =
  | { type: "drive"; to: string }
  | { type: "direct-flight"; to: string }
  | { type: "charter-flight"; to: string }
  | { type: "shuttle-flight"; to: string }
  | { type: "treat"; region: RegionId }
  | { type: "build-station" }
  | {
      type: "share-knowledge";
      withPlayerId: string;
      cityCard: string;
      direction: "give" | "take";
    }
  | { type: "discover-cure"; region: RegionId; cardUids: string[] }
  | { type: "discard"; cardUid: string }
  | { type: "end-turn" }
  | { type: "undo" }
  | { type: "play-government-grant"; cardUid: string; city: string }
  | { type: "play-airlift"; cardUid: string; playerId: string; to: string }
  | { type: "play-forecast"; cardUid: string }
  | { type: "resolve-forecast"; order: string[] }
  | { type: "play-resilient-population"; cardUid: string; cityId: string }
  | { type: "play-one-quiet-night"; cardUid: string }
  | { type: "restart-game" };

export type ClientMessage =
  | { type: "join_room"; roomId: string; playerName: string; playerId?: string }
  | { type: "start_game"; roomId: string }
  | { type: "set_epidemic_count"; roomId: string; epidemicCount: number }
  | {
      type: "player_action";
      roomId: string;
      playerId: string;
      action: PlayerAction;
    }
  | { type: "ping" };

export type ServerMessage =
  | { type: "state_sync"; state: GameState; you: { playerId: string } }
  | { type: "state_diff"; state: GameState }
  | { type: "joined"; playerId: string; roomId: string }
  | { type: "error"; message: string }
  | { type: "pong" };

export const REGION_META: Record<RegionId, { label: string; color: string }> = {
  azure: { label: "Azure Strain", color: "#3b82f6" },
  crimson: { label: "Crimson Strain", color: "#ef4444" },
  amber: { label: "Amber Strain", color: "#f59e0b" },
  verdant: { label: "Verdant Strain", color: "#22c55e" },
};

export const ROLES: RoleDef[] = [
  {
    id: "logistics-chief",
    name: "Logistics Chief",
    description:
      "Once per turn, drive/ferry to an adjacent city as a free action (does not consume an action).",
  },
  {
    id: "field-medic",
    name: "Field Medic",
    description:
      "Treating a disease removes all cubes of that color from the city, not just one.",
  },
  {
    id: "virologist",
    name: "Virologist",
    description:
      "Only needs 4 city cards of a color (instead of 5) to discover a cure.",
  },
  {
    id: "courier",
    name: "Courier",
    description:
      "Can share knowledge with another player regardless of location.",
  },
  {
    id: "liaison-officer",
    name: "Liaison Officer",
    description:
      "May give or take any city card during share knowledge, not just the card matching current city.",
  },
  {
    id: "archivist",
    name: "Archivist",
    description: "Hand limit is 8 cards instead of 7 before must-discard.",
  },
  {
    id: "quartermaster",
    name: "Quartermaster",
    description: "Builds research stations without discarding a card.",
  },
];

export const HAND_LIMIT = 7;
export const STARTING_HUB = "atlantis-hub"; // overridden by boardData starting city
