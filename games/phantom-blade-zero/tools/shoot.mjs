// Developer helper (not part of the delivery checks): plays dist/play.html with real key
// events and saves screenshots at interesting moments into test-results/debug.
// Usage: node tools/shoot.mjs [hash] [mode]
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '..', 'test-results', 'debug');
fs.mkdirSync(out, { recursive: true });
const hash = process.argv[2] || 'seed=7&php=5&bhp=0.45';
const mode = process.argv[3] || 'fight';
const url = pathToFileURL(path.resolve(here, '..', 'dist', 'play.html')).href + '#' + hash;

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
await page.goto(url);
await page.waitForFunction(() => !!window.__game);
const snap = () => page.evaluate(() => window.__game.snapshot());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const held = new Set();
const hold = async (k) => { if (!held.has(k)) { held.add(k); await page.keyboard.down(k); } };
const rel = async (k) => { if (held.has(k)) { held.delete(k); await page.keyboard.up(k); } };
let n = 0;
const shot = async (name) => { await page.screenshot({ path: path.join(out, `${String(n++).padStart(2, '0')}-${name}.png`) }); };

await page.keyboard.press('Enter');
await hold('KeyW');
for (;;) { const s = await snap(); if (s.engaged) break; await sleep(30); }
await rel('KeyW');
await shot('engage');
const seen = new Set();
const t0 = Date.now();
let deadAt = 0;
while (Date.now() - t0 < 240000) {
  const s = await snap();
  const p = s.player, b = s.boss;
  const d = Math.hypot(p.x - b.x, p.z - b.z);
  const key = `${b.phase}-${b.move || b.st}-${b.seg || ''}-${b.tele || ''}`;
  if (!seen.has(key) && (b.st === 'attack' || b.st === 'recover' || b.st === 'phase')) {
    seen.add(key);
    if (b.seg === 'wind' || b.seg === 'hold') await sleep(Math.max(0, Math.min(300, b.hitIn * 1000 - 120)));
    await shot(key);
  }
  if (mode === 'watch') {
    // keep distance and just watch telegraphs
    await hold('KeyK');
  } else if (b.st === 'attack') { await rel('KeyW'); await hold('KeyK'); }
  else {
    await rel('KeyK');
    if (d > 2.3) await hold('KeyW'); else await rel('KeyW');
    if ((b.st === 'recover' || (mode === 'fast' && b.st === 'idle')) && d < 2.7) {
      await page.keyboard.press('KeyJ');
      if (!seen.has('swing' + p.combo)) { seen.add('swing' + p.combo); await sleep(90); await shot('player-swing' + p.combo); }
    }
  }
  if (b.st === 'dead' && !deadAt) { deadAt = Date.now(); await shot('dead0'); }
  if (deadAt && Date.now() - deadAt > 1200 && !seen.has('dead1')) { seen.add('dead1'); await shot('dead1'); }
  if (s.mode !== 'fight') { await sleep(1500); await shot(s.mode); break; }
  await sleep(15);
}
await browser.close();
console.log('shots:', fs.readdirSync(out).join(', '));
