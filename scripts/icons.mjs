// Renders icons/icon.svg to PNG with a headless browser. Needs Playwright: set PLAYWRIGHT_MODULE to its path, or npm i -D playwright.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const svg = readFileSync(new URL('../icons/icon.svg', import.meta.url), 'utf8');
const data = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const browser = await chromium.launch();

async function render(size, name, pad = 0) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const inner = size - pad * 2;
  await page.setContent(`<body style="margin:0;background:${pad ? '#2a2019' : 'transparent'}"><img src="${data}" style="display:block;margin:${pad}px;width:${inner}px;height:${inner}px"></body>`);
  writeFileSync(new URL(`../icons/${name}`, import.meta.url), await page.screenshot({ omitBackground: !pad }));
  await page.close();
}

await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(512, 'icon-maskable-512.png', 64);
await browser.close();
console.log('icons written');
