// Before/after comparison shots for 雨巷双刃 / Rainlane Blades.
// Builds nothing: opens the already-built dist/play.html (file://) at 1280x720, default quality,
// fixed seed, drives it with real keyboard/mouse input and saves normal gameplay-camera shots.
//
//   node tests/compare-shots.mjs before          -> compare/before-{title,explore,combat}.png
//   node tests/compare-shots.mjs after           -> compare/after-{title,explore,combat}.png
//   node tests/compare-shots.mjs after review    -> also test-results/review/*.png (fast turn,
//                                                   wall-hugging, locked-on, lantern close-ups)
//   add "gl" to force the WebGL 2 backend, "shell" to use the default headless shell.
//
// It prefers the full Chromium build with WebGPU flags (hardware-accelerated, what a player
// sees) and falls back to the default headless shell (WebGL 2) if that cannot be launched.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const argv = process.argv.slice(2);
const tag = argv.find((a) => a === 'before' || a === 'after') || 'after';
const review = argv.includes('review');
const forceGL = argv.includes('gl');
const outDir = path.join(root, 'compare');
const reviewDir = path.join(root, 'test-results', 'review');
fs.mkdirSync(outDir, { recursive: true });
if (review) fs.mkdirSync(reviewDir, { recursive: true });

const SEED = 7;
const hash = `seed=${SEED}&php=5&mute${forceGL ? '&gl' : ''}`;
const url = pathToFileURL(path.join(root, 'dist', 'play.html')).href + '#' + hash;
if (!fs.existsSync(path.join(root, 'dist', 'play.html'))) {
  console.error('dist/play.html not found — run "npm run build" first');
  process.exit(1);
}

async function launch() {
  if (!argv.includes('shell')) {
    const args = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu'];
    if (process.platform === 'win32') args.push('--use-angle=d3d11');
    try {
      return { browser: await chromium.launch({ channel: 'chromium', headless: true, args }), kind: 'full Chromium build (GPU flags)' };
    } catch (e) {
      console.log('full Chromium build not launchable, using the headless shell:', String(e.message).split(/\r?\n/)[0]);
    }
  }
  return {
    browser: await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }),
    kind: 'headless shell (software GL)',
  };
}

const { browser, kind } = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: review ? 2 : 1 });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERROR', e.message); });
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
await page.goto(url);
await page.waitForFunction(() => !!window.__game && window.__game.snapshot().frames > 10, null, { timeout: 60000 });
await page.mouse.move(640, 360);

const snap = () => page.evaluate(() => window.__game.snapshot());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const held = new Set();
const hold = async (k) => { if (!held.has(k)) { held.add(k); await page.keyboard.down(k); } };
const rel = async (k) => { if (held.has(k)) { held.delete(k); await page.keyboard.up(k); } };
const relAll = async () => { for (const k of [...held]) await rel(k); };
const save = async (name) => {
  const f = path.join(outDir, `${tag}-${name}.png`);
  await page.screenshot({ path: f, scale: 'css' });
  console.log('saved', path.relative(root, f));
};
const saveReview = async (name) => {
  const f = path.join(reviewDir, `${tag}-${name}.png`);
  await page.screenshot({ path: f, scale: 'css' });
  console.log('saved', path.relative(root, f));
};
async function until(fn, timeout, label, every = 15) {
  const t0 = Date.now();
  for (;;) {
    const s = await snap();
    if (await fn(s)) return s;
    if (Date.now() - t0 > timeout) throw new Error('timed out waiting for: ' + label);
    await sleep(every);
  }
}
// zoomed crop around a fighter (review only), from its projected position
const saveClip = async (name, ndc, size = 300) => {
  const x = Math.max(0, Math.min(1280 - size, (ndc[0] * 0.5 + 0.5) * 1280 - size / 2));
  const y = Math.max(0, Math.min(720 - size, (-ndc[1] * 0.5 + 0.5) * 720 - size / 2));
  const f = path.join(reviewDir, `${tag}-${name}.png`);
  await page.screenshot({ path: f, clip: { x, y, width: size, height: size }, scale: 'device' });
  console.log('saved', path.relative(root, f));
};
const dist = (s) => Math.hypot(s.player.x - s.boss.x, s.player.z - s.boss.z);
const inFrame = (n, m = 0.8) => n[2] < 1 && Math.abs(n[0]) < m && Math.abs(n[1]) < m;

const s0 = await snap();
console.log(`browser: ${kind}; renderer backend: ${s0.backend}; quality: ${s0.quality}; seed: ${SEED}`);

// 1. title / start screen
await sleep(2500);
await save('title');

// 2. exploration: walking into the yard with the normal follow camera
await page.keyboard.press('Enter');
await until((s) => s.mode === 'fight', 5000, 'fight mode');
if (review) {
  await hold('KeyW');
  await until((s) => s.player.z < 12.4, 8000, 'in the lane');
  await saveReview('lane-walk');
  await saveClip('zoom-lane-run', (await snap()).cam.playerNdc);
  await rel('KeyW');
  await sleep(900);
  await saveClip('zoom-lane-idle', (await snap()).cam.playerNdc);
  // swing the free camera round to the front and side, then back
  await hold('KeyQ'); await sleep(1430); await rel('KeyQ'); await sleep(150);
  await saveClip('zoom-lane-front', (await snap()).cam.playerNdc);
  await hold('KeyE'); await sleep(715); await rel('KeyE'); await sleep(150);
  await saveClip('zoom-lane-side', (await snap()).cam.playerNdc);
  await hold('KeyE'); await sleep(715); await rel('KeyE'); await sleep(150);
}
await hold('KeyW');
await until((s) => s.player.z < 4.6, 20000, 'walk into the yard');
await save('explore');
await rel('KeyW');

// 3. combat: both fighters in frame, boss holding the delayed-strike wind-up
await until(async (s) => {
  const d = dist(s);
  const b = s.boss;
  if (b.st === 'attack' && b.move === 'delay' && b.seg === 'wind') {
    // step back out of the long wind-up so both fighters are seen whole
    await rel('KeyW'); await rel('KeyK');
    if (d < 3.1) await hold('KeyS'); else await rel('KeyS');
  } else if (b.st === 'attack') { await rel('KeyW'); await rel('KeyS'); await hold('KeyK'); } else {
    await rel('KeyK'); await rel('KeyS');
    if (d > 3.3) await hold('KeyW'); else await rel('KeyW');
  }
  // the two fighters must also be apart on screen, so the boss is not hidden behind the player
  // (Q swings the lock-on camera off the player's shoulder while the boss winds up)
  const sep = Math.abs(s.cam.playerNdc[0] - s.cam.bossNdc[0]);
  if (b.st === 'attack' && b.move === 'delay' && sep < 0.34) await hold('KeyQ'); else await rel('KeyQ');
  return b.st === 'attack' && b.move === 'delay' && b.seg === 'hold' && d < 4.6 && d > 2.3 && sep > 0.2 && inFrame(s.cam.playerNdc) && inFrame(s.cam.bossNdc);
}, 120000, 'boss delayed-strike wind-up with both fighters in frame', 10);
await sleep(60);
await save('combat');
if (review) {
  const s = await snap();
  await saveClip('zoom-player', s.cam.playerNdc);
  await saveClip('zoom-boss', s.cam.bossNdc);
}

if (review) {
  // locked-on view: a punish swing and a chain attack
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 45000 && seen.size < 5) {
    const s = await snap();
    const b = s.boss;
    const d = dist(s);
    if (b.st === 'attack') { await rel('KeyW'); await hold('KeyK'); } else {
      await rel('KeyK');
      if (d > 2.3) await hold('KeyW'); else await rel('KeyW');
      if (b.st === 'recover' && d < 2.7) {
        await page.keyboard.press('KeyJ');
        if (!seen.has('swing' + s.player.combo)) { seen.add('swing' + s.player.combo); await sleep(110); await saveReview('locked-player-swing' + s.player.combo); }
      }
    }
    const key = `${b.move}-${b.seg}`;
    if (b.st === 'attack' && (key === 'chain-hit' || key === 'chain-wind' || key === 'lunge-wind') && !seen.has(key)) { seen.add(key); await saveReview('locked-boss-' + key); }
    await sleep(12);
  }
  await relAll();
  // back against a wall, locked on
  await hold('KeyS');
  await hold('KeyK');
  await sleep(4200);
  await saveReview('wall-locked');
  await relAll();
  // free camera: hug a wall, then a corner
  await page.keyboard.press('KeyF');
  await hold('KeyD');
  await sleep(450);
  await saveClip('zoom-run-side', (await snap()).cam.playerNdc, 360);
  if (argv.includes('seq')) for (let i = 0; i < 4; i++) await saveClip('seq-run-' + i, (await snap()).cam.playerNdc, 260);
  await hold('KeyK');
  await sleep(4000);
  await saveReview('wall-free');
  await hold('KeyS');
  await sleep(3500);
  await saveReview('corner-free');
  await relAll();
  // fast turn with the mouse (free camera), shot mid-turn and just after
  await hold('KeyK');
  await page.mouse.move(300, 360);
  await page.mouse.move(1000, 360, { steps: 5 });
  await saveReview('fast-turn-mid');
  await page.mouse.move(300, 380, { steps: 5 });
  await sleep(120);
  await saveReview('fast-turn-end');
  await relAll();
  const s = await snap();
  console.log('review end state: cam', JSON.stringify(s.cam), 'player hp', s.player.hp);
}

await relAll();
await browser.close();
if (errors.length) { console.error('page errors:', errors); process.exit(1); }
console.log('done');
