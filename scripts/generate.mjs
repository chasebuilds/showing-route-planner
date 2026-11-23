import { estimateMatrix } from '../src/travel.js';
import { makeProblem } from '../src/solver.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CENTER = { lat: 35.78, lng: -78.64 };

/**
 One made-up day of showings around a fixed map region.
 kind "planted": a hidden route is driven first and each window is built around its visit time, so every stop can be served.
 kind "random": windows are drawn without checking, so some stops usually cannot be met.
 kind "open": every window is wide open, so this is a plain shortest-route problem.
 kind "wide": long windows (2.5 to 6.5 hours), so ordering is mostly a shortest-route problem and a plan usually serves everything.
*/
export function generateInstance({ seed, n, kind }) {
  const rnd = mulberry32(seed);
  const pt = () => ({ lat: CENTER.lat + (rnd() - 0.5) * 0.3, lng: CENTER.lng + (rnd() - 0.5) * 0.4 });
  const start = pt();
  const points = [start, ...Array.from({ length: n }, pt)];
  const { minutes } = estimateMatrix(points);
  const startTime = 9 * 60 + Math.floor(rnd() * 4) * 30;
  const stops = [];
  if (kind === 'planted') {
    const hidden = [...Array(n).keys()].sort(() => rnd() - 0.5);
    let t = startTime;
    let prev = 0;
    for (const k of hidden) {
      const dur = 15 + Math.floor(rnd() * 4) * 5;
      const arrive = t + minutes[prev][k + 1];
      const visit = arrive + Math.floor(rnd() * 15);
      const open = Math.max(startTime, visit - Math.floor(rnd() * 45));
      const close = visit + dur + 10 + Math.floor(rnd() * 50);
      stops[k] = { dur, open, close, must: rnd() < 0.25 };
      t = visit + dur;
      prev = k + 1;
    }
  } else if (kind === 'open') {
    for (let k = 0; k < n; k++) stops[k] = { dur: 15 + Math.floor(rnd() * 4) * 5, open: startTime, close: startTime + 1200, must: false };
  } else if (kind === 'wide') {
    for (let k = 0; k < n; k++) {
      const dur = 15 + Math.floor(rnd() * 4) * 5;
      const open = startTime + Math.floor(rnd() * 3) * 30;
      stops[k] = { dur, open, close: open + dur + 150 + Math.floor(rnd() * 240), must: rnd() < 0.25 };
    }
  } else {
    for (let k = 0; k < n; k++) {
      const dur = 15 + Math.floor(rnd() * 4) * 5;
      const open = startTime + Math.floor(rnd() * 8) * 30;
      stops[k] = { dur, open, close: open + dur + 15 + Math.floor(rnd() * 90), must: rnd() < 0.25 };
    }
  }
  const named = stops.map((s, k) => ({ id: `s${k}`, label: `Stop ${k + 1}`, lat: points[k + 1].lat, lng: points[k + 1].lng, ...s }));
  return { problem: makeProblem({ stops: named, startTime, matrix: minutes }), points, start };
}
