// Lock-on framing measurement with real keyboard input: strafe a full circle around the Warden in
// each direction while holding roughly 3, 4 and 5 m, and sample the read-only framing probe
// (window.__game.snap.framing) every poll.
// usage: node tests/measure-occlusion.mjs <before|after> [--gl]
//   before = same build with #legacycam=1 (the lock-on camera as it was before the duel pass)
// Writes compare/duel/occlusion-<tag>.json.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2), tag = args.find((a) => !a.startsWith('--')) || 'after';
const outDir = path.join(root, 'compare', 'duel'); fs.mkdirSync(outDir, { recursive: true });
const built = path.join(root, 'dist', 'play.html');
const GPU = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu'];
const soft = args.includes('--gl');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;
try { browser = await chromium.launch(soft ? { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } : { channel: 'chrome', args: GPU }); }
catch (e) { browser = await chromium.launch({ args: GPU }); }
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => { console.log('PAGEERROR', e.message); process.exitCode = 1; });
await page.goto(pathToFileURL(built).href + '#seed=3&hurt=0.02&mute=1' + (tag === 'before' ? '&legacycam=1' : '') + (soft ? '&gl=1&q=low' : ''));
await page.waitForFunction(() => window.__game && window.__game.snap.frames > 20, null, { timeout: 45000 });
const snap = () => page.evaluate(() => window.__game.snap);
await page.keyboard.press('Enter');
let s; for (;;) { s = await snap(); if (s.mode === 'fight') break; await sleep(30); }
if (!s.framing || s.framing.legacyCam !== (tag === 'before')) throw new Error('framing probe / legacycam option missing');

const held = new Set();
const hold = async (k, on) => { if (on && !held.has(k)) { held.add(k); await page.keyboard.down(k); } else if (!on && held.has(k)) { held.delete(k); await page.keyboard.up(k); } };
const rows = [], all = { n: 0, covered: 0, any: 0, sum: 0, chestOff: 0, tipOff: 0, handOff: 0, playerOff: 0 };
for (const target of [3, 4, 5]) for (const key of ['KeyA', 'KeyD']) {
  const r = { target, strafe: key === 'KeyA' ? 'left (A)' : 'right (D)', n: 0, covered: 0, any: 0, sum: 0, chestOff: 0, tipOff: 0, handOff: 0, playerOff: 0, dSum: 0, dMin: 99, dMax: 0, inBand: 0, maxJump: 0 };
  let turned = 0, last = null, lastCam = null, lastT = 0; const t0 = Date.now();
  await hold(key, true);
  while (turned < Math.PI * 2 && Date.now() - t0 < 40000) {
    s = await snap();
    if (s.mode !== 'fight') break;
    const ang = Math.atan2(s.player.x - s.boss.x, s.player.z - s.boss.z);
    if (last !== null) turned += Math.abs(Math.atan2(Math.sin(ang - last), Math.cos(ang - last)));
    last = ang;
    await hold('KeyW', s.dist > target + 0.25); await hold('KeyS', s.dist < target - 0.25);
    const f = s.framing, steady = s.player.state !== 'finisher' && s.boss.state !== 'phaseShift';
    if (!steady) continue;
    // camera continuity: largest lens movement between two consecutive rendered frames, in metres per 1/60 s
    // camera continuity: lens speed in m/s over spans of at least 15 ms of wall time (several rendered frames on a fast GPU)
    if (lastCam && s.now - lastT >= 15) { const j = Math.hypot(s.camera.x - lastCam.x, s.camera.y - lastCam.y, s.camera.z - lastCam.z) / ((s.now - lastT) / 1000); if (s.now - lastT < 80 && j > r.maxJump) r.maxJump = j; lastCam = null; }
    if (!lastCam) { lastCam = { x: s.camera.x, y: s.camera.y, z: s.camera.z }; lastT = s.now; }
    r.n++; r.sum += f.cover; if (f.cover >= 0.34) r.covered++; if (f.cover > 0) r.any++;
    if (!f.bossChest.on) r.chestOff++; if (!f.bossTip.on) r.tipOff++; if (!f.bossHand.on) r.handOff++; if (!f.playerChest.on) r.playerOff++;
    r.dSum += s.dist; r.dMin = Math.min(r.dMin, s.dist); r.dMax = Math.max(r.dMax, s.dist); if (Math.abs(s.dist - target) <= 0.6) r.inBand++;
    await sleep(4);
  }
  for (const k of [...held]) await hold(k, false);
  for (const k of ['n', 'covered', 'any', 'sum', 'chestOff', 'tipOff', 'handOff', 'playerOff']) all[k] += r[k];
  const pc = (v) => +(100 * v / (r.n || 1)).toFixed(1);
  rows.push({ target: r.target, strafe: r.strafe, samples: r.n, circleDone: turned >= Math.PI * 2, meanDist: +(r.dSum / (r.n || 1)).toFixed(2), minDist: +r.dMin.toFixed(2), maxDist: +r.dMax.toFixed(2), within0_6mPct: pc(r.inBand),
    coveredPct: pc(r.covered), anyCoverPct: pc(r.any), meanCoverPct: pc(r.sum), wardenChestOffScreenPct: pc(r.chestOff), wardenHandOffScreenPct: pc(r.handOff), wardenTipOffScreenPct: pc(r.tipOff), playerChestOffScreenPct: pc(r.playerOff), maxLensSpeedMps: +r.maxJump.toFixed(1) });
  console.log(JSON.stringify(rows[rows.length - 1]));
  await sleep(300);
}
const pa = (v) => +(100 * v / (all.n || 1)).toFixed(1);
const out = { tag, camera: tag === 'before' ? 'previous lock-on camera (#legacycam=1)' : 'current lock-on camera', backend: s.backend, fps: +s.fps.toFixed(1),
  definition: 'covered = at least 4 of the 12 upper-body samples of the Warden (0.48 m x 0.75 m grid, 1.2-1.95 m) hidden behind the Reedcutter body axis (0.27 m radius); swords, arms and cloth are not part of the occluder',
  total: { samples: all.n, coveredPct: pa(all.covered), anyCoverPct: pa(all.any), meanCoverPct: pa(all.sum), wardenChestOffScreenPct: pa(all.chestOff), wardenHandOffScreenPct: pa(all.handOff), wardenTipOffScreenPct: pa(all.tipOff), playerChestOffScreenPct: pa(all.playerOff) }, rows };
fs.writeFileSync(path.join(outDir, `occlusion-${tag}.json`), JSON.stringify(out, null, 2));
console.log('TOTAL', JSON.stringify(out.total));
await browser.close();
