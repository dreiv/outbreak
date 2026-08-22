import type { WebSocket } from 'ws';
import { Room, createRoom } from './gameState';

const GRACE_PERIOD_MS = 2 * 60 * 1000; // 2 minutes to reconnect before seat is freed

interface Sockets {
  [playerId: string]: WebSocket;
}

const rooms = new Map<string, Room>();
const sockets = new Map<string, Sockets>(); // roomId -> playerId -> ws
const disconnectTimers = new Map<string, NodeJS.Timeout>(); // `${roomId}:${playerId}`

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

  const timerKey = `${roomId}:${playerId}`;
  const timer = disconnectTimers.get(timerKey);
  if (timer) {
    clearTimeout(timer);
    disconnectTimers.delete(timerKey);
  }
  const room = rooms.get(roomId);
  const player = room?.state.players.find((p) => p.id === playerId);
  if (player) player.connected = true;
}

export function unregisterSocket(roomId: string, playerId: string) {
  const bucket = sockets.get(roomId);
  if (bucket) delete bucket[playerId];

  const room = rooms.get(roomId);
  const player = room?.state.players.find((p) => p.id === playerId);
  if (player) player.connected = false;

  const timerKey = `${roomId}:${playerId}`;
  const timer = setTimeout(() => {
    // Grace period expired — seat stays reserved in state.players so the
    // room's history is intact, but we stop waiting on this connection.
    disconnectTimers.delete(timerKey);
  }, GRACE_PERIOD_MS);
  disconnectTimers.set(timerKey, timer);
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
