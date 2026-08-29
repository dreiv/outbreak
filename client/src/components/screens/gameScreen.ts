import type { EventId, RegionId } from "../../../../shared/src/types";
import {
  getConnStatus,
  getErrorMsg,
  getGameState,
  getMyPlayerId,
  clearError,
  dispatch,
} from "../../state/appState";
import { isMuted, toggleMuted } from "../../services/sound";
import { escapeHtml } from "../../utils/escape";
import {
  POPUP_OFFSET,
  POPUP_MIN_WIDTH,
  POPUP_MIN_HEIGHT,
  REGION_LEGEND,
} from "../../constants";
import type { MapController, PendingEvent } from "../../types";
import { initMap, renderMap, attachMapClickHandler } from "../map";
import { renderSidebar } from "../sidebar";
import { renderCityPopup } from "../cityPopup";
import { renderCureModal } from "../modals/cureModal";
import { renderEventModal } from "../modals/eventModal";
import { renderForecastOverlay } from "../modals/forecastOverlay";
import { renderDiscardModal } from "../modals/discardModal";
import { renderHelpOverlay } from "../modals/helpOverlay";
import { renderGameOver } from "../modals/gameOver";

let gameShellBuilt = false;
let mapController: MapController | null = null;
let rootEl: HTMLElement | null = null;
let selectedCity: string | null = null;
let pendingEvent: PendingEvent | null = null;
let forecastOrder: string[] | null = null;

function buildGameShellOnce(el: HTMLElement): void {
  if (gameShellBuilt) return;
  el.innerHTML = `
    <div class="game-shell">
      <header class="topbar">
        <span class="brand">🧬 OUTBREAK PROTOCOL</span>
        <span class="topbar-mid">
          <span class="legend" id="legend"></span>
          <button class="help-btn" id="help-btn" title="How to play" aria-label="How to play">?</button>
          <button class="mute-btn" id="mute-btn" title="Mute sound"></button>
        </span>
        <span class="conn-status"><span class="conn-dot" id="conn-dot"></span><span id="conn-text">connected</span></span>
      </header>
      <div class="game-error-toast" id="game-error-toast" style="display:none;" role="alert"></div>
      <div class="map-wrap" id="map-wrap">
        <svg id="board-svg" role="img" aria-label="World outbreak map"></svg>
        <div class="city-popup" id="city-popup" style="display:none;"></div>
        <div class="fx-banner" id="fx-banner"></div>
        <div class="map-controls">
          <button id="zoom-in-btn" title="Zoom in" aria-label="Zoom in">+</button>
          <button id="zoom-out-btn" title="Zoom out" aria-label="Zoom out">−</button>
          <button id="zoom-reset-btn" title="Reset view" aria-label="Reset view">⤾</button>
        </div>
        <div class="map-hint">Scroll / pinch to zoom · drag to pan</div>
      </div>
      <aside class="sidebar" id="sidebar"></aside>
    </div>
    <div class="discard-overlay" id="discard-overlay" style="display:none;"></div>
    <div class="discard-overlay" id="event-overlay" style="display:none;"></div>
    <div class="help-overlay" id="help-overlay" style="display:none;"></div>
    <div class="gameover-overlay" id="gameover-overlay" style="display:none;"></div>
  `;
  rootEl = el;
  const svg = el.querySelector("#board-svg") as SVGSVGElement;
  const wrap = el.querySelector("#map-wrap") as HTMLElement;
  attachMapClickHandler(svg, (cityId, evt) => onCityClick(el, cityId, evt));
  mapController = initMap(svg, wrap);

  el.querySelector("#zoom-in-btn")?.addEventListener("click", () =>
    mapController?.zoomIn(),
  );
  el.querySelector("#zoom-out-btn")?.addEventListener("click", () =>
    mapController?.zoomOut(),
  );
  el.querySelector("#zoom-reset-btn")?.addEventListener("click", () =>
    mapController?.resetView(),
  );

  el.querySelector("#help-btn")?.addEventListener("click", () => {
    const overlay = el.querySelector("#help-overlay") as HTMLElement;
    renderHelpOverlay(overlay, () => {
      overlay.style.display = "none";
      overlay.innerHTML = "";
    });
  });

  const muteBtn = el.querySelector("#mute-btn") as HTMLButtonElement;
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

function closePopup(el: HTMLElement): void {
  selectedCity = null;
  const popup = el.querySelector("#city-popup") as HTMLElement;
  popup.style.display = "none";
  popup.innerHTML = "";
  const svg = el.querySelector("#board-svg") as SVGSVGElement;
  renderMap(svg, getGameState()!, getMyPlayerId(), selectedCity);
}

function onCureNeeded(el: HTMLElement, region: RegionId): void {
  if (!getGameState() || !getMyPlayerId()) return;
  const overlay = el.querySelector("#discard-overlay") as HTMLElement;
  renderCureModal(
    overlay,
    getGameState()!,
    getMyPlayerId()!,
    region,
    dispatch,
    () => {
      overlay.style.display = "none";
      overlay.innerHTML = "";
    },
  );
}

function onPlayEvent(cardUid: string, event: EventId): void {
  pendingEvent = { cardUid, event };
  renderEventOverlay(rootEl!);
}

function renderEventOverlay(el: HTMLElement): void {
  const state = getGameState();
  const myId = getMyPlayerId();
  const overlay = el.querySelector("#event-overlay") as HTMLElement;
  if (!state || !myId || !pendingEvent) {
    overlay.style.display = "none";
    overlay.innerHTML = "";
    return;
  }
  renderEventModal(
    overlay,
    state,
    myId,
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

function renderForecastIfNeeded(el: HTMLElement): void {
  const state = getGameState();
  const myId = getMyPlayerId();
  const overlay = el.querySelector("#event-overlay") as HTMLElement;
  if (!state || !myId) return;
  if (!state.pendingForecast || state.pendingForecast.playerId !== myId) {
    forecastOrder = null;
    return;
  }
  if (!forecastOrder) forecastOrder = state.pendingForecast.cities.slice();
  renderForecastOverlay(
    overlay,
    state,
    myId,
    forecastOrder,
    (next) => {
      forecastOrder = next;
      renderForecastIfNeeded(el);
    },
    dispatch,
  );
}

function onCityClick(el: HTMLElement, cityId: string, evt: MouseEvent): void {
  const state = getGameState();
  const myId = getMyPlayerId();
  if (!state || !myId) return;
  selectedCity = cityId;

  const wrap = el.querySelector("#map-wrap") as HTMLElement;
  const rect = wrap.getBoundingClientRect();
  const x = Math.min(
    evt.clientX - rect.left + POPUP_OFFSET,
    rect.width - POPUP_MIN_WIDTH,
  );
  const y = Math.min(
    evt.clientY - rect.top + POPUP_OFFSET,
    rect.height - POPUP_MIN_HEIGHT,
  );

  const popup = el.querySelector("#city-popup") as HTMLElement;
  popup.style.display = "block";
  renderCityPopup(
    popup,
    state,
    myId,
    cityId,
    { x, y },
    dispatch,
    () => closePopup(el),
    (region) => onCureNeeded(el, region),
  );
  const svg = el.querySelector("#board-svg") as SVGSVGElement;
  renderMap(svg, state, myId, selectedCity);
}

function renderLegend(el: HTMLElement): void {
  const legend = el.querySelector("#legend") as HTMLElement;
  legend.innerHTML = (Object.keys(REGION_LEGEND) as RegionId[])
    .map(
      (r) =>
        `<span class="item"><span class="swatch-sm" style="background:${REGION_LEGEND[r].color}"></span>${REGION_LEGEND[r].label}</span>`,
    )
    .join("");
}

function renderConnStatus(el: HTMLElement): void {
  const dot = el.querySelector("#conn-dot") as HTMLElement;
  const text = el.querySelector("#conn-text") as HTMLElement;
  const status = getConnStatus();
  dot.className = `conn-dot ${status === "open" ? "" : status === "connecting" ? "connecting" : "bad"}`;
  text.textContent =
    status === "open"
      ? "connected"
      : status === "connecting"
        ? "reconnecting…"
        : "disconnected";
}

function renderErrorToast(el: HTMLElement): void {
  const toast = el.querySelector("#game-error-toast") as HTMLElement;
  const msg = getErrorMsg();
  if (msg) {
    toast.style.display = "flex";
    toast.innerHTML = `<span>${escapeHtml(msg)}</span><button id="error-toast-close" aria-label="Dismiss">✕</button>`;
    el.querySelector("#error-toast-close")?.addEventListener(
      "click",
      clearError,
    );
  } else {
    toast.style.display = "none";
    toast.innerHTML = "";
  }
}

/**
 * Renders the full game screen. The shell (map, sidebar, overlays) is built
 * once and reused across state updates; only the dynamic regions are
 * re-rendered.
 */
export function renderGameScreen(el: HTMLElement): void {
  buildGameShellOnce(el);
  const state = getGameState();
  const myId = getMyPlayerId();
  if (!state || !myId) return;

  renderLegend(el);
  const svg = el.querySelector("#board-svg") as SVGSVGElement;
  renderMap(svg, state, myId, selectedCity);
  renderSidebar(
    el.querySelector("#sidebar") as HTMLElement,
    state,
    myId,
    dispatch,
    onPlayEvent,
  );
  renderDiscardModal(
    el.querySelector("#discard-overlay") as HTMLElement,
    state,
    myId,
    dispatch,
  );
  renderForecastIfNeeded(el);
  renderGameOver(el.querySelector("#gameover-overlay") as HTMLElement, state);
  renderConnStatus(el);
  renderErrorToast(el);
}

/** Tears down the game shell (pan/zoom instance) when leaving the game screen. */
export function destroyGameScreen(): void {
  if (gameShellBuilt) {
    mapController?.destroy();
    mapController = null;
  }
  gameShellBuilt = false;
  rootEl = null;
  selectedCity = null;
  pendingEvent = null;
  forecastOrder = null;
}
