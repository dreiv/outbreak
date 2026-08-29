import type {
  GameState,
  PlayerAction,
  ServerMessage,
} from "../../../shared/src/types";
import { socket } from "../services/socket";
import { sound, unlockAudio } from "../services/sound";
import { runEffects } from "../components/effects";
import {
  STORAGE_KEYS,
  ERROR_TOAST_TTL_MS,
  AUTO_REJOIN_DELAY_MS,
} from "../constants";
import type { ConnectionStatus, Screen } from "../types";

/**
 * Central client-side state and the message/state handlers that mutate it.
 * Kept free of DOM rendering: it only owns data and the socket wiring, and
 * exposes a `subscribe` hook so the view layer can re-render on change.
 */

type RenderListener = () => void;

let screen: Screen = "lobby";
let gameState: GameState | null = null;
let myPlayerId: string | null = localStorage.getItem(STORAGE_KEYS.playerId);
let roomId: string | null = localStorage.getItem(STORAGE_KEYS.roomId);
let playerName: string = localStorage.getItem(STORAGE_KEYS.playerName) ?? "";
let errorMsg: string | null = null;
let errorToastTimer: number | null = null;
let connStatus: ConnectionStatus = "connecting";

const listeners = new Set<RenderListener>();

function notify(): void {
  listeners.forEach((l) => l());
}

export function subscribe(fn: RenderListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function dispatch(action: PlayerAction): void {
  if (!gameState || !myPlayerId) return;
  sound.action();
  socket.send({
    type: "player_action",
    roomId: gameState.roomId,
    playerId: myPlayerId,
    action,
  });
}

export function getGameState(): GameState | null {
  return gameState;
}

export function getMyPlayerId(): string | null {
  return myPlayerId;
}

export function getConnStatus(): ConnectionStatus {
  return connStatus;
}

export function getErrorMsg(): string | null {
  return errorMsg;
}

export function clearError(): void {
  errorMsg = null;
  if (errorToastTimer !== null) {
    window.clearTimeout(errorToastTimer);
    errorToastTimer = null;
  }
  notify();
}

/**
 * Persists the player's identity and room, then asks the server to join.
 * The server's `joined` message is what actually flips the screen to the game.
 */
export function joinRoom(name: string, room: string): void {
  playerName = name;
  roomId = room;
  localStorage.setItem(STORAGE_KEYS.playerName, name);
  localStorage.setItem(STORAGE_KEYS.roomId, room);
  errorMsg = null;
  socket.send({
    type: "join_room",
    roomId: room,
    playerName: name,
    playerId: myPlayerId ?? undefined,
  });
}

export function getScreen(): Screen {
  return screen;
}

export function getPlayerName(): string {
  return playerName;
}

export function getRoomId(): string | null {
  return roomId;
}

function handleServerMessage(msg: ServerMessage): void {
  let prevState: GameState | null = null;
  let didStateUpdate = false;

  if (msg.type === "joined") {
    myPlayerId = msg.playerId;
    roomId = msg.roomId;
    localStorage.setItem(STORAGE_KEYS.playerId, msg.playerId);
    localStorage.setItem(STORAGE_KEYS.roomId, msg.roomId);
    errorMsg = null;
  } else if (msg.type === "state_sync" || msg.type === "state_diff") {
    prevState = gameState;
    gameState = msg.state;
    screen = gameState.phase === "lobby" ? "lobby" : "game";
    didStateUpdate = true;
  } else if (msg.type === "error") {
    errorMsg = msg.message;
    if (errorToastTimer !== null) window.clearTimeout(errorToastTimer);
    errorToastTimer = window.setTimeout(() => {
      errorMsg = null;
      notify();
    }, ERROR_TOAST_TTL_MS);
  }

  notify();

  if (didStateUpdate && gameState && screen === "game") {
    const svg = document.getElementById("board-svg") as SVGSVGElement | null;
    const banner = document.getElementById("fx-banner") as HTMLElement | null;
    if (svg && banner) runEffects(svg, banner, prevState, gameState);
    if (prevState && prevState.phase === "playing" && gameState.phase === "won")
      sound.win();
    if (
      prevState &&
      prevState.phase === "playing" &&
      gameState.phase === "lost"
    )
      sound.lose();
  }
}

export function initAppState(): void {
  socket.onStatus((s) => {
    connStatus = s;
    notify();
  });

  socket.onMessage(handleServerMessage);

  // AudioContext needs a user gesture to start — grab the first one, anywhere.
  window.addEventListener("pointerdown", unlockAudio, { once: true });

  socket.connect();

  // Auto-rejoin if we have a persisted session.
  if (myPlayerId && roomId && playerName) {
    window.setTimeout(() => {
      socket.send({
        type: "join_room",
        roomId: roomId as string,
        playerName,
        playerId: myPlayerId ?? undefined,
      });
    }, AUTO_REJOIN_DELAY_MS);
  }
}
