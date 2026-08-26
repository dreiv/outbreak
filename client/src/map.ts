import createPanZoom, { PanZoom } from "panzoom";
import {
  CITIES,
  CITY_MAP,
  MAP_WIDTH,
  MAP_HEIGHT,
  isShuttleEdge,
} from "../../shared/src/boardData";
import type { GameState, RegionId } from "../../shared/src/types";
import { REGION_META } from "../../shared/src/types";
import { LAND_PATH } from "./worldLand";

const PLAYER_COLORS = ["#f472b6", "#facc15", "#60a5fa", "#34d399"];

// Below this zoom, only "major" cities show labels (see boardData.ts).
const LABEL_REVEAL_ZOOM = 1.6;

function regionsWithCubes(
  state: GameState,
  cityId: string,
): [RegionId, number][] {
  const rec = state.cityCubes[cityId];
  if (!rec) return [];
  return (Object.entries(rec) as [RegionId, number][]).filter(([, n]) => n > 0);
}

function shuttleStub(
  from: { x: number; y: number; name: string },
  to: { x: number; y: number; name: string },
  isLegalMove: boolean,
): string {
  // `from` exits toward the map edge *away* from `to`'s direct-line
  // direction, so the wrap-around reads as the long way round.
  const edgeX = to.x > from.x ? 0 : MAP_WIDTH;
  // Both stubs end at the midpoint y so they line up across the two edges.
  const edgeY = (from.y + to.y) / 2;
  const classes = ["edge-line", "shuttle"];
  if (isLegalMove) classes.push("legal");
  return `
    <line class="${classes.join(" ")}" x1="${from.x}" y1="${from.y}" x2="${edgeX}" y2="${edgeY}">
      <title>Shuttle route: ${from.name} ↔ ${to.name}</title>
    </line>`;
}

// One-time setup: the static SVG structure and pan/zoom controller live for
// the lifetime of the game screen. renderMap() only touches `.edges`/`.nodes`
// so the pan/zoom instance (and the user's view) survives every state update.

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
    // 0.3 keeps the content overlapping the central 40% so you can't pan
    // the map almost entirely off-view.
    boundsPadding: 0.3,
    zoomDoubleClickSpeed: 1,
    smoothScroll: true,
    beforeWheel: (e) => {
      // Plain wheel scroll, no modifier needed.
      e.preventDefault();
      return false;
    },
  });

  const applyZoom = () => {
    const scale = instance.getTransform().scale;
    wrapEl.classList.toggle("zoomed-in", scale >= LABEL_REVEAL_ZOOM);
    const invZoom = 1 / scale;
    // Stashed so renderMap() can re-apply zoom to freshly rebuilt `.node-scale`
    // groups (otherwise markers flash at full size after each state update).
    svgEl.dataset.invZoom = String(invZoom);
    applyNodeScale(svgEl, invZoom);
  };
  instance.on("transform", applyZoom);
  applyZoom();

  return instance;
}

// Counter-scales each marker's `.node-scale` group so the whole marker stays
// a constant, readable size at any zoom (the standard "pin stays pin-sized"
// technique). Everything under it shares the city's local (0,0) origin, so
// nothing drifts off-position.
function applyNodeScale(svgEl: SVGSVGElement, invZoom: number) {
  svgEl.querySelectorAll<SVGGElement>(".node-scale").forEach((g) => {
    g.setAttribute("transform", `scale(${invZoom})`);
  });
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
    // Re-attach against a fresh viewBox to restore the fitted view (reset)
    // and re-fit after container resizes. panzoom.dispose() does NOT clear
    // the `transform` it wrote on the viewport <g>, so clear it first —
    // otherwise the new instance compounds the old transform and the
    // default view comes out wrong.
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

      if (isShuttleEdge(city.id, conn)) {
        // A straight line would cut across the whole map (this projection
        // isn't Pacific-centered), so each end runs off its nearest edge to
        // imply the route wraps around off-map.
        edgesSvg.push(shuttleStub(city, b, isLegalMove));
        edgesSvg.push(shuttleStub(b, city, isLegalMove));
        continue;
      }

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

    // Positioned relative to LOCAL (0,0): the outer <g> translates to the
    // city, the inner .node-scale <g> counter-scales against zoom (see
    // applyNodeScale), so the whole marker stays anchored as one unit.
    const cubes = regionsWithCubes(state, city.id);
    const cubeBadges = cubes
      .map(([region, count], i) => {
        const bx = 11 + i * 14;
        const by = -13;
        return `
        <g class="cube-badge-group">
          <circle cx="${bx}" cy="${by}" r="6.5" fill="${REGION_META[region].color}" stroke="#06101f" stroke-width="1" />
          <text x="${bx}" y="${by + 3}" text-anchor="middle" class="cube-badge">${count}</text>
        </g>
      `;
      })
      .join("");

    const stationRing = hasStation
      ? `<rect class="station-ring" x="-10" y="-10" width="20" height="20" rx="4" />`
      : "";

    const playersHere = state.players.filter((p) => p.location === city.id);
    const pawns = playersHere
      .map((p, i) => {
        const idx = state.players.findIndex((pl) => pl.id === p.id);
        const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
        const px = -11 + i * 7.5;
        const py = 13;
        return `<circle class="pawn" cx="${px}" cy="${py}" r="3.8" fill="${color}" />`;
      })
      .join("");

    return `
      <g class="${classes.join(" ")}" data-city="${city.id}" transform="translate(${city.x} ${city.y})">
        <g class="node-scale">
          ${stationRing}
          <circle class="hit-target" cx="0" cy="0" r="15" />
          <circle class="base" cx="0" cy="0" r="7" />
          <text class="label" x="0" y="-15" text-anchor="middle"
                paint-order="stroke" stroke="#070d18" stroke-width="3" stroke-linejoin="round">${city.name}</text>
          ${cubeBadges}
          ${pawns}
        </g>
      </g>
    `;
  });

  const edgesGroup = svgEl.querySelector(".edges");
  const nodesGroup = svgEl.querySelector(".nodes");
  if (edgesGroup) edgesGroup.innerHTML = edgesSvg.join("");
  if (nodesGroup) {
    nodesGroup.innerHTML = nodesSvg.join("");
    // Re-apply the current zoom immediately so a mid-zoom state update
    // doesn't flash oversized markers for a frame.
    const invZoom = Number(svgEl.dataset.invZoom) || 1;
    applyNodeScale(svgEl, invZoom);
  }
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