import { CITY_MAP } from "../../../shared/src/boardData";
import type {
  EventId,
  GameState,
  PlayerCard,
  RegionId,
} from "../../../shared/src/types";
import { REGION_META } from "../../../shared/src/types";
import { escapeHtml } from "../utils/escape";
import { ACTIONS_PER_TURN, LOG_VISIBLE_ENTRIES } from "../constants";
import type { Dispatch } from "../types";
import { eventName, roleDesc, roleLabel } from "./labels";

function handCardHtml(c: PlayerCard): string {
  if (c.type === "epidemic") {
    return `<div class="hand-card epidemic"><span>⚠️ Epidemic</span></div>`;
  }
  if (c.type === "event") {
    return `<div class="hand-card event"><span>🃏 ${escapeHtml(eventName(c.event))}</span><button class="play-event-btn" data-uid="${c.uid}" data-event="${c.event}">Play</button></div>`;
  }
  return `<div class="hand-card"><span>${CITY_MAP[c.city].name}</span></div>`;
}

/**
 * Renders the right-hand sidebar: turn banner, role, strain tracker, board
 * stats, hand, team roster and the activity log.
 */
export function renderSidebar(
  el: HTMLElement,
  state: GameState,
  myId: string,
  dispatch: Dispatch,
  onPlayEvent: (cardUid: string, event: EventId) => void,
): void {
  const me = state.players.find((p) => p.id === myId);
  const currentId = state.turnOrder[state.currentPlayerIndex];
  const current = state.players.find((p) => p.id === currentId);
  const isMyTurn = currentId === myId;

  const pips = Array.from(
    { length: ACTIONS_PER_TURN },
    (_, i) =>
      `<div class="action-pip ${i < state.actionsRemaining ? "filled" : ""}"></div>`,
  ).join("");

  const diseaseGrid = (Object.keys(REGION_META) as RegionId[])
    .map((r) => {
      const meta = REGION_META[r];
      const st = state.diseaseState[r];
      return `
      <div class="disease-chip ${st}" data-region="${r}">
        <span class="swatch" style="background:${meta.color}"></span>
        <span>${meta.label}</span>
        <span class="state">${st}</span>
        <span class="stat-row" style="padding:0"><b>${state.cubesRemaining[r]}</b>&nbsp;cubes left</span>
      </div>`;
    })
    .join("");

  const handHtml =
    (me?.hand ?? []).map(handCardHtml).join("") ||
    '<div class="empty-hint">No cards.</div>';

  const playersHtml = state.players
    .map((p) => {
      const isTurn = p.id === currentId;
      return `
      <div class="player-chip ${isTurn ? "active" : ""}">
        <span>${escapeHtml(p.name)}${p.id === myId ? " (you)" : ""} — ${CITY_MAP[p.location].name}</span>
        ${p.connected ? "" : '<span class="offline-tag">offline</span>'}
      </div>`;
    })
    .join("");

  const logHtml = state.log
    .slice(-LOG_VISIBLE_ENTRIES)
    .map((l) => `<div>${escapeHtml(l.text)}</div>`)
    .join("");

  el.innerHTML = `
    <section>
      <h2>Status</h2>
      <div class="turn-banner">
        <div class="who">${current ? escapeHtml(current.name) : "—"}${isMyTurn ? " (your turn)" : ""}</div>
        <div class="role">${current ? roleLabel(current.role) : ""}</div>
        <div class="actions-left">${pips}</div>
        <button class="end-turn-btn" id="end-turn-btn" ${isMyTurn && state.phase === "playing" ? "" : "disabled"}>End Turn</button>
      </div>
    </section>

    <section>
      <h2>Your Role</h2>
      <div class="turn-banner">
        <div class="who">${roleLabel(me?.role ?? null)}</div>
        <div class="role" style="color: var(--text-dim)">${roleDesc(me?.role ?? null)}</div>
      </div>
    </section>

    <section>
      <h2>Strains</h2>
      <div class="disease-grid">${diseaseGrid}</div>
    </section>

    <section>
      <h2>Board</h2>
      <div class="stat-row"><span>Outbreaks</span><b>${state.outbreakCounter} / ${state.outbreakMax}</b></div>
      <div class="stat-row"><span>Infection rate</span><b>${state.infectionRate}</b></div>
      <div class="stat-row"><span>Research stations</span><b>${state.researchStations.length}</b></div>
      <div class="stat-row"><span>Player deck</span><b>${state.playerDeckSize} left</b></div>
      <div class="stat-row"><span>Infection deck</span><b>${state.infectionDeckSize} left</b></div>
      <div class="stat-row"><span>Epidemics resolved</span><b>${state.epidemicsResolved} / ${state.epidemicCount}</b></div>
      ${state.oneQuietNightActive ? `<div class="stat-row"><span>🌙 One Quiet Night armed</span><b>next infection skipped</b></div>` : ""}
    </section>

    <section>
      <h2>Your Hand</h2>
      <div class="hand-list">${handHtml}</div>
    </section>

    <section>
      <h2>Team</h2>
      <div class="players-list">${playersHtml}</div>
    </section>

    <section>
      <h2>Log</h2>
      <div class="log-list">${logHtml}</div>
    </section>
  `;

  el.querySelector("#end-turn-btn")?.addEventListener("click", () =>
    dispatch({ type: "end-turn" }),
  );
  el.querySelectorAll<HTMLButtonElement>(".play-event-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const uid = btn.dataset.uid;
      const event = btn.dataset.event;
      if (uid && event) onPlayEvent(uid, event as EventId);
    });
  });
}
