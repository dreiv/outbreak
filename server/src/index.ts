import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '../../shared/src/types.js';
import { addPlayer, applyAction, startGame, forfeitPlayer } from './gameState.js';
import {
  getOrCreateRoom, getRoom, registerSocket, unregisterSocket, broadcast, destroyRoomIfEmpty,
  scheduleGraceExpiry,
} from './rooms.js';

const PORT = Number(process.env.PORT) || 8787;
const GRACE_PERIOD_MS = 2 * 60 * 1000; // time to reconnect before a seat is forfeited
const MAX_MESSAGE_BYTES = 32 * 1024; // generous for this protocol's largest payload (full state); guards against a malicious/broken client flooding the process
const wss = new WebSocketServer({ port: PORT, maxPayload: MAX_MESSAGE_BYTES });

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
  broadcast(roomId, { type: 'state_diff', state: room.state } satisfies ServerMessage);
}

wss.on('connection', (ws: WebSocket) => {
  const meta: ConnMeta = { roomId: null, playerId: null };

  ws.on('message', (raw: Buffer) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: 'error', message: 'Malformed message.' });
      return;
    }

    switch (msg.type) {
      case 'ping': {
        send(ws, { type: 'pong' });
        break;
      }

      case 'join_room': {
        const roomId = msg.roomId.trim().toLowerCase();
        if (!roomId) { send(ws, { type: 'error', message: 'Room id required.' }); return; }
        const room = getOrCreateRoom(roomId);
        const playerId = msg.playerId && room.state.players.some((p) => p.id === msg.playerId)
          ? msg.playerId
          : randomUUID();

        const alreadySeated = room.state.players.some((p) => p.id === playerId);
        if (!alreadySeated) {
          const err = addPlayer(room, playerId, msg.playerName.trim() || 'Agent');
          if (err) { send(ws, { type: 'error', message: err }); return; }
        }

        meta.roomId = roomId;
        meta.playerId = playerId;
        registerSocket(roomId, playerId, ws);

        send(ws, { type: 'joined', playerId, roomId });
        send(ws, { type: 'state_sync', state: room.state, you: { playerId } });
        broadcastState(roomId);
        break;
      }

      case 'start_game': {
        const room = getRoom(msg.roomId);
        if (!room) { send(ws, { type: 'error', message: 'Room not found.' }); return; }
        const err = startGame(room);
        if (err) { send(ws, { type: 'error', message: err }); return; }
        broadcastState(msg.roomId);
        break;
      }

      case 'player_action': {
        const room = getRoom(msg.roomId);
        if (!room) { send(ws, { type: 'error', message: 'Room not found.' }); return; }
        const err = applyAction(room, msg.playerId, msg.action);
        if (err) { send(ws, { type: 'error', message: err }); return; }
        broadcastState(msg.roomId);
        break;
      }

      default:
        send(ws, { type: 'error', message: 'Unknown message type.' });
    }
  });

  ws.on('close', () => {
    if (meta.roomId && meta.playerId) {
      const { roomId, playerId } = meta;
      unregisterSocket(roomId, playerId);
      broadcastState(roomId);
      // Give reconnects a grace period before forfeiting the seat (freeing it
      // in the lobby, or auto-skipping their turn mid-game) and considering
      // the room for cleanup. registerSocket() cancels this if they
      // reconnect in time.
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

console.log(`[outbreak-server] listening on ws://localhost:${PORT}`);