import type {
  GameState,
  PlayerAction,
  RegionId,
  EventId,
} from "../../shared/src/types";
import { DIFFICULTIES } from "../../shared/src/types";
import { socket } from "./ws";
import {
  renderMap,
  attachMapClickHandler,
  initMap,
  type MapController,
} from "./map";
import {
  renderSidebar,
  renderCityPopup,
  renderCureModal,
  renderDiscardModal,
  renderEventModal,
  renderForecastOverlay,
  renderGameOver,
  renderHelpOverlay,
} from "./ui";
import { runEffects } from "./effects";
import { sound, unlockAudio, isMuted, toggleMuted } from "./sound";
import { escapeHtml } from "./escape";

const app = document.getElementById("app")!;

let screen: "lobby" | "game" = "lobby";
let gameState: GameState | null = null;
let myPlayerId: string | null = localStorage.getItem("op_player_id");
let roomId: string | null = localStorage.getItem("op_room_id");
let playerName: string = localStorage.getItem("op_player_name") || "";
let errorMsg: string | null = null;
let errorToastTimer: number | undefined;
let selectedCity: string | null = null;
let connStatus: "connecting" | "open" | "closed" = "connecting";

function dispatch(action: PlayerAction) {
  if (!gameState || !myPlayerId) return;
  sound.action();
  socket.send({
    type: "player_action",
    roomId: gameState.roomId,
    playerId: myPlayerId,
    action,
  });
}

// ---------------------------------------------------------------------------
// Lobby screen
// ---------------------------------------------------------------------------

function renderLobbyScreen() {
  const inLobbyRoom = gameState && gameState.phase === "lobby";

  app.innerHTML = `
    <div class="lobby-screen">
      <div class="lobby-card">
        <h1>🧬 Outbreak Protocol</h1>
        <p class="tagline">Cooperative global outbreak response — 2 to 4 players.</p>
        ${errorMsg ? `<div class="error-banner">${escapeHtml(errorMsg)}</div>` : ""}
        ${
          !inLobbyRoom
            ? `
          <div class="field">
            <label>Your name</label>
            <input id="name-input" type="text" value="${escapeHtml(playerName)}" placeholder="Agent Smith" maxlength="24" />
          </div>
          <div class="field">
            <label>Room code</label>
            <input id="room-input" type="text" value="${escapeHtml(roomId ?? "")}" placeholder="e.g. bravo-19" maxlength="24" />
          </div>
          <button class="btn-primary" id="join-btn">Join / Create Room</button>
        `
            : `
          <p style="color:var(--text-dim); font-size:13px;">Room: <b style="color:var(--text)">${escapeHtml(gameState!.roomId)}</b> — share this code with your team.</p>
          <div class="lobby-players">
            ${gameState!.players
              .map(
                (p) => `
              <div class="lobby-player-row ${p.connected ? "" : "offline"}">
                <span><span class="dot"></span>${escapeHtml(p.name)}${p.id === myPlayerId ? " (you)" : ""}</span>
                <span style="color:var(--text-dim); font-size:11px;">${p.connected ? "connected" : "offline"}</span>
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

  document.querySelectorAll<HTMLButtonElement>("[data-epidemic-count]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!gameState) return;
      socket.send({
        type: "set_epidemic_count",
        roomId: gameState.roomId,
        epidemicCount: Number(btn.dataset.epidemicCount),
      });
    });
  });

  document.getElementById("join-btn")?.addEventListener("click", () => {
    const name =
      (
        document.getElementById("name-input") as HTMLInputElement
      ).value.trim() || "Agent";
    const room =
      (document.getElementById("room-input") as HTMLInputElement).value
        .trim()
        .toLowerCase() || "default";
    playerName = name;
    roomId = room;
    localStorage.setItem("op_player_name", name);
    localStorage.setItem("op_room_id", room);
    errorMsg = null;
    socket.send({
      type: "join_room",
      roomId: room,
      playerName: name,
      playerId: myPlayerId ?? undefined,
    });
  });

  document.getElementById("start-btn")?.addEventListener("click", () => {
    if (!gameState) return;
    socket.send({ type: "start_game", roomId: gameState.roomId });
  });
}

// ---------------------------------------------------------------------------
// Game screen
// ---------------------------------------------------------------------------

let gameShellBuilt = false;
let mapController: MapController | null = null;

function buildGameShellOnce() {
  if (gameShellBuilt) return;
  app.innerHTML = `
    <div class="game-shell">
      <div class="topbar">
        <span class="brand">🧬 OUTBREAK PROTOCOL</span>
        <span class="topbar-mid">
          <span class="legend" id="legend"></span>
          <button class="help-btn" id="help-btn" title="How to play">?</button>
          <button class="mute-btn" id="mute-btn" title="Mute sound"></button>
        </span>
        <span class="conn-status"><span class="conn-dot" id="conn-dot"></span><span id="conn-text">connected</span></span>
      </div>
      <div class="game-error-toast" id="game-error-toast" style="display:none;"></div>
      <div class="map-wrap" id="map-wrap">
        <svg id="board-svg"></svg>
        <div class="city-popup" id="city-popup" style="display:none;"></div>
        <div class="fx-banner" id="fx-banner"></div>
        <div class="map-controls">
          <button id="zoom-in-btn" title="Zoom in">+</button>
          <button id="zoom-out-btn" title="Zoom out">−</button>
          <button id="zoom-reset-btn" title="Reset view">⤾</button>
        </div>
        <div class="map-hint">Scroll / pinch to zoom · drag to pan</div>
      </div>
      <div class="sidebar" id="sidebar"></div>
    </div>
    <div class="discard-overlay" id="discard-overlay" style="display:none;"></div>
    <div class="discard-overlay" id="event-overlay" style="display:none;"></div>
    <div class="help-overlay" id="help-overlay" style="display:none;"></div>
    <div class="gameover-overlay" id="gameover-overlay" style="display:none;"></div>
  `;
  const svg = document.getElementById("board-svg") as unknown as SVGSVGElement;
  const wrap = document.getElementById("map-wrap") as HTMLElement;
  attachMapClickHandler(svg, onCityClick);
  mapController = initMap(svg, wrap);

  document
    .getElementById("zoom-in-btn")
    ?.addEventListener("click", () => mapController?.zoomIn());
  document
    .getElementById("zoom-out-btn")
    ?.addEventListener("click", () => mapController?.zoomOut());
  document
    .getElementById("zoom-reset-btn")
    ?.addEventListener("click", () => mapController?.resetView());
  document.getElementById("help-btn")?.addEventListener("click", () => {
    const overlay = document.getElementById("help-overlay")!;
    renderHelpOverlay(overlay, () => {
      overlay.style.display = "none";
      overlay.innerHTML = "";
    });
  });
  const muteBtn = document.getElementById("mute-btn") as HTMLButtonElement;
  const syncMuteBtn = () => {
    muteBtn.textContent = isMuted() ? "🔇" : "🔊";
    muteBtn.title = isMuted() ? "Unmute sound" : "Mute sound";
  };
  syncMuteBtn();
  muteBtn.addEventListener("click", () => {
    toggleMuted();
    syncMuteBtn();
  });

  gameShellBuilt = true;
}

function closePopup() {
  selectedCity = null;
  const popup = document.getElementById("city-popup");
  if (popup) {
    popup.style.display = "none";
    popup.innerHTML = "";
  }
  if (gameState)
    renderMap(
      document.getElementById("board-svg") as unknown as SVGSVGElement,
      gameState,
      myPlayerId,
      selectedCity,
    );
}

function onCureNeeded(region: RegionId) {
  if (!gameState || !myPlayerId) return;
  const overlay = document.getElementById("discard-overlay")!;
  renderCureModal(overlay, gameState, myPlayerId, region, dispatch, () => {
    overlay.style.display = "none";
    overlay.innerHTML = "";
  });
}

let pendingEvent: { cardUid: string; event: EventId } | null = null;
let forecastOrder: string[] | null = null;

function onPlayEvent(cardUid: string, event: EventId) {
  pendingEvent = { cardUid, event };
  renderEventOverlay();
}

function renderEventOverlay() {
  if (!gameState || !myPlayerId) return;
  const overlay = document.getElementById("event-overlay")!;
  if (!pendingEvent) {
    overlay.style.display = "none";
    overlay.innerHTML = "";
    return;
  }
  renderEventModal(
    overlay,
    gameState,
    myPlayerId,
    pendingEvent.cardUid,
    pendingEvent.event,
    dispatch,
    () => {
      pendingEvent = null;
      overlay.style.display = "none";
      overlay.innerHTML = "";
    },
  );
}

function renderForecastIfNeeded() {
  if (!gameState || !myPlayerId) return;
  const overlay = document.getElementById("event-overlay")!;
  if (
    !gameState.pendingForecast ||
    gameState.pendingForecast.playerId !== myPlayerId
  ) {
    forecastOrder = null;
    return;
  }
  if (!forecastOrder) forecastOrder = gameState.pendingForecast.cities.slice();
  renderForecastOverlay(
    overlay,
    gameState,
    myPlayerId,
    forecastOrder,
    (next) => {
      forecastOrder = next;
      renderForecastIfNeeded();
    },
    dispatch,
  );
}

function onCityClick(cityId: string, evt: MouseEvent) {
  if (!gameState || !myPlayerId) return;
  selectedCity = cityId;
  const wrap = document.getElementById("map-wrap")!;
  const rect = wrap.getBoundingClientRect();
  let x = evt.clientX - rect.left + 14;
  let y = evt.clientY - rect.top + 14;
  x = Math.min(x, rect.width - 240);
  y = Math.min(y, rect.height - 260);

  const popup = document.getElementById("city-popup")!;
  popup.style.display = "block";
  renderCityPopup(
    popup,
    gameState,
    myPlayerId,
    cityId,
    { x, y },
    dispatch,
    closePopup,
    onCureNeeded,
  );
  renderMap(
    document.getElementById("board-svg") as unknown as SVGSVGElement,
    gameState,
    myPlayerId,
    selectedCity,
  );
}

function renderLegend() {
  const legend = document.getElementById("legend");
  if (!legend) return;
  legend.innerHTML = `
    <span class="item"><span class="swatch-sm" style="background:#3b82f6"></span>Azure</span>
    <span class="item"><span class="swatch-sm" style="background:#ef4444"></span>Crimson</span>
    <span class="item"><span class="swatch-sm" style="background:#f59e0b"></span>Amber</span>
    <span class="item"><span class="swatch-sm" style="background:#22c55e"></span>Verdant</span>
  `;
}

function renderGameScreen() {
  buildGameShellOnce();
  if (!gameState || !myPlayerId) return;
  renderLegend();
  renderMap(
    document.getElementById("board-svg") as unknown as SVGSVGElement,
    gameState,
    myPlayerId,
    selectedCity,
  );
  renderSidebar(
    document.getElementById("sidebar")!,
    gameState,
    myPlayerId,
    dispatch,
    onPlayEvent,
  );
  renderDiscardModal(
    document.getElementById("discard-overlay")!,
    gameState,
    myPlayerId,
    dispatch,
  );
  renderForecastIfNeeded();
  renderGameOver(document.getElementById("gameover-overlay")!, gameState);

  const dot = document.getElementById("conn-dot");
  const text = document.getElementById("conn-text");
  if (dot && text) {
    dot.className = `conn-dot ${connStatus === "open" ? "" : connStatus === "connecting" ? "connecting" : "bad"}`;
    text.textContent =
      connStatus === "open"
        ? "connected"
        : connStatus === "connecting"
          ? "reconnecting…"
          : "disconnected";
  }

  // Surface rejected actions (server `error`) as a dismissible toast.
  const toast = document.getElementById("game-error-toast");
  if (toast) {
    if (errorMsg) {
      toast.style.display = "flex";
      toast.innerHTML = `<span>${escapeHtml(errorMsg)}</span><button id="error-toast-close" aria-label="Dismiss">✕</button>`;
      document
        .getElementById("error-toast-close")
        ?.addEventListener("click", () => {
          errorMsg = null;
          renderGameScreen();
        });
    } else {
      toast.style.display = "none";
      toast.innerHTML = "";
    }
  }
}

// ---------------------------------------------------------------------------
// Root render dispatch
// ---------------------------------------------------------------------------

function render() {
  if (screen === "lobby") {
    if (gameShellBuilt) {
      mapController?.destroy();
      mapController = null;
    }
    gameShellBuilt = false;
    renderLobbyScreen();
  } else {
    renderGameScreen();
  }
}

socket.onStatus((s) => {
  connStatus = s;
  if (screen === "game") render();
});

socket.onMessage((msg) => {
  let prevState: GameState | null = null;
  let didStateUpdate = false;

  if (msg.type === "joined") {
    myPlayerId = msg.playerId;
    roomId = msg.roomId;
    localStorage.setItem("op_player_id", msg.playerId);
    localStorage.setItem("op_room_id", msg.roomId);
    errorMsg = null;
  } else if (msg.type === "state_sync" || msg.type === "state_diff") {
    prevState = gameState;
    gameState = msg.state;
    screen = gameState.phase === "lobby" ? "lobby" : "game";
    didStateUpdate = true;
  } else if (msg.type === "error") {
    errorMsg = msg.message;
    window.clearTimeout(errorToastTimer);
    errorToastTimer = window.setTimeout(() => {
      errorMsg = null;
      render();
    }, 6000);
  }

  render();

  if (didStateUpdate && gameState && screen === "game") {
    const svg = document.getElementById(
      "board-svg",
    ) as unknown as SVGSVGElement | null;
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
});

// AudioContext needs a user gesture to start — grab the first one, anywhere.
window.addEventListener("pointerdown", unlockAudio, { once: true });

socket.connect();
render();

// Auto-rejoin if we have a persisted session
if (myPlayerId && roomId && playerName) {
  setTimeout(() => {
    socket.send({
      type: "join_room",
      roomId: roomId!,
      playerName,
      playerId: myPlayerId ?? undefined,
    });
  }, 300);
}