import { CITY_MAP } from "../../../shared/src/boardData";
import type {
  CityDef,
  GameState,
  PlayerCard,
  RegionId,
} from "../../../shared/src/types";
import { REGION_META } from "../../../shared/src/types";
import { sound } from "../services/sound";
import { escapeHtml } from "../utils/escape";
import { eventName } from "./labels";

const REGION_IDS = new Set<string>(Object.keys(REGION_META));
const SVG_NS = "http://www.w3.org/2000/svg";

const PULSE_LIFETIME_MS = { infect: 650, outbreak: 900 } as const;
const TRAVEL_LIFETIME_MS = 750;
const BANNER_LIFETIME_MS = 1700;
const DRAW_TOAST_LIFETIME_MS = 2600;

let drawToastTimer: number | null = null;

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function spawnPulse(
  fx: Element,
  city: CityDef,
  kind: "infect" | "outbreak",
  color?: string,
): void {
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
  window.setTimeout(() => ring.remove(), PULSE_LIFETIME_MS[kind]);
}

function spawnTravel(fx: Element, from: CityDef, to: CityDef): void {
  const line = el("line", {
    class: "fx-travel-trail",
    x1: String(from.x),
    y1: String(from.y),
    x2: String(to.x),
    y2: String(to.y),
  });
  fx.appendChild(line);

  const dot = el("circle", { class: "fx-travel-dot", r: "4" });
  const motion = document.createElementNS(SVG_NS, "animateMotion");
  motion.setAttribute("dur", "0.7s");
  motion.setAttribute("fill", "freeze");
  motion.setAttribute("path", `M${from.x},${from.y} L${to.x},${to.y}`);
  dot.appendChild(motion);
  fx.appendChild(dot);

  window.setTimeout(() => {
    line.remove();
    dot.remove();
  }, TRAVEL_LIFETIME_MS);
}

export type BannerKind = "outbreak" | "epidemic" | "cure";

export function showBanner(
  bannerEl: HTMLElement,
  kind: BannerKind,
  text: string,
): void {
  bannerEl.textContent = text;
  bannerEl.className = `fx-banner show fx-banner-${kind}`;
  // Force a reflow so the CSS animation restarts if a second event lands
  // mid-flight.
  void bannerEl.offsetWidth;
  window.setTimeout(
    () => bannerEl.classList.remove("show"),
    BANNER_LIFETIME_MS,
  );
}

interface LogSignals {
  sawOutbreak: boolean;
  sawEpidemic: boolean;
  sawCure: boolean;
  lastOutbreakCity: CityDef | null;
  lastCureRegion: RegionId | null;
}

/**
 * Classifies the new log entries since the previous state, flagging the
 * events that drive sound + banner (priority: epidemic > outbreak > cure).
 * Outbreak pulses are spawned here against the live `.fx` layer.
 */
function classifyLog(
  fx: Element,
  prev: GameState,
  next: GameState,
): LogSignals {
  const prevLogIds = new Set(prev.log.map((l) => l.id));
  const newEntries = next.log.filter((l) => !prevLogIds.has(l.id));

  const signals: LogSignals = {
    sawOutbreak: false,
    sawEpidemic: false,
    sawCure: false,
    lastOutbreakCity: null,
    lastCureRegion: null,
  };

  for (const entry of newEntries) {
    if (/^Outbreak in .+! \(/.test(entry.text)) {
      signals.sawOutbreak = true;
      // Prefer the structured cityId over parsing the display name.
      const city = entry.cityId ? CITY_MAP[entry.cityId] : undefined;
      if (city) {
        spawnPulse(fx, city, "outbreak");
        signals.lastOutbreakCity = city;
      }
      continue;
    }
    if (entry.text === "Epidemic!") {
      signals.sawEpidemic = true;
      continue;
    }
    const eradicatedMatch = entry.text.match(/^(\w+) strain eradicated!$/);
    if (eradicatedMatch && REGION_IDS.has(eradicatedMatch[1])) {
      signals.sawCure = true;
      signals.lastCureRegion = eradicatedMatch[1] as RegionId;
      continue;
    }
    const cureMatch = entry.text.match(
      /discovered the cure for the (\w+) strain!/,
    );
    if (cureMatch && REGION_IDS.has(cureMatch[1])) {
      signals.sawCure = true;
      signals.lastCureRegion = cureMatch[1] as RegionId;
    }
  }

  return signals;
}

/**
 * Diffs `prev` -> `next` and fires animations / sound / banners for what
 * changed. Safe to call on every state; no-ops with nothing to diff.
 */
export function runEffects(
  svgEl: SVGSVGElement,
  bannerEl: HTMLElement,
  prev: GameState | null,
  next: GameState,
  myId: string | null,
): void {
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
  const signals = classifyLog(fx, prev, next);

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
  if (signals.sawEpidemic) {
    sound.epidemic();
    showBanner(bannerEl, "epidemic", "⚠️ EPIDEMIC!");
  } else if (signals.sawOutbreak) {
    sound.outbreak();
    showBanner(
      bannerEl,
      "outbreak",
      signals.lastOutbreakCity
        ? `💥 OUTBREAK — ${signals.lastOutbreakCity.name}`
        : "💥 OUTBREAK!",
    );
  } else if (signals.sawCure) {
    sound.cure();
    showBanner(
      bannerEl,
      "cure",
      signals.lastCureRegion
        ? `🧪 ${REGION_META[signals.lastCureRegion].label.toUpperCase()} CURED`
        : "🧪 CURE DISCOVERED",
    );
  } else if (anyInfect) {
    sound.infection();
  }

  // --- reveal cards drawn into the local player's hand ---------------
  revealDrawnCards(prev, next, myId);
}

function cardLabel(c: PlayerCard): string {
  if (c.type === "epidemic") return "⚠️ Epidemic";
  if (c.type === "event") return `🃏 ${eventName(c.event)}`;
  return CITY_MAP[c.city].name;
}

/**
 * Briefly reveals the cards the local player just drew (by uid diff), so a
 * draw is visible rather than silently landing in the hand. Skipped when any
 * hand shrank (a share-knowledge "take" also grows a hand) and for epidemic
 * draws (already surfaced by the Epidemic banner).
 */
function revealDrawnCards(
  prev: GameState,
  next: GameState,
  myId: string | null,
): void {
  if (!myId) return;
  const prevMe = prev.players.find((p) => p.id === myId);
  const me = next.players.find((p) => p.id === myId);
  if (!prevMe || !me) return;

  const prevUids = new Set(prevMe.hand.map((c) => c.uid));
  const drawn = me.hand.filter((c) => !prevUids.has(c.uid));
  if (drawn.length === 0) return;

  // A "take" grows the receiver's hand while shrinking the giver's — don't
  // toast that as a draw.
  const anyShrank = next.players.some(
    (p) =>
      prev.players.find((pl) => pl.id === p.id)!.hand.length > p.hand.length,
  );
  if (anyShrank) return;

  const labels = drawn.map(cardLabel);
  showDrawToast(labels);
}

function showDrawToast(labels: string[]): void {
  const toast = document.getElementById("draw-toast");
  if (!toast) return;
  toast.innerHTML =
    `<span class="draw-toast-label">🃏 Drew</span>` +
    labels
      .map((l) => `<span class="draw-toast-card">${escapeHtml(l)}</span>`)
      .join("");
  toast.style.display = "flex";
  if (drawToastTimer !== null) window.clearTimeout(drawToastTimer);
  drawToastTimer = window.setTimeout(() => {
    toast.style.display = "none";
    toast.innerHTML = "";
    drawToastTimer = null;
  }, DRAW_TOAST_LIFETIME_MS);
}
