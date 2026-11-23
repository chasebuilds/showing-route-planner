export const DEFAULT_TRAVEL = { roadFactor: 1.3, mph: 30 };

const R_MILES = 3958.8;

export function haversineMiles(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Offline estimate: straight-line miles x road factor, driven at a flat speed. Minutes are rounded up. */
export function estimateMatrix(points, { roadFactor, mph } = DEFAULT_TRAVEL) {
  const miles = points.map((a) => points.map((b) => haversineMiles(a, b) * roadFactor));
  const minutes = miles.map((row) => row.map((d) => (d === 0 ? 0 : Math.ceil((d / mph) * 60))));
  return { minutes, miles, source: 'estimate' };
}

export function cleanOsrmBase(url) {
  let u;
  try {
    u = new URL(String(url).trim());
  } catch {
    throw new Error('The OSRM address is not a valid URL.');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('The OSRM address must start with http:// or https://.');
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

/** Road-following line through the stops in order, from the same OSRM server. Returns [[lat, lng], ...]. */
export async function osrmRoute(points, baseUrl, fetchImpl = fetch) {
  if (points.length < 2) return [];
  const base = cleanOsrmBase(baseUrl);
  const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const res = await fetchImpl(`${base}/route/v1/driving/${coords}?overview=full&geometries=geojson`);
  if (!res.ok) throw new Error(`The OSRM server answered ${res.status}.`);
  const data = await res.json();
  const line = data.routes?.[0]?.geometry?.coordinates;
  if (data.code !== 'Ok' || !Array.isArray(line)) throw new Error('The OSRM server returned no route.');
  return line.map(([lng, lat]) => [lat, lng]);
}

/** Real drive times from an OSRM server the user supplies (its /table service). No default server on purpose. */
export async function osrmMatrix(points, baseUrl, fetchImpl = fetch) {
  const base = cleanOsrmBase(baseUrl);
  const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const res = await fetchImpl(`${base}/table/v1/driving/${coords}?annotations=duration,distance`);
  if (!res.ok) throw new Error(`The OSRM server answered ${res.status}.`);
  const data = await res.json();
  if (data.code !== 'Ok' || !Array.isArray(data.durations)) throw new Error(`The OSRM server could not build a table (${data.code ?? 'no code'}).`);
  const minutes = data.durations.map((row) =>
    row.map((s) => {
      if (s === null || s === undefined) throw new Error('OSRM has no road route between two of these points.');
      return s === 0 ? 0 : Math.ceil(s / 60);
    }),
  );
  const miles = (data.distances ?? []).map((row) => row.map((m) => (m ?? 0) / 1609.344));
  return { minutes, miles: miles.length ? miles : estimateMatrix(points).miles, source: 'osrm' };
}
