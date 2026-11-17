// Wall-clock fight timings, to check frame-rate independence. Real keyboard input; read-only probe.
// usage: node tests/measure-timing.mjs [--gl]
//   default: installed Chrome with hardware flags (full frame rate); --gl: bundled Chromium on SwiftShader (software)
// Each renderer is measured twice on the same build: as shipped, and with #legacyclamp=1, which
// restores the previous 50 ms in-fight frame clamp (the "before" behaviour).
// Writes compare/controls/timing-<hardware|software>.json.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const built = path.join(root, 'dist', 'play.html');
const soft = process.argv.includes('--gl');
const browser = soft
  ? await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  : await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// (each figure is read at frame boundaries, so it carries an error of about one frame at either end)
const DUR = { string3: 2.45, quick2: 1.7, heavy: 2.3, thrust: 2.2 };
const out = { renderer: soft ? 'bundled Chromium, SwiftShader (software)' : 'Chrome, hardware GPU', runs: [] };

for (const legacy of [false, true]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(pathToFileURL(built).href + '#seed=5&hurt=0.05&mute=1' + (legacy ? '&legacyclamp=1' : ''));
  await page.waitForFunction(() => window.__game && window.__game.snap.frames > 10, null, { timeout: 90000 });
  const snap = () => page.evaluate(() => window.__game.snap);
  const until = async (cond, label, timeout = 60000) => { const t0 = Date.now(); let s; for (;;) { s = await snap(); if (cond(s)) return s; if (Date.now() - t0 > timeout) throw new Error('timeout: ' + label); await sleep(4); } };
  const wall = (a, b) => +((b.now - a.now) / 1000).toFixed(3);
  await page.keyboard.press('Enter');
  let s = await until((q) => q.mode === 'fight', 'fight');
  // (the quality governor has already settled on the title screen and during the 2.2 s opening;
  // the jump and the charge are measured at once, while the Warden is still walking in)
  const r = { mode: legacy ? 'before (50 ms clamp, #legacyclamp=1)' : 'after (as shipped)', backend: s.backend };
  // jump: Space press -> landing (sim: 0.08 s take-off + 0.61 s airborne)
  let a = await snap(); await page.keyboard.press('Space');
  const j0 = await until((q) => q.stats.jumps > a.stats.jumps, 'jump'), j1 = await until((q) => q.stats.lands > a.stats.lands || q.stats.hitsTaken > a.stats.hitsTaken, 'land');
  r.jump = { expected: 0.69, wall: wall(j0, j1), valid: j1.stats.lands > a.stats.lands };
  // charge: J held -> "fully charged" cue (sim: 0.65 s from the press)
  await until((q) => q.player.state === 'idle', 'idle'); a = await snap(); await page.keyboard.down('KeyJ');
  const c0 = await until((q) => q.stats.swings > a.stats.swings, 'press'), c1 = await until((q) => q.player.chargeFull || q.stats.hitsTaken > a.stats.hitsTaken, 'full');
  await page.keyboard.up('KeyJ');
  r.charge = { expected: 0.65, wall: wall(c0, c1), valid: c1.player.chargeFull };
  // one boss move from wind-up to end, standing still
  await until((q) => !q.boss.move && q.boss.state === 'approach', 'between moves'); // never start mid-move
  const m0 = await until((q) => q.boss.move, 'boss move starts'), name = m0.boss.move;
  const m1 = await until((q) => q.boss.move !== name || q.boss.state !== 'attack', 'boss move ends');
  r.bossMove = { move: name, expected: DUR[name], wall: wall(m0, m1), sim: +(m1.time - m0.time).toFixed(3) };
  // simulation seconds per wall-clock second over ~5 s of fighting
  a = await snap(); await sleep(5000); s = await snap();
  r.simRate = +((s.time - a.time) / ((s.now - a.now) / 1000)).toFixed(3);
  r.fps = +s.fps.toFixed(1); r.tier = s.quality.tier; r.stepsPerFrame = +((s.steps - a.steps) / (s.frames - a.frames)).toFixed(2);
  console.log(JSON.stringify(r));
  out.runs.push(r);
  await page.close();
}
await browser.close();
const dir = path.join(root, 'compare', 'controls'); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `timing-${soft ? 'software' : 'hardware'}.json`), JSON.stringify(out, null, 2));
