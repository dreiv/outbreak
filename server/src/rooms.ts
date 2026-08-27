import type { WebSocket } from "ws";
import { Redis } from "ioredis";
import { Room, RoomInternal, createRoom } from "./gameState.js";

interface Sockets {
  [playerId: string]: WebSocket;
}

const rooms = new Map<string, Room>();
const sockets = new Map<string, Sockets>(); // roomId -> playerId -> ws

// Reconnect grace timers, keyed by `${roomId}:${playerId}`. The expiry
// callback (set via scheduleGraceExpiry) frees the seat / unsticks the game.
const graceTimers = new Map<string, NodeJS.Timeout>();

// ---------------------------------------------------------------------------
// Optional Redis-backed persistence
// ---------------------------------------------------------------------------
// `rooms`/`sockets` above are plain in-memory Maps, so a server restart
// wipes every active game — this bites hardest on Render, where a free-tier
// instance spins down after ~15min idle and every deploy is a fresh
// process. If REDIS_URL is set we write the room's state through to Redis
// on every broadcast and rehydrate all rooms from Redis at boot; if it's
// not set we fall back to the old in-memory-only behaviour (fine for local
// dev) and just warn once.
const REDIS_URL = process.env.REDIS_URL;
const redis = REDIS_URL ? new Redis(REDIS_URL) : null;
const ROOM_KEY_PREFIX = "outbreak:room:";
const ROOM_TTL_SECONDS = 60 * 60 * 24 * 3; // 3 days — sweep up abandoned rooms

if (!redis) {
  console.warn(
    "[rooms] REDIS_URL not set — room state is in-memory only and will be " +
      "lost on restart, redeploy, or free-tier sleep. Set REDIS_URL (e.g. " +
      "a Render Key Value/Redis instance) to persist rooms across restarts.",
  );
} else {
  redis.on("error", (err: Error) => {
    console.error("[rooms] Redis error:", err.message);
  });
}

interface SerializedRoom {
  state: Room["state"];
  internal:
    | null
    | (Omit<RoomInternal, "freeMoveUsed"> & { freeMoveUsed: string[] });
}

function serializeRoom(room: Room): SerializedRoom {
  return {
    state: room.state,
    internal: room.internal
      ? { ...room.internal, freeMoveUsed: Array.from(room.internal.freeMoveUsed) }
      : null,
  };
}

function deserializeRoom(raw: SerializedRoom): Room {
  // Nobody is actually connected right after a rehydrate — each client's
  // own reconnect logic (join_room with its saved playerId) flips these
  // back to true as players rejoin.
  for (const p of raw.state.players) p.connected = false;
  return {
    state: raw.state,
    internal: raw.internal
      ? { ...raw.internal, freeMoveUsed: new Set(raw.internal.freeMoveUsed) }
      : null,
  };
}

// Write-through: call after any mutation that should survive a restart.
// Fire-and-forget — a slow/blipped Redis write shouldn't stall gameplay.
export function persistRoom(roomId: string): void {
  if (!redis) return;
  const room = rooms.get(roomId);
  if (!room) return;
  const payload = JSON.stringify(serializeRoom(room));
  redis
    .set(ROOM_KEY_PREFIX + roomId, payload, "EX", ROOM_TTL_SECONDS)
    .catch((err: unknown) =>
      console.error("[rooms] failed to persist room:", roomId, err),
    );
}

async function deleteRoomFromRedis(roomId: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.del(ROOM_KEY_PREFIX + roomId);
  } catch (err: unknown) {
    console.error("[rooms] failed to delete persisted room:", roomId, err);
  }
}

// Call once at boot, before accepting connections — pulls every room that
// survived a previous process back into the in-memory Maps.
export async function hydrateRoomsFromRedis(): Promise<void> {
  if (!redis) return;
  try {
    const keys = await redis.keys(ROOM_KEY_PREFIX + "*");
    for (const key of keys) {
      const raw = await redis.get(key);
      if (!raw) continue;
      const roomId = key.slice(ROOM_KEY_PREFIX.length);
      rooms.set(roomId, deserializeRoom(JSON.parse(raw)));
      sockets.set(roomId, {});
    }
    if (keys.length) {
      console.log(`[rooms] rehydrated ${keys.length} room(s) from Redis`);
    }
  } catch (err: unknown) {
    console.error("[rooms] failed to hydrate rooms from Redis:", err);
  }
}

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

export function registerSocket(
  roomId: string,
  playerId: string,
  ws: WebSocket,
) {
  const bucket = sockets.get(roomId) ?? {};
  bucket[playerId] = ws;
  sockets.set(roomId, bucket);

  const room = rooms.get(roomId);
  const player = room?.state.players.find((p) => p.id === playerId);
  if (player) player.connected = true;

  // Reconnect within the grace period cancels the pending forfeiture.
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
    void deleteRoomFromRedis(roomId);
  }
}
