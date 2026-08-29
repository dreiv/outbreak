import type {
  ClientMessage,
  EventId,
  GameState,
  PlayerAction,
  RegionId,
  ServerMessage,
} from "../../../shared/src/types";

export type {
  ClientMessage,
  EventId,
  GameState,
  PlayerAction,
  RegionId,
  ServerMessage,
};

export type ConnectionStatus = "connecting" | "open" | "closed";

export type Screen = "lobby" | "game";

/** Callback used by UI components to submit a validated player action. */
export type Dispatch = (action: PlayerAction) => void;

/** A pending event-card play awaiting parameter collection in a modal. */
export interface PendingEvent {
  cardUid: string;
  event: EventId;
}

/**
 * Imperative handle to the pan/zoom map. The controller owns the panzoom
 * instance for the lifetime of the game screen so the user's view survives
 * state re-renders.
 */
export interface MapController {
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  destroy: () => void;
}
