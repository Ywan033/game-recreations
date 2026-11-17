// Dev helper (not part of the offline suite): capture screenshots of the built game.
// usage: node tests/shot.mjs [hash] [outPrefix]
import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const hash = process.argv[2] || 'seed=3';
const out = process.argv[3] || 'shots/s';
fs.mkdirSync(path.dirname(out), { recursive: true });
const browser = await chromium.launch({ channel: process.argv.includes('chrome') ? 'chrome' : undefined, args: process.argv.includes('webgpu') ? ['--enable-unsafe-webgpu', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] : process.argv.includes('noflags') ? [] : ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: process.argv.includes('small') ? { width: 800, height: 450 } : { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.type(), m.text().slice(0, 400)); });
await page.goto(pathToFileURL(path.resolve('dist/play.html')).href + '#' + hash);
await page.waitForFunction(() => window.__game && window.__game.snap.frames > 5, null, { timeout: 60000 });
await page.screenshot({ path: out + '-title.png' });
await page.click('#start');
const snap = () => page.evaluate(() => window.__game.snap);
await page.waitForFunction(() => window.__game.snap.mode === 'fight', null, { timeout: 60000 });
console.log(JSON.stringify(await snap()).slice(0, 600));
await page.screenshot({ path: out + '-fight.png' });
// wait for a boss attack and capture mid-swing, then a thrust cue
for (const [name, cond] of [['attack', (s) => s.nextHit && s.nextHit.inT < 0.25], ['cue', (s) => s.nextHit && s.nextHit.type === 'thrust' && s.nextHit.inT < 0.6]]) {
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) { const s = await snap(); if (cond(s) || s.mode !== 'fight') break; await page.waitForTimeout(15); }
  await page.screenshot({ path: `${out}-${name}.png` });
}
const s = await snap();
console.log('fps', s.fps.toFixed(1), 'backend', s.backend, 'mode', s.mode, 'time', s.time.toFixed(1));
await browser.close();
