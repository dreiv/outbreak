// ============================================================================
// Outbreak Protocol — shared types, imported by both server and client so
// message shapes cannot drift between them.
// ============================================================================

export type RegionId = 'azure' | 'crimson' | 'amber' | 'verdant';

export interface CityDef {
  id: string;
  name: string;
  region: RegionId;
  x: number; // 0-1000 svg coordinate space
  y: number; // 0-1000 svg coordinate space
  connections: string[]; // city ids
}

export type RoleId =
  | 'logistics-chief'   // may drive/ferry as a free action once per turn
  | 'field-medic'       // treats remove all cubes of a color, not just one
  | 'virologist'        // needs only 4 cards (not 5) of a color to cure
  | 'courier'           // share knowledge does not require being in the same city
  | 'liaison-officer'   // may give/take any card, not just the city-match card
  | 'archivist'         // hand limit is 8 instead of 7
  | 'quartermaster';    // building a research station costs no card

export interface RoleDef {
  id: RoleId;
  name: string;
  description: string;
}

export interface PlayerCardCity {
  type: 'city';
  city: string; // city id
}
export interface PlayerCardEpidemic {
  type: 'epidemic';
}
export type PlayerCard = (PlayerCardCity | PlayerCardEpidemic) & { uid: string };

export interface Player {
  id: string;
  name: string;
  role: RoleId | null;
  location: string; // city id
  hand: PlayerCard[];
  connected: boolean;
}

export type DiseaseState = 'active' | 'cured' | 'eradicated';

export interface GameState {
  roomId: string;
  phase: 'lobby' | 'playing' | 'won' | 'lost';
  players: Player[];
  turnOrder: string[]; // player ids
  currentPlayerIndex: number;
  actionsRemaining: number;
  cityCubes: Record<string, Partial<Record<RegionId, number>>>;
  cubesRemaining: Record<RegionId, number>;
  diseaseState: Record<RegionId, DiseaseState>;
  researchStations: string[]; // city ids, first is always the starting hub
  infectionRate: number; // cities infected per infection step
  infectionRateTrack: number[]; // e.g. [2,2,2,3,3,4,4]
  infectionRateIndex: number;
  outbreakCounter: number;
  outbreakMax: number;
  playerDeckSize: number;
  playerDiscard: PlayerCard[];
  infectionDeckSize: number;
  infectionDiscard: string[]; // city ids
  log: LogEntry[];
  lossReason?: string;
  pendingDiscard?: { playerId: string; mustDiscardTo: number } | null;
  epidemicsResolved: number;
}

export interface LogEntry {
  id: string;
  ts: number;
  text: string;
}

// ---------------------------------------------------------------------------
// Actions a player can request. Server validates & applies; never trust
// client-side resolution beyond optimistic UI feedback.
// ---------------------------------------------------------------------------

export type PlayerAction =
  | { type: 'drive'; to: string }
  | { type: 'direct-flight'; to: string }
  | { type: 'charter-flight'; to: string }
  | { type: 'shuttle-flight'; to: string }
  | { type: 'treat'; region: RegionId }
  | { type: 'build-station' }
  | { type: 'share-knowledge'; withPlayerId: string; cityCard: string; direction: 'give' | 'take' }
  | { type: 'discover-cure'; region: RegionId; cardUids: string[] }
  | { type: 'discard'; cardUid: string }
  | { type: 'end-turn' };

// ---------------------------------------------------------------------------
// WebSocket message envelopes
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: 'join_room'; roomId: string; playerName: string; playerId?: string }
  | { type: 'start_game'; roomId: string }
  | { type: 'player_action'; roomId: string; playerId: string; action: PlayerAction }
  | { type: 'ping' };

export type ServerMessage =
  | { type: 'state_sync'; state: GameState; you: { playerId: string } }
  | { type: 'state_diff'; state: GameState }
  | { type: 'joined'; playerId: string; roomId: string }
  | { type: 'error'; message: string }
  | { type: 'pong' };

export const REGION_META: Record<RegionId, { label: string; color: string }> = {
  azure: { label: 'Azure Strain', color: '#3b82f6' },
  crimson: { label: 'Crimson Strain', color: '#ef4444' },
  amber: { label: 'Amber Strain', color: '#f59e0b' },
  verdant: { label: 'Verdant Strain', color: '#22c55e' },
};

export const ROLES: RoleDef[] = [
  { id: 'logistics-chief', name: 'Logistics Chief', description: 'Once per turn, drive/ferry to an adjacent city as a free action (does not consume an action).' },
  { id: 'field-medic', name: 'Field Medic', description: 'Treating a disease removes all cubes of that color from the city, not just one.' },
  { id: 'virologist', name: 'Virologist', description: 'Only needs 4 city cards of a color (instead of 5) to discover a cure.' },
  { id: 'courier', name: 'Courier', description: 'Can share knowledge with another player regardless of location.' },
  { id: 'liaison-officer', name: 'Liaison Officer', description: 'May give or take any city card during share knowledge, not just the card matching current city.' },
  { id: 'archivist', name: 'Archivist', description: 'Hand limit is 8 cards instead of 7 before must-discard.' },
  { id: 'quartermaster', name: 'Quartermaster', description: 'Builds research stations without discarding a card.' },
];

export const HAND_LIMIT = 7;
export const STARTING_HUB = 'atlantis-hub'; // overridden by boardData starting city
