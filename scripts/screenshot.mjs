// Takes docs/preview.png (desktop) and docs/preview-phone.png (375 px) of the running app and checks the phone layout.
// Needs Playwright: set PLAYWRIGHT_MODULE to its path, or npm i -D playwright. Start the app first: npm run serve
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const url = process.env.APP_URL ?? 'http://localhost:47831/';
const out = (n) => new URL(`../docs/${n}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const browser = await chromium.launch();
const errors = [];

async function open(viewport, mobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, colorScheme: 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/tile\.openstreetmap|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(url);
  await page.waitForSelector('.pin', { state: 'attached' });
  return page;
}

const settle = async (page) => {
  await page.waitForTimeout(2500);
};

const desk = await open({ width: 1280, height: 860 }, false);
await settle(desk);
await desk.click('#tabs [data-tab="route"]');
await desk.waitForTimeout(400);
await desk.screenshot({ path: out('preview.png') });

const phone = await open({ width: 375, height: 760 }, true);
await settle(phone);
const overflow = async (label) => {
  const w = await phone.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  if (w.doc > w.win) errors.push(`horizontal overflow on ${label}: ${w.doc} > ${w.win}`);
};
for (const tab of ['stops', 'map', 'route', 'share']) {
  await phone.click(`#tabs [data-tab="${tab}"]`);
  await phone.waitForTimeout(500);
  await overflow(tab);
}
await phone.click('#tabs [data-tab="route"]');
await phone.waitForTimeout(400);
await phone.screenshot({ path: out('preview-phone.png') });
await phone.click('#tabs [data-tab="map"]');
await phone.waitForTimeout(1500);
await phone.screenshot({ path: out('preview-phone-map.png') });

await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('screenshots written, no errors, no horizontal overflow at 375 px');
