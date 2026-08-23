// Regenerates client/src/worldLand.ts from the `world-atlas` 110m land dataset.
//
// IMPORTANT: this uses d3-geo's geoPath/geoEquirectangular, not a hand-rolled
// per-point (lon,lat) -> (x,y) projection. A naive per-point projection does
// not clip polygons at the ±180° antimeridian, which tears landmasses that
// cross the date line (Russia, Alaska/Chukotka, Antarctica's edge) into
// pieces that get reconnected with a straight line across the *entire* map —
// visually a broken horizontal streak. d3-geo's projection pipeline clips
// this correctly. The projection is configured to match the exact pixel
// mapping used for city coordinates in shared/src/boardData.ts
// (x = (lon+180)/360*W, y = (90-lat)/180*H), so the landmass and city dots
// stay aligned.
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

// scale = W / (2*PI) + translate to center reproduces the same equirectangular
// pixel mapping as boardData.ts's project(), verified: (lon=-180 -> x=0),
// (lon=180 -> x=W), (lat=90 -> y=0), (lat=-90 -> y=H).
const projection = geoEquirectangular()
  .scale(W / (2 * Math.PI))
  .translate([W / 2, H / 2])
  .precision(0.1);
const pathGen = geoPath(projection);

// Simplify to keep the outline light, then drop slivers/tiny islands that
// are invisible at world-map scale anyway (area is in the topology's own
// lon/lat-degree units, pre-projection).
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

const out = `// Simplified world landmass outline (Natural Earth 110m, via the world-atlas
// npm package), pre-projected with the exact same equirectangular projection
// used for city coordinates in shared/src/boardData.ts (MAP_WIDTH x MAP_HEIGHT,
// x = (lon+180)/360*W, y = (90-lat)/180*H).
//
// Generated with d3-geo's geoPath + geoEquirectangular projection, which
// (unlike a hand-rolled per-point projection) correctly clips polygons that
// cross the ±180° antimeridian. A naive per-point projection tears landmasses
// like Russia/Alaska in two and reconnects the pieces with a straight line
// across the entire map — that's the "reversed/broken" horizontal streaks
// this replaces. Also lightly simplified and small islands below a threshold
// are dropped, so the outline stays legible at world-map scale.
//
// Regenerate with: node scripts/gen-world-land.mjs (see script for details).
export const LAND_PATH =
  "${d}";
`;
fs.writeFileSync(outPath, out);
console.log(`Wrote ${outPath} (${d.length} chars of path data)`);
