// Generates BENCHMARK.md from a real run. Nothing in that file is typed by hand.
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { solve, nearestNeighbor, describe, EXACT_MAX } from '../src/solver.js';
import { generateInstance } from './generate.mjs';

const SMALL = { count: 120, sizes: [6, 7, 8, 9, 10] };
const LARGE = { count: 120, sizes: [12, 15, 20, 25, 30] };

const KINDS = ['planted', 'random', 'wide', 'open'];
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const max = (a) => a.reduce((m, x) => Math.max(m, x), 0);
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

function runSmall() {
  const rows = [];
  for (let i = 0; i < SMALL.count; i++) {
    const n = SMALL.sizes[i % SMALL.sizes.length];
    const kind = KINDS[i % KINDS.length];
    const { problem } = generateInstance({ seed: 1000 + i, n, kind });
    const t0 = performance.now();
    const exact = solve(problem);
    const exactMs = performance.now() - t0;
    const t1 = performance.now();
    const heur = solve(problem, { forceHeuristic: true });
    const heurMs = performance.now() - t1;
    rows.push({ n, kind, exact, heur, exactMs, heurMs });
  }
  return rows;
}

function runLarge() {
  const rows = [];
  for (let i = 0; i < LARGE.count; i++) {
    const n = LARGE.sizes[i % LARGE.sizes.length];
    const kind = KINDS[i % KINDS.length];
    const { problem } = generateInstance({ seed: 5000 + i, n, kind });
    const t0 = performance.now();
    const ours = solve(problem);
    const ms = performance.now() - t0;
    const nn = describe(problem, nearestNeighbor(problem).route, 'nearest-neighbor');
    rows.push({ n, kind, ours, nn, ms });
  }
  return rows;
}

const small = runSmall();
const large = runLarge();

// small: heuristic against the exact optimum
const optimal = small.filter((r) => r.heur.cost === r.exact.cost);
const sameServed = small.filter((r) => r.heur.served === r.exact.served && r.exact.drive > 0);
const gaps = sameServed.map((r) => (r.heur.drive - r.exact.drive) / r.exact.drive);
const lessServed = small.filter((r) => r.heur.served < r.exact.served || r.heur.mustMissed > r.exact.mustMissed);

// large: ours against nearest neighbor
const bothAll = large.filter((r) => r.ours.served === r.nn.served && r.ours.mustMissed === r.nn.mustMissed && r.nn.drive > 0);
const savings = bothAll.map((r) => (r.nn.drive - r.ours.drive) / r.nn.drive);
const moreServed = large.filter((r) => r.ours.served > r.nn.served);
const fewerServed = large.filter((r) => r.ours.served < r.nn.served);
const notWorse = large.filter((r) => r.ours.cost <= r.nn.cost);

const kindCounts = (rows) => KINDS.map((k) => `${rows.filter((r) => r.kind === k).length} ${k}`).join(', ');
const bySize = (rows, f) =>
  [...new Set(rows.map((r) => r.n))]
    .sort((a, b) => a - b)
    .map((n) => f(n, rows.filter((r) => r.n === n)));

const md = `# Benchmark

Written by \`npm run bench\` (\`scripts/benchmark.mjs\`) from a real run on ${small.length + large.length} generated instances. Do not edit by hand.
Node ${process.version}, ${process.platform}. Run on ${new Date().toISOString().slice(0, 10)}. Times are for that machine and will differ on yours.

## How the instances are made

Seeded generator (\`scripts/generate.mjs\`), invented stops scattered over a 0.3 by 0.4 degree patch of map, 9:00 to 10:30 start.
Travel time is the default offline estimate (straight-line miles x 1.3 at 30 mph, rounded up to whole minutes).

- **planted**: a hidden route is driven first and each showing window is built around its visit time, so a plan that serves every stop exists.
- **random**: windows are drawn without checking, so often some stops cannot be met. These test the "which windows fail" side.
- **wide**: long windows (2.5 to 6.5 hours), so the order is mostly a shortest-route puzzle. This is the hard case for a heuristic.
- **open**: every window is open all day, so there are no time limits at all and the order is a plain shortest-route puzzle. This is where nearest neighbor can serve everything, so it is the fair drive-time comparison.
- About a quarter of stops are must-see. The planner minimizes missed must-sees first, then missed stops, then driving time.

## Small instances: heuristic against the exact optimum

${small.length} instances, 6 to ${EXACT_MAX} stops. The app solves these exactly (branch and bound over every ordered subset).
Here the heuristic (greedy insertion, or-opt, 2-opt, swap, ruin and recreate) is forced on, and its answer is compared to the true optimum.

| Measure | Result |
| --- | --- |
| Instances | ${small.length} (${kindCounts(small)}) |
| Heuristic found the exact optimum | ${optimal.length} of ${small.length} (${pct(optimal.length / small.length)}) |
| Drive-time gap, mean (instances serving the same number of stops: ${sameServed.length}) | ${pct(mean(gaps))} |
| Drive-time gap, worst | ${pct(max(gaps))} |
| Heuristic served fewer stops or missed more must-sees than optimal | ${lessServed.length} |
| Exact solver time, mean / max | ${mean(small.map((r) => r.exactMs)).toFixed(1)} ms / ${max(small.map((r) => r.exactMs)).toFixed(0)} ms |
| Heuristic time, mean / max | ${mean(small.map((r) => r.heurMs)).toFixed(1)} ms / ${max(small.map((r) => r.heurMs)).toFixed(0)} ms |

By size:

| Stops | Instances | Heuristic optimal | Mean exact time |
| --- | --- | --- | --- |
${bySize(small, (n, rs) => `| ${n} | ${rs.length} | ${rs.filter((r) => r.heur.cost === r.exact.cost).length} of ${rs.length} | ${mean(rs.map((r) => r.exactMs)).toFixed(1)} ms |`).join('\n')}

## Larger instances: solver against nearest neighbor

${large.length} instances, 12 to 30 stops (above ${EXACT_MAX} stops the app uses the heuristic, so this is what it does for a big day).
The baseline drives to the nearest stop whose window can still be met, over and over, which is what many people do by feel.
There is no exact optimum at this size, so this compares to the baseline only.

| Measure | Result |
| --- | --- |
| Instances | ${large.length} (${kindCounts(large)}) |
| Solver plan as good or better than nearest neighbor | ${notWorse.length} of ${large.length} |
| Solver served more stops | ${moreServed.length} |
| Solver served fewer stops (it trades them to keep must-sees) | ${fewerServed.length} |
| Mean stops served, solver / nearest neighbor | ${mean(large.map((r) => r.ours.served)).toFixed(1)} / ${mean(large.map((r) => r.nn.served)).toFixed(1)} of ${mean(large.map((r) => r.n)).toFixed(1)} |
| Mean drive-time saving where both serve the same count (same stops served and same must-sees missed, ${bothAll.length} instances) | ${pct(mean(savings))} |
| Median drive-time saving, same instances | ${pct(median(savings))} |
| Solver time, mean / max | ${mean(large.map((r) => r.ms)).toFixed(0)} ms / ${max(large.map((r) => r.ms)).toFixed(0)} ms |

By size:

| Stops | Instances | Mean served (solver / NN) | Mean drive minutes (solver / NN, same outcome) |
| --- | --- | --- | --- |
${bySize(large, (n, rs) => {
  const same = rs.filter((r) => r.ours.served === r.nn.served && r.ours.mustMissed === r.nn.mustMissed);
  return `| ${n} | ${rs.length} | ${mean(rs.map((r) => r.ours.served)).toFixed(1)} / ${mean(rs.map((r) => r.nn.served)).toFixed(1)} | ${mean(same.map((r) => r.ours.drive)).toFixed(0)} / ${mean(same.map((r) => r.nn.drive)).toFixed(0)} |`;
}).join('\n')}

## Limits of this benchmark

- The generator is synthetic. Real days have clusters (a neighborhood with six listings) that this scatter does not copy.
- Travel times are the offline estimate. With a real OSRM server the matrix changes but the solver is the same.
- Above ${EXACT_MAX} stops the answer is not proven optimal. The baseline comparison shows it beats a common habit, not that it is the best possible.
`;

writeFileSync(new URL('../BENCHMARK.md', import.meta.url), md);
console.log(md.split('\n').slice(15, 30).join('\n'));
