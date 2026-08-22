import type { CityDef, RegionId } from './types';

interface RawCity {
  id: string;
  name: string;
  region: RegionId;
  x: number;
  y: number;
}

// Coordinates are hand-placed on a 1000x520 equirectangular-style canvas —
// approximate real-world positions, not to-scale cartography.
const RAW_CITIES: RawCity[] = [
  // Azure — North America & Western Europe
  { id: 'new-york', name: 'New York', region: 'azure', x: 250, y: 175 },
  { id: 'chicago', name: 'Chicago', region: 'azure', x: 228, y: 160 },
  { id: 'los-angeles', name: 'Los Angeles', region: 'azure', x: 148, y: 195 },
  { id: 'mexico-city', name: 'Mexico City', region: 'azure', x: 195, y: 235 },
  { id: 'toronto', name: 'Toronto', region: 'azure', x: 244, y: 152 },
  { id: 'washington', name: 'Washington', region: 'azure', x: 254, y: 182 },
  { id: 'london', name: 'London', region: 'azure', x: 480, y: 128 },
  { id: 'madrid', name: 'Madrid', region: 'azure', x: 470, y: 162 },
  { id: 'paris', name: 'Paris', region: 'azure', x: 490, y: 134 },
  { id: 'milan', name: 'Milan', region: 'azure', x: 502, y: 145 },
  { id: 'essen', name: 'Essen', region: 'azure', x: 495, y: 122 },
  { id: 'st-petersburg', name: 'St. Petersburg', region: 'azure', x: 542, y: 98 },

  // Crimson — East & Southeast Asia
  { id: 'beijing', name: 'Beijing', region: 'crimson', x: 742, y: 152 },
  { id: 'shanghai', name: 'Shanghai', region: 'crimson', x: 762, y: 184 },
  { id: 'hong-kong', name: 'Hong Kong', region: 'crimson', x: 750, y: 216 },
  { id: 'taipei', name: 'Taipei', region: 'crimson', x: 772, y: 220 },
  { id: 'seoul', name: 'Seoul', region: 'crimson', x: 780, y: 158 },
  { id: 'tokyo', name: 'Tokyo', region: 'crimson', x: 822, y: 170 },
  { id: 'osaka', name: 'Osaka', region: 'crimson', x: 806, y: 186 },
  { id: 'bangkok', name: 'Bangkok', region: 'crimson', x: 710, y: 236 },
  { id: 'ho-chi-minh-city', name: 'Ho Chi Minh City', region: 'crimson', x: 726, y: 250 },
  { id: 'manila', name: 'Manila', region: 'crimson', x: 782, y: 246 },
  { id: 'jakarta', name: 'Jakarta', region: 'crimson', x: 730, y: 292 },

  // Amber — Latin America & Sub-Saharan Africa
  { id: 'bogota', name: 'Bogotá', region: 'amber', x: 222, y: 292 },
  { id: 'lima', name: 'Lima', region: 'amber', x: 206, y: 322 },
  { id: 'santiago', name: 'Santiago', region: 'amber', x: 222, y: 402 },
  { id: 'buenos-aires', name: 'Buenos Aires', region: 'amber', x: 252, y: 392 },
  { id: 'sao-paulo', name: 'São Paulo', region: 'amber', x: 272, y: 342 },
  { id: 'lagos', name: 'Lagos', region: 'amber', x: 492, y: 270 },
  { id: 'kinshasa', name: 'Kinshasa', region: 'amber', x: 522, y: 300 },
  { id: 'khartoum', name: 'Khartoum', region: 'amber', x: 546, y: 250 },
  { id: 'johannesburg', name: 'Johannesburg', region: 'amber', x: 546, y: 362 },
  { id: 'algiers', name: 'Algiers', region: 'amber', x: 496, y: 195 },

  // Verdant — Middle East, South Asia & Oceania
  { id: 'moscow', name: 'Moscow', region: 'verdant', x: 556, y: 108 },
  { id: 'istanbul', name: 'Istanbul', region: 'verdant', x: 546, y: 170 },
  { id: 'cairo', name: 'Cairo', region: 'verdant', x: 546, y: 212 },
  { id: 'riyadh', name: 'Riyadh', region: 'verdant', x: 582, y: 212 },
  { id: 'baghdad', name: 'Baghdad', region: 'verdant', x: 582, y: 186 },
  { id: 'tehran', name: 'Tehran', region: 'verdant', x: 592, y: 176 },
  { id: 'karachi', name: 'Karachi', region: 'verdant', x: 630, y: 206 },
  { id: 'mumbai', name: 'Mumbai', region: 'verdant', x: 630, y: 232 },
  { id: 'delhi', name: 'Delhi', region: 'verdant', x: 652, y: 196 },
  { id: 'chennai', name: 'Chennai', region: 'verdant', x: 656, y: 252 },
  { id: 'sydney', name: 'Sydney', region: 'verdant', x: 852, y: 404 },
];

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
  ['buenos-aires', 'johannesburg'], ['los-angeles', 'tokyo'], ['sydney', 'los-angeles'],
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
    map.set(c.id, { ...c, connections: [] });
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
