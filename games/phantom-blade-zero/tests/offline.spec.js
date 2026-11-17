// Offline real-input suite for 雨巷双刃 / Rainlane Blades.
// Copies ONLY dist/play.html into a fresh temp directory, opens it via file:// in an offline
// browser context, and drives the game with real keyboard and mouse events. The page's
// read-only probe (window.__game) is used to observe state, never to change it.
import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '..', 'dist', 'play.html');
const shots = path.resolve(here, '..', 'test-results', 'shots');
let tmpDir;
let fileUrl;

test.beforeAll(() => {
  expect(fs.existsSync(dist), 'dist/play.html must be built first (npm run build)').toBe(true);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rainlane-'));
  fs.copyFileSync(dist, path.join(tmpDir, 'play.html'));
  expect(fs.readdirSync(tmpDir)).toEqual(['play.html']);
  fileUrl = pathToFileURL(path.join(tmpDir, 'play.html')).href;
  fs.mkdirSync(shots, { recursive: true });
});
test.afterAll(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- harness

let page;
let context;
let errors;
let requests;
let held;
let extraBrowser = null;

async function open(browser, hash) {
  context = await browser.newContext({ offline: true, viewport: { width: 1280, height: 720 } });
  page = await context.newPage();
  errors = [];
  requests = [];
  held = new Set();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('file:')) return route.continue();
    requests.push(u);
    return route.abort();
  });
  await page.goto(fileUrl + (hash ? '#' + hash : ''));
  await page.waitForFunction(() => !!window.__game && window.__game.snapshot().frames > 3, null, { timeout: 60000 });
  await page.mouse.move(640, 360);
}

test.afterEach(async () => {
  if (!page) return;
  const errs = errors;
  const reqs = requests;
  await context.close();
  page = null;
  if (extraBrowser) { await extraBrowser.close(); extraBrowser = null; }
  expect(errs, 'uncaught page errors / console errors').toEqual([]);
  expect(reqs, 'network requests attempted').toEqual([]);
});

const snap = () => page.evaluate(() => window.__game.snapshot());
const events = (since = -1) => page.evaluate((s) => window.__game.events(s), since);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function hold(code) { if (!held.has(code)) { held.add(code); await page.keyboard.down(code); } }
async function release(code) { if (held.has(code)) { held.delete(code); await page.keyboard.up(code); } }
async function releaseAll() { for (const c of [...held]) await release(c); }
async function shot(name) { const f = path.join(shots, name + '.png'); await page.screenshot({ path: f }); return f; }

function imageStats(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const seen = new Set();
  let sum = 0, sum2 = 0, n = 0;
  for (let i = 0; i < png.data.length; i += 4 * 7) {
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    const l = 0.3 * r + 0.59 * g + 0.11 * b;
    sum += l; sum2 += l * l; n++;
    seen.add((r >> 3) << 10 | (g >> 3) << 5 | (b >> 3));
  }
  const mean = sum / n;
  return { colors: seen.size, mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
}

async function until(fn, timeout, label, every = 25) {
  const t0 = Date.now();
  for (;;) {
    const s = await snap();
    const r = await fn(s);
    if (r) return s;
    if (Date.now() - t0 > timeout) throw new Error('timed out waiting for: ' + label + ' — last ' + JSON.stringify({ mode: s.mode, player: s.player, boss: s.boss }));
    await sleep(every);
  }
}

async function startAndEnter() {
  await page.keyboard.press('Enter');
  await until((s) => s.mode === 'fight', 5000, 'fight mode');
  await hold('KeyW');
  await until((s) => s.engaged, 15000, 'walk into the yard');
  await release('KeyW');
}

// Real-input fighter: closes distance, guards telegraphed hits, strikes during recovery.
// opts.attack: 'recover' | 'always' | 'never'
async function fightStep(s, opts = {}) {
  const p = s.player;
  const b = s.boss;
  const d = Math.hypot(p.x - b.x, p.z - b.z);
  const threatened = b.st === 'attack';
  if (threatened) {
    await release('KeyW');
    await hold('KeyK');
    return;
  }
  await release('KeyK');
  if (d > 2.3) await hold('KeyW'); else await release('KeyW');
  const mayHit = opts.attack === 'always' ? (b.st === 'recover' || b.st === 'idle') : opts.attack === 'never' ? false : b.st === 'recover';
  if (mayHit && d < 2.7 && (p.st === 'idle' || p.st === 'attack')) await page.keyboard.press('KeyJ');
}

// ---------------------------------------------------------------- tests

test('opening: start screen renders, lists controls, starts by mouse click', async ({ browser }) => {
  await open(browser, 'seed=3');
  const s0 = await snap();
  console.log(`renderer backend: ${s0.backend}, fps≈${s0.fps}, quality=${s0.quality}`);
  expect(['webgpu', 'webgl2']).toContain(s0.backend);
  expect(s0.mode).toBe('title');
  await expect(page).toHaveTitle(/雨巷双刃/);
  await expect(page.locator('#title h1')).toHaveText('雨巷双刃');
  const controls = await page.locator('#controls').innerText();
  for (const k of ['W A S D', 'J', 'K', 'Space', 'Enter']) expect(controls).toContain(k);
  const body = await page.locator('body').innerText();
  expect(body.toLowerCase()).not.toContain('phantom');
  await sleep(600);
  const st = imageStats(await shot('01-title'));
  console.log('title image stats', st);
  expect(st.colors).toBeGreaterThan(40);
  expect(st.std).toBeGreaterThan(4);

  const f0 = (await snap()).frames;
  await sleep(500);
  expect((await snap()).frames).toBeGreaterThan(f0);

  await page.locator('#startbtn').click(); // real mouse click
  await until((s) => s.mode === 'fight', 5000, 'fight after click');
  await expect(page.locator('#title')).toBeHidden();
  await expect(page.locator('#hud')).toBeVisible();
  await sleep(500);
  const lane = imageStats(await shot('02-lane'));
  console.log('lane image stats', lane);
  expect(lane.colors).toBeGreaterThan(60);
  expect(lane.std).toBeGreaterThan(6);
});

test('WebGL 2 fallback path renders when forced', async ({ browser }) => {
  await open(browser, 'seed=3&gl');
  const s0 = await snap();
  expect(s0.backend).toBe('webgl2');
  await page.keyboard.press('Enter');
  await until((s) => s.mode === 'fight', 5000, 'fight');
  await hold('KeyW');
  await until((s) => s.engaged, 15000, 'engaged');
  await release('KeyW');
  await sleep(1200);
  const st = imageStats(await shot('03-webgl2-yard'));
  console.log('webgl2 yard image stats', st);
  expect(st.colors).toBeGreaterThan(80);
  expect(st.std).toBeGreaterThan(6);
});

test('movement, mouse look, boundary collision, body collision, near-wall camera', async ({ browser }) => {
  await open(browser, 'seed=5&php=5&bhp=5&q=low');
  await page.keyboard.press('Enter');
  await until((s) => s.mode === 'fight', 5000, 'fight');
  const a = await snap();
  expect(a.player.z).toBeGreaterThan(13);

  // lane: W walks forward (−z), the lane walls stop sideways movement
  await hold('KeyW');
  await until((s) => s.player.z < a.player.z - 1.5, 8000, 'W moves forward');
  await release('KeyW');
  await hold('KeyD');
  await sleep(900);
  await release('KeyD');
  const laneR = await snap();
  expect(laneR.player.x).toBeGreaterThan(0.5);
  expect(laneR.player.x).toBeLessThanOrEqual(1.6 - 0.45 + 1e-6);
  await hold('KeyA');
  await sleep(1300);
  await release('KeyA');
  const laneL = await snap();
  expect(laneL.player.x).toBeLessThan(-0.5);
  expect(laneL.player.x).toBeGreaterThanOrEqual(-1.6 + 0.45 - 1e-6);
  await hold('KeyS');
  await sleep(500);
  await release('KeyS');
  expect((await snap()).player.z).toBeGreaterThan(laneL.player.z + 0.5);

  // mouse look without pointer lock (free camera before the duel starts)
  const yaw0 = (await snap()).cam.yaw;
  await page.mouse.move(640, 360);
  await page.mouse.move(760, 350, { steps: 6 });
  await sleep(100);
  const yaw1 = (await snap()).cam.yaw;
  expect(Math.abs(yaw1 - yaw0)).toBeGreaterThan(0.2);
  await page.mouse.move(640, 360, { steps: 6 });
  // keyboard camera
  await hold('KeyQ');
  await sleep(300);
  await release('KeyQ');
  expect(Math.abs((await snap()).cam.yaw - yaw0)).toBeGreaterThan(0.1);
  await hold('KeyE');
  await sleep(300);
  await release('KeyE');

  // enter the yard: gate closes behind
  await hold('KeyW');
  await until((s) => s.engaged, 15000, 'engaged');
  await release('KeyW');
  const eng = await snap();
  expect(eng.gateClosed).toBe(true);
  await until((s) => s.boss.st !== 'intro', 6000, 'boss intro over');

  // lock-on camera follows the boss; mouse still offsets it
  const lockYaw = (await snap()).cam.yaw;
  await page.mouse.move(520, 360, { steps: 5 });
  await sleep(250);
  expect(Math.abs((await snap()).cam.yaw - lockYaw)).toBeGreaterThan(0.05);

  // Unlock (F) so directions are fixed, then push into each wall while the boss harasses us.
  await page.keyboard.press('KeyF');
  expect((await snap()).cam.lock).toBe(false);
  const Y = eng.arena;
  const PR = 0.45, BR = 0.62;
  const check = (s, where) => {
    expect(s.player.x, where + ' player x').toBeGreaterThanOrEqual(Y.minX + PR - 1e-6);
    expect(s.player.x, where + ' player x').toBeLessThanOrEqual(Y.maxX - PR + 1e-6);
    expect(s.player.z, where + ' player z').toBeGreaterThanOrEqual(Y.minZ + PR - 1e-6);
    expect(s.player.z, where + ' player z').toBeLessThanOrEqual(Y.maxZ - PR + 1e-6);
    expect(s.boss.x, where + ' boss x').toBeGreaterThanOrEqual(Y.minX + BR - 1e-6);
    expect(s.boss.x, where + ' boss x').toBeLessThanOrEqual(Y.maxX - BR + 1e-6);
    expect(s.boss.z, where + ' boss z').toBeGreaterThanOrEqual(Y.minZ + BR - 1e-6);
    expect(s.boss.z, where + ' boss z').toBeLessThanOrEqual(Y.maxZ - BR + 1e-6);
    expect(Math.hypot(s.player.x - s.boss.x, s.player.z - s.boss.z), where + ' bodies overlap').toBeGreaterThan(PR + BR - 0.12);
    // camera stays inside the walls and below the eaves
    expect(s.cam.inBounds, where + ' camera in bounds').toBe(true);
    expect(s.cam.x).toBeGreaterThan(Y.minX + 0.3); expect(s.cam.x).toBeLessThan(Y.maxX - 0.3);
    expect(s.cam.z).toBeGreaterThan(Y.minZ + 0.3); expect(s.cam.z).toBeLessThan(Y.maxZ - 0.3);
    expect(s.cam.y).toBeGreaterThan(0.5); expect(s.cam.y).toBeLessThan(7.3);
  };
  // camera yaw is whatever the lock left; steer by measuring which key moves us where
  const reached = {};
  for (const key of ['KeyD', 'KeyW', 'KeyA', 'KeyS']) {
    await hold(key);
    const t0 = Date.now();
    let best = Infinity;
    let atWall = 0;
    while (Date.now() - t0 < 14000 && atWall < 10) {
      await sleep(50);
      const s = await snap();
      check(s, key);
      const edge = Math.min(s.player.x - (Y.minX + PR), (Y.maxX - PR) - s.player.x, s.player.z - (Y.minZ + PR), (Y.maxZ - PR) - s.player.z);
      best = Math.min(best, edge);
      atWall = edge < 0.02 ? atWall + 1 : 0; // keep pushing into the wall for a while
    }
    if (key === 'KeyD') await shot('04-wall-free-cam');
    await release(key);
    reached[key] = best;
  }
  console.log('distance to nearest wall after pushing each direction', reached);
  // the free camera keeps a fixed heading, so the four keys push into the four walls
  expect(Object.values(reached).filter((v) => v < 0.02).length).toBeGreaterThanOrEqual(3);

  // Re-lock: with our back near a wall the camera must keep both fighters in frame.
  await page.keyboard.press('KeyF');
  expect((await snap()).cam.lock).toBe(true);
  await hold('KeyS'); // back away from the boss until a wall stops us
  let visible = 0, total = 0, minT = 1, nearWall = 0, maxAvoid = 0, roomy = 0;
  const t1 = Date.now();
  while (Date.now() - t1 < 9000) {
    await sleep(70);
    const s = await snap();
    check(s, 'locked');
    const edge = Math.min(s.player.x - (Y.minX + PR), (Y.maxX - PR) - s.player.x, s.player.z - (Y.minZ + PR), (Y.maxZ - PR) - s.player.z);
    if (edge < 1.5) {
      nearWall++;
      total++;
      const bn = s.cam.bossNdc;
      if (bn[2] < 1 && Math.abs(bn[0]) < 0.98 && Math.abs(bn[1]) < 0.98) visible++;
      minT = Math.min(minT, s.cam.t);
      maxAvoid = Math.max(maxAvoid, Math.abs(s.cam.avoid));
      if (s.cam.t > 0.3) roomy++;
      if (nearWall === 12) await shot('05-wall-locked-cam');
    }
  }
  await releaseAll();
  console.log(`near-wall lock camera: boss on screen ${visible}/${total} samples, min camera pull-in ${minT.toFixed(2)}, max sideways swing ${maxAvoid.toFixed(2)} rad, camera kept its distance in ${roomy}/${total}`);
  expect(total).toBeGreaterThan(20);
  expect(visible / total).toBeGreaterThan(0.9);
  expect(roomy / total).toBeGreaterThan(0.7); // it swings around rather than collapsing onto the player
  expect(minT < 0.9 || maxAvoid > 0.2).toBe(true); // the wall really did force the camera to adapt
});

test('combo hits, guard reduces damage, dodge avoids a hit, punish bonus', async ({ browser }) => {
  await open(browser, 'seed=11&php=20&bhp=5&q=low');
  await startAndEnter();
  await until((s) => s.boss.st === 'idle' || s.boss.st === 'attack', 6000, 'boss active');

  // --- guard: hold K through an attack
  let since = (await snap()).time;
  let guardedEv = null;
  await until(async (s) => {
    const d = Math.hypot(s.player.x - s.boss.x, s.player.z - s.boss.z);
    if (d > 2.6 && s.boss.st !== 'attack') await hold('KeyW'); else await release('KeyW');
    await hold('KeyK');
    const ev = await events(since);
    guardedEv = ev.find((e) => e.type === 'playerHurt' && e.guarded && !e.perfect);
    return !!guardedEv;
  }, 60000, 'a guarded hit');
  await releaseAll();
  console.log('guarded hit', guardedEv);
  expect(guardedEv.dmg).toBeLessThan(guardedEv.raw);
  expect(guardedEv.dmg).toBeLessThanOrEqual(Math.round(guardedEv.raw * 0.5));

  // --- unguarded reference hit: stand still with no input
  since = (await snap()).time;
  let rawEv = null;
  await until(async (s) => {
    const d = Math.hypot(s.player.x - s.boss.x, s.player.z - s.boss.z);
    if (d > 2.6 && s.boss.st !== 'attack') await hold('KeyW'); else await release('KeyW');
    const ev = await events(since);
    rawEv = ev.find((e) => e.type === 'playerHurt' && !e.guarded);
    return !!rawEv;
  }, 60000, 'an unguarded hit');
  await releaseAll();
  console.log('unguarded hit', rawEv);
  expect(rawEv.dmg).toBe(rawEv.raw);

  // --- dodge: sidestep with Space just before a hit lands
  since = (await snap()).time;
  let dodgedEv = null;
  let hpAt = null;
  await until(async (s) => {
    const d = Math.hypot(s.player.x - s.boss.x, s.player.z - s.boss.z);
    if (d > 2.4 && s.boss.st !== 'attack') await hold('KeyW'); else await release('KeyW');
    if (s.boss.st === 'attack' && s.boss.hitIn >= 0 && s.boss.hitIn < 0.11 && s.player.st === 'idle' && s.player.dodgeCd <= 0) {
      hpAt = s.player.hp;
      await page.keyboard.press('Space');
    }
    const ev = await events(since);
    dodgedEv = ev.find((e) => e.type === 'dodged');
    return !!dodgedEv;
  }, 90000, 'a dodged hit', 12);
  await releaseAll();
  const evAll = await events(since);
  const hurtNear = evAll.find((e) => e.type === 'playerHurt' && Math.abs(e.t - dodgedEv.t) < 0.02);
  console.log('dodged', dodgedEv);
  expect(hurtNear, 'no damage at the moment of the dodged hit').toBeUndefined();
  expect((await snap()).stats.dodged).toBeGreaterThan(0);

  // --- combo + punish: guard the attack, then press J×3 during the recovery
  since = (await snap()).time;
  let got = null;
  await until(async (s) => {
    await fightStep(s, { attack: 'recover' });
    const ev = await events(since);
    const pun = ev.filter((e) => e.type === 'bossHurt' && e.punish);
    const ns = new Set(pun.map((e) => e.n));
    if (ns.has(1) && ns.has(2) && ns.has(3)) { got = pun; return true; }
    return false;
  }, 120000, 'three-hit punish combo', 15);
  await releaseAll();
  console.log('punish hits', got.slice(0, 4));
  const st = await snap();
  expect(st.stats.comboMax).toBe(3);
  expect(st.stats.punishHits).toBeGreaterThanOrEqual(3);
  for (const e of got) {
    expect(e.dmg).toBe(Math.round(e.base * 1.8));
    expect(e.dmg).toBeGreaterThan(e.base);
  }
  // punish is signalled in the HUD during recovery
  await until(async (s) => { await fightStep(s, { attack: 'never' }); return s.boss.st === 'recover'; }, 60000, 'a recovery window', 15);
  await expect(page.locator('#punishcue')).toHaveClass(/on/);
  await shot('06-punish-window');
  await releaseAll();

  // --- a hit on a ready (idle) boss is turned aside for reduced damage, so punish is a real bonus
  since = (await snap()).time;
  let plain = null;
  await until(async (s) => {
    await fightStep(s, { attack: 'always' });
    const ev = await events(since);
    plain = ev.find((e) => e.type === 'bossHurt' && !e.punish);
    return !!plain;
  }, 60000, 'a non-punish hit', 15);
  await releaseAll();
  console.log('non-punish hit', plain);
  expect(plain.dmg).toBeLessThanOrEqual(plain.base);

  // --- gap closer: back off (S while locked on) and the boss lunges across the yard
  since = (await snap()).time;
  let lunge = null;
  let farthest = 0;
  await until(async (s) => {
    const d = Math.hypot(s.player.x - s.boss.x, s.player.z - s.boss.z);
    farthest = Math.max(farthest, d);
    if (s.boss.move === 'lunge') {
      for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) await release(k);
      await hold('KeyK');
    } else {
      await release('KeyK');
      // run for whichever quarter of the yard is farthest from the boss (keys are boss-relative while locked on)
      let best = null, bd = -1;
      for (const c of [[-6.5, -5], [6.5, -5], [-6.5, 5], [6.5, 5]]) {
        const cd = Math.hypot(c[0] - s.boss.x, c[1] - s.boss.z);
        if (cd > bd) { bd = cd; best = c; }
      }
      const tx = best[0] - s.player.x, tz = best[1] - s.player.z;
      const tl = Math.hypot(tx, tz);
      const fx = (s.boss.x - s.player.x) / (d || 1), fz = (s.boss.z - s.player.z) / (d || 1);
      const fwd = tl > 0.8 ? (tx * fx + tz * fz) / tl : 0;
      const right = tl > 0.8 ? (tx * -fz + tz * fx) / tl : 0;
      if (fwd > 0.35) { await release('KeyS'); await hold('KeyW'); } else if (fwd < -0.35) { await release('KeyW'); await hold('KeyS'); } else { await release('KeyW'); await release('KeyS'); }
      if (right > 0.35) { await release('KeyA'); await hold('KeyD'); } else if (right < -0.35) { await release('KeyD'); await hold('KeyA'); } else { await release('KeyA'); await release('KeyD'); }
    }
    const ev = await events(since);
    lunge = ev.find((e) => e.type === 'bossMove' && e.name === 'lunge');
    return !!lunge && ev.some((e) => e.type === 'recover' && e.move === 'lunge');
  }, 90000, 'a lunge from range', 15);
  await releaseAll();
  const afterLunge = await snap();
  const dAfter = Math.hypot(afterLunge.player.x - afterLunge.boss.x, afterLunge.player.z - afterLunge.boss.z);
  console.log('lunge', lunge, 'farthest gap', farthest.toFixed(2), 'gap after lunge', dAfter.toFixed(2));
  expect(farthest).toBeGreaterThan(5);
  expect(dAfter).toBeLessThan(farthest - 4); // the dash (max 10.5 m) really closed the gap
});

test('phase-two transition, changed behaviour, victory, retry by key', async ({ browser }) => {
  await open(browser, 'seed=7&php=5&bhp=0.45&q=low');
  await startAndEnter();
  const all = [];
  let since = -1;
  const pull = async () => {
    const ev = await events(since);
    if (ev.length) { since = ev[ev.length - 1].t; all.push(...ev); }
    return all;
  };

  // phase one: fight until the boss drops to half health
  let sawPhaseState = false;
  await until(async (s) => {
    if (s.boss.st === 'phase') sawPhaseState = true;
    await fightStep(s, { attack: 'always' });
    await pull();
    return s.boss.st === 'phase' || s.boss.phase === 2;
  }, 150000, 'boss reaches half health', 15);
  await releaseAll();
  const mid = await snap();
  expect(mid.boss.hp).toBeLessThanOrEqual(mid.boss.maxHp / 2);
  expect(mid.boss.hp).toBeGreaterThan(0);
  await sleep(1500);
  await shot('07-phase-transition');
  const hpDuring = (await snap()).boss.hp;
  await until((s) => { if (s.boss.st === 'phase') sawPhaseState = true; return s.boss.phase === 2; }, 10000, 'phase two begins');
  expect(sawPhaseState).toBe(true);
  expect((await snap()).boss.hp).toBe(hpDuring); // invulnerable during the transition
  await expect(page.locator('#phaselabel')).toContainText('第二式');
  await expect(page.locator('#phase')).toHaveClass(/two/);
  await pull();
  expect(all.some((e) => e.type === 'phaseStart')).toBe(true);
  expect(all.some((e) => e.type === 'burst')).toBe(true);
  expect(all.some((e) => e.type === 'phaseTwo')).toBe(true);

  // phase two: only defend until the new follow-ups and faster timing have been observed
  await until(async (s) => {
    await fightStep(s, { attack: 'never' });
    await pull();
    const m1 = all.filter((e) => e.type === 'bossMove' && e.phase === 1);
    const m2 = all.filter((e) => e.type === 'bossMove' && e.phase === 2);
    const common = m2.some((m) => m1.some((n) => n.name === m.name));
    return all.some((e) => e.type === 'followUp') && common;
  }, 150000, 'phase-two follow-up and a move seen in both phases', 15);
  await shot('08-phase-two');
  const m1 = all.filter((e) => e.type === 'bossMove' && e.phase === 1);
  const m2 = all.filter((e) => e.type === 'bossMove' && e.phase === 2);
  expect(m1.every((m) => m.follow.length === 0)).toBe(true);
  expect(m2.some((m) => m.follow.length > 0)).toBe(true);
  let compared = 0;
  for (const m of m2) {
    const ref = m1.find((n) => n.name === m.name);
    if (!ref) continue;
    compared++;
    expect(m.wind).toBeLessThan(ref.wind);
    expect(m.rec).toBeLessThan(ref.rec);
  }
  expect(compared).toBeGreaterThan(0);
  console.log('phase 1 moves', m1.map((m) => `${m.name} wind=${m.wind} rec=${m.rec}`).join(' | '));
  console.log('phase 2 moves', m2.map((m) => `${m.name} wind=${m.wind} holds=${m.holds} rec=${m.rec} follow=${m.follow}`).join(' | '));
  console.log('follow-ups seen', all.filter((e) => e.type === 'followUp').map((e) => e.follow));

  // finish the fight
  await until(async (s) => {
    if (s.mode === 'fight') await fightStep(s, { attack: 'always' });
    return s.mode === 'victory';
  }, 200000, 'victory', 15);
  await releaseAll();
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#resultsub')).toHaveText('VICTORY');
  await shot('09-victory');
  const v = await snap();
  expect(v.boss.hp).toBe(0);
  expect(v.player.hp).toBeGreaterThan(0);

  // retry with the keyboard
  await page.keyboard.press('KeyR');
  const r = await until((s) => s.mode === 'fight', 5000, 'retry');
  await expect(page.locator('#result')).toBeHidden();
  expect(r.fights).toBe(2);
  expect(r.player.hp).toBe(r.player.maxHp);
  expect(r.boss.hp).toBe(r.boss.maxHp);
  expect(r.boss.phase).toBe(1);
  expect(r.engaged).toBe(false);
  await expect(page.locator('#phaselabel')).toContainText('第一式');
  // the retried fight is playable again
  await hold('KeyW');
  await until((s) => s.engaged, 15000, 're-engage after retry');
  await releaseAll();
});

test('defeat screen, retry by mouse, mouse buttons attack and guard', async ({ browser }) => {
  await open(browser, 'seed=2&php=0.3&q=low');
  await startAndEnter();
  // no input at all: the boss wins
  await until((s) => s.mode === 'defeat', 120000, 'defeat', 100);
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#resultsub')).toHaveText('DEFEAT');
  await shot('10-defeat');
  const d = await snap();
  expect(d.player.hp).toBe(0);
  expect(d.boss.hp).toBeGreaterThan(0);

  await page.locator('#retrybtn').click(); // real mouse click
  const r = await until((s) => s.mode === 'fight', 5000, 'retry');
  await expect(page.locator('#result')).toBeHidden();
  expect(r.player.hp).toBe(r.player.maxHp);
  expect(r.boss.hp).toBe(r.boss.maxHp);
  expect(r.fights).toBe(2);

  // mouse buttons: left = attack, right (held) = guard
  const sw0 = r.stats.swings;
  await page.mouse.move(640, 300);
  await page.mouse.click(640, 300, { button: 'left' });
  await until((s) => s.stats.swings > sw0, 3000, 'left click swings');
  await until((s) => s.player.st === 'idle', 3000, 'swing ends');
  await page.mouse.down({ button: 'right' });
  await until((s) => s.player.guard === true, 3000, 'right button guards');
  await page.mouse.up({ button: 'right' });
  await until((s) => s.player.guard === false, 3000, 'guard released');
  // pause key stops the simulation clock
  await page.keyboard.press('KeyP');
  const p0 = await snap();
  await sleep(400);
  const p1 = await snap();
  expect(p1.paused).toBe(true);
  expect(p1.time).toBe(p0.time);
  await page.keyboard.press('KeyP');
  await until((s) => s.time > p1.time, 3000, 'unpaused');
});

test('WebGPU backend renders and plays (skipped without a hardware WebGPU adapter)', async () => {
  // The default headless shell has no usable WebGPU device, so this uses the full Chromium build.
  const args = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu'];
  if (process.platform === 'win32') args.push('--use-angle=d3d11');
  try {
    extraBrowser = await chromium.launch({ channel: 'chromium', headless: true, args });
  } catch (e) {
    test.skip(true, 'full Chromium build not launchable here: ' + String(e.message).split(/\r?\n/)[0]);
    return;
  }
  await open(extraBrowser, 'seed=3&php=5');
  const s0 = await snap();
  console.log('WebGPU check: backend =', s0.backend);
  test.skip(s0.backend !== 'webgpu', 'no hardware WebGPU adapter in this environment; the game fell back to ' + s0.backend);
  await startAndEnter();
  await until((s) => s.boss.st === 'idle' || s.boss.st === 'attack', 8000, 'boss active');
  await until(async (s) => { await fightStep(s, { attack: 'always' }); return s.stats.hitsLanded > 0 && s.stats.guarded + s.stats.perfect + s.stats.hurt > 0; }, 90000, 'exchange blows on WebGPU', 15);
  await releaseAll();
  const st = imageStats(await shot('11-webgpu-yard'));
  const s1 = await snap();
  console.log('webgpu yard image stats', st, 'fps≈' + s1.fps);
  expect(st.colors).toBeGreaterThan(80);
  expect(st.std).toBeGreaterThan(6);
});
