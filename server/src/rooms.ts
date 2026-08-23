import type { WebSocket } from 'ws';
import { Room, createRoom } from './gameState.js';

interface Sockets {
  [playerId: string]: WebSocket;
}

const rooms = new Map<string, Room>();
const sockets = new Map<string, Sockets>(); // roomId -> playerId -> ws

// Single source of truth for "player has been disconnected too long" grace
// timers, keyed by `${roomId}:${playerId}`. Previously this logic was
// duplicated: one timer lived here and did nothing but clear itself, and a
// second (functionally identical) timer lived in index.ts and only ever
// checked whether the *room* was empty — neither one ever acted on an
// individual disconnected seat, so a player who dropped mid-game held their
// seat (and could block the turn order) forever. Now there's one timer,
// and its callback (registered by index.ts via scheduleGraceExpiry) is what
// actually frees the seat / unsticks the game.
const graceTimers = new Map<string, NodeJS.Timeout>();

export function getOrCreateRoom(roomId: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    room = createRoom(roomId);
    rooms.set(roomId, room);
    sockets.set(roomId, {});
  }
  return room;
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

export function registerSocket(roomId: string, playerId: string, ws: WebSocket) {
  const bucket = sockets.get(roomId) ?? {};
  bucket[playerId] = ws;
  sockets.set(roomId, bucket);

  const room = rooms.get(roomId);
  const player = room?.state.players.find((p) => p.id === playerId);
  if (player) player.connected = true;

  // A reconnect within the grace period cancels any pending forfeiture.
  cancelGraceExpiry(roomId, playerId);
}

export function unregisterSocket(roomId: string, playerId: string) {
  const bucket = sockets.get(roomId);
  if (bucket) delete bucket[playerId];

  const room = rooms.get(roomId);
  const player = room?.state.players.find((p) => p.id === playerId);
  if (player) player.connected = false;
}

export function scheduleGraceExpiry(
  roomId: string,
  playerId: string,
  graceMs: number,
  onExpire: () => void,
) {
  const key = `${roomId}:${playerId}`;
  cancelGraceExpiry(roomId, playerId);
  const timer = setTimeout(() => {
    graceTimers.delete(key);
    onExpire();
  }, graceMs);
  graceTimers.set(key, timer);
}

export function cancelGraceExpiry(roomId: string, playerId: string) {
  const key = `${roomId}:${playerId}`;
  const timer = graceTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    graceTimers.delete(key);
  }
}

export function broadcast(roomId: string, payload: unknown) {
  const bucket = sockets.get(roomId);
  if (!bucket) return;
  const msg = JSON.stringify(payload);
  for (const ws of Object.values(bucket)) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

export function roomIsEmpty(roomId: string): boolean {
  const bucket = sockets.get(roomId);
  if (!bucket) return true;
  return Object.keys(bucket).length === 0;
}

export function destroyRoomIfEmpty(roomId: string) {
  if (roomIsEmpty(roomId)) {
    rooms.delete(roomId);
    sockets.delete(roomId);
  }
}
