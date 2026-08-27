import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "../../shared/src/types.js";
import {
  addPlayer,
  applyAction,
  startGame,
  forfeitPlayer,
  setEpidemicCount,
} from "./gameState.js";
import {
  getOrCreateRoom,
  getRoom,
  registerSocket,
  unregisterSocket,
  broadcast,
  destroyRoomIfEmpty,
  scheduleGraceExpiry,
  persistRoom,
  hydrateRoomsFromRedis,
} from "./rooms.js";

const PORT = Number(process.env.PORT) || 8787;
const GRACE_PERIOD_MS = 2 * 60 * 1000; // reconnect window before a seat is forfeited
const MAX_MESSAGE_BYTES = 32 * 1024; // covers a full state sync; caps abusive clients

// A bare `new WebSocketServer({ port })` only speaks the WS upgrade
// handshake — any plain HTTP request (e.g. Render's health check hitting
// "/") gets a raw "426 Upgrade Required" with no body, which Render (and
// most platforms) treats as an unhealthy service and cycles the instance.
// Run an explicit HTTP server and only hand WS upgrade requests off to the
// WebSocketServer, so plain GETs get back a normal 200.
const httpServer = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("outbreak-server ok");
});

const wss = new WebSocketServer({
  server: httpServer,
  maxPayload: MAX_MESSAGE_BYTES,
});

interface ConnMeta {
  roomId: string | null;
  playerId: string | null;
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastState(roomId: string) {
  const room = getRoom(roomId);
  if (!room) return;
  broadcast(roomId, {
    type: "state_diff",
    state: room.state,
  } satisfies ServerMessage);
  // Write-through to Redis (no-op if REDIS_URL isn't set) so a restart
  // resumes the game instead of losing it. See rooms.ts.
  persistRoom(roomId);
}

wss.on("connection", (ws: WebSocket) => {
  const meta: ConnMeta = { roomId: null, playerId: null };

  ws.on("message", (raw: Buffer) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: "error", message: "Malformed message." });
      return;
    }

    switch (msg.type) {
      case "ping": {
        send(ws, { type: "pong" });
        break;
      }

      case "join_room": {
        const roomId = msg.roomId.trim().toLowerCase();
        if (!roomId) {
          send(ws, { type: "error", message: "Room id required." });
          return;
        }
        const room = getOrCreateRoom(roomId);
        const playerId =
          msg.playerId && room.state.players.some((p) => p.id === msg.playerId)
            ? msg.playerId
            : randomUUID();

        const alreadySeated = room.state.players.some((p) => p.id === playerId);
        if (!alreadySeated) {
          const err = addPlayer(
            room,
            playerId,
            msg.playerName.trim() || "Agent",
          );
          if (err) {
            send(ws, { type: "error", message: err });
            return;
          }
        }

        meta.roomId = roomId;
        meta.playerId = playerId;
        registerSocket(roomId, playerId, ws);

        send(ws, { type: "joined", playerId, roomId });
        send(ws, { type: "state_sync", state: room.state, you: { playerId } });
        broadcastState(roomId);
        break;
      }

      case "start_game": {
        const room = getRoom(msg.roomId);
        if (!room) {
          send(ws, { type: "error", message: "Room not found." });
          return;
        }
        const err = startGame(room);
        if (err) {
          send(ws, { type: "error", message: err });
          return;
        }
        broadcastState(msg.roomId);
        break;
      }

      case "set_epidemic_count": {
        const room = getRoom(msg.roomId);
        if (!room) {
          send(ws, { type: "error", message: "Room not found." });
          return;
        }
        const err = setEpidemicCount(room, msg.epidemicCount);
        if (err) {
          send(ws, { type: "error", message: err });
          return;
        }
        broadcastState(msg.roomId);
        break;
      }

      case "player_action": {
        const room = getRoom(msg.roomId);
        if (!room) {
          send(ws, { type: "error", message: "Room not found." });
          return;
        }
        const err = applyAction(room, msg.playerId, msg.action);
        if (err) {
          send(ws, { type: "error", message: err });
          return;
        }
        broadcastState(msg.roomId);
        break;
      }

      default:
        send(ws, { type: "error", message: "Unknown message type." });
    }
  });

  ws.on("close", () => {
    if (meta.roomId && meta.playerId) {
      const { roomId, playerId } = meta;
      unregisterSocket(roomId, playerId);
      broadcastState(roomId);
      // Forfeit the seat after the grace period; registerSocket() cancels
      // this if they reconnect in time.
      scheduleGraceExpiry(roomId, playerId, GRACE_PERIOD_MS, () => {
        const room = getRoom(roomId);
        if (room) {
          forfeitPlayer(room, playerId);
          broadcastState(roomId);
        }
        destroyRoomIfEmpty(roomId);
      });
    }
  });
});

async function main() {
  // Pull back any rooms a previous process had persisted before we start
  // accepting connections, so reconnecting players land in the same game.
  await hydrateRoomsFromRedis();

  httpServer.listen(PORT, () => {
    console.log(
      `[outbreak-server] listening on :${PORT} (http health check + ws)`,
    );
  });
}

main().catch((err) => {
  console.error("[outbreak-server] failed to start:", err);
  process.exit(1);
});
