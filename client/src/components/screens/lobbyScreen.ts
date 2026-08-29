import type { GameState } from "../../../../shared/src/types";
import { DIFFICULTIES } from "../../../../shared/src/types";
import { socket } from "../../services/socket";
import { escapeHtml } from "../../utils/escape";
import type { ConnectionStatus } from "../../types";

interface LobbyParams {
  gameState: GameState | null;
  myPlayerId: string | null;
  playerName: string;
  roomId: string | null;
  errorMsg: string | null;
  connStatus: ConnectionStatus;
  onJoined: (name: string, room: string) => void;
}

/**
 * Renders the lobby: the join/create form before a room exists, or the
 * in-room roster + difficulty picker once one does.
 */
export function renderLobbyScreen(el: HTMLElement, params: LobbyParams): void {
  const {
    gameState,
    myPlayerId,
    playerName,
    roomId,
    errorMsg,
    connStatus,
    onJoined,
  } = params;
  const inLobbyRoom = gameState && gameState.phase === "lobby";

  el.innerHTML = `
    <div class="lobby-screen">
      <div class="lobby-card">
        <h1>🧬 Outbreak Protocol</h1>
        <p class="tagline">Cooperative global outbreak response — 2 to 4 players.</p>
        ${errorMsg ? `<div class="error-banner">${escapeHtml(errorMsg)}</div>` : ""}
        ${
          !inLobbyRoom
            ? `
          <div class="field">
            <label for="name-input">Your name</label>
            <input id="name-input" type="text" value="${escapeHtml(playerName)}" placeholder="Agent Smith" maxlength="24" />
          </div>
          <div class="field">
            <label for="room-input">Room code</label>
            <input id="room-input" type="text" value="${escapeHtml(roomId ?? "")}" placeholder="e.g. bravo-19" maxlength="24" />
          </div>
          <button class="btn-primary" id="join-btn" ${connStatus !== "open" ? "disabled" : ""}>
            ${connStatus === "open" ? "Join / Create Room" : "Reconnecting…"}
          </button>
        `
            : `
          <p class="room-code-line">Room: <b>${escapeHtml(gameState!.roomId)}</b> — share this code with your team.</p>
          <div class="lobby-players">
            ${gameState!.players
              .map(
                (p) => `
              <div class="lobby-player-row ${p.connected ? "" : "offline"}">
                <span><span class="dot"></span>${escapeHtml(p.name)}${p.id === myPlayerId ? " (you)" : ""}</span>
                <span class="lobby-player-status">${p.connected ? "connected" : "offline"}</span>
              </div>`,
              )
              .join("")}
          </div>
          <div class="field">
            <label>Difficulty</label>
            <div class="difficulty-picker">
              ${DIFFICULTIES.map(
                (d) => `
                <button
                  class="difficulty-option ${gameState!.epidemicCount === d.epidemicCount ? "selected" : ""}"
                  data-epidemic-count="${d.epidemicCount}"
                  title="${escapeHtml(d.description)}"
                >${escapeHtml(d.label)}<span>${d.epidemicCount} epidemics</span></button>`,
              ).join("")}
            </div>
          </div>
          <button class="btn-primary" id="start-btn" ${gameState!.players.length < 2 ? "disabled" : ""}>
            ${gameState!.players.length < 2 ? "Need 2+ players" : "Start Game"}
          </button>
        `
        }
      </div>
    </div>
  `;

  el.querySelectorAll<HTMLButtonElement>("[data-epidemic-count]").forEach(
    (btn) => {
      btn.addEventListener("click", () => {
        if (!gameState) return;
        socket.send({
          type: "set_epidemic_count",
          roomId: gameState.roomId,
          epidemicCount: Number(btn.dataset.epidemicCount),
        });
      });
    },
  );

  el.querySelector("#join-btn")?.addEventListener("click", () => {
    const nameInput = el.querySelector<HTMLInputElement>("#name-input");
    const roomInput = el.querySelector<HTMLInputElement>("#room-input");
    const name = nameInput?.value.trim() || "Agent";
    const room = roomInput?.value.trim().toLowerCase() || "default";
    onJoined(name, room);
  });

  el.querySelector("#start-btn")?.addEventListener("click", () => {
    if (!gameState) return;
    socket.send({ type: "start_game", roomId: gameState.roomId });
  });
}
