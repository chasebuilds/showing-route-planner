import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geocode, geocodeMany, geocodeUrl, pickResult } from '../src/geocode.js';
import { osrmRoute } from '../src/travel.js';

const ok = (body) => async () => ({ ok: true, json: async () => body });

test('geocode url: appends the query, or fills a {q} template, and refuses non-http addresses', () => {
  const u = new URL(geocodeUrl('https://geo.example.test/search', '12 Pine St & Co'));
  assert.equal(u.searchParams.get('q'), '12 Pine St & Co');
  assert.equal(u.searchParams.get('limit'), '1');
  assert.equal(geocodeUrl('https://geo.example.test/find?text={q}&n=1', 'a b'), 'https://geo.example.test/find?text=a%20b&n=1');
  assert.throws(() => geocodeUrl('javascript:alert(1)', 'x'));
  assert.throws(() => geocodeUrl('not a url', 'x'));
});

test('geocode reads list answers and GeoJSON answers', () => {
  assert.deepEqual(pickResult([{ lat: '35.8', lon: '-78.6', display_name: 'X' }]), { lat: 35.8, lng: -78.6, name: 'X' });
  assert.deepEqual(pickResult({ features: [{ geometry: { coordinates: [-78.6, 35.8] }, properties: { name: 'Y' } }] }), { lat: 35.8, lng: -78.6, name: 'Y' });
  assert.equal(pickResult([]), null);
  assert.equal(pickResult([{ lat: '999', lon: '1' }]), null);
  assert.equal(pickResult(null), null);
});

test('geocode errors are readable', async () => {
  await assert.rejects(geocode('https://g.test', '  '), /Type an address/);
  await assert.rejects(geocode('https://g.test', 'x', async () => ({ ok: false, status: 429 })), /429/);
  await assert.rejects(geocode('https://g.test', 'Nowhere', ok([])), /No match for "Nowhere"/);
  const hit = await geocode('https://g.test', 'x', ok([{ lat: 1, lon: 2 }]));
  assert.equal(hit.lat, 1);
});

test('geocodeMany waits between requests and keeps going after a miss', async () => {
  const waits = [];
  let n = 0;
  const fetchImpl = async () => (++n === 2 ? { ok: true, json: async () => [] } : { ok: true, json: async () => [{ lat: n, lon: n }] });
  const out = await geocodeMany('https://g.test', ['a', 'b', 'c'], { fetchImpl, delayMs: 1100, sleep: async (ms) => waits.push(ms) });
  assert.deepEqual(out.map((o) => o.ok), [true, false, true]);
  assert.deepEqual(waits, [1100, 1100]);
});

test('osrm route geometry becomes [lat, lng] pairs from the supplied server', async () => {
  let seen = '';
  const fake = async (url) => {
    seen = url;
    return { ok: true, json: async () => ({ code: 'Ok', routes: [{ geometry: { coordinates: [[-78.6, 35.8], [-78.5, 35.9]] } }] }) };
  };
  const line = await osrmRoute([{ lat: 35.8, lng: -78.6 }, { lat: 35.9, lng: -78.5 }], 'https://osrm.example.test', fake);
  assert.deepEqual(line, [[35.8, -78.6], [35.9, -78.5]]);
  assert.match(seen, /^https:\/\/osrm\.example\.test\/route\/v1\/driving\/-78\.600000,35\.800000;-78\.500000,35\.900000\?overview=full&geometries=geojson$/);
  assert.deepEqual(await osrmRoute([{ lat: 1, lng: 1 }], 'https://osrm.example.test', fake), []);
  await assert.rejects(osrmRoute([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }], 'https://x.test', async () => ({ ok: true, json: async () => ({ code: 'NoRoute' }) })), /no route/);
});
