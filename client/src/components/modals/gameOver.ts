import type { GameState, RegionId } from "../../../../shared/src/types";
import { REGION_META } from "../../../../shared/src/types";
import { dispatch } from "../../state/appState";

/**
 * End-of-game overlay shown when the phase reaches "won" or "lost".
 */
export function renderGameOver(
  el: HTMLElement,
  state: GameState,
  myId: string | null,
): void {
  if (state.phase !== "won" && state.phase !== "lost") {
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }
  const won = state.phase === "won";

  const regions = Object.keys(REGION_META) as RegionId[];
  const curedCount = regions.filter(
    (r) => state.diseaseState[r] !== "active",
  ).length;

  const strainRows = regions
    .map((r) => {
      const meta = REGION_META[r];
      const st = state.diseaseState[r];
      const icon = st === "eradicated" ? "✦" : st === "cured" ? "✓" : "✕";
      return `
      <div class="go-strain ${st}">
        <span class="swatch" style="background:${meta.color}"></span>
        <span>${meta.label.replace(" Strain", "")}</span>
        <span class="go-strain-icon">${icon}</span>
      </div>`;
    })
    .join("");

  el.style.display = "flex";
  el.innerHTML = `
    <div class="gameover-card ${won ? "won" : "lost"}">
      <div class="go-icon">${won ? "🌍" : "☣️"}</div>
      <h1>${won ? "Outbreak Contained" : "Containment Failed"}</h1>
      <p class="go-sub">${
        won
          ? "All four strains have been cured. The world is safe — for now."
          : (state.lossReason ?? "The outbreak could not be stopped.")
      }</p>

      <div class="go-strains">${strainRows}</div>

      <div class="go-stats">
        <div class="go-stat"><b>${state.turnsPlayed}</b><span>turns played</span></div>
        <div class="go-stat"><b>${curedCount}/4</b><span>strains cured</span></div>
        <div class="go-stat"><b>${state.outbreakCounter}/${state.outbreakMax}</b><span>outbreaks</span></div>
        <div class="go-stat"><b>${state.epidemicsResolved}</b><span>epidemics</span></div>
      </div>

      <div class="go-actions">
        <button class="btn-primary" id="gameover-restart">Restart Game</button>
        <button class="btn-ghost" id="gameover-menu">Main Menu</button>
      </div>
    </div>
  `;

  el.querySelector("#gameover-restart")?.addEventListener("click", () => {
    if (myId) dispatch({ type: "restart-game" });
  });
  el.querySelector("#gameover-menu")?.addEventListener("click", () => {
    location.reload();
  });
}
