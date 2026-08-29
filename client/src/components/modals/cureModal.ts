import { CITY_MAP } from "../../../../shared/src/boardData";
import type {
  GameState,
  PlayerCard,
  RegionId,
} from "../../../../shared/src/types";
import { REGION_META } from "../../../../shared/src/types";
import type { Dispatch } from "../../types";

/**
 * Modal that collects the exact set of matching city cards required to
 * discover a cure for a region.
 */
export function renderCureModal(
  el: HTMLElement,
  state: GameState,
  myId: string,
  region: RegionId,
  dispatch: Dispatch,
  onClose: () => void,
): void {
  const me = state.players.find((p) => p.id === myId)!;
  const needed = me.role === "virologist" ? 4 : 5;
  const matching = me.hand.filter(
    (c) => c.type === "city" && CITY_MAP[c.city].region === region,
  ) as (PlayerCard & { type: "city" })[];

  const items =
    matching
      .map(
        (c) => `
    <label><input type="checkbox" value="${c.uid}" /> ${CITY_MAP[c.city].name}</label>
  `,
      )
      .join("") || '<div class="empty-hint">No matching cards.</div>';

  el.innerHTML = `
    <div class="discard-modal">
      <h3>Discover Cure — ${REGION_META[region].label}</h3>
      <p class="modal-hint">Select exactly ${needed} matching city cards.</p>
      <div class="cure-select-list">${items}</div>
      <button class="btn-primary" id="cure-submit">Discover Cure</button>
      <button class="btn-secondary" id="cure-cancel" style="margin-top:8px; width:100%;">Cancel</button>
    </div>
  `;
  el.style.display = "flex";
  el.querySelector("#cure-cancel")?.addEventListener("click", onClose);
  el.querySelector("#cure-submit")?.addEventListener("click", () => {
    const checked = Array.from(
      el.querySelectorAll<HTMLInputElement>("input[type=checkbox]:checked"),
    ).map((i) => i.value);
    if (checked.length !== needed) {
      window.alert(`Select exactly ${needed} cards.`);
      return;
    }
    dispatch({ type: "discover-cure", region, cardUids: checked });
    onClose();
  });
}
