// Before/after comparison capture for the built game (dist/play.html), driven with real input.
// usage: node tests/compare-shots.mjs <prefix> [--gl] [--extra]
//   <prefix>  before | after (or any tag) -> compare/<prefix>-title.png, -explore.png, -combat.png
//   --gl      skip the hardware/WebGPU attempts and use the bundled Chromium on WebGL 2 (SwiftShader)
//   --extra   also write review shots (boundary, fast turn, locked view, close crops) to compare/review/
// 1280x720, default quality, fixed seed. The same input steps are used for every run.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);
const prefix = args.find((a) => !a.startsWith('--')) || 'after';
const extra = args.includes('--extra');
// --dir=<name> writes into compare/<name>/ (e.g. --dir=controls for the controls pass evidence)
const sub = (args.find((a) => a.startsWith('--dir=')) || '').slice(6);
const outDir = path.join(root, 'compare', sub);
const revDir = path.join(outDir, 'review');
fs.mkdirSync(outDir, { recursive: true });
if (extra) fs.mkdirSync(revDir, { recursive: true });
const built = path.join(root, 'dist', 'play.html');
if (!fs.existsSync(built)) { console.error('dist/play.html missing — run `npm run build` first'); process.exit(1); }

// hurt=0.05 (documented test option) keeps the player alive while the camera steps run.
const HASH = 'seed=3&hurt=0.05&mute=1';
const GPU = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu'];
const attempts = args.includes('--gl')
  ? [{ name: 'bundled Chromium, SwiftShader', opts: { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }, hash: HASH + '&gl=1' }]
  : [
    { name: 'Chrome (channel) with WebGPU flags', opts: { channel: 'chrome', args: GPU }, hash: HASH },
    { name: 'bundled Chromium with WebGPU flags', opts: { args: GPU }, hash: HASH },
    { name: 'bundled Chromium, SwiftShader', opts: { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }, hash: HASH + '&gl=1' },
  ];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, page, used;
for (const a of attempts) {
  try {
    browser = await chromium.launch(a.opts);
    page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
    await page.goto(pathToFileURL(built).href + '#' + a.hash);
    await page.waitForFunction(() => window.__game && window.__game.snap.frames > 20, null, { timeout: 45000 });
    used = a.name; break;
  } catch (e) {
    console.log(`launch attempt failed (${a.name}): ${String(e.message).split('\n')[0]}`);
    if (browser) await browser.close().catch(() => {});
    browser = null;
  }
}
if (!browser) { console.error('no browser could render the game'); process.exit(1); }
const snap = () => page.evaluate(() => window.__game.snap);
const until = async (cond, label, timeout = 40000) => {
  const t0 = Date.now(); let s;
  for (;;) { s = await snap(); if (cond(s)) return s; if (Date.now() - t0 > timeout) throw new Error('timeout: ' + label); await sleep(8); }
};
const shot = (name, clip) => page.screenshot({ path: name, ...(clip ? { clip } : {}) });
const main = (n) => path.join(outDir, `${prefix}-${n}.png`);
const rev = (n) => path.join(revDir, `${prefix}-${n}.png`);

let s = await snap();
console.log(`browser: ${used}; render backend: ${s.backend}`);

// 1. title
await sleep(1500);
await shot(main('title'));

// 2. exploration: free camera, pitch lowered a little with the mouse, player running left
await page.mouse.move(640, 400);
await page.mouse.click(640, 400).catch(() => {});
await page.keyboard.press('Enter');
s = await until((q) => q.mode === 'fight', 'fight start');
const tFight = s.time;
await page.keyboard.press('KeyQ');
await page.mouse.move(640, 352, { steps: 6 });
await page.keyboard.down('KeyA');
await until((q) => q.time >= tFight + 0.75, 'explore time');
await shot(main('explore'));
if (extra) await shot(rev('explore-zoom'), { x: 320, y: 180, width: 640, height: 360 });
await page.keyboard.up('KeyA');

// 3. combat: lock-on, guard held, boss in the wind-up of its first blow
await page.keyboard.press('KeyQ');
await page.mouse.down({ button: 'right' });
await until((q) => q.nextHit && q.nextHit.idx === 0 && q.nextHit.inT < 0.42 && q.nextHit.inT > 0.1 && q.dist < 6, 'boss wind-up');
await shot(main('combat'));
if (extra) await shot(rev('combat-zoom'), { x: 320, y: 180, width: 640, height: 360 });

if (extra) {
  // hit moment (guard/deflect contact) and its recoil
  await until((q) => q.stats.guards + q.stats.deflects + q.stats.hitsTaken > 0, 'first contact', 8000).catch(() => {});
  await shot(rev('contact'));
  await page.mouse.up({ button: 'right' });
  // player cut
  await page.mouse.click(640, 400); await sleep(170);
  await shot(rev('cut'));
  await sleep(500);
  // locked-on view at rest
  await sleep(700);
  await shot(rev('locked'));
  // reed boundary in free look
  await page.keyboard.press('KeyQ');
  await page.keyboard.down('KeyS');
  await until((q) => Math.hypot(q.player.x, q.player.z) > 10.2, 'boundary', 7000).catch(() => {});
  await sleep(300);
  await shot(rev('boundary'));
  await page.keyboard.up('KeyS');
  // fast turn: sweep the mouse and capture mid-turn
  await page.mouse.move(900, 352);
  await page.mouse.move(400, 352, { steps: 5 });
  await shot(rev('turn'));
  await sleep(500);
  await shot(rev('turn-settled'));
  await page.keyboard.press('KeyQ');
  await sleep(1200);
  await shot(rev('locked2'));
} else {
  await page.mouse.up({ button: 'right' });
}
s = await snap();
console.log(`done: ${prefix}; fps ${s.fps.toFixed(1)}; backend ${s.backend}; mode ${s.mode}`);
await browser.close();
