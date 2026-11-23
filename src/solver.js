import { fmtTime } from './format.js';

/*
 Vehicle routing with time windows, one vehicle, open path (no return to the start).
 Each stop has a window [open, close] in minutes after midnight and needs `dur` minutes inside it.
 Arriving early means waiting for the window to open. A stop that cannot finish by `close` is dropped.
 Goal, in strict order: miss as few must-see stops as possible, miss as few stops as possible, drive the least.
 Waiting is not driving, so it is free.
*/

const W_MUST = 1e12;
const W_MISS = 1e7;

export const EXACT_MAX = 10;
const NODE_LIMIT = 4e6;

export function makeProblem({ stops, startTime, matrix }) {
  const n = stops.length;
  if (matrix.length !== n + 1) throw new Error('matrix must be (stops + 1) square, start first');
  return { stops, startTime, matrix, n, metric: isMetric(matrix) };
}

function isMetric(m) {
  const n = m.length;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) if (m[i][j] > m[i][k] + m[k][j]) return false;
  return true;
}

/** Drive minutes for a route (array of stop indexes) or -1 if any window would be missed. */
export function check(p, route) {
  let t = p.startTime;
  let prev = 0;
  let drive = 0;
  for (let i = 0; i < route.length; i++) {
    const k = route[i];
    const s = p.stops[k];
    const d = p.matrix[prev][k + 1];
    const arrive = t + d;
    t = (arrive > s.open ? arrive : s.open) + s.dur;
    if (t > s.close) return -1;
    drive += d;
    prev = k + 1;
  }
  return drive;
}

export function costOf(p, route) {
  const drive = check(p, route);
  if (drive < 0) return Infinity;
  let mustIn = 0;
  let mustAll = 0;
  for (const s of p.stops) if (s.must) mustAll++;
  for (const k of route) if (p.stops[k].must) mustIn++;
  return (mustAll - mustIn) * W_MUST + (p.n - route.length) * W_MISS + drive;
}

/** Full schedule for a feasible route, or null. */
export function evaluate(p, route) {
  let t = p.startTime;
  let prev = 0;
  let drive = 0;
  const legs = [];
  for (const k of route) {
    const s = p.stops[k];
    const d = p.matrix[prev][k + 1];
    const arrive = t + d;
    const start = Math.max(arrive, s.open);
    const end = start + s.dur;
    if (end > s.close) return null;
    legs.push({ index: k, id: s.id, drive: d, arrive, start, end, wait: start - arrive, slack: s.close - end });
    drive += d;
    t = end;
    prev = k + 1;
  }
  return { drive, finish: t, legs };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- exact: branch and bound over every ordered subset ---------- */

function solveExact(p, seedRoute) {
  const { n, matrix: M } = p;
  let mustAll = 0;
  for (const s of p.stops) if (s.must) mustAll++;
  let best = { cost: costOf(p, seedRoute), route: seedRoute.slice() };
  const used = new Array(n).fill(false);
  const route = [];
  let nodes = 0;
  let aborted = false;

  function rec(prev, t, drive, mustIn) {
    if (aborted) return;
    if (++nodes > NODE_LIMIT) {
      aborted = true;
      return;
    }
    const cost = (mustAll - mustIn) * W_MUST + (n - route.length) * W_MISS + drive;
    if (cost < best.cost) best = { cost, route: route.slice() };
    let lostMust = 0;
    let lostAll = 0;
    const next = [];
    for (let j = 0; j < n; j++) {
      if (used[j]) continue;
      const s = p.stops[j];
      const d = M[prev][j + 1];
      const arrive = t + d;
      const end = (arrive > s.open ? arrive : s.open) + s.dur;
      if (end <= s.close) next.push({ j, d, end });
      else {
        lostAll++;
        if (s.must) lostMust++;
      }
    }
    // With the triangle inequality, a stop that cannot be served from here cannot be served later either.
    const bound = (p.metric ? lostMust * W_MUST + lostAll * W_MISS : 0) + drive;
    if (bound >= best.cost) return;
    next.sort((a, b) => a.d - b.d);
    for (const { j, d, end } of next) {
      used[j] = true;
      route.push(j);
      rec(j + 1, end, drive + d, mustIn + (p.stops[j].must ? 1 : 0));
      route.pop();
      used[j] = false;
    }
  }
  rec(0, p.startTime, 0, 0);
  return { route: best.route, cost: best.cost, nodes, complete: !aborted };
}

/* ---------- heuristic: cheapest insertion, local search, ruin and recreate ---------- */

function insertAll(p, base, order) {
  let route = base.slice();
  for (const k of order) {
    let bestR = null;
    let bestC = Infinity;
    for (let pos = 0; pos <= route.length; pos++) {
      const r = route.slice();
      r.splice(pos, 0, k);
      const c = costOf(p, r);
      if (c < bestC) {
        bestC = c;
        bestR = r;
      }
    }
    if (bestR) route = bestR;
  }
  return route;
}

function localSearch(p, start) {
  let route = start;
  let cur = costOf(p, route);
  const n = p.n;
  const consider = (r) => {
    const c = costOf(p, r);
    if (c < cur) {
      route = r;
      cur = c;
      return true;
    }
    return false;
  };
  let improved = true;
  while (improved) {
    improved = false;
    const inRoute = new Set(route);
    // add a dropped stop anywhere it fits
    for (let u = 0; u < n && !improved; u++) {
      if (inRoute.has(u)) continue;
      for (let pos = 0; pos <= route.length && !improved; pos++) {
        const r = route.slice();
        r.splice(pos, 0, u);
        improved = consider(r);
      }
    }
    // swap a dropped stop in for a served one
    for (let u = 0; u < n && !improved; u++) {
      if (inRoute.has(u)) continue;
      for (let i = 0; i < route.length && !improved; i++) {
        const r = route.slice();
        r[i] = u;
        improved = consider(r);
      }
    }
    // or-opt: move a run of 1 to 3 stops elsewhere, optionally reversed
    for (let len = 1; len <= 3 && !improved; len++) {
      for (let i = 0; i + len <= route.length && !improved; i++) {
        const seg = route.slice(i, i + len);
        const rest = route.slice(0, i).concat(route.slice(i + len));
        for (let pos = 0; pos <= rest.length && !improved; pos++) {
          if (pos === i) continue;
          for (const s of len > 1 ? [seg, seg.slice().reverse()] : [seg]) {
            if (consider(rest.slice(0, pos).concat(s, rest.slice(pos)))) {
              improved = true;
              break;
            }
          }
        }
      }
    }
    // 2-opt: reverse a stretch
    for (let i = 0; i < route.length - 1 && !improved; i++) {
      for (let j = i + 1; j < route.length && !improved; j++) {
        improved = consider(route.slice(0, i).concat(route.slice(i, j + 1).reverse(), route.slice(j + 1)));
      }
    }
    // swap two served stops
    for (let i = 0; i < route.length - 1 && !improved; i++) {
      for (let j = i + 1; j < route.length && !improved; j++) {
        const r = route.slice();
        [r[i], r[j]] = [r[j], r[i]];
        improved = consider(r);
      }
    }
  }
  return { route, cost: cur };
}

function solveHeuristic(p, { seed = 1, rounds = 60 } = {}) {
  const n = p.n;
  const idx = [...Array(n).keys()];
  const S = p.stops;
  const orders = [
    idx.slice().sort((a, b) => Number(S[b].must) - Number(S[a].must) || S[a].close - S[b].close),
    idx.slice().sort((a, b) => S[a].open - S[b].open),
    idx.slice().sort((a, b) => S[a].close - S[b].close),
    idx.slice().sort((a, b) => p.matrix[0][a + 1] - p.matrix[0][b + 1]),
  ];
  let best = { route: [], cost: costOf(p, []) };
  for (const order of orders) {
    const r = localSearch(p, insertAll(p, [], order));
    if (r.cost < best.cost) best = r;
  }
  const rng = mulberry32(seed);
  let cur = best;
  for (let round = 0; round < rounds && n > 1; round++) {
    const removeCount = 1 + Math.floor(rng() * Math.max(1, Math.min(4, Math.ceil(n / 4))));
    const keep = cur.route.slice();
    for (let i = 0; i < removeCount && keep.length; i++) keep.splice(Math.floor(rng() * keep.length), 1);
    const pool = idx.filter((k) => !keep.includes(k));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const cand = localSearch(p, insertAll(p, keep, pool));
    if (cand.cost <= cur.cost) cur = cand;
    if (cur.cost < best.cost) best = cur;
  }
  return best;
}

/** Baseline: always drive to the nearest stop whose window can still be met. */
export function nearestNeighbor(p) {
  const route = [];
  const left = new Set(p.stops.keys());
  let t = p.startTime;
  let prev = 0;
  for (;;) {
    let pick = -1;
    let pickD = Infinity;
    let pickEnd = 0;
    for (const k of left) {
      const s = p.stops[k];
      const d = p.matrix[prev][k + 1];
      const end = Math.max(t + d, s.open) + s.dur;
      if (end <= s.close && d < pickD) {
        pick = k;
        pickD = d;
        pickEnd = end;
      }
    }
    if (pick < 0) break;
    route.push(pick);
    left.delete(pick);
    t = pickEnd;
    prev = pick + 1;
  }
  return { route, cost: costOf(p, route) };
}

/* ---------- why a stop was dropped ---------- */

function simulate(p, route) {
  let t = p.startTime;
  let prev = 0;
  for (const k of route) {
    const s = p.stops[k];
    const start = Math.max(t + p.matrix[prev][k + 1], s.open);
    const end = start + s.dur;
    if (end > s.close) return { ok: false, at: k, late: end - s.close, end };
    t = end;
    prev = k + 1;
  }
  return { ok: true };
}

export function explainDropped(p, route, u) {
  const s = p.stops[u];
  const name = (k) => `"${p.stops[k].label}"`;
  if (s.close - s.open < s.dur) {
    return { code: 'window_too_short', text: `The window is ${s.close - s.open} min long but the showing needs ${s.dur} min inside.` };
  }
  const direct = p.startTime + p.matrix[0][u + 1];
  if (Math.max(direct, s.open) + s.dur > s.close) {
    return {
      code: 'unreachable',
      text: `Even driving straight from the start you would arrive at ${fmtTime(direct)}. The showing has to begin by ${fmtTime(s.close - s.dur)} (window closes ${fmtTime(s.close)}).`,
    };
  }
  let best = null;
  for (let pos = 0; pos <= route.length; pos++) {
    const r = route.slice();
    r.splice(pos, 0, u);
    const sim = simulate(p, r);
    if (sim.ok) return { code: 'not_chosen', text: 'It would fit, but the planner kept a better plan.' };
    const own = sim.at === u;
    const score = (own ? 0 : 1e6) + sim.late;
    if (!best || score < best.score) best = { score, own, pos, sim };
  }
  const after = best.pos === 0 ? 'right after the start' : `right after ${name(route[best.pos - 1])}`;
  const b = best.sim;
  const text = best.own
    ? `No gap is big enough. The best spot is ${after}, where it would run ${b.late} min past its window (finish ${fmtTime(b.end)}, closes ${fmtTime(s.close)}).`
    : `The best spot is ${after}, but then ${name(b.at)} would run ${b.late} min past its window (finish ${fmtTime(b.end)}, closes ${fmtTime(p.stops[b.at].close)}).`;
  return { code: 'conflict', text };
}

/* ---------- public entry ---------- */

export function solve(input, opts = {}) {
  const p = input.matrix && input.n !== undefined ? input : makeProblem(input);
  const heur = solveHeuristic(p, { seed: opts.seed ?? 1, rounds: opts.rounds ?? 60 });
  let route = heur.route;
  let mode = 'heuristic';
  let nodes = 0;
  if (p.n <= (opts.exactMax ?? EXACT_MAX) && !opts.forceHeuristic) {
    const ex = solveExact(p, heur.route);
    route = ex.route;
    nodes = ex.nodes;
    mode = ex.complete ? 'exact' : 'heuristic';
  }
  return describe(p, route, mode, nodes);
}

export function describe(p, route, mode = 'given', nodes = 0) {
  const ev = evaluate(p, route);
  const inRoute = new Set(route);
  const unserved = [];
  for (let k = 0; k < p.n; k++) {
    if (inRoute.has(k)) continue;
    unserved.push({ index: k, id: p.stops[k].id, must: !!p.stops[k].must, reason: explainDropped(p, route, k) });
  }
  return {
    mode,
    nodes,
    route,
    order: route.map((k) => p.stops[k].id),
    legs: ev.legs,
    drive: ev.drive,
    finish: ev.finish,
    served: route.length,
    total: p.n,
    unserved,
    mustMissed: unserved.filter((u) => u.must).length,
    cost: costOf(p, route),
  };
}
