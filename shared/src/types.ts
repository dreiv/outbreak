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

export interface PlayerCardCity {
  type: "city";
  city: string;
}
export interface PlayerCardEpidemic {
  type: "epidemic";
}
export type PlayerCard = (PlayerCardCity | PlayerCardEpidemic) & {
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
  | { type: "end-turn" };

export type ClientMessage =
  | { type: "join_room"; roomId: string; playerName: string; playerId?: string }
  | { type: "start_game"; roomId: string }
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
