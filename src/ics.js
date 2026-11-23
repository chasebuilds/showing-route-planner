const enc = new TextEncoder();

function esc(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold a content line at 75 octets, continuation lines start with one space (RFC 5545 section 3.1). */
export function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

function local(date, min) {
  const [y, m, d] = date.split('-');
  return `${y}${m}${d}T${pad(Math.floor(min / 60))}${pad(min % 60)}00`;
}

function stamp(now) {
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
}

/**
 Build a calendar file with one event per showing, in floating local time (no time zone, so it lands
 at the same clock time wherever the phone is).
 items: [{ uid, label, startMin, endMin, lat, lng, description }]
*/
export function buildIcs({ date, title = 'Showings', items, now = new Date(), alarmMin = 15 }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date must be YYYY-MM-DD');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Chase Builds//Showing Route Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(title)}`];
  for (const it of items) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${it.uid}@showing-route-planner`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${local(date, it.startMin)}`,
      `DTEND:${local(date, it.endMin)}`,
      `SUMMARY:${esc(it.label)}`,
      `LOCATION:${esc(it.label)}`,
    );
    if (Number.isFinite(it.lat) && Number.isFinite(it.lng)) lines.push(`GEO:${it.lat.toFixed(6)};${it.lng.toFixed(6)}`);
    if (it.description) lines.push(`DESCRIPTION:${esc(it.description)}`);
    if (alarmMin > 0) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`Leave for ${it.label}`)}`, `TRIGGER:-PT${alarmMin}M`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
