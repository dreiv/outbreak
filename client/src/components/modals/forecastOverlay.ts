import { CITY_MAP } from "../../../../shared/src/boardData";
import type { GameState } from "../../../../shared/src/types";
import { escapeHtml } from "../../utils/escape";
import type { Dispatch } from "../../types";

/**
 * Forecast reorder overlay — shown once the server reveals the top cards of
 * the Infection Deck so the acting player can rearrange them before they're
 * applied.
 */
export function renderForecastOverlay(
  el: HTMLElement,
  state: GameState,
  myId: string,
  order: string[],
  setOrder: (next: string[]) => void,
  dispatch: Dispatch,
): void {
  if (!state.pendingForecast || state.pendingForecast.playerId !== myId) {
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }
  const rows = order
    .map(
      (cityId, i) => `
      <div class="hand-card">
        <span>${i + 1}. ${escapeHtml(CITY_MAP[cityId].name)}</span>
        <span>
          <button data-dir="up" data-idx="${i}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
          <button data-dir="down" data-idx="${i}" ${i === order.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
        </span>
      </div>`,
    )
    .join("");

  el.style.display = "flex";
  el.innerHTML = `
    <div class="discard-modal">
      <h3>🔮 Forecast</h3>
      <p class="modal-hint">Top of the Infection Deck, in draw order (1 = drawn next). Reorder as you like, then confirm.</p>
      <div class="hand-list">${rows}</div>
      <button class="btn-primary" id="forecast-confirm" style="margin-top:8px;">Confirm Order</button>
    </div>
  `;

  el.querySelectorAll<HTMLButtonElement>("button[data-idx]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.idx);
      const j = btn.dataset.dir === "up" ? i - 1 : i + 1;
      const next = order.slice();
      [next[i], next[j]] = [next[j], next[i]];
      setOrder(next);
    });
  });
  el.querySelector("#forecast-confirm")?.addEventListener("click", () => {
    dispatch({ type: "resolve-forecast", order });
  });
}
