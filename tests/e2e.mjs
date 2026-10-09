// End-to-end check of the real page in headless Chromium.
//
// External services (Esri tiles, OSM, NASA POWER, Overpass, Nominatim) are
// replaced with local stand-ins so the test runs offline and gives the same
// result every time. Screenshots and the exported PNG land in tests/output/.
//
//   npm install && npm run test:e2e
//
// Set CHROME_PATH to use a specific Chromium instead of Playwright's own.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'output');
fs.mkdirSync(OUT, { recursive: true });
const tile = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'tile.png'));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const target = file.endsWith(path.sep) ? path.join(file, 'index.html') : file;
  if (!target.startsWith(ROOT) || !fs.existsSync(target)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(target)] || 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const cors = { 'Access-Control-Allow-Origin': '*' };
const json = (body) => ({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
const errors = [];

async function stubNetwork(page) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.route(/arcgisonline|tile\.openstreetmap/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: tile, headers: cors }));
  await page.route(/power\.larc\.nasa\.gov/, (r) => r.fulfill(json({ properties: { parameter: { ALLSKY_SFC_SW_DWN: { ANN: 5.12 } } } })));
  await page.route(/nominatim/, (r) => r.fulfill(json([{ lat: '31.52', lon: '74.35' }])));
  await page.route(/overpass-api/, (r) => {
    const lat = 31.5206, lng = 74.3592, dl = 0.00008, dg = 0.00012;
    const geometry = [[lat, lng], [lat, lng + dg], [lat + dl, lng + dg], [lat + dl, lng], [lat, lng]].map(([a, b]) => ({ lat: a, lon: b }));
    r.fulfill(json({ elements: [{ type: 'way', geometry }] }));
  });
}

// Cloud sessions ship a Chromium under PLAYWRIGHT_BROWSERS_PATH that may not match
// this Playwright version; fall back to it when Playwright's own build is missing.
function findChromium() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!dir || !fs.existsSync(dir)) return undefined;
  for (const name of fs.readdirSync(dir).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
    const exe = path.join(dir, name, 'chrome-linux', 'chrome');
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}
let browser;
try {
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
} catch (err) {
  const exe = findChromium();
  if (!exe) throw err;
  browser = await chromium.launch({ executablePath: exe });
}
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  await stubNetwork(page);
  await page.goto(BASE);
  const count = async () => Number((await page.textContent('#r-count')).replace(/,/g, ''));

  // 1. Location by DMS coordinates and city.
  await page.fill('#coords', '31°31\'13.4"N 74°21\'31.3"E');
  await page.click('#go-coords');
  await page.fill('#city', 'Lahore');
  await page.click('#go-city');
  await page.waitForTimeout(500);

  // 2. Draw a roof by clicking corners, closing on the first point.
  const box = await page.locator('#map').boundingBox();
  const at = (x, y) => page.mouse.click(box.x + x, box.y + y);
  await page.click('#draw-roof');
  for (const [x, y] of [[420, 260], [760, 240], [790, 520], [440, 540]]) { await at(x, y); await page.waitForTimeout(80); }
  await at(420, 260);
  await page.waitForTimeout(300);
  const onRoof = await count();
  assert.ok(onRoof > 0, 'panels placed on drawn roof');

  // 3. An obstruction removes panels.
  await page.click('#draw-obstacle');
  for (const [x, y] of [[580, 360], [640, 360], [640, 420], [580, 420]]) { await at(x, y); await page.waitForTimeout(60); }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const withObstacle = await count();
  assert.ok(withObstacle < onRoof, 'obstruction removes panels');

  // 4. Clicking a panel switches it off.
  await at(470, 500);
  await page.waitForTimeout(300);
  assert.equal(await count(), withObstacle - 1, 'clicked panel removed');

  // 5. Outline from (stubbed) OpenStreetMap adds a second roof.
  await page.click('#detect-roof');
  await page.waitForTimeout(800);
  const total = await count();
  assert.ok(total > withObstacle - 1, 'detected roof adds panels');
  await page.waitForTimeout(500);
  assert.match(await page.textContent('#r-source'), /NASA POWER/, 'site sunlight data used');
  assert.notEqual(await page.textContent('#r-kwh'), '–', 'yearly kWh shown');

  // 6. Export the 4K client image.
  await page.fill('#project', 'Test Residence');
  await page.screenshot({ path: path.join(OUT, 'desktop.png') });
  await page.click('#export');
  await page.waitForSelector('#download:not([hidden])', { timeout: 30000 });
  const dims = await page.evaluate(() => { const i = document.querySelector('#modal-body img'); return [i.naturalWidth, i.naturalHeight]; });
  assert.deepEqual(dims, [3840, 2160], 'export is 4K');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  await dl.saveAs(path.join(OUT, 'export.png'));
  await page.keyboard.press('Escape');

  // 7. Work survives a reload.
  await page.reload();
  await page.waitForTimeout(800);
  assert.equal(await count(), total, 'state restored after reload');

  // 8. Phone width has no sideways scroll.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const mp = await phone.newPage();
  await stubNetwork(mp);
  await mp.goto(BASE);
  await mp.waitForTimeout(600);
  assert.equal(await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0, 'no horizontal overflow on phone');
  await mp.screenshot({ path: path.join(OUT, 'mobile.png') });

  assert.deepEqual(errors, [], 'no browser errors');
  console.log(`e2e passed: ${total} panels, screenshots in tests/output/`);
} finally {
  await browser.close();
  server.close();
}
