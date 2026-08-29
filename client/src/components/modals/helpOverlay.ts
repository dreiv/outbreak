import { EVENTS, ROLES } from "../../../../shared/src/types";

/**
 * "How to play" overlay: core rules plus the full role and event-card
 * reference.
 */
export function renderHelpOverlay(el: HTMLElement, onClose: () => void): void {
  const roleItems = ROLES.map(
    (r) => `
    <div class="help-role">
      <div class="help-role-name">${r.name}</div>
      <div class="help-role-desc">${r.description}</div>
    </div>
  `,
  ).join("");
  const eventItems = EVENTS.map(
    (e) => `
    <div class="help-role">
      <div class="help-role-name">🃏 ${e.name}</div>
      <div class="help-role-desc">${e.description}</div>
    </div>
  `,
  ).join("");

  el.style.display = "flex";
  el.innerHTML = `
    <div class="discard-modal help-modal">
      <button class="close-btn" id="help-close" aria-label="Close">✕</button>
      <h3>How to Play</h3>
      <ul class="help-list">
        <li>On your turn you get 4 actions: drive/ferry to a connected city, fly (direct/charter/shuttle), treat disease cubes, build a research station, share knowledge, or discover a cure.</li>
        <li>Click a city on the map to see the actions available there. Cities connected to your current location are outlined in blue.</li>
        <li>After actions, draw 2 player cards (watch for Epidemic cards) and resolve that many infection cards.</li>
        <li>Cure all four strains to win. Too many outbreaks, running out of disease cubes, or an empty player deck ends the game in a loss.</li>
        <li>Event cards (🃏 in your hand) can be played anytime — even outside your turn — and never cost an action.</li>
      </ul>
      <h3>Roles</h3>
      <div class="help-roles">${roleItems}</div>
      <h3>Event Cards</h3>
      <div class="help-roles">${eventItems}</div>
    </div>
  `;
  el.querySelector("#help-close")?.addEventListener("click", onClose);
  el.addEventListener("click", (e) => {
    if (e.target === el) onClose();
  });
}
