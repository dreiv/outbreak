import { CITY_MAP } from "../../shared/src/boardData";
import type { CityDef, GameState, RegionId } from "../../shared/src/types";
import { REGION_META } from "../../shared/src/types";
import { sound } from "./sound";

const NAME_TO_ID = new Map<string, string>(
  Object.values(CITY_MAP).map((c) => [c.name, c.id]),
);
const REGION_IDS = new Set<string>(Object.keys(REGION_META));

const NS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function spawnPulse(
  fx: Element,
  city: CityDef,
  kind: "infect" | "outbreak",
  color?: string,
) {
  const ring = el("circle", {
    class: `fx-pulse fx-pulse-${kind}`,
    cx: String(city.x),
    cy: String(city.y),
    r: kind === "outbreak" ? "9" : "7",
  });
  if (color) ring.style.stroke = color;
  ring.style.setProperty("--fx-cx", `${city.x}px`);
  ring.style.setProperty("--fx-cy", `${city.y}px`);
  fx.appendChild(ring);
  window.setTimeout(() => ring.remove(), kind === "outbreak" ? 900 : 650);
}

function spawnTravel(fx: Element, from: CityDef, to: CityDef) {
  const line = el("line", {
    class: "fx-travel-trail",
    x1: String(from.x),
    y1: String(from.y),
    x2: String(to.x),
    y2: String(to.y),
  });
  fx.appendChild(line);

  const dot = el("circle", { class: "fx-travel-dot", r: "4" });
  const motion = document.createElementNS(NS, "animateMotion");
  motion.setAttribute("dur", "0.7s");
  motion.setAttribute("fill", "freeze");
  motion.setAttribute("path", `M${from.x},${from.y} L${to.x},${to.y}`);
  dot.appendChild(motion);
  fx.appendChild(dot);

  window.setTimeout(() => {
    line.remove();
    dot.remove();
  }, 750);
}

export type BannerKind = "outbreak" | "epidemic" | "cure";

export function showBanner(
  bannerEl: HTMLElement,
  kind: BannerKind,
  text: string,
) {
  bannerEl.textContent = text;
  bannerEl.className = `fx-banner show fx-banner-${kind}`;
  // restart the CSS animation if it's already mid-flight from a rapid second event
  void bannerEl.offsetWidth;
  window.setTimeout(() => bannerEl.classList.remove("show"), 1700);
}

/**
 * Diffs `prev` -> `next` and fires map animations / sound / toast banners for
 * whatever changed: player travel, new infection cubes, outbreaks,
 * epidemics, and cures. Safe to call every time a new state arrives —
 * no-ops cleanly when there's nothing to diff against (first load / new room).
 */
export function runEffects(
  svgEl: SVGSVGElement,
  bannerEl: HTMLElement,
  prev: GameState | null,
  next: GameState,
) {
  const fx = svgEl.querySelector(".fx");
  if (!fx || !prev || prev.roomId !== next.roomId) return;

  // --- player travel -------------------------------------------------
  let anyTravel = false;
  for (const p of next.players) {
    const before = prev.players.find((pl) => pl.id === p.id);
    if (before && before.location !== p.location) {
      const from = CITY_MAP[before.location];
      const to = CITY_MAP[p.location];
      if (from && to) {
        spawnTravel(fx, from, to);
        anyTravel = true;
      }
    }
  }
  if (anyTravel) sound.travel();

  // --- classify new log entries --------------------------------------
  const prevLogIds = new Set(prev.log.map((l) => l.id));
  const newEntries = next.log.filter((l) => !prevLogIds.has(l.id));

  let sawOutbreak = false;
  let sawEpidemic = false;
  let sawCure = false;
  let lastOutbreakCity: CityDef | null = null;
  let lastCureRegion: RegionId | null = null;

  for (const entry of newEntries) {
    const outbreakMatch = entry.text.match(/^Outbreak in (.+)! \(/);
    if (outbreakMatch) {
      sawOutbreak = true;
      const cityId = NAME_TO_ID.get(outbreakMatch[1]);
      const city = cityId ? CITY_MAP[cityId] : undefined;
      if (city) {
        spawnPulse(fx, city, "outbreak");
        lastOutbreakCity = city;
      }
      continue;
    }
    if (entry.text === "Epidemic!") {
      sawEpidemic = true;
      continue;
    }
    const eradicatedMatch = entry.text.match(/^(\w+) strain eradicated!$/);
    if (eradicatedMatch && REGION_IDS.has(eradicatedMatch[1])) {
      sawCure = true;
      lastCureRegion = eradicatedMatch[1] as RegionId;
      continue;
    }
    const cureMatch = entry.text.match(
      /discovered the cure for the (\w+) strain!/,
    );
    if (cureMatch && REGION_IDS.has(cureMatch[1])) {
      sawCure = true;
      lastCureRegion = cureMatch[1] as RegionId;
    }
  }

  // --- new infection cubes (independent of outbreak chains) ----------
  let anyInfect = false;
  for (const cityId of Object.keys(next.cityCubes)) {
    const nextRec = next.cityCubes[cityId] ?? {};
    const prevRec = prev.cityCubes[cityId] ?? {};
    for (const region of Object.keys(nextRec) as RegionId[]) {
      const n = nextRec[region] ?? 0;
      const p = prevRec[region] ?? 0;
      if (n > p) {
        const city = CITY_MAP[cityId];
        if (city) spawnPulse(fx, city, "infect", REGION_META[region].color);
        anyInfect = true;
      }
    }
  }

  // --- sound + banner (priority: epidemic > outbreak > cure > infect) -
  if (sawEpidemic) {
    sound.epidemic();
    showBanner(bannerEl, "epidemic", "⚠️ EPIDEMIC!");
  } else if (sawOutbreak) {
    sound.outbreak();
    showBanner(
      bannerEl,
      "outbreak",
      lastOutbreakCity
        ? `💥 OUTBREAK — ${lastOutbreakCity.name}`
        : "💥 OUTBREAK!",
    );
  } else if (sawCure) {
    sound.cure();
    showBanner(
      bannerEl,
      "cure",
      lastCureRegion
        ? `🧪 ${REGION_META[lastCureRegion].label.toUpperCase()} CURED`
        : "🧪 CURE DISCOVERED",
    );
  } else if (anyInfect) {
    sound.infection();
  }
}
