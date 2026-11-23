export function fmtTime(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  return `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

export function fmtDuration(min) {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h} hr` : `${h} hr ${m % 60} min`;
}

/** "13:05" -> 785 (minutes after midnight). Returns NaN on bad input. */
export function parseClock(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text).trim());
  if (!m) return NaN;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h > 23 || mi > 59 ? NaN : h * 60 + mi;
}

export function toClock(min) {
  const m = Math.max(0, Math.min(1439, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Accepts "35.78, -78.64" or "35.78 -78.64". Returns {lat, lng} or null. */
export function parseLatLng(text) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(text));
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/**
 Forgiving clock parser for pasted data: "1:00 PM", "1pm", "13:00", "1300", "1.30 pm".
 With no am/pm, hours 1 to 6 are read as afternoon and 7 to 11 as morning (showings are rarely at 3 am).
 Returns minutes after midnight or NaN.
*/
export function parseFlexTime(text) {
  const m = /^(\d{1,2})(?:[:.]?(\d{2}))?\s*([ap])?\.?m?\.?$/i.exec(String(text).trim().replace(/\s+/g, ' '));
  if (!m) return NaN;
  let h = Number(m[1]);
  const mi = m[2] === undefined ? 0 : Number(m[2]);
  if (mi > 59 || h > 24) return NaN;
  const mer = m[3]?.toLowerCase();
  if (mer) {
    if (h < 1 || h > 12) return NaN;
    h = (h % 12) + (mer === 'p' ? 12 : 0);
  } else if (h >= 1 && h <= 6) h += 12;
  return h === 24 ? (mi === 0 ? 1439 : NaN) : h * 60 + mi;
}

/** "1:00-2:00 PM", "1pm to 2pm", "13:00 - 14:00". Returns {open, close} or null. */
export function parseWindow(text) {
  const dashes = `${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}`;
  const parts = String(text).split(new RegExp(String.raw`\s*(?:-|[${dashes}]|\bto\b)\s*`, 'i'));
  if (parts.length !== 2) return null;
  const hasMer = (s) => /[ap]\.?m?\.?\s*$/i.test(s);
  const close = parseFlexTime(parts[1]);
  if (Number.isNaN(close)) return null;
  let open = parseFlexTime(parts[0]);
  // "11:30-12:30 PM": the opening time borrows the closing am/pm when that makes sense.
  if (!hasMer(parts[0]) && hasMer(parts[1])) {
    const mer = /[ap]/i.exec(parts[1])[0];
    const borrowed = parseFlexTime(`${parts[0].trim()}${mer}`);
    if (!Number.isNaN(borrowed) && borrowed < close) open = borrowed;
    else if (!Number.isNaN(borrowed) && borrowed - 720 >= 0 && borrowed - 720 < close) open = borrowed - 720;
  }
  return !Number.isNaN(open) && open < close ? { open, close } : null;
}

/** "30", "30 min", "45m", "1 hr", "1.5h". Returns minutes or NaN. */
export function parseMinutes(text) {
  const m = /^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minutes?)?$/i.exec(String(text).trim());
  if (!m) return NaN;
  const v = Number(m[1]);
  return /^h/i.test(m[2] ?? '') ? Math.round(v * 60) : Math.round(v);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
