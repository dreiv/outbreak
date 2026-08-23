import createPanZoom, { PanZoom } from "panzoom";
import {
  CITIES,
  CITY_MAP,
  MAP_WIDTH,
  MAP_HEIGHT,
} from "../../shared/src/boardData";
import type { GameState, RegionId } from "../../shared/src/types";
import { REGION_META } from "../../shared/src/types";
import { LAND_PATH } from "./worldLand";

const PLAYER_COLORS = ["#f472b6", "#facc15", "#60a5fa", "#34d399"];

// Below this zoom scale, only "major" cities show labels — otherwise a
// fully-zoomed-out board is a wall of overlapping text. See `major` in
// shared/src/boardData.ts.
const LABEL_REVEAL_ZOOM = 1.6;

function regionsWithCubes(
  state: GameState,
  cityId: string,
): [RegionId, number][] {
  const rec = state.cityCubes[cityId];
  if (!rec) return [];
  return (Object.entries(rec) as [RegionId, number][]).filter(([, n]) => n > 0);
}

// ---------------------------------------------------------------------------
// One-time setup: the static SVG structure (landmass + empty edge/node
// groups) and the pan/zoom controller live for the lifetime of the game
// screen. renderMap() below only ever touches the contents of `.edges` and
// `.nodes` so the pan/zoom instance (and the user's current view) survives
// every state update.
// ---------------------------------------------------------------------------

export interface MapController {
  panzoom: PanZoom;
  wrapEl: HTMLElement;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  destroy: () => void;
}

function attachPanzoom(
  svgEl: SVGSVGElement,
  viewport: SVGGElement,
  wrapEl: HTMLElement,
): PanZoom {
  svgEl.setAttribute("viewBox", `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`);
  svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");

  const instance = createPanZoom(viewport, {
    minZoom: 1,
    maxZoom: 10,
    bounds: true,
    boundsPadding: 0.15,
    zoomDoubleClickSpeed: 1,
    smoothScroll: true,
    beforeWheel: (e) => {
      // Allow plain wheel scroll (no modifier needed) but don't hijack the
      // page scroll if the pointer isn't over the map.
      e.preventDefault();
      return false;
    },
  });

  instance.on("transform", () => {
    const scale = instance.getTransform().scale;
    wrapEl.classList.toggle("zoomed-in", scale >= LABEL_REVEAL_ZOOM);
  });

  return instance;
}

export function initMap(
  svgEl: SVGSVGElement,
  wrapEl: HTMLElement,
): MapController {
  svgEl.innerHTML = `
    <g class="viewport">
      <path class="landmass" d="${LAND_PATH}" />
      <g class="edges"></g>
      <g class="nodes"></g>
      <g class="fx"></g>
    </g>
  `;
  const viewport = svgEl.querySelector(".viewport") as SVGGElement;
  let panzoom = attachPanzoom(svgEl, viewport, wrapEl);

  const center = () => {
    const rect = wrapEl.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };

  function reinit() {
    // panzoom bakes the SVG's viewBox->pixel scale into the transform once,
    // at attach time (by reading the viewport <g>'s current CTM), then
    // removes the viewBox and applies further pan/zoom as a `transform`
    // attribute directly on that <g>. Re-attaching against a fresh viewBox
    // both (a) restores the fitted, fully-zoomed-out view (used for "reset")
    // and (b) re-fits after the container is resized (window resize, sidebar
    // breakpoint change), where the old baked-in scale would otherwise go
    // stale.
    //
    // panzoom.dispose() only removes its event listeners — it does NOT clear
    // the `transform` attribute it already wrote onto the viewport <g>, and
    // does not restore the SVG's viewBox either. If we re-attach without
    // clearing that leftover transform first, the new instance's initial
    // CTM read is the fresh viewBox scale *compounded* with the old baked-in
    // transform, producing a wrong (sometimes wildly zoomed-in, sometimes
    // offset) default view — this is the "scales by default" / "sometimes
    // resets wrong" bug. Clearing it first guarantees a clean baseline.
    panzoom.dispose();
    viewport.removeAttribute("transform");
    svgEl.setAttribute("viewBox", `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`);
    panzoom = attachPanzoom(svgEl, viewport, wrapEl);
    wrapEl.classList.remove("zoomed-in");
  }

  let resizeTimer: number | undefined;
  const onResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(reinit, 150);
  };
  window.addEventListener("resize", onResize);

  return {
    get panzoom() {
      return panzoom;
    },
    wrapEl,
    zoomIn: () => {
      const c = center();
      panzoom.smoothZoom(c.x, c.y, 1.5);
    },
    zoomOut: () => {
      const c = center();
      panzoom.smoothZoom(c.x, c.y, 1 / 1.5);
    },
    resetView: reinit,
    destroy: () => {
      window.removeEventListener("resize", onResize);
      panzoom.dispose();
    },
  } as MapController;
}

export function renderMap(
  svgEl: SVGSVGElement,
  state: GameState,
  myPlayerId: string | null,
  selectedCity: string | null,
) {
  const me = state.players.find((p) => p.id === myPlayerId);
  const myLocation = me?.location ?? null;

  const edgesSvg: string[] = [];
  const seen = new Set<string>();
  for (const city of CITIES) {
    for (const conn of city.connections) {
      const key = [city.id, conn].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const b = CITY_MAP[conn];
      const isLegalMove =
        myLocation != null && (city.id === myLocation || conn === myLocation);
      edgesSvg.push(
        `<line class="edge-line${isLegalMove ? " legal" : ""}" x1="${city.x}" y1="${city.y}" x2="${b.x}" y2="${b.y}" />`,
      );
    }
  }

  const nodesSvg: string[] = CITIES.map((city) => {
    const isCurrent = city.id === myLocation;
    const isSelected = city.id === selectedCity;
    const connectedHint =
      myLocation != null && CITY_MAP[myLocation].connections.includes(city.id);
    const hasStation = state.researchStations.includes(city.id);
    const classes = ["city-node"];
    if (isCurrent) classes.push("current");
    if (isSelected) classes.push("selected");
    if (connectedHint) classes.push("connected-hint");
    if (hasStation) classes.push("station");
    if (city.major) classes.push("major");

    const cubes = regionsWithCubes(state, city.id);
    const cubeBadges = cubes
      .map(([region, count], i) => {
        const bx = city.x + 11 + i * 14;
        const by = city.y - 13;
        return `
        <circle cx="${bx}" cy="${by}" r="6.5" fill="${REGION_META[region].color}" stroke="#06101f" stroke-width="1" />
        <text x="${bx}" y="${by + 3}" text-anchor="middle" class="cube-badge">${count}</text>
      `;
      })
      .join("");

    const stationRing = hasStation
      ? `<rect class="station-ring" x="${city.x - 10}" y="${city.y - 10}" width="20" height="20" rx="4" />`
      : "";

    const playersHere = state.players.filter((p) => p.location === city.id);
    const pawns = playersHere
      .map((p, i) => {
        const idx = state.players.findIndex((pl) => pl.id === p.id);
        const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
        const px = city.x - 11 + i * 7.5;
        const py = city.y + 13;
        return `<circle class="pawn" cx="${px}" cy="${py}" r="3.8" fill="${color}" />`;
      })
      .join("");

    return `
      <g class="${classes.join(" ")}" data-city="${city.id}">
        ${stationRing}
        <circle class="hit-target" cx="${city.x}" cy="${city.y}" r="15" />
        <circle class="base" cx="${city.x}" cy="${city.y}" r="7" />
        <text class="label" x="${city.x}" y="${city.y - 15}" text-anchor="middle"
              paint-order="stroke" stroke="#070d18" stroke-width="3" stroke-linejoin="round">${city.name}</text>
        ${cubeBadges}
        ${pawns}
      </g>
    `;
  });

  const edgesGroup = svgEl.querySelector(".edges");
  const nodesGroup = svgEl.querySelector(".nodes");
  if (edgesGroup) edgesGroup.innerHTML = edgesSvg.join("");
  if (nodesGroup) nodesGroup.innerHTML = nodesSvg.join("");
}

export function attachMapClickHandler(
  svgEl: SVGSVGElement,
  onCityClick: (cityId: string, evt: MouseEvent) => void,
) {
  svgEl.addEventListener("click", (evt) => {
    const target = (evt.target as Element).closest(
      ".city-node",
    ) as SVGGElement | null;
    if (!target) return;
    const cityId = target.getAttribute("data-city");
    if (cityId) onCityClick(cityId, evt);
  });
}