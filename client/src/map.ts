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

function shuttleStub(
  from: { x: number; y: number; name: string },
  to: { x: number; y: number; name: string },
  isLegalMove: boolean,
): string {
  // Shuttle edges exist specifically because the direct path between the
  // two cities isn't the real-world short way round (see isShuttleEdge's
  // doc comment) — so `from` always exits toward whichever map edge is
  // *away* from `to`'s direct-line direction: if `to` sits to the right,
  // the wrap-around path goes left off x=0, and vice versa.
  const edgeX = to.x > from.x ? 0 : MAP_WIDTH;
  // Both cities' stubs end at the same height (their midpoint y, not
  // `from`'s own y) so the two dashed stubs visually line up with each
  // other across the two edges — e.g. Sydney sits much further south than
  // LA, so ending each stub at its own city's latitude would send them off
  // the map at two unrelated heights and they'd no longer read as "this
  // connects to that" the way matching heights on opposite edges do.
  const edgeY = (from.y + to.y) / 2;
  const classes = ["edge-line", "shuttle"];
  if (isLegalMove) classes.push("legal");
  return `
    <line class="${classes.join(" ")}" x1="${from.x}" y1="${from.y}" x2="${edgeX}" y2="${edgeY}">
      <title>Shuttle route: ${from.name} ↔ ${to.name}</title>
    </line>`;
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
    // panzoom's bounds check only requires the content to still overlap a
    // window this fraction in from each edge of the *container* — with the
    // previous 0.15 that window is a loose [15%,85%] box, so it only stops
    // you once the content has *almost entirely* left view, not while
    // you're dragging toward that. A bigger fraction shrinks that window
    // (0.3 -> content must always overlap the central 40%), so you're
    // stopped well before the view is mostly empty margin around a sliver
    // of map in one corner.
    boundsPadding: 0.3,
    zoomDoubleClickSpeed: 1,
    smoothScroll: true,
    beforeWheel: (e) => {
      // Allow plain wheel scroll (no modifier needed) but don't hijack the
      // page scroll if the pointer isn't over the map.
      e.preventDefault();
      return false;
    },
  });

  const applyZoom = () => {
    const scale = instance.getTransform().scale;
    wrapEl.classList.toggle("zoomed-in", scale >= LABEL_REVEAL_ZOOM);
    const invZoom = 1 / scale;
    // Stashed so renderMap() can re-apply the current zoom to freshly
    // created `.node-scale` groups after a state update rebuilds them —
    // otherwise every re-render (i.e. after every game action) would
    // briefly reset markers to full map-zoom size until the next pan/zoom
    // interaction happened to fire a "transform" event.
    svgEl.dataset.invZoom = String(invZoom);
    applyNodeScale(svgEl, invZoom);
  };
  instance.on("transform", applyZoom);
  // Apply immediately (rather than waiting for the first "transform" event)
  // so markers/labels aren't briefly rendered at the wrong size before any
  // zoom/pan interaction has happened.
  applyZoom();

  return instance;
}

// Every marker's on-map visuals (pin, station ring, label, cube badges,
// pawns) live in a `.node-scale` group nested inside a
// `translate(cx, cy)` — see renderMap. Counter-scaling that inner group
// keeps the whole marker (not just its text) a constant, readable size
// regardless of map zoom, and — because everything under it shares the
// same local (0,0) origin the translate already placed at the city's exact
// position — it does so without any risk of drifting off that position,
// unlike trying to pivot a CSS `transform-origin` on each element
// individually (which is what the previous approach did, and which broke
// in a subtly different way for labels vs. badges vs. the marker itself).
// This is the standard technique zoomable-map libraries (Leaflet, Mapbox,
// etc.) use for "the pin stays pin-sized" markers.
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

      if (isShuttleEdge(city.id, conn)) {
        // A straight line between these two would cut directly across the
        // whole map (through Asia/the Middle East/Europe) rather than
        // across the Pacific, because this projection isn't Pacific-
        // centered — Greenwich sits in the middle, so the Pacific is split
        // across the map's two vertical edges. The real Pandemic board's
        // dashed Los Angeles<->Tokyo / Los Angeles<->Sydney lines have the
        // same problem and solve it the same way: each end just runs off
        // its nearest edge, implying the route wraps around off-map,
        // rather than drawing a single connecting line across the middle.
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

    // Everything below is positioned relative to LOCAL (0,0) — the outer
    // <g> translates the whole node to the city's actual map position, and
    // the inner .node-scale <g> counter-scales it against the current zoom
    // (see applyNodeScale). Because every part of the marker shares this
    // same local origin, the whole thing (pin, ring, label, badges, pawns)
    // scales and stays anchored together as one unit — nothing can drift
    // out of alignment with anything else, at any zoom level.
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
    // The groups just created above start with no transform (i.e.
    // full map-zoom scale) until the next pan/zoom "transform" event —
    // re-apply the zoom level that was already in effect immediately so a
    // mid-zoom state update (which happens after every game action)
    // doesn't cause a one-frame flash of oversized markers.
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