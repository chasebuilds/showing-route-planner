import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeProblem, solve, evaluate, costOf, nearestNeighbor } from '../src/solver.js';
import { generateInstance } from '../scripts/generate.mjs';

const T = (h, m = 0) => h * 60 + m;

/** Stops on a line: leg minutes are |i - j| * 10 so results are easy to reason about. */
function lineProblem(stops, startTime = T(12)) {
  const pos = [0, ...stops.map((s) => s.at)];
  const matrix = pos.map((a) => pos.map((b) => Math.abs(a - b) * 10));
  return makeProblem({ stops: stops.map((s, i) => ({ id: `s${i}`, label: s.label ?? `S${i}`, open: T(0), close: T(23), dur: 20, must: false, ...s })), startTime, matrix });
}

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((r) => [x, ...r]));
}

function bruteForce(p) {
  let best = Infinity;
  const idx = [...Array(p.n).keys()];
  const subsets = (arr) => (arr.length === 0 ? [[]] : subsets(arr.slice(1)).flatMap((s) => [s, [arr[0], ...s]]));
  for (const sub of subsets(idx)) for (const r of permutations(sub)) best = Math.min(best, costOf(p, r));
  return best;
}

test('orders stops by window when that avoids a miss', () => {
  const p = lineProblem([
    { at: 1, open: T(14), close: T(15), label: 'Late' },
    { at: 2, open: T(12), close: T(13), label: 'Early' },
  ]);
  const r = solve(p);
  assert.deepEqual(r.order, ['s1', 's0']);
  assert.equal(r.unserved.length, 0);
  assert.equal(r.legs[0].start, T(12, 20));
});

test('waits for a window to open and does not count the wait as driving', () => {
  const p = lineProblem([{ at: 1, open: T(13), close: T(14) }]);
  const r = solve(p);
  assert.equal(r.legs[0].arrive, T(12, 10));
  assert.equal(r.legs[0].start, T(13));
  assert.equal(r.legs[0].wait, 50);
  assert.equal(r.drive, 10);
});

test('window that closes before the earliest possible arrival is reported as unreachable', () => {
  const p = lineProblem([
    { at: 1, open: T(12), close: T(15), label: 'Easy' },
    { at: 9, open: T(12), close: T(13), label: 'Too far', must: true },
  ]);
  const r = solve(p);
  assert.deepEqual(r.order, ['s0']);
  assert.equal(r.unserved.length, 1);
  assert.equal(r.unserved[0].id, 's1');
  assert.equal(r.unserved[0].reason.code, 'unreachable');
  assert.match(r.unserved[0].reason.text, /1:30 PM/);
  assert.equal(r.mustMissed, 1);
});

test('window shorter than the showing is reported', () => {
  const p = lineProblem([{ at: 1, open: T(13), close: T(13, 10), dur: 30 }]);
  const r = solve(p);
  assert.equal(r.served, 0);
  assert.equal(r.unserved[0].reason.code, 'window_too_short');
});

test('two must-sees with clashing windows: one is kept, the other is explained as a conflict', () => {
  const p = lineProblem([
    { at: 1, open: T(13), close: T(13, 30), must: true, label: 'North' },
    { at: 8, open: T(13), close: T(13, 30), must: true, label: 'South' },
  ]);
  const r = solve(p);
  assert.equal(r.served, 1);
  assert.equal(r.mustMissed, 1);
  assert.ok(['conflict', 'unreachable'].includes(r.unserved[0].reason.code));
});

test('a conflict reason names the stop that blocks it', () => {
  const p = lineProblem(
    [
      { at: 1, open: T(13), close: T(13, 40), label: 'Anchor', must: true },
      { at: 2, open: T(13), close: T(13, 45), label: 'Squeezed' },
    ],
    T(12, 30),
  );
  const r = solve(p);
  assert.equal(r.served, 1);
  assert.equal(r.unserved[0].reason.code, 'conflict');
  assert.match(r.unserved[0].reason.text, /past its window/);
});

test('must-see beats a bigger set of ordinary stops', () => {
  const p = lineProblem([
    { at: 1, open: T(12), close: T(13), label: 'A' },
    { at: 1, open: T(12), close: T(13), label: 'B' },
    { at: 1, open: T(12), close: T(13), label: 'C' },
    { at: 2, open: T(12), close: T(12, 45), must: true, label: 'Must' },
  ]);
  const r = solve(p);
  assert.equal(r.mustMissed, 0);
  assert.ok(r.order.includes('s3'));
});

test('exact search matches brute force on random small instances', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { problem } = generateInstance({ seed, n: 5, kind: seed % 2 ? 'planted' : 'random' });
    const r = solve(problem);
    assert.equal(r.mode, 'exact');
    assert.equal(r.cost, bruteForce(problem), `seed ${seed}`);
  }
});

test('heuristic returns a feasible schedule and is never worse than nearest neighbor', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { problem } = generateInstance({ seed, n: 16, kind: 'planted' });
    const r = solve(problem);
    assert.equal(r.mode, 'heuristic');
    assert.ok(evaluate(problem, r.route), 'schedule is feasible');
    assert.ok(r.cost <= nearestNeighbor(problem).cost);
  }
});

test('planted instances can be fully served', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { problem } = generateInstance({ seed, n: 8, kind: 'planted' });
    assert.equal(solve(problem).unserved.length, 0, `seed ${seed}`);
  }
});

test('same input gives the same plan', () => {
  const { problem } = generateInstance({ seed: 7, n: 20, kind: 'random' });
  assert.deepEqual(solve(problem).route, solve(problem).route);
});

test('no stops is a valid empty plan', () => {
  const r = solve(makeProblem({ stops: [], startTime: T(9), matrix: [[0]] }));
  assert.equal(r.served, 0);
  assert.equal(r.drive, 0);
});
