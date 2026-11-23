import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, fold } from '../src/ics.js';
import { shareText } from '../src/itinerary.js';
import { fmtTime, parseClock, parseLatLng } from '../src/format.js';
import { estimateMatrix, haversineMiles, osrmMatrix, cleanOsrmBase } from '../src/travel.js';

const now = new Date(Date.UTC(2026, 10, 23, 15, 0, 0));
const items = [
  { uid: 'a', label: 'Maple Ridge Dr, Unit 4', startMin: 13 * 60, endMin: 13 * 60 + 30, lat: 35.78, lng: -78.64, description: 'Window 1:00 PM to 2:00 PM; plan 30 min.' },
  { uid: 'b', label: 'Cedar Hollow Ln', startMin: 14 * 60 + 5, endMin: 14 * 60 + 25 },
];

test('ics has one event per showing, CRLF endings and floating local times', () => {
  const ics = buildIcs({ date: '2026-11-28', title: 'Demo buyer', items, now });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.ok(ics.includes('DTSTART:20261128T130000\r\n'));
  assert.ok(ics.includes('DTEND:20261128T133000\r\n'));
  assert.ok(ics.includes('DTSTART:20261128T140500\r\n'));
  assert.ok(ics.includes('DTSTAMP:20261123T150000Z\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'no bare LF');
});

test('ics escapes commas, semicolons and keeps lines within 75 octets', () => {
  const ics = buildIcs({ date: '2026-11-28', items: [{ ...items[0], label: `${'Long Street Name '.repeat(8)}, Apt 2; back` }], now });
  assert.ok(ics.includes('\\,'));
  assert.ok(ics.includes('\\;'));
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.ok(ics.includes('GEO:35.780000;-78.640000'));
});

test('ics rejects a bad date', () => {
  assert.throws(() => buildIcs({ date: '11/28/2026', items, now }));
});

test('fold keeps multi-byte characters whole', () => {
  const folded = fold(`SUMMARY:${'é'.repeat(60)}`);
  for (const part of folded.split('\r\n ')) assert.ok(new TextEncoder().encode(part).length <= 75);
  assert.equal(folded.replace(/\r\n /g, ''), `SUMMARY:${'é'.repeat(60)}`);
});

test('share text lists stops in order and the ones left out', () => {
  const rows = [
    { number: 1, label: 'Maple Ridge Dr', start: 13 * 60, end: 13 * 60 + 30, drive: 12, from: 'Office' },
    { number: 2, label: 'Cedar Hollow Ln', start: 14 * 60, end: 14 * 60 + 20, drive: 0, from: 'Maple Ridge Dr' },
  ];
  const t = shareText({ rows, unserved: [{ label: 'Birch Ct', reason: 'Window closes before you can get there.' }], date: 'Sat Nov 28', buyer: 'Demo Buyer', startLabel: 'Office' });
  assert.match(t, /Showings for Demo Buyer, Sat Nov 28/);
  assert.match(t, /1\. 1:00 PM to 1:30 PM {2}Maple Ridge Dr/);
  assert.match(t, /12 min drive from Office/);
  assert.match(t, /Not scheduled:\n- Birch Ct/);
  assert.ok(!t.includes('—'));
});

test('time helpers', () => {
  assert.equal(fmtTime(13 * 60 + 5), '1:05 PM');
  assert.equal(fmtTime(0), '12:00 AM');
  assert.equal(parseClock('13:05'), 785);
  assert.ok(Number.isNaN(parseClock('25:00')));
  assert.deepEqual(parseLatLng('35.78, -78.64'), { lat: 35.78, lng: -78.64 });
  assert.equal(parseLatLng('nope'), null);
});

test('estimate: miles x road factor at a flat speed, rounded up to whole minutes', () => {
  const a = { lat: 35.78, lng: -78.64 };
  const b = { lat: 35.78, lng: -78.54 };
  const straight = haversineMiles(a, b);
  const m = estimateMatrix([a, b], { roadFactor: 1.3, mph: 30 });
  assert.equal(m.minutes[0][1], Math.ceil(((straight * 1.3) / 30) * 60));
  assert.equal(m.minutes[0][0], 0);
  assert.equal(m.minutes[0][1], m.minutes[1][0]);
  const slower = estimateMatrix([a, b], { roadFactor: 1.3, mph: 15 });
  assert.ok(slower.minutes[0][1] > m.minutes[0][1]);
});

test('osrm: uses the supplied server, converts seconds to minutes, refuses bad input', async () => {
  let seen = '';
  const fake = async (url) => {
    seen = url;
    return { ok: true, json: async () => ({ code: 'Ok', durations: [[0, 601], [590, 0]], distances: [[0, 1609.344], [1609.344, 0]] }) };
  };
  const m = await osrmMatrix([{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }], 'https://osrm.example.test/base/', fake);
  assert.ok(seen.startsWith('https://osrm.example.test/base/table/v1/driving/2.000000,1.000000;4.000000,3.000000'));
  assert.deepEqual(m.minutes, [[0, 11], [10, 0]]);
  assert.equal(m.source, 'osrm');
  assert.ok(Math.abs(m.miles[0][1] - 1) < 1e-9);
  assert.throws(() => cleanOsrmBase('ftp://x'));
  await assert.rejects(osrmMatrix([{ lat: 1, lng: 2 }], 'https://x.test', async () => ({ ok: false, status: 502 })), /502/);
  await assert.rejects(osrmMatrix([{ lat: 1, lng: 2 }], 'https://x.test', async () => ({ ok: true, json: async () => ({ code: 'Ok', durations: [[null]] }) })), /no road route/);
});
