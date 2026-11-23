# showing-route-planner

[![ci](https://github.com/chasebuilds/showing-route-planner/actions/workflows/ci.yml/badge.svg)](https://github.com/chasebuilds/showing-route-planner/actions/workflows/ci.yml)

Put a day of home showings in the order that fits every listing agent's window with the least driving. You enter the homes, the window each one is open (say 1:00 to 2:00 pm), how many minutes you need inside, and which ones are must-sees. The app picks the order, shows it on a map and a timeline, and tells you which showings cannot work and why. Then it gives the buyer a printable itinerary, a calendar file, and text to send.

**Live demo:** https://chasebuilds.github.io/showing-route-planner/ (invented homes and addresses; works on a phone, and "Add to Home Screen" installs it)

![Showing Route Planner: timeline on the left, numbered route on the map](docs/preview.png)

## What you get

- **An order that fits the windows.** Waiting for a window to open is allowed. A showing that cannot finish before its window closes is left out.
- **Must-sees first.** The plan misses as few must-sees as possible, then as few showings as possible, then drives the least.
- **Plain reasons for what does not fit.** For example: "The best spot is right after 88 Linden Park Ave, where it would run 1 min past its window." Or: "Even driving straight from the start you would arrive at 1:30 PM."
- **Map and timeline.** Numbered pins on OpenStreetMap, and a timeline with drive time, arrival, wait, and minutes to spare for each showing. Drag the start pin, or tap the map to drop a new one.
- **Buyer itinerary.** Print it (or save as PDF), download a `.ics` file for any calendar app, or share the text.
- **Works offline after the first load.** The app and the map tiles you have looked at are cached. Your data stays on your device.

## Travel times

By default the app does not call any server. It estimates drive time as straight-line miles x a road factor (default 1.3), driven at a flat speed (default 30 mph), rounded up to whole minutes. Both numbers are on screen and editable under "Travel time settings", so you can match your market.

For real drive times, switch on "Use my own OSRM server" and enter your server's address. The app asks its `/table` service for a drive-time matrix. It is off by default and no server address is built in, so nothing is sent anywhere unless you set one. If the server fails, the app says so and falls back to the estimate.

## How the planner works

One car, one day, no return to the start. Each showing has a window and a duration.

- **Up to 10 showings:** exact search. Branch and bound over every ordered subset, so the answer is the true best for the travel times given.
- **More than 10:** a heuristic. Cheapest-insertion starts, then local search (or-opt, 2-opt, swaps, adding or swapping in dropped stops), then rounds of removing a few stops and reinserting them. It is seeded, so the same input always gives the same plan.
- **Order of goals:** fewest must-sees missed, then fewest showings missed, then least driving.

## Measured results

From `BENCHMARK.md`, written by `npm run bench` over 240 generated instances (full tables and method in that file):

- **Small days (6 to 10 stops, 120 instances):** the heuristic alone found the exact optimum in 111 of 120 cases (92.5%), with a mean drive-time gap of 0.3%. The app itself uses the exact search here, which took a few milliseconds on average and well under a tenth of a second at worst (timings are in BENCHMARK.md).
- **Large days (12 to 30 stops, 120 instances):** the planner was as good or better than a nearest-neighbor baseline in all 120 cases and served more showings in 85. Where both served the same showings and missed the same must-sees (30 instances), it drove 10.3% less.

The instances are synthetic (invented stops scattered over a map patch), so read these as a check that the solver works, not as a promise about your market.

## Run it

```sh
npm install
npm test           # solver, infeasible windows, .ics output, travel time estimates
npm run lint
npm run build      # copies the static site to dist/
npm run serve      # serves this folder at http://localhost:47831
npm run bench      # rewrites BENCHMARK.md
```

No bundler and no runtime dependencies: plain ES modules, with Leaflet 1.9.4 included under `vendor/`. `npm run screenshot` and `npm run icons` use Playwright if you have it installed.

## Limits

- Addresses are not looked up. You enter coordinates or drop a pin, because address search needs a geocoding service and this app contacts none by default.
- The route line on the map is straight between stops, not the road path.
- The estimate does not know about traffic or one-way streets. Use your own OSRM server for road times (still no live traffic).
- One vehicle, one day, and the route ends at the last showing.
- Map tiles come from OpenStreetMap and need a connection the first time you view an area.

## License

MIT. Leaflet is BSD-2-Clause, see `vendor/leaflet/LICENSE`. Map data (c) OpenStreetMap contributors.
