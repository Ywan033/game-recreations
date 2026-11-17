// Dev helper (not part of the offline suite): screenshots of the pose gallery (#gallery=player|boss)
// for checking body silhouettes at combat-camera scale. Writes compare/review/gallery-*.png.
// usage: node tests/gallery-shots.mjs [--gl]
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'compare', 'review');
fs.mkdirSync(out, { recursive: true });
const gl = process.argv.includes('--gl');
const browser = await chromium.launch(gl ? { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } : { channel: 'chrome', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu'] });
const only = process.argv.find((a) => a === 'player' || a === 'boss');
const views = [];
for (const who of only ? [only] : ['player', 'boss']) for (const gp of [0, 1, 2]) views.push([who, 0.7, gp]);
views.push(['player', -1.57, 0], ['boss', 2.6, 0]);
for (const [who, gy, gp] of views) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.type(), m.text().slice(0, 300)); });
  await page.goto(pathToFileURL(path.join(root, 'dist', 'play.html')).href + `#gallery=${who}&gy=${gy}&gp=${gp}&mute=1${gl ? '&gl=1' : ''}`);
  await page.waitForFunction(() => window.__game && window.__game.snap.frames > 90, null, { timeout: 60000 });
  const name = `gallery-${who}-${gy < 0 ? 'side' : gy > 2 ? 'back' : 'front'}-${gp}.png`;
  await page.screenshot({ path: path.join(out, name) });
  console.log(name, await page.evaluate(() => window.__game.snap.backend));
  await page.close();
}
await browser.close();
