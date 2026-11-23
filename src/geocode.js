import { cleanOsrmBase } from './travel.js';

/*
 Optional address lookup through an endpoint the user supplies. Nothing is built in and nothing is called unless it is switched on.
 The endpoint can contain {q} where the address goes, otherwise "?q=<address>&format=jsonv2&limit=1" is added.
 Understands two common answer shapes: a list of {lat, lon} (Nominatim style) and GeoJSON features (Photon, Pelias style).
*/
export function geocodeUrl(endpoint, query) {
  const raw = String(endpoint).trim();
  const q = query.trim();
  if (raw.includes('{q}')) {
    cleanOsrmBase(raw.replace('{q}', 'x'));
    return raw.replace('{q}', encodeURIComponent(q));
  }
  const u = new URL(cleanOsrmBase(raw));
  u.searchParams.set('q', q);
  u.searchParams.set('format', 'jsonv2');
  u.searchParams.set('limit', '1');
  return u.toString();
}

export function pickResult(data) {
  const first = Array.isArray(data) ? data[0] : (data?.features?.[0] ?? data?.results?.[0]);
  if (!first) return null;
  let lat;
  let lng;
  if (first.geometry?.coordinates) [lng, lat] = first.geometry.coordinates;
  else {
    lat = Number(first.lat ?? first.latitude);
    lng = Number(first.lon ?? first.lng ?? first.longitude);
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, name: first.display_name ?? first.properties?.name ?? '' };
}

export async function geocode(endpoint, query, fetchImpl = fetch) {
  if (!query.trim()) throw new Error('Type an address first.');
  const res = await fetchImpl(geocodeUrl(endpoint, query), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`The geocoder answered ${res.status}.`);
  const hit = pickResult(await res.json());
  if (!hit) throw new Error(`No match for "${query}".`);
  return hit;
}

/** Look up many addresses one at a time, waiting between requests so a shared service is not hammered. */
export async function geocodeMany(endpoint, labels, { fetchImpl = fetch, delayMs = 1100, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onProgress } = {}) {
  const out = [];
  for (let i = 0; i < labels.length; i++) {
    if (i > 0) await sleep(delayMs);
    try {
      out.push({ ok: true, ...(await geocode(endpoint, labels[i], fetchImpl)) });
    } catch (e) {
      out.push({ ok: false, error: e.message });
    }
    onProgress?.(i + 1, labels.length);
  }
  return out;
}
