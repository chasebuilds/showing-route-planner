// Browser check of the optional features against mock servers (no real service is contacted).
// Needs Playwright: set PLAYWRIGHT_MODULE to its path, or npm i -D playwright. Start the app first: npm run serve
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const url = process.env.APP_URL ?? 'http://localhost:47831/';
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const hits = { table: 0, route: 0, geo: [] };
await page.route('https://osrm.example.test/**', (route) => {
  const u = route.request().url();
  const cors = { 'access-control-allow-origin': '*' };
  if (u.includes('/table/')) {
    hits.table++;
    const n = u.split('/driving/')[1].split('?')[0].split(';').length;
    const durations = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : 600)));
    return route.fulfill({ json: { code: 'Ok', durations }, headers: cors });
  }
  hits.route++;
  return route.fulfill({ json: { code: 'Ok', routes: [{ geometry: { coordinates: [[-78.64, 35.78], [-78.6, 35.79], [-78.58, 35.8]] } }] }, headers: cors });
});
await page.route('https://geo.example.test/**', (route) => {
  hits.geo.push(new URL(route.request().url()).searchParams.get('q'));
  return route.fulfill({ json: [{ lat: '35.79', lon: '-78.63', display_name: 'Invented Place' }], headers: { 'access-control-allow-origin': '*' } });
});

await page.goto(url);
await page.waitForSelector('.pin', { state: 'attached' });

// 1. offline default: straight lines, labeled
check((await page.textContent('#routeNote')).includes('Straight lines'), 'offline route is labeled as straight lines');

// 2. CSV import, messy file, one row without coordinates and no geocoder yet
await page.click('#clearAll');
const csv = 'Address;Latitude;Longitude;Window;Minutes;Must\r\n"1 Pine St, Unit 2";35.79;-78.63;1-2 PM;30;yes\r\n3 Elm Rd;35.80;-78.60;3pm to 4pm;;\r\nNo Coords Ln;;;1-2 PM;20;\r\nBad Window Ave;35.8;-78.6;whenever;20;\r\n';
await page.click('#csvBox summary');
await page.setInputFiles('#csvFile', { name: 'm.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
await page.waitForFunction(() => document.querySelectorAll('#stopList .stop').length === 2);
const status = await page.textContent('#csvStatus');
check(/Imported 2 of 4/.test(status) && /No coordinates/.test(status) && /Row 5/.test(status), 'import reports 2 of 4 and lists why the others were skipped');

// 3. geocoder on: pending rows are looked up through the user endpoint
await page.click('#settings summary');
await page.check('#sGeo');
await page.fill('#sGeoUrl', 'https://geo.example.test/search');
await page.dispatchEvent('#sGeoUrl', 'change');
await page.setInputFiles('#csvFile', { name: 'm.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
await page.waitForFunction(() => document.querySelectorAll('#stopList .stop').length === 5, null, { timeout: 15000 });
check(hits.geo.length === 1 && hits.geo[0] === 'No Coords Ln', 'only the row with no coordinates was sent to the geocoder');

await page.fill('#fLabel', '9 Invented Way');
check(!(await page.isHidden('#lookupBtn')), 'Look up button appears when the geocoder is on');
await page.click('#lookupBtn');
await page.waitForFunction(() => document.getElementById('fCoords').value.startsWith('35.79'));
check(hits.geo.includes('9 Invented Way'), 'Look up fills coordinates from the user endpoint');

// 4. OSRM on: times from /table and a road line from /route
await page.fill('#sOsrmUrl', 'https://osrm.example.test');
await page.check('#sOsrm');
await page.dispatchEvent('#sOsrmUrl', 'change');
await page.waitForFunction(() => document.getElementById('routeNote').textContent.includes('Road route'), null, { timeout: 10000 });
check(hits.table > 0 && hits.route > 0, 'OSRM table and route endpoints were used');
check(await page.evaluate(() => document.querySelectorAll('.leaflet-overlay-pane path').length > 0), 'a road polyline is on the map');

// 5. CSV export downloads a file with the stops
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#csvExport')]);
check(dl.suggestedFilename() === 'showings.csv', 'CSV export downloads showings.csv');

await page.click('#tabs [data-tab="map"]');
await page.waitForTimeout(600);
check(
  await page.evaluate(() => {
    const m = document.getElementById('map').getBoundingClientRect();
    const pins = [...document.querySelectorAll('.pin')].filter((p) => !p.classList.contains('start'));
    return pins.length > 0 && pins.every((p) => { const r = p.getBoundingClientRect(); return r.left >= m.left - 2 && r.right <= m.right + 2 && r.top >= m.top - 2 && r.bottom <= m.bottom + 2; });
  }),
  'every pin is inside the map after opening the Map tab on a phone',
);

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(overflow <= 0, 'no horizontal overflow at 375 px');
check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
await browser.close();
process.exit(failures.length ? 1 : 0);
