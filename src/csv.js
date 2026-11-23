import { parseLatLng, parseFlexTime, parseWindow, parseMinutes, toClock } from './format.js';

/*
 Columns (header row required, names are case and spacing insensitive, order does not matter):
   label    address, name, home, property, listing                  required
   lat      latitude                                                 with lng, or use "location" below
   lng      lon, long, longitude
   location coordinates, coords, latlng                              "35.81, -78.61" in one column
   open     window_start, from, start, opens                         time window opens
   close    window_end, until, end, closes                           time window closes
   window   times, showing_window                                    "1:00-2:00 PM", instead of open and close
   minutes  duration, dur, mins, time_needed                         default 30 when blank
   must     must_see, priority, mustsee, required                    yes/true/1/y/x/must/high
*/
const ALIASES = {
  label: ['label', 'address', 'name', 'home', 'property', 'listing', 'stop', 'house'],
  lat: ['lat', 'latitude'],
  lng: ['lng', 'lon', 'long', 'longitude'],
  location: ['location', 'coordinates', 'coords', 'latlng', 'latlon', 'position'],
  open: ['open', 'opens', 'windowstart', 'windowopen', 'from', 'start', 'earliest'],
  close: ['close', 'closes', 'windowend', 'windowclose', 'until', 'end', 'latest', 'to'],
  window: ['window', 'times', 'showingwindow', 'showtimes', 'timewindow'],
  minutes: ['minutes', 'duration', 'dur', 'mins', 'min', 'timeneeded', 'length'],
  must: ['must', 'mustsee', 'priority', 'required', 'musthave'],
};

export const CSV_COLUMNS = ['label', 'lat', 'lng', 'open', 'close', 'minutes', 'must'];
export const DEFAULT_MINUTES = 30;

const norm = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Split CSV text into rows. Handles a BOM, quotes with doubled quotes, CR/LF/CRLF, embedded newlines and , ; or tab separators. */
export function parseCsvText(input) {
  const text = String(input).replace(new RegExp(`^${String.fromCharCode(0xfeff)}`), '');
  const first = text.split(/\r\n|\r|\n/, 1)[0] ?? '';
  let delim = ',';
  let best = -1;
  for (const d of [',', ';', '\t']) {
    let n = 0;
    let q = false;
    for (const ch of first) {
      if (ch === '"') q = !q;
      else if (ch === d && !q) n++;
    }
    if (n > best) {
      best = n;
      delim = d;
    }
  }
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      cur = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const TRUE = new Set(['y', 'yes', 'true', 't', '1', 'x', 'must', 'must-see', 'mustsee', 'high', 'required', 'priority']);

/**
 Turn CSV text into stops. Never throws on bad rows: each one is skipped and listed in `skipped` with the reason.
 Rows with a label and a good window but no coordinates go in `pending` so the app can look them up if a geocoder is set.
*/
export function importStops(text, newId = (i) => `csv${i}`) {
  const rows = parseCsvText(text);
  const result = { stops: [], pending: [], skipped: [], total: 0 };
  if (!rows.length) {
    result.skipped.push({ row: 0, reason: 'The file is empty.' });
    return result;
  }
  const header = rows[0].map(norm);
  const col = {};
  for (const [key, names] of Object.entries(ALIASES)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) col[key] = i;
  }
  if (col.label === undefined) {
    result.skipped.push({ row: 1, reason: 'No label column. The first row needs a column named label (or address).' });
    return result;
  }
  const get = (r, key) => (col[key] === undefined ? '' : String(r[col[key]] ?? '').trim());
  rows.slice(1).forEach((r, k) => {
    const rowNo = k + 2;
    result.total++;
    const skip = (reason) => result.skipped.push({ row: rowNo, label: get(r, 'label'), reason });
    let label = get(r, 'label').replace(/^'(?=[=+@-])/, '');
    if (!label) return skip('No label.');
    label = label.slice(0, 80);

    let ll = null;
    if (get(r, 'lat') !== '' && get(r, 'lng') !== '') {
      const lat = Number(get(r, 'lat').replace(',', '.'));
      const lng = Number(get(r, 'lng').replace(',', '.'));
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) ll = { lat, lng };
      else return skip(`Coordinates ${get(r, 'lat')}, ${get(r, 'lng')} are not valid.`);
    } else if (get(r, 'location') !== '') {
      ll = parseLatLng(get(r, 'location'));
      if (!ll) return skip(`Could not read the location "${get(r, 'location')}".`);
    }

    let open;
    let close;
    if (get(r, 'window') !== '') {
      const w = parseWindow(get(r, 'window'));
      if (!w) return skip(`Could not read the window "${get(r, 'window')}".`);
      ({ open, close } = w);
    } else {
      if (get(r, 'open') === '' || get(r, 'close') === '') return skip('No showing window (open and close times).');
      open = parseFlexTime(get(r, 'open'));
      close = parseFlexTime(get(r, 'close'));
      if (Number.isNaN(open) || Number.isNaN(close)) return skip(`Could not read the times "${get(r, 'open')}" and "${get(r, 'close')}".`);
      if (close <= open) return skip('The window closes before it opens.');
    }

    let dur = DEFAULT_MINUTES;
    if (get(r, 'minutes') !== '') {
      dur = parseMinutes(get(r, 'minutes'));
      if (Number.isNaN(dur)) return skip(`Could not read minutes "${get(r, 'minutes')}".`);
      if (dur < 5 || dur > 240) return skip(`Minutes inside should be 5 to 240, got ${dur}.`);
    }
    const must = TRUE.has(get(r, 'must').toLowerCase());
    const stop = { id: newId(result.stops.length + result.pending.length), label, open, close, dur, must };
    if (ll) result.stops.push({ ...stop, ...ll });
    else result.pending.push({ ...stop, row: rowNo });
  });
  return result;
}

function cell(v, text = false) {
  let s = String(v);
  if (text && /^[=+@-]/.test(s)) s = `'${s}`; // keeps spreadsheets from running a label as a formula
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportStops(stops) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const s of stops) {
    lines.push([cell(s.label, true), ...[s.lat.toFixed(6), s.lng.toFixed(6), toClock(s.open), toClock(s.close), s.dur, s.must ? 'yes' : 'no'].map((v) => cell(v))].join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

export const TEMPLATE_CSV = `${CSV_COLUMNS.join(',')}\r\n"418 Maple Ridge Dr",35.8101,-78.612,13:00,14:00,30,yes\r\n"72 Cedar Hollow Ln",35.748,-78.69,12:30,15:00,20,no\r\n`;
