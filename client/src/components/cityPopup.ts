import { CITY_MAP } from "../../../shared/src/boardData";
import type { GameState, RegionId } from "../../../shared/src/types";
import { REGION_META } from "../../../shared/src/types";
import { escapeHtml } from "../utils/escape";
import type { Dispatch } from "../types";

interface PopupPosition {
  x: number;
  y: number;
}

interface ActionButton {
  label: string;
  id: string;
}

/**
 * Renders the contextual action popup for a clicked city: the disease cubes
 * present, plus the legal actions available to the acting player from that
 * city (travel, treat, build, share, discover-cure).
 */
export function renderCityPopup(
  el: HTMLElement,
  state: GameState,
  myId: string,
  cityId: string,
  pos: PopupPosition,
  dispatch: Dispatch,
  onClose: () => void,
  onNeedCureCards: (region: RegionId) => void,
): void {
  const me = state.players.find((p) => p.id === myId)!;
  const city = CITY_MAP[cityId];
  const isMyTurn =
    state.turnOrder[state.currentPlayerIndex] === myId &&
    state.phase === "playing";
  const hereIsCurrent = cityId === me.location;

  const cubes = Object.entries(state.cityCubes[cityId] ?? {}) as [
    RegionId,
    number,
  ][];
  const cubeRow =
    cubes
      .filter(([, n]) => n > 0)
      .map(
        ([r, n]) =>
          `<span class="cube-chip" style="background:${REGION_META[r].color}">${REGION_META[r].label} × ${n}</span>`,
      )
      .join("") || '<span class="empty-hint">No cubes here.</span>';

  const actions: ActionButton[] = [];
  const addBtn = (label: string, id: string) => actions.push({ label, id });

  if (isMyTurn) {
    if (hereIsCurrent) {
      for (const [region] of cubes.filter(([, n]) => n > 0)) {
        addBtn(`Treat ${REGION_META[region].label}`, `treat:${region}`);
      }
      if (!state.researchStations.includes(cityId)) {
        addBtn("Build Research Station", "build-station");
      }
      if (state.researchStations.includes(cityId)) {
        for (const region of Object.keys(REGION_META) as RegionId[]) {
          if (state.diseaseState[region] === "active") {
            const needed = me.role === "virologist" ? 4 : 5;
            const have = me.hand.filter(
              (c) => c.type === "city" && CITY_MAP[c.city].region === region,
            ).length;
            addBtn(
              `Discover Cure — ${REGION_META[region].label} (${have}/${needed})`,
              `cure:${region}`,
            );
          }
        }
      }
      const shareTargets = state.players.filter((p) => p.id !== myId);
      for (const other of shareTargets) {
        const colocated = other.location === cityId;
        const courierInvolved =
          me.role === "courier" || other.role === "courier";
        // Sharing needs same city, unless a Courier is involved (their ability
        // relaxes that).
        if (!colocated && !courierInvolved) continue;
        const remoteTag = colocated ? "" : " (remote)";
        const flexible =
          me.role === "liaison-officer" || other.role === "liaison-officer";

        if (flexible) {
          // Liaison Officer can share *any* card, not just the current-city
          // one — so offer a button per card actually in the giver's hand.
          for (const card of me.hand) {
            if (card.type !== "city") continue;
            addBtn(
              `Give ${CITY_MAP[card.city].name} card to ${escapeHtml(other.name)}${remoteTag}`,
              `share-give:${other.id}:${card.city}`,
            );
          }
          for (const card of other.hand) {
            if (card.type !== "city") continue;
            addBtn(
              `Take ${CITY_MAP[card.city].name} card from ${escapeHtml(other.name)}${remoteTag}`,
              `share-take:${other.id}:${card.city}`,
            );
          }
        } else {
          const cardHereMine = me.hand.find(
            (c) => c.type === "city" && c.city === cityId,
          );
          const cardHereTheirs = other.hand.find(
            (c) => c.type === "city" && c.city === cityId,
          );
          if (cardHereMine)
            addBtn(
              `Give card to ${escapeHtml(other.name)}${remoteTag}`,
              `share-give:${other.id}:${cityId}`,
            );
          if (cardHereTheirs)
            addBtn(
              `Take card from ${escapeHtml(other.name)}${remoteTag}`,
              `share-take:${other.id}:${cityId}`,
            );
        }
      }
    } else {
      if (CITY_MAP[me.location].connections.includes(cityId)) {
        addBtn(`Drive/Ferry to ${city.name}`, "drive");
      }
      const hasTargetCard = me.hand.some(
        (c) => c.type === "city" && c.city === cityId,
      );
      if (hasTargetCard)
        addBtn(`Direct Flight to ${city.name}`, "direct-flight");
      const hasCurrentCard = me.hand.some(
        (c) => c.type === "city" && c.city === me.location,
      );
      if (hasCurrentCard)
        addBtn(`Charter Flight to ${city.name}`, "charter-flight");
      if (
        state.researchStations.includes(cityId) &&
        state.researchStations.includes(me.location)
      ) {
        addBtn(`Shuttle Flight to ${city.name}`, "shuttle-flight");
      }
    }
  }

  el.style.left = `${pos.x}px`;
  el.style.top = `${pos.y}px`;
  el.innerHTML = `
    <button class="close-btn" id="popup-close" aria-label="Close">✕</button>
    <h3>${city.name} <span class="popup-region">(${REGION_META[city.region].label.replace(" Strain", "")})</span></h3>
    <div class="cube-row">${cubeRow}</div>
    ${
      actions.length
        ? actions
            .map(
              (a) =>
                `<button class="action-btn" data-act="${a.id}">${a.label}</button>`,
            )
            .join("")
        : '<div class="empty-hint">No actions available here right now.</div>'
    }
  `;
  el.querySelector("#popup-close")?.addEventListener("click", onClose);
  el.querySelectorAll<HTMLButtonElement>(".action-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const act = btn.dataset.act!;
      if (act === "drive") dispatch({ type: "drive", to: cityId });
      else if (act === "direct-flight")
        dispatch({ type: "direct-flight", to: cityId });
      else if (act === "charter-flight")
        dispatch({ type: "charter-flight", to: cityId });
      else if (act === "shuttle-flight")
        dispatch({ type: "shuttle-flight", to: cityId });
      else if (act === "build-station") dispatch({ type: "build-station" });
      else if (act.startsWith("treat:"))
        dispatch({ type: "treat", region: act.split(":")[1] as RegionId });
      else if (act.startsWith("cure:")) {
        onNeedCureCards(act.split(":")[1] as RegionId);
        return;
      } else if (act.startsWith("share-give:")) {
        const [, otherId, cardCity] = act.split(":");
        dispatch({
          type: "share-knowledge",
          withPlayerId: otherId,
          cityCard: cardCity,
          direction: "give",
        });
      } else if (act.startsWith("share-take:")) {
        const [, otherId, cardCity] = act.split(":");
        dispatch({
          type: "share-knowledge",
          withPlayerId: otherId,
          cityCard: cardCity,
          direction: "take",
        });
      }
      onClose();
    });
  });
}

export type { PopupPosition };
