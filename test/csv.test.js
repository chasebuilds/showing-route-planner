import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importStops, exportStops, parseCsvText, TEMPLATE_CSV } from '../src/csv.js';
import { parseFlexTime, parseWindow, parseMinutes } from '../src/format.js';

const H = (h, m = 0) => h * 60 + m;

test('flexible times', () => {
  assert.equal(parseFlexTime('1:00 PM'), H(13));
  assert.equal(parseFlexTime('1pm'), H(13));
  assert.equal(parseFlexTime('1 p.m.'), H(13));
  assert.equal(parseFlexTime('13:30'), H(13, 30));
  assert.equal(parseFlexTime('1330'), H(13, 30));
  assert.equal(parseFlexTime('9'), H(9));
  assert.equal(parseFlexTime('2'), H(14), 'bare 2 is afternoon');
  assert.equal(parseFlexTime('12:15 AM'), 15);
  assert.equal(parseFlexTime('12:15 PM'), H(12, 15));
  assert.ok(Number.isNaN(parseFlexTime('noon')));
  assert.ok(Number.isNaN(parseFlexTime('25:00')));
  assert.ok(Number.isNaN(parseFlexTime('13pm')));
});

test('windows in one cell', () => {
  assert.deepEqual(parseWindow('1:00-2:00 PM'), { open: H(13), close: H(14) });
  assert.deepEqual(parseWindow('1pm to 2pm'), { open: H(13), close: H(14) });
  assert.deepEqual(parseWindow('11:30 - 12:30 PM'), { open: H(11, 30), close: H(12, 30) });
  assert.deepEqual(parseWindow('13:00 – 14:30'), { open: H(13), close: H(14, 30) });
  assert.equal(parseWindow('2pm-1pm'), null);
  assert.equal(parseWindow('afternoon'), null);
});

test('minutes in words', () => {
  assert.equal(parseMinutes('30'), 30);
  assert.equal(parseMinutes('45 min'), 45);
  assert.equal(parseMinutes('1 hr'), 60);
  assert.equal(parseMinutes('1.5h'), 90);
  assert.ok(Number.isNaN(parseMinutes('a while')));
});

test('quotes, embedded commas and newlines, doubled quotes', () => {
  const rows = parseCsvText('a,b\r\n"Unit 4, 12 Oak ""The Oaks"" Rd","line1\nline2"\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['Unit 4, 12 Oak "The Oaks" Rd', 'line1\nline2']]);
});

test('messy file: BOM, semicolons, odd headers, blank lines, mixed time formats', () => {
  const csv = String.fromCharCode(0xfeff) + 'Address; Latitude ;LONG;Window;Time Needed;Must See\r\n' +
    '12 Pine St;35.80;-78.60;1:00-2:00 PM;30 min;YES\r\n' +
    '\r\n' +
    '"9 Elm Ct, Unit B";35,81;-78,62;3pm to 4:30pm;45;\r\n' +
    ';35.8;-78.6;1-2;30;no\r\n';
  const r = importStops(csv);
  assert.equal(r.stops.length, 2);
  assert.equal(r.stops[0].label, '12 Pine St');
  assert.deepEqual([r.stops[0].open, r.stops[0].close, r.stops[0].dur, r.stops[0].must], [H(13), H(14), 30, true]);
  assert.equal(r.stops[1].label, '9 Elm Ct, Unit B');
  assert.equal(r.stops[1].lat, 35.81, 'decimal comma accepted');
  assert.deepEqual([r.stops[1].open, r.stops[1].close, r.stops[1].must], [H(15), H(16, 30), false]);
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /No label/);
});

test('bad rows are skipped with a reason, good rows still load', () => {
  const csv = 'label,lat,lng,open,close,minutes\n' +
    'Good 1,35.8,-78.6,13:00,14:00,30\n' +
    'Bad lat,95,-78.6,13:00,14:00,30\n' +
    'Backwards,35.8,-78.6,15:00,14:00,30\n' +
    'No times,35.8,-78.6,,,30\n' +
    'Silly minutes,35.8,-78.6,13:00,14:00,a while\n' +
    'Too long,35.8,-78.6,13:00,14:00,600\n' +
    'Garbled time,35.8,-78.6,soonish,later,30\n';
  const r = importStops(csv);
  assert.deepEqual(r.stops.map((s) => s.label), ['Good 1']);
  assert.equal(r.skipped.length, 6);
  assert.equal(r.total, 7);
  assert.ok(r.skipped.every((s) => s.row >= 3 && s.reason.length > 5));
});

test('combined location column, default minutes, rows with no coordinates are held for lookup', () => {
  const r = importStops('address,location,open,close\n5 Oak Way,"35.7, -78.6",1:00 PM,2:00 PM\n7 Birch Way,,1:00 PM,2:00 PM\n');
  assert.equal(r.stops.length, 1);
  assert.equal(r.stops[0].dur, 30);
  assert.equal(r.pending.length, 1);
  assert.equal(r.pending[0].label, '7 Birch Way');
  assert.equal(r.pending[0].row, 3);
});

test('file without a label column, and an empty file, say so instead of throwing', () => {
  assert.match(importStops('foo,bar\n1,2\n').skipped[0].reason, /label/);
  assert.match(importStops('').skipped[0].reason, /empty/);
});

test('export then import round-trips, and formula-like labels are defused and restored', () => {
  const stops = [
    { id: 'a', label: '1 Main St, Apt "B"', lat: 35.8101, lng: -78.612, open: H(13), close: H(14), dur: 30, must: true },
    { id: 'b', label: '=HYPERLINK("x")', lat: 35.7, lng: -78.7, open: H(9, 30), close: H(11), dur: 20, must: false },
  ];
  const csv = exportStops(stops);
  assert.ok(csv.includes("'=HYPERLINK"), 'defused in the file');
  const back = importStops(csv).stops;
  assert.equal(back.length, 2);
  for (let i = 0; i < 2; i++) {
    for (const k of ['label', 'open', 'close', 'dur', 'must']) assert.equal(back[i][k], stops[i][k], k);
    assert.ok(Math.abs(back[i].lat - stops[i].lat) < 1e-6);
  }
});

test('template parses cleanly', () => {
  const r = importStops(TEMPLATE_CSV);
  assert.equal(r.stops.length, 2);
  assert.equal(r.skipped.length, 0);
});
