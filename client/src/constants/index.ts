import type { RegionId } from "../../../shared/src/types";

/** localStorage keys for the persisted session. */
export const STORAGE_KEYS = {
  playerId: "op_player_id",
  roomId: "op_room_id",
  playerName: "op_player_name",
  muted: "op_muted",
} as const;

/** Milliseconds before a rejected-action toast auto-dismisses. */
export const ERROR_TOAST_TTL_MS = 6000;

/** Milliseconds before an auto-rejoin fires after the socket opens. */
export const AUTO_REJOIN_DELAY_MS = 300;

/**
 * Player pawn colors, assigned by seat index. Kept here (not in shared)
 * because they are purely presentational.
 */
export const PLAYER_COLORS = [
  "#f472b6",
  "#facc15",
  "#60a5fa",
  "#34d399",
] as const;

/**
 * Region display metadata. The canonical colors live in shared `REGION_META`
 * (server uses them for state); this mirrors them for the legend so the
 * client never hardcodes hex in markup.
 */
export const REGION_LEGEND: Record<RegionId, { label: string; color: string }> =
  {
    azure: { label: "Azure", color: "#3b82f6" },
    crimson: { label: "Crimson", color: "#ef4444" },
    amber: { label: "Amber", color: "#f59e0b" },
    verdant: { label: "Verdant", color: "#22c55e" },
  };

/** Number of action pips rendered in the turn banner. */
export const ACTIONS_PER_TURN = 4;

/**
 * Maximum research stations buildable in a game (matches the physical game's
 * six station tokens). Used only for the sidebar counter display.
 */
export const RESEARCH_STATION_MAX = 6;

/** How many log lines the sidebar keeps visible. */
export const LOG_VISIBLE_ENTRIES = 40;

/** City popup clamping so it never overflows the map viewport. */
export const POPUP_OFFSET = 14;
export const POPUP_MIN_WIDTH = 240;
export const POPUP_MIN_HEIGHT = 260;
