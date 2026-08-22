import { CITIES, CITY_MAP } from '../../shared/src/boardData';
import type { GameState, RegionId } from '../../shared/src/types';
import { REGION_META } from '../../shared/src/types';

const PLAYER_COLORS = ['#f472b6', '#facc15', '#60a5fa', '#34d399'];

function regionsWithCubes(state: GameState, cityId: string): [RegionId, number][] {
  const rec = state.cityCubes[cityId];
  if (!rec) return [];
  return (Object.entries(rec) as [RegionId, number][]).filter(([, n]) => n > 0);
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
      const key = [city.id, conn].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const b = CITY_MAP[conn];
      edgesSvg.push(
        `<line class="edge-line" x1="${city.x}" y1="${city.y}" x2="${b.x}" y2="${b.y}" />`,
      );
    }
  }

  const nodesSvg: string[] = CITIES.map((city) => {
    const isCurrent = city.id === myLocation;
    const isSelected = city.id === selectedCity;
    const connectedHint = myLocation != null && CITY_MAP[myLocation].connections.includes(city.id);
    const hasStation = state.researchStations.includes(city.id);
    const classes = ['city-node'];
    if (isCurrent) classes.push('current');
    if (isSelected) classes.push('selected');
    if (connectedHint) classes.push('connected-hint');
    if (hasStation) classes.push('station');

    const cubes = regionsWithCubes(state, city.id);
    const cubeBadges = cubes.map(([region, count], i) => {
      const bx = city.x + 10 + i * 13;
      const by = city.y - 12;
      return `
        <circle cx="${bx}" cy="${by}" r="6" fill="${REGION_META[region].color}" stroke="#06101f" stroke-width="1" />
        <text x="${bx}" y="${by + 3}" text-anchor="middle" class="cube-badge">${count}</text>
      `;
    }).join('');

    const stationRing = hasStation
      ? `<rect class="station-ring" x="${city.x - 9}" y="${city.y - 9}" width="18" height="18" rx="4" />`
      : '';

    const playersHere = state.players.filter((p) => p.location === city.id);
    const pawns = playersHere.map((p, i) => {
      const idx = state.players.findIndex((pl) => pl.id === p.id);
      const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
      const px = city.x - 10 + i * 7;
      const py = city.y + 12;
      return `<circle class="pawn" cx="${px}" cy="${py}" r="3.5" fill="${color}" />`;
    }).join('');

    return `
      <g class="${classes.join(' ')}" data-city="${city.id}">
        ${stationRing}
        <circle class="base" cx="${city.x}" cy="${city.y}" r="7" />
        <text class="label" x="${city.x}" y="${city.y - 15}" text-anchor="middle">${city.name}</text>
        ${cubeBadges}
        ${pawns}
      </g>
    `;
  });

  svgEl.setAttribute('viewBox', '0 0 1000 520');
  svgEl.innerHTML = `
    <g class="edges">${edgesSvg.join('')}</g>
    <g class="nodes">${nodesSvg.join('')}</g>
  `;
}

export function attachMapClickHandler(svgEl: SVGSVGElement, onCityClick: (cityId: string, evt: MouseEvent) => void) {
  svgEl.addEventListener('click', (evt) => {
    const target = (evt.target as Element).closest('.city-node') as SVGGElement | null;
    if (!target) return;
    const cityId = target.getAttribute('data-city');
    if (cityId) onCityClick(cityId, evt);
  });
}
