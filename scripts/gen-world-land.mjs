// Regenerates client/src/worldLand.ts from the `world-atlas` 110m land dataset,
// projecting every coordinate with the same equirectangular formula used for
// city coordinates in shared/src/boardData.ts. Keeping both in one script (and
// using the same W/H/formula) is what guarantees the landmass and the city
// dots stay aligned if the map size ever changes.
//
// Usage (from repo root):
//   npm install --no-save world-atlas topojson-client
//   node scripts/gen-world-land.mjs
import { feature } from 'topojson-client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const topoPath = path.join(__dirname, '..', 'node_modules', 'world-atlas', 'land-110m.json');
const outPath = path.join(__dirname, '..', 'client', 'src', 'worldLand.ts');

// Must match MAP_WIDTH / MAP_HEIGHT / project() in shared/src/boardData.ts.
const W = 1000;
const H = 500;
function project([lon, lat]) {
  const x = ((lon + 180) / 360) * W;
  const y = ((90 - lat) / 180) * H;
  return [Number(x.toFixed(2)), Number(y.toFixed(2))];
}

function ringToPath(ring) {
  const pts = ring.map(project);
  return 'M' + pts.map((p) => p.join(',')).join('L') + 'Z';
}

function geomToPath(geom) {
  if (geom.type === 'Polygon') return geom.coordinates.map(ringToPath).join(' ');
  if (geom.type === 'MultiPolygon') return geom.coordinates.map((poly) => poly.map(ringToPath).join(' ')).join(' ');
  return '';
}

const topo = JSON.parse(fs.readFileSync(topoPath, 'utf8'));
const geo = feature(topo, topo.objects.land);
const d = geo.features.map((f) => geomToPath(f.geometry)).join(' ');

const out = `// Simplified world landmass outline (Natural Earth 110m, via the world-atlas
// npm package), pre-projected with the exact same equirectangular projection
// used for city coordinates in shared/src/boardData.ts (MAP_WIDTH x MAP_HEIGHT,
// x = (lon+180)/360*W, y = (90-lat)/180*H). Because both use the same formula,
// city dots line up with their real continent instead of floating off it.
//
// Regenerate with: node scripts/gen-world-land.mjs (see script for details).
export const LAND_PATH =
  "${d}";
`;
fs.writeFileSync(outPath, out);
console.log(`Wrote ${outPath} (${d.length} chars of path data)`);
