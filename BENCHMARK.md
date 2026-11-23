# Benchmark

Written by `npm run bench` (`scripts/benchmark.mjs`) from a real run on 540 generated instances. Do not edit by hand.
Node v24.14.1, win32. Run on 2026-11-23. Times are for that machine and will differ on yours.

## How the instances are made

Seeded generator (`scripts/generate.mjs`), invented stops scattered over a 0.3 by 0.4 degree patch of map, 9:00 to 10:30 start.
Travel time is the default offline estimate (straight-line miles x 1.3 at 30 mph, rounded up to whole minutes).

- **planted**: a hidden route is driven first and each showing window is built around its visit time, so a plan that serves every stop exists.
- **random**: windows are drawn without checking, so often some stops cannot be met. These test the "which windows fail" side.
- **wide**: long windows (2.5 to 6.5 hours), so the order is mostly a shortest-route puzzle. This is the hard case for a heuristic.
- **open**: every window is open all day, so there are no time limits at all and the order is a plain shortest-route puzzle. This is where nearest neighbor can serve everything, so it is the fair drive-time comparison.
- About a quarter of stops are must-see. The planner minimizes missed must-sees first, then missed stops, then driving time.

## Small instances: heuristic against the exact optimum

120 instances, 6 to 10 stops. The app solves these exactly (branch and bound over every ordered subset).
Here the heuristic (greedy insertion, or-opt, 2-opt, swap, ruin and recreate) is forced on, and its answer is compared to the true optimum.

| Measure | Result |
| --- | --- |
| Instances | 120 (30 planted, 30 random, 30 wide, 30 open) |
| Heuristic found the exact optimum | 120 of 120 (100.0%) |
| Drive-time gap, mean (instances serving the same number of stops: 120) | 0.0% |
| Drive-time gap, worst | 0.0% |
| Heuristic served fewer stops or missed more must-sees than optimal | 0 |
| Exact solver time, mean / max | 10.3 ms / 69 ms |
| Heuristic time, mean / max | 8.4 ms / 24 ms |

By size:

| Stops | Instances | Heuristic optimal | Mean exact time |
| --- | --- | --- | --- |
| 6 | 24 | 24 of 24 | 3.9 ms |
| 7 | 24 | 24 of 24 | 6.0 ms |
| 8 | 24 | 24 of 24 | 9.2 ms |
| 9 | 24 | 24 of 24 | 11.7 ms |
| 10 | 24 | 24 of 24 | 20.7 ms |

Held-out check: the heuristic was tuned against the 120 instances above, so 300 more small instances (same generator, seeds never used while tuning) were run as well.
The heuristic found the exact optimum in 300 of 300 (100.0%); worst drive-time gap 0.0%.

## Larger instances: solver against nearest neighbor

120 instances, 12 to 30 stops (above 10 stops the app uses the heuristic, so this is what it does for a big day).
The baseline drives to the nearest stop whose window can still be met, over and over, which is what many people do by feel.
There is no exact optimum at this size, so this compares to the baseline only.

| Measure | Result |
| --- | --- |
| Instances | 120 (30 planted, 30 random, 30 wide, 30 open) |
| Solver plan as good or better than nearest neighbor | 120 of 120 |
| Solver served more stops | 87 |
| Solver served fewer stops (it trades them to keep must-sees) | 1 |
| Mean stops served, solver / nearest neighbor | 14.8 / 9.5 of 20.4 |
| Mean drive-time saving where both serve the same count (same stops served and same must-sees missed, 30 instances) | 10.6% |
| Median drive-time saving, same instances | 10.2% |
| Solver time, mean / max | 65 ms / 434 ms |

By size:

| Stops | Instances | Mean served (solver / NN) | Mean drive minutes (solver / NN, same outcome) |
| --- | --- | --- | --- |
| 12 | 24 | 10.0 / 6.2 | 150 / 165 |
| 15 | 24 | 12.0 / 7.8 | 180 / 199 |
| 20 | 24 | 14.7 / 9.7 | 203 / 234 |
| 25 | 24 | 17.3 / 11.0 | 230 / 258 |
| 30 | 24 | 20.4 / 13.0 | 252 / 285 |

## Limits of this benchmark

- The generator is synthetic. Real days have clusters (a neighborhood with six listings) that this scatter does not copy.
- Travel times are the offline estimate. With a real OSRM server the matrix changes but the solver is the same.
- Above 10 stops the answer is not proven optimal. The baseline comparison shows it beats a common habit, not that it is the best possible.
