import { fmtTime, fmtDuration } from './format.js';

/**
 Turn a solved plan into the pieces the buyer sees. `stops` are the app's stop objects, `plan` is solve() output,
 `miles` is an optional matrix of road miles (index 0 = start).
*/
export function itineraryRows(stops, plan, start) {
  const byId = new Map(stops.map((s) => [s.id, s]));
  return plan.legs.map((leg, i) => {
    const s = byId.get(leg.id);
    return {
      number: i + 1,
      id: s.id,
      label: s.label,
      lat: s.lat,
      lng: s.lng,
      arrive: leg.arrive,
      start: leg.start,
      end: leg.end,
      drive: leg.drive,
      wait: leg.wait,
      from: i === 0 ? start.label || 'Start' : byId.get(plan.legs[i - 1].id).label,
      windowOpen: s.open,
      windowClose: s.close,
      must: !!s.must,
    };
  });
}

export function rowDescription(r) {
  const bits = [`Window ${fmtTime(r.windowOpen)} to ${fmtTime(r.windowClose)}.`, `Plan ${fmtDuration(r.end - r.start)} inside.`];
  if (r.drive > 0) bits.push(`Drive from ${r.from}: ${fmtDuration(r.drive)}.`);
  if (r.wait > 0) bits.push(`You arrive ${fmtDuration(r.wait)} early.`);
  return bits.join(' ');
}

export function shareText({ rows, unserved = [], date, buyer, startLabel }) {
  const head = buyer ? `Showings for ${buyer}` : 'Showing plan';
  const lines = [`${head}, ${date}`];
  if (startLabel) lines.push(`Start: ${startLabel}`);
  lines.push('');
  for (const r of rows) {
    lines.push(`${r.number}. ${fmtTime(r.start)} to ${fmtTime(r.end)}  ${r.label}`);
    if (r.drive > 0) lines.push(`   ${fmtDuration(r.drive)} drive from ${r.from}`);
  }
  if (unserved.length) {
    lines.push('', 'Not scheduled:');
    for (const u of unserved) lines.push(`- ${u.label}: ${u.reason}`);
  }
  return `${lines.join('\n')}\n`;
}
