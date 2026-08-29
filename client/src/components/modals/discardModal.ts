import { CITY_MAP } from "../../../../shared/src/boardData";
import type { GameState, PlayerCard } from "../../../../shared/src/types";
import { escapeHtml } from "../../utils/escape";
import type { Dispatch } from "../../types";
import { eventName } from "../labels";

function cardLabel(c: PlayerCard): string {
  if (c.type === "epidemic") return "⚠️ Epidemic";
  if (c.type === "event") return `🃏 ${eventName(c.event)}`;
  return CITY_MAP[c.city].name;
}

/**
 * Forced discard modal shown when a player's hand exceeds the limit.
 */
export function renderDiscardModal(
  el: HTMLElement,
  state: GameState,
  myId: string,
  dispatch: Dispatch,
): void {
  const me = state.players.find((p) => p.id === myId);
  if (!state.pendingDiscard || state.pendingDiscard.playerId !== myId || !me) {
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }
  const over = me.hand.length - state.pendingDiscard.mustDiscardTo;
  const items = me.hand
    .map(
      (c) =>
        `<div class="hand-card"><span>${escapeHtml(cardLabel(c))}</span><button data-uid="${c.uid}">Discard</button></div>`,
    )
    .join("");

  el.style.display = "flex";
  el.innerHTML = `
    <div class="discard-modal">
      <h3>Hand limit exceeded</h3>
      <p class="modal-hint">Discard ${over} more card${over === 1 ? "" : "s"} to continue.</p>
      <div class="hand-list">${items}</div>
    </div>
  `;
  el.querySelectorAll<HTMLButtonElement>("button[data-uid]").forEach((btn) => {
    btn.addEventListener("click", () =>
      dispatch({ type: "discard", cardUid: btn.dataset.uid! }),
    );
  });
}
