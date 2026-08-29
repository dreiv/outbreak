import { CITIES, CITY_MAP } from "../../../../shared/src/boardData";
import type { EventId, GameState } from "../../../../shared/src/types";
import { escapeHtml } from "../../utils/escape";
import type { Dispatch } from "../../types";
import { eventName } from "../labels";

interface EventBody {
  html: string;
  confirm: (dispatch: Dispatch, cardUid: string, el: HTMLElement) => void;
}

function cityOptionsHtml(): string {
  return CITIES.map(
    (c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`,
  ).join("");
}

function buildEventBody(
  event: EventId,
  state: GameState,
  myId: string,
): EventBody {
  switch (event) {
    case "government-grant":
      return {
        html: `
      <p class="modal-hint">Build a research station in any city — no card needed.</p>
      <select id="ev-city">${cityOptionsHtml()}</select>
      <button class="btn-primary" id="ev-confirm">Build Station</button>`,
        confirm: (dispatch, cardUid, el) => {
          const cityEl = el.querySelector("#ev-city") as HTMLSelectElement;
          dispatch({
            type: "play-government-grant",
            cardUid,
            city: cityEl.value,
          });
        },
      };

    case "airlift": {
      const playerOptions = state.players
        .map(
          (p) =>
            `<option value="${p.id}">${escapeHtml(p.name)}${p.id === myId ? " (you)" : ""}</option>`,
        )
        .join("");
      return {
        html: `
      <p class="modal-hint">Move any player to any city.</p>
      <select id="ev-player">${playerOptions}</select>
      <select id="ev-city">${cityOptionsHtml()}</select>
      <button class="btn-primary" id="ev-confirm">Airlift</button>`,
        confirm: (dispatch, cardUid, el) => {
          const playerEl = el.querySelector("#ev-player") as HTMLSelectElement;
          const cityEl = el.querySelector("#ev-city") as HTMLSelectElement;
          dispatch({
            type: "play-airlift",
            cardUid,
            playerId: playerEl.value,
            to: cityEl.value,
          });
        },
      };
    }

    case "resilient-population": {
      const seen = new Set<string>();
      const discardOptions = state.infectionDiscard
        .filter((c) => (seen.has(c) ? false : (seen.add(c), true)))
        .map(
          (c) =>
            `<option value="${c}">${escapeHtml(CITY_MAP[c].name)}</option>`,
        )
        .join("");
      if (state.infectionDiscard.length) {
        return {
          html: `
      <p class="modal-hint">Remove one card from the infection discard pile — permanently, out of the game.</p>
      <select id="ev-city">${discardOptions}</select>
      <button class="btn-primary" id="ev-confirm">Remove</button>`,
          confirm: (dispatch, cardUid, el) => {
            const cityEl = el.querySelector("#ev-city") as HTMLSelectElement;
            dispatch({
              type: "play-resilient-population",
              cardUid,
              cityId: cityEl.value,
            });
          },
        };
      }
      return {
        html: `
      <p class="modal-hint">The infection discard pile is empty — nothing to remove yet.</p>
      <button id="ev-cancel-only">Close</button>`,
        confirm: () => {},
      };
    }

    case "one-quiet-night":
      return {
        html: `
      <p class="modal-hint">Skip the next infection step entirely.</p>
      <button class="btn-primary" id="ev-confirm">Play One Quiet Night</button>`,
        confirm: (dispatch, cardUid) =>
          dispatch({ type: "play-one-quiet-night", cardUid }),
      };

    case "forecast":
      return {
        html: `
      <p class="modal-hint">Peek at the top of the Infection Deck and rearrange it.</p>
      <button class="btn-primary" id="ev-confirm">Peek</button>`,
        confirm: (dispatch, cardUid) =>
          dispatch({ type: "play-forecast", cardUid }),
      };
  }
}

/**
 * Modal that collects the parameters for an event card, then dispatches the
 * matching play action.
 */
export function renderEventModal(
  el: HTMLElement,
  state: GameState,
  myId: string,
  cardUid: string,
  event: EventId,
  dispatch: Dispatch,
  onClose: () => void,
): void {
  const me = state.players.find((p) => p.id === myId);
  if (!me) {
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }

  const body = buildEventBody(event, state, myId);

  el.style.display = "flex";
  el.innerHTML = `
    <div class="discard-modal">
      <h3>🃏 ${escapeHtml(eventName(event))}</h3>
      ${body.html}
      <button id="ev-cancel" style="margin-top:8px;">Cancel</button>
    </div>
  `;

  el.querySelector("#ev-cancel")?.addEventListener("click", onClose);
  el.querySelector("#ev-cancel-only")?.addEventListener("click", onClose);
  el.querySelector("#ev-confirm")?.addEventListener("click", () => {
    body.confirm(dispatch, cardUid, el);
    onClose();
  });
}
