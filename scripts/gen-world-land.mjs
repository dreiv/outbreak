// Regenerates client/src/worldLand.ts from the `world-atlas` 110m dataset.
// Uses d3-geo's geoPath/geoEquirectangular (not a hand-rolled per-point
// projection) so polygons crossing the ±180° antimeridian clip correctly
// instead of tearing into a broken horizontal streak. The projection matches
// boardData.ts's city mapping so landmass and city dots stay aligned.
//
// Usage (from repo root):
//   npm install --no-save d3-geo topojson-client topojson-simplify world-atlas
//   node scripts/gen-world-land.mjs
import { geoEquirectangular, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import { presimplify, simplify } from 'topojson-simplify';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const topoPath = path.join(__dirname, '..', 'node_modules', 'world-atlas', 'land-110m.json');
const outPath = path.join(__dirname, '..', 'client', 'src', 'worldLand.ts');

// Must match MAP_WIDTH / MAP_HEIGHT / project() in shared/src/boardData.ts.
const W = 1000;
const H = 500;

// scale + translate reproduces boardData.ts's project() pixel mapping.
const projection = geoEquirectangular()
  .scale(W / (2 * Math.PI))
  .translate([W / 2, H / 2])
  .precision(0.1);
const pathGen = geoPath(projection);

// Simplify to keep the outline light, then drop tiny islands invisible at
// world-map scale (area in the topology's lon/lat-degree units, pre-projection).
function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(a) / 2;
}
const MIN_ISLAND_AREA = 0.2;
function dropTinyIslands(geom) {
  if (!geom) return null;
  if (geom.type === 'Polygon') {
    return ringArea(geom.coordinates[0]) > MIN_ISLAND_AREA ? geom : null;
  }
  if (geom.type === 'MultiPolygon') {
    const kept = geom.coordinates.filter((poly) => ringArea(poly[0]) > MIN_ISLAND_AREA);
    return kept.length ? { type: 'MultiPolygon', coordinates: kept } : null;
  }
  return geom;
}

let topo = JSON.parse(fs.readFileSync(topoPath, 'utf8'));
topo = simplify(presimplify(topo), 0.15);
const geo = feature(topo, topo.objects.land);
const features = geo.features
  .map((f) => ({ ...f, geometry: dropTinyIslands(f.geometry) }))
  .filter((f) => f.geometry);

const d = pathGen({ type: 'FeatureCollection', features });

const out = `// Simplified world landmass (Natural Earth 110m via world-atlas), pre-projected
// with the same equirectangular projection as city coords in boardData.ts.
// Generated with d3-geo (clips polygons crossing the ±180° antimeridian, which
// a naive per-point projection tears). Regenerate: node scripts/gen-world-land.mjs
export const LAND_PATH =
  "${d}";
`;
fs.writeFileSync(outPath, out);
console.log(`Wrote ${outPath} (${d.length} chars of path data)`);
