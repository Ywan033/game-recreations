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
  for (const k of ['W A S D', 'J', 'K', 'Space', 'Enter', 'Left Shift', 'R', '跳跃', '蓄力', '药壶']) expect(controls).toContain(k);
  expect(controls).not.toMatch(/Space\s*\/\s*L/); // Space is no longer a dodge key
  const tb = await page.locator('#title').boundingBox();
  const btn = await page.locator('#startbtn').boundingBox();
  expect(btn.y + btn.height, 'start button fits on a 720p screen').toBeLessThanOrEqual(720);
  expect(tb.height).toBeLessThanOrEqual(720);
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

  // --- dodge: sidestep with Left Shift just before a hit lands
  since = (await snap()).time;
  let dodgedEv = null;
  let hpAt = null;
  await until(async (s) => {
    const d = Math.hypot(s.player.x - s.boss.x, s.player.z - s.boss.z);
    if (d > 2.4 && s.boss.st !== 'attack') await hold('KeyW'); else await release('KeyW');
    if (s.boss.st === 'attack' && s.boss.hitIn >= 0 && s.boss.hitIn < 0.11 && s.player.st === 'idle' && s.player.dodgeCd <= 0) {
      hpAt = s.player.hp;
      await page.keyboard.press('ShiftLeft');
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
  // (one flask charge is drunk on the way, so the retry below has something to restore)
  await until(async (s) => {
    if (s.mode === 'fight' && s.player.flask === s.player.maxFlask && s.player.hp < s.player.maxHp && s.boss.st === 'recover' && s.player.st === 'idle' && s.boss.hp > 30) {
      await releaseAll();
      await page.keyboard.press('KeyR');
      await sleep(750);
      return false;
    }
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
  console.log(`flask at victory: ${v.player.flask}/${v.player.maxFlask}, heals ${v.stats.heals}`);
  expect(v.player.flask).toBe(v.player.maxFlask - v.stats.heals);
  expect(v.stats.heals).toBeGreaterThanOrEqual(1);

  // retry with the keyboard (on the result screen R is retry and cannot drink)
  await sleep(700);
  await page.keyboard.press('KeyR');
  const r = await until((s) => s.mode === 'fight', 5000, 'retry');
  await expect(page.locator('#result')).toBeHidden();
  expect(r.fights).toBe(2);
  expect(r.player.flask, 'retry restores the flask').toBe(r.player.maxFlask);
  expect(r.stats.heals + r.stats.drinkFails, 'the retry press was not taken as a drink').toBe(0);
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

  // R on the result screen is retry only: it must not act in the instant the screen appears,
  // and the Enter key / button remain. Use the button here (R is used in the victory test).
  await page.locator('#retrybtn').click(); // real mouse click
  const r = await until((s) => s.mode === 'fight', 5000, 'retry');
  await expect(page.locator('#result')).toBeHidden();
  expect(r.player.flask).toBe(r.player.maxFlask);
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

const count = (ev, type, f) => ev.filter((e) => e.type === type && (!f || f(e))).length;

test('controls: Left Shift dodges, Space jumps, tap/hold attack, pause cleanup, audio start/mute/pause', async ({ browser }) => {
  await open(browser, 'seed=5&q=low');
  const pre = await snap();
  expect(pre.audio.started, 'no audio before the first user gesture').toBe(false);
  await page.keyboard.press('Enter');
  await until((s) => s.mode === 'fight', 5000, 'fight');
  // audio unlocks on that first gesture and its clock runs
  const a0 = await until((s) => s.audio.started && s.audio.state === 'running', 5000, 'audio running after the first gesture');
  await sleep(300);
  expect((await snap()).audio.time).toBeGreaterThan(a0.audio.time);
  await hold('KeyW');
  await until((s) => s.player.z < 12.5, 8000, 'into the lane');
  await release('KeyW');
  await until((s) => s.player.st === 'idle', 2000, 'idle');
  let t0 = (await snap()).time;

  // Left Shift = dodge, and it does not jump
  await page.keyboard.press('ShiftLeft');
  await until((s) => s.player.st === 'dodge', 2000, 'ShiftLeft dodges');
  let maxY = 0;
  await until((s) => { maxY = Math.max(maxY, s.player.y); return s.player.st === 'idle' && s.player.dodgeCd <= 0; }, 3000, 'dodge ends');
  let ev = await events(t0);
  expect(count(ev, 'dodge')).toBe(1);
  expect(count(ev, 'jump')).toBe(0);
  expect(maxY).toBe(0);
  // Right Shift is not bound
  await page.keyboard.press('ShiftRight');
  await sleep(250);
  expect(count(await events(t0), 'dodge')).toBe(1);

  // Space = jump (held for the whole flight and beyond: exactly one jump), and it does not dodge
  t0 = (await snap()).time;
  const seen = new Set();
  await hold('Space');
  maxY = 0;
  // (wait on the simulation, not the wall clock: software rendering can run slower than real time)
  await until((s) => { seen.add(s.player.st); maxY = Math.max(maxY, s.player.y); return seen.has('air') && s.player.st === 'idle' && s.player.y === 0; }, 15000, 'jump and land', 8);
  const tLand = (await snap()).time;
  await until((s) => { seen.add(s.player.st); return s.time > tLand + 0.8; }, 15000, 'Space still held after landing', 8);
  await release('Space');
  const afterJump = await snap();
  ev = await events(t0);
  console.log(`jump: peak height ${maxY.toFixed(2)} m, states seen ${[...seen].join(',')}`);
  expect(count(ev, 'jump'), 'holding Space jumps once').toBe(1);
  expect(count(ev, 'land')).toBe(1);
  expect(count(ev, 'dodge'), 'Space no longer dodges').toBe(0);
  expect(maxY).toBeGreaterThan(0.6);
  expect(maxY).toBeLessThan(1.4);
  expect(seen.has('air')).toBe(true);
  expect(afterJump.player.y).toBe(0);
  expect(afterJump.player.st).toBe('idle');
  expect(afterJump.stats.jumps).toBe(1);
  // jump while running forward: keeps moving, stays inside the lane, input works after landing
  await hold('KeyW');
  await sleep(250);
  const zRun = (await snap()).player.z;
  await page.keyboard.press('Space');
  await until((s) => s.player.st === 'air', 2000, 'running jump');
  await shot('12-jump');
  await until((s) => s.player.st === 'idle' && s.player.y === 0, 3000, 'lands');
  const zLand = (await snap()).player.z;
  expect(zLand).toBeLessThan(zRun - 1.5);
  await release('KeyW');
  expect(Math.abs((await snap()).player.x)).toBeLessThanOrEqual(1.6 - 0.45 + 1e-6);
  // walk back up the lane so the swings below (which step forward) stay clear of the yard
  await hold('KeyS');
  await until((s) => s.player.z > 13.5, 15000, 'back up the lane');
  await release('KeyS');
  expect((await snap()).engaged).toBe(false);

  // attack key, short press: one light cut and no charge
  await until((s) => s.player.st === 'idle', 2000, 'idle');
  t0 = (await snap()).time;
  let st0 = (await snap()).stats;
  await page.keyboard.press('KeyJ');
  await until((s) => s.stats.swings === st0.swings + 1, 2000, 'tap swings');
  await until((s) => s.player.st === 'idle', 3000, 'swing ends');
  ev = await events(t0);
  expect(count(ev, 'swing')).toBe(1);
  expect(count(ev, 'chargeStart')).toBe(0);
  expect((await snap()).stats.heavies).toBe(0);
  // repeated short presses: the 3-step combo
  t0 = (await snap()).time;
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('KeyJ');
    const sw = await until((s) => s.player.st === 'attack' && s.player.combo === i, 3000, 'combo step ' + (i + 1), 8);
    await until((s) => s.time > sw.time + 0.07, 3000, 'a moment into the swing', 8); // paced in simulation time
  }
  await until((s) => s.player.st === 'idle', 4000, 'combo ends');
  ev = await events(t0);
  expect(ev.filter((e) => e.type === 'swing').map((e) => e.n)).toEqual([1, 2, 3]);
  expect((await snap()).stats.heavies).toBe(0);

  // hold to charge, release for the heavy: keyboard, then mouse (identical behaviour)
  for (const dev of ['key', 'mouse']) {
    t0 = (await snap()).time;
    st0 = (await snap()).stats;
    if (dev === 'key') await hold('KeyJ'); else { await page.mouse.move(640, 300); await page.mouse.down(); }
    await until((s) => s.player.st === 'charge', 2000, dev + ' hold enters the charge');
    await until((s) => s.player.charged, 3000, dev + ' fully charged');
    await expect(page.locator('#charge')).toHaveClass(/full/);
    if (dev === 'key') await shot('13-charged');
    await sleep(150);
    expect((await snap()).player.st, 'the charge is held until release').toBe('charge');
    if (dev === 'key') await release('KeyJ'); else await page.mouse.up();
    await until((s) => s.player.st === 'heavy', 2000, dev + ' release swings the heavy');
    await until((s) => s.player.st === 'idle', 4000, 'heavy recovers');
    ev = await events(t0);
    const s1 = await snap();
    expect(count(ev, 'charged')).toBe(1);
    expect(ev.filter((e) => e.type === 'swing').map((e) => !!e.heavy), dev + ': one wind-up, one heavy, no light cut').toEqual([false, true]);
    expect(s1.stats.heavies).toBe(st0.heavies + 1);
    expect(s1.stats.swings).toBe(st0.swings + 1);
    expect(s1.player.chargeT).toBe(0);
    await expect(page.locator('#charge')).not.toHaveClass(/on/);
  }
  // released before the charge is full: just the one light cut
  t0 = (await snap()).time;
  st0 = (await snap()).stats;
  await hold('KeyJ');
  await until((s) => s.player.st === 'charge', 2000, 'charging');
  await release('KeyJ');
  await until((s) => s.player.st === 'idle', 3000, 'idle after an early release');
  ev = await events(t0);
  expect(count(ev, 'charged')).toBe(0);
  expect(count(ev, 'swing')).toBe(1);
  expect((await snap()).stats.heavies).toBe(st0.heavies);

  // state cleanup: pausing mid-charge drops the charge; releasing afterwards swings nothing
  t0 = (await snap()).time;
  st0 = (await snap()).stats;
  await hold('KeyJ');
  await until((s) => s.player.st === 'charge' && s.player.chargeT > 0.15, 3000, 'charging before the pause');
  await page.keyboard.press('KeyP');
  const pz = await until((s) => s.paused, 2000, 'paused');
  expect(pz.player.st).toBe('idle');
  expect(pz.player.chargeT).toBe(0);
  // audio stops with the pause
  await until((s) => s.audio.paused && s.audio.state === 'suspended', 3000, 'audio suspended while paused');
  const at = (await snap()).audio.time;
  await sleep(300);
  expect((await snap()).audio.time).toBe(at);
  // keys pressed while paused do nothing later
  await page.keyboard.press('Space');
  await page.keyboard.press('KeyR');
  await page.keyboard.press('ShiftLeft');
  await page.keyboard.press('KeyP');
  await until((s) => !s.paused && s.audio.state === 'running', 3000, 'resumed with audio running');
  await sleep(150);
  await release('KeyJ');
  await sleep(500);
  ev = await events(t0);
  const sC = await snap();
  expect(sC.audio.time).toBeGreaterThan(at);
  expect(sC.stats.heavies).toBe(st0.heavies);
  expect(count(ev, 'swing')).toBe(1); // only the wind-up that began the charge
  expect(count(ev, 'jump') + count(ev, 'dodge') + count(ev, 'drinkFail')).toBe(0);
  expect(sC.player.st).toBe('idle');

  // mute and unmute (M)
  await page.keyboard.press('KeyM');
  expect((await snap()).audio.muted).toBe(true);
  await expect(page.locator('#status')).toContainText('MUTED');
  await page.keyboard.press('KeyM');
  expect((await snap()).audio.muted).toBe(false);

  // flask at full health: refused with feedback, nothing spent; R does not restart the fight
  t0 = (await snap()).time;
  await page.keyboard.press('KeyR');
  await until(async () => count(await events(t0), 'drinkFail') === 1, 2000, 'full-health refusal');
  await expect(page.locator('#flask')).toHaveClass(/deny/);
  const sF = await snap();
  expect(sF.player.flask).toBe(sF.player.maxFlask);
  expect(sF.mode).toBe('fight');
  expect(sF.fights).toBe(1);
  await expect(page.locator('#flaskcount')).toHaveText(`${sF.player.maxFlask}/${sF.player.maxFlask}`);
});

test('flask heals once per drink, capped; hits interrupt a drink and a charge; empty flask; jump camera in the fight', async ({ browser }) => {
  await open(browser, 'seed=11&php=4&bhp=8&q=low');
  await startAndEnter();
  await until((s) => s.boss.st === 'idle' || s.boss.st === 'attack', 6000, 'boss active');
  const S0 = await snap();
  const maxHp = S0.player.maxHp, maxFlask = S0.player.maxFlask;
  const healAmt = Math.round(maxHp * S0.config.flask.healFrac);
  const near = (s) => Math.hypot(s.player.x - s.boss.x, s.player.z - s.boss.z);
  const approach = async (s) => { if (near(s) > 2.4 && s.boss.st !== 'attack') await hold('KeyW'); else await release('KeyW'); };

  // --- jump in the fight, locked on: the camera rises only a little and stays inside
  let base = (await snap()).cam.y, rise = 0, inB = true, peak = 0;
  await page.keyboard.press('Space');
  let tj = Date.now();
  while (Date.now() - tj < 900) { const s = await snap(); rise = Math.max(rise, s.cam.y - base); peak = Math.max(peak, s.player.y); inB = inB && s.cam.inBounds; await sleep(10); }
  console.log(`locked-on jump: player peak ${peak.toFixed(2)} m, camera rise ${rise.toFixed(2)} m`);
  expect(peak).toBeGreaterThan(0.5);
  expect(rise).toBeLessThan(0.6);
  expect(inB).toBe(true);

  // --- a hit interrupts the charge: hold J as an attack comes in, keep holding afterwards
  let since = (await snap()).time;
  let st0 = (await snap()).stats;
  let broke = null;
  await until(async (s) => {
    await approach(s);
    const ev = await events(since);
    broke = ev.find((e) => e.type === 'chargeBreak');
    if (broke) return true;
    if (s.boss.st === 'attack' && s.boss.hitIn >= 0 && s.boss.hitIn < 0.75 && near(s) < 2.7 && s.player.st === 'idle') await hold('KeyJ');
    if (s.boss.st !== 'attack' && (s.player.st === 'charge' || s.player.st === 'heavy')) await release('KeyJ'); // wrong moment: let go
    return false;
  }, 120000, 'a charge broken by a hit', 12);
  await sleep(700); // J is still held: nothing may start from it
  let ev = await events(since);
  const hurtAt = ev.find((e) => e.type === 'playerHurt' && Math.abs(e.t - broke.t) < 0.02);
  const after = ev.filter((e) => e.t > broke.t && (e.type === 'swing' || e.type === 'chargeStart'));
  console.log('charge broken at', broke.t, 'by', hurtAt && hurtAt.move);
  expect(hurtAt, 'the break coincides with a hit').toBeTruthy();
  expect(after, 'holding through the hit starts no swing').toEqual([]);
  expect((await snap()).player.chargeT).toBe(0);
  await releaseAll();
  await sleep(200);
  expect(count(await events(broke.t), 'swing')).toBe(0);

  // --- a hit interrupts a drink before the sip: no charge spent, no heal
  since = (await snap()).time;
  let brk = null;
  let tries = 0;
  await until(async (s) => {
    await approach(s);
    const e2 = await events(since);
    brk = e2.find((e) => e.type === 'drinkBreak');
    if (brk) return true;
    if (s.player.hp < maxHp && s.player.flask === maxFlask && s.boss.st === 'attack' && s.boss.hitIn >= 0.05 && s.boss.hitIn < 0.4 && near(s) < 2.6 && s.player.st === 'idle') {
      tries++;
      await page.keyboard.press('KeyR');
      await sleep(120);
    }
    return false;
  }, 150000, 'a drink broken by a hit', 12);
  ev = await events(since);
  const sB = await snap();
  console.log(`drink interrupted (${tries} presses); flask ${sB.player.flask}/${maxFlask}; heals so far ${count(ev, 'heal')}`);
  expect(brk.left).toBe(maxFlask - count(ev, 'heal', (e) => e.t < brk.t));
  expect(sB.player.flask).toBe(maxFlask - count(ev, 'heal'));
  expect(ev.some((e) => e.type === 'playerHurt' && Math.abs(e.t - brk.t) < 0.02)).toBe(true);
  expect(ev.some((e) => e.type === 'heal' && Math.abs(e.t - brk.t) < 0.02)).toBe(false);
  await releaseAll();

  // --- drinks: R (held down) after taking damage heals exactly once per press, never above max
  let drinks = 0;
  let guardUntil = 0;
  while ((await snap()).player.flask > 0) {
    const f0 = (await snap()).player.flask;
    since = (await snap()).time;
    let healEv = null;
    let hp0 = null;
    await until(async (s) => {
      const e2 = await events(since);
      healEv = e2.find((e) => e.type === 'heal');
      if (healEv) return true;
      if (s.player.st === 'drink') { await release('KeyW'); return false; }
      await release('KeyR');
      // take a hit if at full health, otherwise guard until the boss is recovering, then drink
      if (s.player.hp >= maxHp) { await release('KeyK'); await approach(s); return false; }
      if (s.boss.st === 'attack') { await release('KeyW'); await hold('KeyK'); guardUntil = Date.now() + 60; return false; }
      if (Date.now() > guardUntil) await release('KeyK');
      if (s.boss.st === 'recover' && s.player.st === 'idle' && !s.player.guard) { hp0 = s.player.hp; await hold('KeyR'); } // R stays down
      return false;
    }, 150000, 'a completed drink', 12);
    await sleep(900); // R is still held: it must not repeat
    await release('KeyR');
    const e3 = await events(since);
    const s2 = await snap();
    drinks++;
    console.log(`drink ${drinks}: +${healEv.amount} -> ${healEv.hp}/${maxHp}, flask ${healEv.left}`);
    expect(count(e3, 'heal'), 'one heal per press, even when held').toBe(1);
    expect(healEv.left).toBe(f0 - 1);
    expect(s2.player.flask).toBe(f0 - 1);
    expect(healEv.amount).toBeGreaterThan(0);
    expect(healEv.amount).toBeLessThanOrEqual(healAmt);
    expect(healEv.hp).toBeLessThanOrEqual(maxHp);
    if (hp0 !== null && hp0 + healAmt > maxHp) expect(healEv.hp === maxHp || healEv.amount < healAmt).toBe(true);
    await expect(page.locator('#flaskcount')).toHaveText(`${f0 - 1}/${maxFlask}`);
    if (drinks === 1) await shot('14-after-drink');
  }
  expect(drinks).toBeGreaterThanOrEqual(1);
  await releaseAll();

  // --- empty flask: refused with feedback, nothing healed
  since = (await snap()).time;
  let fail = null;
  let hpBefore = null;
  await until(async (s) => {
    const e2 = await events(since);
    fail = e2.find((e) => e.type === 'drinkFail');
    if (fail) return true;
    if (s.player.hp >= maxHp) { await release('KeyK'); await approach(s); return false; }
    if (s.boss.st === 'attack') { await release('KeyW'); await hold('KeyK'); return false; }
    await release('KeyK');
    if (s.player.st === 'idle') { hpBefore = s.player.hp; await page.keyboard.press('KeyR'); await sleep(60); }
    return false;
  }, 120000, 'empty-flask refusal', 12);
  await releaseAll();
  expect(fail.reason).toBe('empty');
  const sE = await snap();
  expect(sE.player.flask).toBe(0);
  expect(count(await events(since), 'heal')).toBe(0);
  expect(sE.player.hp).toBeLessThanOrEqual(hpBefore);
  await expect(page.locator('#flask')).toHaveClass(/empty/);
  expect(sE.mode).toBe('fight');
  expect(sE.fights).toBe(1);

  // --- jump with the back to a wall, mid-fight: camera stays inside and does not pop
  await hold('KeyS');
  await sleep(3500);
  base = (await snap()).cam.y; rise = 0; inB = true;
  await page.keyboard.press('Space');
  tj = Date.now();
  while (Date.now() - tj < 900) { const s = await snap(); rise = Math.max(rise, s.cam.y - base); inB = inB && s.cam.inBounds; await sleep(10); }
  await releaseAll();
  console.log(`near-wall jump: camera rise ${rise.toFixed(2)} m, in bounds ${inB}`);
  expect(rise).toBeLessThan(0.7);
  expect(inB).toBe(true);
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
