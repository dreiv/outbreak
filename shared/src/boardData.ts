import type { CityDef, RegionId } from './types.js';

interface RawCity {
  id: string;
  name: string;
  region: RegionId;
  lat: number;
  lon: number;
  major?: boolean;
}

// The map canvas is a true 2:1 equirectangular projection (see `project()`
// below). Every city's x/y is derived from its real lat/lon so a real-world
// landmass layer (client/src/worldLand.ts, generated with the same
// projection) lines up with the board without any manual fudging.
export const MAP_WIDTH = 1000;
export const MAP_HEIGHT = 500;

export function project(lat: number, lon: number): { x: number; y: number } {
  const x = ((lon + 180) / 360) * MAP_WIDTH;
  const y = ((90 - lat) / 180) * MAP_HEIGHT;
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

// `major: true` marks the handful of cities shown at low zoom so the board
// isn't a wall of illegible text when zoomed all the way out; every city's
// label reveals once the player zooms in on that region.
const RAW_CITIES: RawCity[] = [
  // Azure — North America & Western Europe
  { id: 'new-york', name: 'New York', region: 'azure', lat: 40.7128, lon: -74.0060, major: true },
  { id: 'chicago', name: 'Chicago', region: 'azure', lat: 41.8781, lon: -87.6298 },
  { id: 'los-angeles', name: 'Los Angeles', region: 'azure', lat: 34.0522, lon: -118.2437 },
  { id: 'mexico-city', name: 'Mexico City', region: 'azure', lat: 19.4326, lon: -99.1332, major: true },
  { id: 'toronto', name: 'Toronto', region: 'azure', lat: 43.6511, lon: -79.3830 },
  { id: 'washington', name: 'Washington', region: 'azure', lat: 38.9072, lon: -77.0369 },
  { id: 'london', name: 'London', region: 'azure', lat: 51.5074, lon: -0.1278, major: true },
  { id: 'madrid', name: 'Madrid', region: 'azure', lat: 40.4168, lon: -3.7038 },
  { id: 'paris', name: 'Paris', region: 'azure', lat: 48.8566, lon: 2.3522, major: true },
  { id: 'milan', name: 'Milan', region: 'azure', lat: 45.4642, lon: 9.1900 },
  { id: 'essen', name: 'Essen', region: 'azure', lat: 51.4556, lon: 7.0116 },
  { id: 'st-petersburg', name: 'St. Petersburg', region: 'azure', lat: 59.9311, lon: 30.3609 },

  // Crimson — East & Southeast Asia
  { id: 'beijing', name: 'Beijing', region: 'crimson', lat: 39.9042, lon: 116.4074, major: true },
  { id: 'shanghai', name: 'Shanghai', region: 'crimson', lat: 31.2304, lon: 121.4737 },
  { id: 'hong-kong', name: 'Hong Kong', region: 'crimson', lat: 22.3193, lon: 114.1694 },
  { id: 'taipei', name: 'Taipei', region: 'crimson', lat: 25.0330, lon: 121.5654 },
  { id: 'seoul', name: 'Seoul', region: 'crimson', lat: 37.5665, lon: 126.9780 },
  { id: 'tokyo', name: 'Tokyo', region: 'crimson', lat: 35.6762, lon: 139.6503, major: true },
  { id: 'osaka', name: 'Osaka', region: 'crimson', lat: 34.6937, lon: 135.5023 },
  { id: 'bangkok', name: 'Bangkok', region: 'crimson', lat: 13.7563, lon: 100.5018, major: true },
  { id: 'ho-chi-minh-city', name: 'Ho Chi Minh City', region: 'crimson', lat: 10.8231, lon: 106.6297 },
  { id: 'manila', name: 'Manila', region: 'crimson', lat: 14.5995, lon: 120.9842 },
  { id: 'jakarta', name: 'Jakarta', region: 'crimson', lat: -6.2088, lon: 106.8456, major: true },

  // Amber — Latin America & Sub-Saharan Africa
  { id: 'bogota', name: 'Bogotá', region: 'amber', lat: 4.7110, lon: -74.0721 },
  { id: 'lima', name: 'Lima', region: 'amber', lat: -12.0464, lon: -77.0428 },
  { id: 'santiago', name: 'Santiago', region: 'amber', lat: -33.4489, lon: -70.6693 },
  { id: 'buenos-aires', name: 'Buenos Aires', region: 'amber', lat: -34.6037, lon: -58.3816, major: true },
  { id: 'sao-paulo', name: 'São Paulo', region: 'amber', lat: -23.5505, lon: -46.6333, major: true },
  { id: 'lagos', name: 'Lagos', region: 'amber', lat: 6.5244, lon: 3.3792, major: true },
  { id: 'kinshasa', name: 'Kinshasa', region: 'amber', lat: -4.4419, lon: 15.2663 },
  { id: 'khartoum', name: 'Khartoum', region: 'amber', lat: 15.5007, lon: 32.5599 },
  { id: 'johannesburg', name: 'Johannesburg', region: 'amber', lat: -26.2041, lon: 28.0473, major: true },
  { id: 'algiers', name: 'Algiers', region: 'amber', lat: 36.7538, lon: 3.0588 },

  // Verdant — Middle East, South Asia & Oceania
  { id: 'moscow', name: 'Moscow', region: 'verdant', lat: 55.7558, lon: 37.6173, major: true },
  { id: 'istanbul', name: 'Istanbul', region: 'verdant', lat: 41.0082, lon: 28.9784 },
  { id: 'cairo', name: 'Cairo', region: 'verdant', lat: 30.0444, lon: 31.2357, major: true },
  { id: 'riyadh', name: 'Riyadh', region: 'verdant', lat: 24.7136, lon: 46.6753 },
  { id: 'baghdad', name: 'Baghdad', region: 'verdant', lat: 33.3152, lon: 44.3661 },
  { id: 'tehran', name: 'Tehran', region: 'verdant', lat: 35.6892, lon: 51.3890 },
  { id: 'karachi', name: 'Karachi', region: 'verdant', lat: 24.8607, lon: 67.0011 },
  { id: 'mumbai', name: 'Mumbai', region: 'verdant', lat: 19.0760, lon: 72.8777, major: true },
  { id: 'delhi', name: 'Delhi', region: 'verdant', lat: 28.7041, lon: 77.1025 },
  { id: 'chennai', name: 'Chennai', region: 'verdant', lat: 13.0827, lon: 80.2707 },
  { id: 'sydney', name: 'Sydney', region: 'verdant', lat: -33.8688, lon: 151.2093, major: true },
];

// "Shuttle" routes — long-haul ocean crossings with no plausible adjacent
// land/short-flight path, connecting distant hubs the way the original
// Pandemic board's dashed lines do (e.g. its Los Angeles<->Tokyo and
// Los Angeles<->Sydney wrap-around connections). Functionally identical to
// any other edge (Drive/Ferry works normally), but rendered as a dashed
// line on the map instead of solid so they read as the "long way round"
// rather than a regular adjacent hop — see EDGE_KEY / isShuttleEdge below
// and client/src/map.ts.
const SHUTTLE_EDGES: [string, string][] = [
  ['los-angeles', 'tokyo'],
  ['sydney', 'los-angeles'],
];

function edgeKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}
const SHUTTLE_EDGE_KEYS = new Set(SHUTTLE_EDGES.map(([a, b]) => edgeKey(a, b)));

export function isShuttleEdge(a: string, b: string): boolean {
  return SHUTTLE_EDGE_KEYS.has(edgeKey(a, b));
}

// Undirected edges — plausible travel/flight corridors. Both directions are
// derived automatically below.
const EDGES: [string, string][] = [
  // Americas
  ['new-york', 'chicago'], ['new-york', 'toronto'], ['new-york', 'washington'],
  ['chicago', 'toronto'], ['chicago', 'los-angeles'], ['chicago', 'mexico-city'],
  ['los-angeles', 'mexico-city'], ['mexico-city', 'bogota'],
  ['bogota', 'lima'], ['lima', 'santiago'], ['santiago', 'buenos-aires'],
  ['buenos-aires', 'sao-paulo'], ['sao-paulo', 'bogota'],
  // Trans-Atlantic / trans-Pacific hubs
  ['new-york', 'london'], ['washington', 'london'], ['sao-paulo', 'lagos'],
  ['buenos-aires', 'johannesburg'],
  ...SHUTTLE_EDGES,
  // Europe
  ['london', 'paris'], ['london', 'madrid'], ['paris', 'milan'], ['paris', 'essen'],
  ['essen', 'st-petersburg'], ['madrid', 'milan'], ['st-petersburg', 'moscow'],
  ['milan', 'istanbul'],
  // Europe <-> Africa / Middle East
  ['madrid', 'algiers'], ['milan', 'cairo'], ['istanbul', 'cairo'],
  ['istanbul', 'moscow'], ['istanbul', 'baghdad'],
  // Africa
  ['algiers', 'lagos'], ['lagos', 'kinshasa'], ['kinshasa', 'khartoum'],
  ['khartoum', 'cairo'], ['khartoum', 'johannesburg'], ['kinshasa', 'johannesburg'],
  // Middle East / South Asia
  ['cairo', 'riyadh'], ['riyadh', 'baghdad'], ['baghdad', 'tehran'],
  ['tehran', 'karachi'], ['karachi', 'mumbai'], ['mumbai', 'delhi'],
  ['delhi', 'chennai'], ['chennai', 'mumbai'], ['delhi', 'karachi'],
  ['riyadh', 'khartoum'], ['moscow', 'tehran'],
  // South/SE Asia bridge
  ['chennai', 'bangkok'],
  // East / SE Asia
  ['bangkok', 'ho-chi-minh-city'], ['bangkok', 'hong-kong'], ['bangkok', 'jakarta'],
  ['hong-kong', 'shanghai'], ['shanghai', 'beijing'], ['beijing', 'seoul'],
  ['seoul', 'tokyo'], ['tokyo', 'osaka'], ['osaka', 'shanghai'],
  ['hong-kong', 'taipei'], ['taipei', 'manila'], ['manila', 'tokyo'],
  ['ho-chi-minh-city', 'manila'], ['ho-chi-minh-city', 'jakarta'],
  ['jakarta', 'sydney'],
];

function buildCities(): CityDef[] {
  const map = new Map<string, CityDef>();
  for (const c of RAW_CITIES) {
    const { x, y } = project(c.lat, c.lon);
    map.set(c.id, {
      id: c.id,
      name: c.name,
      region: c.region,
      lat: c.lat,
      lon: c.lon,
      x,
      y,
      major: c.major ?? false,
      connections: [],
    });
  }
  for (const [a, b] of EDGES) {
    const ca = map.get(a);
    const cb = map.get(b);
    if (!ca || !cb) throw new Error(`Unknown city in edge: ${a} <-> ${b}`);
    if (!ca.connections.includes(b)) ca.connections.push(b);
    if (!cb.connections.includes(a)) cb.connections.push(a);
  }
  return Array.from(map.values());
}

export const CITIES: CityDef[] = buildCities();
export const CITY_MAP: Record<string, CityDef> = Object.fromEntries(CITIES.map((c) => [c.id, c]));
export const STARTING_CITY = 'new-york';

export function isConnected(a: string, b: string): boolean {
  return CITY_MAP[a]?.connections.includes(b) ?? false;
}