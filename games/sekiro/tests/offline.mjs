// Offline real-input suite for dist/play.html.
// Copies ONLY play.html into a fresh temp directory, opens it via file:// in a fresh browser
// context with networking disabled, and drives the game with real keyboard and mouse events.
// window.__game.snap is used read-only, to observe state and time the inputs. No state is injected.
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const built = path.resolve(here, '..', 'dist', 'play.html');
if (!fs.existsSync(built)) { console.error('dist/play.html missing — run `npm run build` first'); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reedmoon-offline-'));
fs.copyFileSync(built, path.join(tmp, 'play.html'));
const listing = fs.readdirSync(tmp);
const url = pathToFileURL(path.join(tmp, 'play.html')).href;
const shotDir = path.resolve(here, '..', 'test-results');
fs.mkdirSync(shotDir, { recursive: true });

const results = [];
const P2_ONLY = ['string5', 'feint', 'leap'];
let current = '';
function ok(cond, label, detail = '') {
  if (!cond) throw new Error(`[${current}] FAILED: ${label} ${detail}`);
  results.push(`${current}: ${label}`);
  console.log(`  ok  ${label}${detail ? '  (' + detail + ')' : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// default: bundled Chromium on software rendering (the launcher's environment; the page reports WebGL 2).
// --gpu: installed Chrome with hardware flags, to run the same suite on the WebGPU backend (extra coverage, not part of test:offline).
// If the headless shell cannot create a WebGL 2 context at all (seen on this machine: its SwiftShader
// fallback stopped working), the bundled full Chromium (installed by the same `playwright install
// chromium`) is used instead with the game's WebGL 2 backend forced by the documented #gl=1 option.
const SOFT = ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let extraHash = '', browserName = 'installed Chrome with hardware flags (--gpu)';
async function launchDefault() {
  let b = await chromium.launch({ args: SOFT });
  const p = await b.newPage(), has = await p.evaluate(() => !!document.createElement('canvas').getContext('webgl2')).catch(() => false);
  await p.close();
  if (has) { browserName = 'bundled Chromium headless shell'; return b; }
  await b.close();
  b = await chromium.launch({ channel: 'chromium', args: SOFT });
  extraHash = '&gl=1'; browserName = 'bundled full Chromium, new headless (the headless shell gave no WebGL 2 context), #gl=1';
  return b;
}
const browser = process.argv.includes('--gpu')
  ? await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu'] })
  : await launchDefault();
console.log('browser: ' + browserName);
const pageErrors = [];
const external = [];

async function open(hash) {
  const context = await browser.newContext({ viewport: { width: 800, height: 450 } }); // fresh context
  await context.setOffline(true);
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('file:')) return route.continue();
    external.push(u); return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${hash}: ${e.message}`));
  page.on('crash', () => pageErrors.push(`${hash}: page crashed`));
  await page.goto(url + '#' + hash + extraHash);
  await page.waitForFunction(() => window.__game && window.__game.snap.frames > 3, null, { timeout: 90000 });
  const snap = () => page.evaluate(() => window.__game.snap);
  const until = async (cond, label, timeout = 30000) => {
    const t0 = Date.now(); let s;
    for (;;) { s = await snap(); if (cond(s)) return s; if (Date.now() - t0 > timeout) throw new Error(`[${current}] timeout waiting for ${label}: ${JSON.stringify(s).slice(0, 700)}`); await sleep(10); }
  };
  return { page, context, snap, until };
}

async function renderStats(page, name) {
  const buf = await page.screenshot({ clip: { x: 100, y: 110, width: 600, height: 240 } });
  fs.writeFileSync(path.join(shotDir, name + '.png'), await page.screenshot());
  const png = PNG.sync.read(buf);
  const colors = new Set(); let sum = 0, sum2 = 0, n = 0;
  for (let i = 0; i < png.data.length; i += 16) {
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    colors.add((r >> 3) << 10 | (g >> 3) << 5 | (b >> 3));
    const l = 0.3 * r + 0.6 * g + 0.1 * b; sum += l; sum2 += l * l; n++;
  }
  return { colors: colors.size, std: Math.sqrt(sum2 / n - (sum / n) ** 2), mean: sum / n };
}

// Keep away from the Warden with real movement keys until it is walking (not mid-move) and far
// enough that no blow can land for about a second and a half. Used before checks that need a quiet moment.
async function clear(g, minDist = 7.5, timeout = 40000) {
  const { page, snap } = g; const t0 = Date.now(); let s, sawAttack = false;
  const held = { KeyW: false, KeyA: false, KeyS: false, KeyD: false };
  const set = async (k, v) => { if (held[k] !== v) { held[k] = v; await page.keyboard[v ? 'down' : 'up'](k); } };
  try {
    for (;;) {
      s = await snap();
      if (s.mode !== 'fight') throw new Error(`[${current}] fight ended (${s.mode}) while backing off`);
      // quiet: the Warden is far off, or it has just finished a move (its pause before the next one
      // plus the next wind-up leave well over a second)
      if (s.boss.state === 'attack') sawAttack = true;
      if (s.boss.state === 'approach' && ['idle', 'guard'].includes(s.player.state) && (s.dist > minDist || (sawAttack && s.dist > 3.5))) return s;
      if (Date.now() - t0 > timeout) throw new Error(`[${current}] timeout while backing off: ${JSON.stringify(s).slice(0, 500)}`);
      // circling out of reach for a while without the Warden committing: stand still and let it come
      if (!sawAttack && Date.now() - t0 > 2500 && s.boss.state === 'approach') { for (const k in held) await set(k, false); await sleep(25); continue; }
      // head for the far side of the clearing from the Warden, never running into it; the keys are
      // chosen from the camera heading the same way a player reads the screen
      const p = s.player, b = s.boss, br = Math.hypot(b.x, b.z);
      const tx = br > 0.5 ? -b.x / br * 9.6 : (p.x - b.x) / s.dist * 9.6, tz = br > 0.5 ? -b.z / br * 9.6 : (p.z - b.z) / s.dist * 9.6;
      let gx = tx - p.x, gz = tz - p.z; const gl = Math.hypot(gx, gz);
      if (gl < 0.6) { for (const k in held) await set(k, false); await sleep(25); continue; }
      gx /= gl; gz /= gl;
      const ux = (b.x - p.x) / s.dist, uz = (b.z - p.z) / s.dist, fx = Math.sin(s.camera.yaw), fz = Math.cos(s.camera.yaw);
      let best = null;
      for (const f of [-1, 0, 1]) for (const r of [-1, 0, 1]) {
        if (!f && !r) continue;
        const l = Math.hypot(f, r), mx = (fx * f - fz * r) / l, mz = (fz * f + fx * r) / l;
        if (s.dist < 6 && mx * ux + mz * uz > 0.3) continue; // not toward the Warden when it is near
        const score = mx * gx + mz * gz - (s.dist < 6 ? 0.8 * (mx * ux + mz * uz) : 0);
        if (!best || score > best.score) best = { f, r, score };
      }
      if (process.argv.includes('--kite-debug') && Math.random() < 0.05) console.log('kite', s.dist.toFixed(1), b.state, b.x.toFixed(1), b.z.toFixed(1), 'p', p.x.toFixed(1), p.z.toFixed(1), p.state, best.f, best.r, 'yaw', s.camera.yaw.toFixed(2), 'lock', s.camera.lock);
      await set('KeyW', best.f > 0); await set('KeyS', best.f < 0); await set('KeyD', best.r > 0); await set('KeyA', best.r < 0);
      await sleep(25);
    }
  } finally { for (const k in held) await set(k, false); }
}
// Run `fn` in a quiet moment; if the Warden lands a blow meanwhile, back off and try again.
async function quiet(g, label, fn, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const a = await clear(g);
    const before = results.length;
    const r = await fn(a);
    if ((r && r.done) || results.length > before) return r; // the check sampled its own result in time and recorded it
    const b = await g.snap();
    if (b.stats.hitsTaken === a.stats.hitsTaken && b.stats.guards === a.stats.guards && r !== 'retry') return r;
    console.log(`  (retry ${label}: disturbed by the Warden)`);
    await g.until((q) => ['idle', 'guard'].includes(q.player.state) || q.mode !== 'fight', 'recover', 8000);
  }
  throw new Error(`[${current}] no quiet moment for: ${label}`);
}

// Reactive duelling with real inputs: right mouse button for guard/Glance, W + Left Shift for the Bind-Step, F for the Moonwheel.
async function duel(g, stop, label, timeout = 240000, onPrompt) {
  const { page, snap } = g;
  const t0 = Date.now();
  let guardDown = false, guardSeq = -1, wDown = false, thrustSeq = -1, s;
  try {
    for (;;) {
      s = await snap();
      if (stop(s)) return s;
      if (s.mode !== 'fight') throw new Error(`[${current}] fight ended (${s.mode}) before: ${label}; stats ${JSON.stringify(s.stats)}`);
      if (Date.now() - t0 > timeout) throw new Error(`[${current}] timeout in duel before: ${label}: ${JSON.stringify(s).slice(0, 700)}`);
      const h = s.nextHit;
      if (guardDown && (s.hitSeq !== guardSeq || !h)) { await page.mouse.up({ button: 'right' }); guardDown = false; }
      if (s.promptOpen) { if (onPrompt) await onPrompt(s); await page.keyboard.press('KeyF'); await sleep(30); continue; }
      const wantW = s.boss.state === 'broken' && s.dist > 3;
      if (wantW !== wDown) { await page.keyboard[wantW ? 'down' : 'up']('KeyW'); wDown = wantW; }
      if (h && h.type === 'thrust') {
        if (h.inT <= 0.3 && h.inT > 0.03 && thrustSeq !== s.hitSeq && ['idle', 'guard'].includes(s.player.state)) {
          thrustSeq = s.hitSeq;
          await page.keyboard.down('KeyW'); await page.keyboard.press('ShiftLeft'); await sleep(140); await page.keyboard.up('KeyW'); wDown = false;
        }
      } else if (h && !guardDown && h.inT <= 0.19) { await page.mouse.down({ button: 'right' }); guardDown = true; guardSeq = s.hitSeq; }
      await sleep(6);
    }
  } finally {
    if (guardDown) await page.mouse.up({ button: 'right' });
    if (wDown) await page.keyboard.up('KeyW');
  }
}

async function winRun() {
  current = 'win-run';
  // hurt=0.3 reduces damage taken (documented test option) so the unguarded movement/camera
  // checks early in the run cannot end the fight; boss meters and timing windows are unscaled.
  const g = await open('seed=11&q=low&hurt=0.3');
  const { page, snap, until } = g;
  let s = await snap();
  ok(listing.length === 1 && listing[0] === 'play.html', 'temp directory holds only play.html', tmp);
  ok(url.startsWith('file://'), 'loaded over file://');
  ok(s.mode === 'title', 'opening screen is shown');
  ok((await page.title()).includes('苇月剑决') && (await page.title()).includes('Reedmoon Duel'), 'page title is the game title');
  const text = await page.evaluate(() => document.body.innerText);
  ok(!/sekiro/i.test(text) && !/sekiro/i.test(await page.title()), 'engineering id absent from UI text');
  ok(/WASD|W\s*A\s*S\s*D/.test(text.replace(/\n/g, ' ')) && text.includes('Guard') && text.includes('Bind-Step'), 'controls listed on the start screen');
  console.log(`  backend: ${s.backend}, options: ${JSON.stringify(s.options)}`);
  const r0 = await renderStats(page, '01-title');
  ok(r0.colors > 20, 'title scene rendered', JSON.stringify(r0));

  // start with a real mouse click on the Begin button
  const box = await page.locator('#start').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  s = await until((q) => q.mode === 'intro' || q.mode === 'fight', 'intro');
  ok(true, 'mouse click on Begin starts the opening');
  s = await until((q) => q.mode === 'fight', 'fight start');
  ok(await page.locator('#hud').isVisible() && !(await page.locator('#title').isVisible()), 'HUD visible, title hidden');
  const r1 = await renderStats(page, '02-fight');
  ok(r1.colors > 60 && r1.std > 6, '3D scene rendered (varied pixels in canvas region)', JSON.stringify(r1));
  const f0 = s.frames; await sleep(500); s = await snap();
  ok(s.frames > f0 + 2, 'frames advancing', `${s.fps.toFixed(1)} fps`);

  // ---- movement (keyboard)
  for (const key of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
    const a = await snap();
    await page.keyboard.down(key);
    let moved = 0; const t0 = Date.now();
    while (moved < 0.5 && Date.now() - t0 < 4000) { await sleep(40); const b = await snap(); moved = Math.hypot(b.player.x - a.player.x, b.player.z - a.player.z); }
    await page.keyboard.up(key);
    ok(moved >= 0.5, `movement with ${key}`, moved.toFixed(2) + ' units');
  }

  // ---- lock-on camera
  const inView = (q) => q.bossScreen.front && Math.abs(q.bossScreen.x) < 0.8 && Math.abs(q.bossScreen.y) < 0.8 && q.playerScreen.front && Math.abs(q.playerScreen.x) < 0.9 && Math.abs(q.playerScreen.y) < 0.95;
  const facing = (q) => { const dx = q.boss.x - q.camera.x, dz = q.boss.z - q.camera.z, d = Math.hypot(dx, dz); return (Math.sin(q.camera.yaw) * dx + Math.cos(q.camera.yaw) * dz) / d; };
  await sleep(600); s = await snap();
  ok(s.camera.lock === true, 'lock-on is active by default');
  ok(inView(s) && facing(s) > 0.8, 'lock-on frames both fighters', `boss ndc ${s.bossScreen.x},${s.bossScreen.y} player ndc ${s.playerScreen.x},${s.playerScreen.y}`);
  await page.keyboard.down('KeyD');
  let worst = 1;
  const fr = [];
  for (let i = 0; i < 12; i++) { await sleep(90); s = await snap(); if (s.mode === 'fight') { worst = Math.min(worst, facing(s)); fr.push(s.framing); } }
  await page.keyboard.up('KeyD');
  await sleep(500); s = await snap();
  ok(worst > 0.6 && inView(s), 'lock-on keeps tracking while strafing', `min facing ${worst.toFixed(2)}`);
  // duel pass: strafe the other way too (the direction in which the old camera let the Reedcutter cover the Warden)
  await page.keyboard.down('KeyA');
  for (let i = 0; i < 14; i++) { await sleep(90); s = await snap(); if (s.mode === 'fight') fr.push({ ...s.framing, d: s.dist, st: s.player.state + '/' + s.boss.state }); }
  await page.keyboard.up('KeyA');
  const offs = fr.filter((f) => !(f.playerChest.on && f.bossChest.on)).length, cov = fr.filter((f) => f.cover >= 0.34).length;
  ok(fr.length >= 16 && offs === 0, 'both fighters\' upper bodies stay on screen while strafing locked on (both directions)', `${fr.length} samples, ${offs} with a chest off screen`);
  ok(cov <= fr.length * 0.2, 'the Reedcutter does not cover the Warden\'s upper body while strafing locked on', `${cov}/${fr.length} samples covered` + (cov ? ': ' + fr.filter((f) => f.d).map((f) => `${f.d.toFixed(1)}m ${f.cover} ${f.st} cam${f.camDist}`).join(' | ') : ''));
  await sleep(300);
  await page.keyboard.press('KeyQ');
  s = await snap();
  ok(s.camera.lock === false, 'Q releases lock-on (free look)');
  const yaw0 = s.camera.yaw;
  await page.mouse.move(400, 225); await page.mouse.move(150, 225, { steps: 12 });
  await sleep(400); s = await snap();
  const dyaw = Math.abs(Math.atan2(Math.sin(s.camera.yaw - yaw0), Math.cos(s.camera.yaw - yaw0)));
  ok(dyaw > 0.4, 'mouse look turns the free camera without pointer lock', dyaw.toFixed(2) + ' rad');
  const yaw1 = s.camera.yaw;
  await page.keyboard.down('ArrowLeft'); await sleep(500); await page.keyboard.up('ArrowLeft'); await sleep(200);
  s = await snap();
  ok(Math.abs(Math.atan2(Math.sin(s.camera.yaw - yaw1), Math.cos(s.camera.yaw - yaw1))) > 0.15, 'arrow keys turn the free camera');
  await page.mouse.move(400, 225);
  await page.keyboard.press('KeyQ');
  await sleep(1200); s = await snap();
  ok(s.camera.lock === true && inView(s) && facing(s) > 0.8, 'Q re-engages lock-on and re-frames the boss', `facing ${facing(s).toFixed(2)}`);

  // ---- attack (mouse), approach first
  await page.keyboard.down('KeyW');
  await until((q) => q.dist < 2.5 || q.mode !== 'fight', 'closing distance', 20000);
  await page.keyboard.up('KeyW');
  const st0 = (await snap()).stats;
  for (let i = 0; i < 40; i++) {
    await page.mouse.click(400, 240); await sleep(160);
    s = await snap();
    if (s.stats.hitsDealt + s.stats.blocked > st0.hitsDealt + st0.blocked) break;
    if (s.dist > 2.5) { await page.keyboard.down('KeyW'); await sleep(200); await page.keyboard.up('KeyW'); }
  }
  ok(s.stats.swings > st0.swings, 'left mouse button swings', `${s.stats.swings} swings`);
  ok(s.stats.hitsDealt + s.stats.blocked > st0.hitsDealt + st0.blocked, 'attack connects with the boss', `hits ${s.stats.hitsDealt}, blocked ${s.stats.blocked}`);
  const sw = s.stats.swings;
  for (let i = 0; i < 30 && s.stats.swings <= sw && s.mode === 'fight'; i++) { await page.keyboard.press('KeyJ'); await sleep(200); s = await snap(); }
  ok(s.stats.swings > sw, 'J key swings (keyboard binding)');

  // ---- guard (hold right mouse button)
  const g0 = s.stats.guards;
  await page.mouse.down({ button: 'right' });
  s = await until((q) => q.stats.guards > g0 || q.mode !== 'fight', 'a guarded hit', 40000);
  await page.mouse.up({ button: 'right' });
  ok(s.stats.guards > g0 && s.player.stance > 0, 'held guard blocks a hit and fills the player Balance', `balance ${s.player.stance.toFixed(0)}`);

  // ---- deflect, chained deflects, step-in counter, first stance break + finisher
  s = await duel(g, (q) => q.stats.deflects >= 1, 'first Glance');
  ok(s.stats.deflects >= 1 && s.boss.stance > 0, 'Glance (deflect) on a timed guard press fills the boss Balance', `boss balance ${s.boss.stance.toFixed(0)}`);
  let promptSeen = false, p1Moves = null;
  const onPrompt = async (q) => { if (!promptSeen) { promptSeen = await page.locator('#prompt.on').isVisible(); if (q.boss.phase === 1) p1Moves = q.boss.movesSeen[1]; } };
  s = await duel(g, (q) => q.stats.breaks >= 1, 'first stance break', 240000, onPrompt);
  ok(s.boss.state === 'broken' || s.stats.breaks >= 1, 'boss Balance fills: stance break (Unbalanced)');
  await renderStats(page, '03-break');
  s = await duel(g, (q) => q.boss.phase === 2, 'first Moonwheel / phase two', 60000, onPrompt);
  ok(promptSeen, 'finisher prompt shown while the boss is Unbalanced');
  ok(s.stats.finishers === 1 && s.boss.phase === 2, 'first finisher starts phase two');
  ok(s.boss.hp === 100 && s.boss.stance === 0, 'boss recovers health and Balance for phase two');
  ok((await page.locator('#phaseText').innerText()).includes('Second Tide'), 'phase indicator shows the second phase');
  p1Moves = p1Moves || s.boss.movesSeen[1];
  ok(p1Moves.length > 0 && p1Moves.every((m) => !P2_ONLY.includes(m)), 'phase one used only phase-one moves', p1Moves.join(','));
  await renderStats(page, '04-phase2');

  // ---- phase two: changed behaviour, second break, second finisher, victory
  s = await duel(g, (q) => q.mode === 'victory', 'victory', 300000, onPrompt);
  ok(s.boss.movesSeen[2][0] === 'string5', 'phase two opens with a new five-hit string', s.boss.movesSeen[2].join(','));
  ok(s.boss.movesSeen[2].some((m) => P2_ONLY.includes(m)), 'phase two uses moves absent from phase one');
  ok(s.stats.maxChain >= 3, 'chained Glances against a multi-hit string', `longest chain ${s.stats.maxChain}, total ${s.stats.deflects}`);
  ok(s.stats.jumps === 0, 'the fight was won without a single jump (Left Shift never jumps)');
  ok(s.stats.cues >= 1 && s.stats.counters >= 1, 'Bind-Step with W + Left Shift against the dangerous thrust', `${s.stats.counters} of ${s.stats.cues} thrusts countered`);
  ok(s.stats.breaks === 2 && s.stats.finishers === 2, 'second stance break and second finisher');
  ok(s.mode === 'victory' && await page.locator('#result.win').isVisible(), 'victory screen shown');
  ok((await page.locator('#resSub').innerText()).length > 0, 'victory text present');
  console.log('  final stats: ' + JSON.stringify(s.stats) + `, player hp ${s.player.hp.toFixed(0)}`);
  await renderStats(page, '05-victory');

  // ---- retry from victory with the keyboard
  await sleep(600);
  await page.keyboard.press('KeyR'); await page.keyboard.press('Space'); await page.keyboard.press('ShiftLeft');
  await sleep(700); s = await snap();
  ok(s.mode === 'victory' && await page.locator('#result.win').isVisible(), 'R (flask key), Space and Left Shift do nothing on the result screen');
  await page.keyboard.press('Enter');
  s = await until((q) => q.mode === 'fight', 'retry after victory', 20000);
  ok(s.boss.phase === 1 && s.boss.hp === 100 && s.player.hp === 100 && s.stats.deflects === 0 && s.player.flask === 3 && s.stats.drinks === 0, 'Enter restarts the fight from a clean state');
  ok(!(await page.locator('#result').isVisible()), 'result screen hidden after retry');
  await g.context.close();
}

async function lossRun() {
  current = 'loss-run';
  // hurt=0.5 (documented test option) halves damage taken so the flask checks, which need several
  // real wounds, cannot end the fight early; the defeat then follows from standing still
  const g = await open('seed=5&q=low&hurt=0.5');
  const { page, snap, until } = g;
  await page.keyboard.press('Enter');
  let s = await until((q) => q.mode === 'fight', 'fight start via Enter', 30000);
  ok(true, 'Enter key starts the fight');
  // ---- flask at full health: refused, nothing consumed
  await page.keyboard.press('KeyR');
  s = await until((q) => q.stats.drinkFails >= 1, 'flask refusal at full health', 5000);
  ok(s.player.flask === 3 && s.player.hp === 100 && s.stats.drinks === 0 && s.player.state !== 'drink', 'R at full health is refused and consumes nothing', `flask ${s.player.flask}`);
  ok(await page.locator('#callout').innerText().then((t) => /full health/i.test(t)), 'refusal is shown on screen');
  ok(/×3/.test(await page.locator('#flaskN').innerText()), 'HUD shows the remaining flask charges');
  // keyboard guard: hold K through at least one hit
  await page.keyboard.down('KeyK');
  s = await until((q) => q.stats.guards >= 1 || q.mode !== 'fight', 'guarded hit with K', 40000);
  ok(s.stats.guards >= 1 && s.player.state !== 'dead', 'K key guards (keyboard binding)', `balance ${s.player.stance.toFixed(0)}`);
  await page.keyboard.up('KeyK');
  // keyboard dodge registers
  const d0 = s.stats.dodges;
  for (let i = 0; i < 30 && s.stats.dodges <= d0 && s.mode === 'fight'; i++) { await page.keyboard.press('ShiftLeft'); await sleep(200); s = await snap(); }
  ok(s.stats.dodges > d0 && s.stats.jumps === 0, 'Left Shift performs the step (dodge) and does not jump');

  // ---- flask: interrupted by a hit before the sip => nothing consumed, nothing healed
  s = await until((q) => q.stats.hitsTaken >= 1 || q.mode !== 'fight', 'a first wound', 60000);
  ok(s.player.hp < 100 && s.mode === 'fight', 'the Reedcutter is wounded', `hp ${s.player.hp.toFixed(0)}`);
  let broke = null;
  for (let i = 0; i < 8 && !broke; i++) {
    s = await until((q) => q.mode !== 'fight' || (q.nextHit && q.nextHit.inT <= 0.5 && q.nextHit.inT > 0.2 && q.player.state === 'idle' && q.dist < 3.2), 'a blow on its way', 60000);
    if (s.mode !== 'fight') break;
    const a = s;
    await page.keyboard.press('KeyR');
    s = await until((q) => q.hitSeq > a.hitSeq + 0 && !['drink'].includes(q.player.state) || q.mode !== 'fight', 'the blow to arrive', 5000);
    if (s.stats.drinkBreaks > a.stats.drinkBreaks) broke = { a, s };
    await until((q) => q.player.state === 'idle' || q.mode !== 'fight', 'recover', 6000);
  }
  ok(broke && broke.s.player.flask === broke.a.player.flask && broke.s.stats.drinks === broke.a.stats.drinks && broke.s.player.hp < broke.a.player.hp, 'a hit before the sip interrupts the drink: no charge spent, no heal', broke ? `hp ${broke.a.player.hp.toFixed(0)} -> ${broke.s.player.hp.toFixed(0)}, flask ${broke.s.player.flask}` : '');

  // ---- flask: valid drinks until it is empty, one charge and one heal each, never above max; R held down does not repeat
  let verified = 0;
  for (let n = 1; n <= 4; n++) {
    s = await snap();
    if (s.player.flask === 0) break;
    if (s.player.hp >= 100) s = await until((q) => q.stats.hitsTaken > s.stats.hitsTaken || q.mode !== 'fight', 'another wound', 60000);
    const res = await quiet(g, 'drink ' + n, async (a) => {
      if (a.player.flask === 0 || a.player.hp >= 100) return null;
      await page.keyboard.down('KeyR'); // held for the whole drink and beyond
      let q = await until((x) => x.player.state === 'drink' || x.stats.hitsTaken > a.stats.hitsTaken || x.mode !== 'fight', 'drink to start', 4000);
      if (q.player.state !== 'drink') { await page.keyboard.up('KeyR'); return 'retry'; }
      // sample at the sip itself (the first frame in which the drink is counted)
      const b = await until((x) => x.stats.drinks > a.stats.drinks || x.player.state !== 'drink' || x.mode !== 'fight', 'the sip', 6000);
      if (b.stats.drinks === a.stats.drinks || b.stats.hitsTaken > a.stats.hitsTaken) { await page.keyboard.up('KeyR'); return 'retry'; }
      await sleep(1300); const c = await snap(); // R is still held: no second drink may start
      await page.keyboard.up('KeyR');
      return { a, b, c, done: true };
    });
    if (!res) continue;
    const { a, b, c } = res, want = Math.min(100, a.player.hp + 38);
    ok(b.stats.drinks === a.stats.drinks + 1 && b.player.flask === a.player.flask - 1 && c.stats.drinks === b.stats.drinks && c.player.flask === b.player.flask, `drink ${n}: exactly one charge spent while R is held down`, `flask ${a.player.flask} -> ${c.player.flask}`);
    ok(Math.abs(b.player.hp - want) < 0.01 && b.player.hp <= 100, `drink ${n}: healed once, capped at max health`, `hp ${a.player.hp.toFixed(1)} -> ${b.player.hp.toFixed(1)}`);
    verified++;
  }
  s = await snap();
  ok(verified >= 2 && s.player.flask === 0 && s.stats.drinks === 3, 'three charges give three drinks in total', `${verified} checked in a quiet moment`);
  ok(/×0/.test(await page.locator('#flaskN').innerText()) && await page.locator('#flask .gd.on').count() === 0, 'HUD shows the empty flask');
  // ---- empty flask: refused
  s = await snap();
  if (s.player.hp >= 100) s = await until((q) => q.stats.hitsTaken > s.stats.hitsTaken || q.mode !== 'fight', 'a wound for the empty-flask check', 60000);
  await until((q) => ['idle', 'guard'].includes(q.player.state) || q.mode !== 'fight', 'idle', 6000);
  const e0 = await snap();
  for (let i = 0; i < 20; i++) { await page.keyboard.press('KeyR'); await sleep(120); s = await snap(); if (s.stats.drinkFails > e0.stats.drinkFails || s.mode !== 'fight') break; }
  ok(s.stats.drinkFails > e0.stats.drinkFails && s.player.flask === 0 && s.stats.drinks === 3 && s.player.hp <= e0.player.hp, 'R with an empty flask is refused: no heal', `hp ${s.player.hp.toFixed(0)}`);
  // then stand still and lose
  s = await until((q) => q.mode === 'defeat', 'defeat', 120000);
  ok(s.player.hp <= 0 && s.stats.hitsTaken >= 1, 'player health reaches zero', `${s.stats.hitsTaken} hits taken`);
  ok(await page.locator('#result.lose').isVisible(), 'defeat screen shown');
  await renderStats(page, '06-defeat');
  await sleep(600);
  const box = await page.locator('#retry').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  s = await until((q) => q.mode === 'fight', 'retry after defeat', 20000);
  ok(s.player.hp === 100 && s.boss.hp === 100 && s.boss.phase === 1, 'mouse click on Retry restarts the fight');
  ok(s.player.flask === 3 && s.stats.drinks === 0 && /×3/.test(await page.locator('#flaskN').innerText()), 'retry restores the flask charges');
  ok(!(await page.locator('#result').isVisible()), 'result screen hidden after retry');
  const a = s; await page.keyboard.down('KeyA'); await sleep(500); await page.keyboard.up('KeyA'); s = await snap();
  ok(Math.hypot(s.player.x - a.player.x, s.player.z - a.player.z) > 0.3, 'controls work after retry');
  await g.context.close();
}

// Controls pass: Left Shift / Space separation, jump, light vs. charged cut, interruption, pause /
// blur clean-up, audio start / pause / mute / resume, real-time simulation rate.
async function controlsRun() {
  current = 'controls-run';
  // hurt=0.08 (documented test option): this run waits for many quiet moments between the Warden's
  // moves and takes blows on purpose; hits still stagger and interrupt, they just wound less
  const g = await open('seed=11&q=low&hurt=0.08');
  const { page, snap, until } = g;
  let s = await snap();
  ok(s.audio.state === 'none', 'no audio context before the first user gesture', s.audio.state);
  const hint = await page.evaluate(() => document.getElementById('title').innerText + ' ' + document.getElementById('hint').textContent);
  ok(/Shift/.test(hint) && /Jump/.test(hint) && /Reaping Cut/.test(hint) && /Dew Gourd/.test(hint), 'start screen and HUD hint list Left Shift, Jump, the charged cut and the flask');
  await page.keyboard.press('Enter');
  s = await until((q) => q.mode === 'fight', 'fight start', 30000);
  // ---- audio starts on the first gesture and the ambience is running
  s = await until((q) => q.audio.state === 'running' && q.audio.time > 0.5 && q.audio.drops > 0, 'audio running', 10000);
  ok(true, 'audio unlocked by the first key press: context running, ambience drops being scheduled', `t=${s.audio.time.toFixed(1)}s, ${s.audio.drops} drops, wind ${s.audio.wind.toFixed(2)}`);

  // ---- Left Shift steps, Space jumps, neither triggers the other (the Warden is still far away)
  let a = await snap();
  await page.keyboard.press('ShiftLeft');
  s = await until((q) => q.stats.dodges > a.stats.dodges, 'step', 4000);
  ok(s.stats.jumps === a.stats.jumps && s.player.y === 0, 'Left Shift steps and does not jump');
  s = await until((q) => q.player.state === 'idle', 'idle after the step', 4000);
  a = s;
  await page.keyboard.down('Space'); // held down well past the landing
  let peak = 0, sawAir = false;
  s = await until((q) => { peak = Math.max(peak, q.player.y); sawAir = sawAir || q.player.state === 'air'; return q.stats.lands > a.stats.lands; }, 'jump and landing', 5000);
  ok(s.stats.jumps === a.stats.jumps + 1 && s.stats.dodges === a.stats.dodges, 'Space jumps and does not step');
  ok(sawAir && peak > 0.3, 'the Reedcutter leaves the ground', `highest sampled y ${peak.toFixed(2)} m`);
  s = await until((q) => q.player.state === 'idle' && q.player.y === 0, 'landed', 4000);
  await sleep(900); s = await snap();
  await page.keyboard.up('Space');
  ok(s.stats.jumps === a.stats.jumps + 1 && s.player.y === 0, 'holding Space does not jump again (edge-triggered)');
  a = s; await page.keyboard.down('KeyA'); await sleep(350); await page.keyboard.up('KeyA'); s = await snap();
  ok(Math.hypot(s.player.x - a.player.x, s.player.z - a.player.z) > 0.3, 'normal movement returns after landing');

  // ---- real-time simulation: sim seconds per wall-clock second while fighting
  a = await snap(); await sleep(3000); s = await snap();
  const rate = (s.time - a.time) / ((s.now - a.now) / 1000);
  ok(s.mode === 'fight' && rate > 0.93 && rate < 1.07, 'the simulation advances in real time at this frame rate', `${rate.toFixed(3)} sim s per wall s at ${s.fps.toFixed(1)} fps, ${((s.steps - a.steps) / (s.frames - a.frames)).toFixed(1)} steps per frame`);

  // ---- short press: one light cut; three presses: the combo; no heavy from taps
  await quiet(g, 'light cut', async (q0) => {
    await page.keyboard.press('KeyJ');
    const q = await until((x) => x.stats.swings > q0.stats.swings, 'J tap swing', 3000);
    await until((x) => x.player.state === 'idle', 'cut to finish', 3000);
    const q1 = await snap();
    ok(q1.stats.swings === q0.stats.swings + 1 && q1.stats.heavies === q0.stats.heavies && q.player.state !== 'charge', 'a short J press is one light cut, no charge');
  });
  await quiet(g, 'combo', async (q0) => {
    const combos = new Set();
    for (let i = 0; i < 3; i++) {
      await page.mouse.click(400, 240);
      const t0 = Date.now(); while (Date.now() - t0 < 230) { const q = await snap(); if (q.player.state === 'attack') combos.add(q.player.combo); await sleep(15); }
    }
    await until((x) => x.player.state === 'idle', 'combo to finish', 3000);
    const q1 = await snap();
    if (q1.stats.hitsTaken !== q0.stats.hitsTaken) return 'retry';
    ok(q1.stats.swings === q0.stats.swings + 3 && q1.stats.heavies === q0.stats.heavies && combos.size >= 2, 'three quick clicks give three light cuts (combo steps)', `combo steps seen ${[...combos].join(',')}`);
  });

  // ---- hold to charge, release for the heavy (mouse and J behave the same)
  for (const [name, down, up] of [['left mouse', () => page.mouse.down(), () => page.mouse.up()], ['J key', () => page.keyboard.down('KeyJ'), () => page.keyboard.up('KeyJ')]]) {
    await quiet(g, 'charge with ' + name, async (q0) => {
      await down();
      try {
        let q = await until((x) => x.player.state === 'charge' || x.stats.hitsTaken > q0.stats.hitsTaken, 'charge state', 3000);
        if (q.player.state !== 'charge') return 'retry';
        q = await until((x) => x.player.chargeFull || x.player.state !== 'charge', 'full charge', 3000);
        if (!q.player.chargeFull) return 'retry';
        const cue = await page.locator('#charge.full').isVisible();
        await up();
        q = await until((x) => x.stats.heavies > q0.stats.heavies || x.stats.hitsTaken > q0.stats.hitsTaken, 'heavy cut', 3000);
        if (q.stats.heavies === q0.stats.heavies) return 'retry';
        ok(q.stats.heavies === q0.stats.heavies + 1 && q.stats.swings === q0.stats.swings + 1 && q.stats.chargeFulls === q0.stats.chargeFulls + 1, `holding ${name} charges; releasing after the cue gives exactly one heavy cut and no light cut`);
        ok(cue, `the "fully charged" cue is shown (${name})`);
      } finally { await up(); }
    });
  }
  // ---- released before the threshold: an ordinary cut, no heavy
  await quiet(g, 'early release', async (q0) => {
    await page.mouse.down(); await sleep(330); await page.mouse.up();
    await until((x) => x.player.state === 'idle' && x.stats.swings > q0.stats.swings, 'cut to finish', 4000);
    const q1 = await snap();
    if (q1.stats.hitsTaken !== q0.stats.hitsTaken) return 'retry';
    ok(q1.stats.heavies === q0.stats.heavies && q1.stats.swings === q0.stats.swings + 1, 'released before the threshold: one ordinary cut, no heavy');
  });

  // ---- pause clears a held charge and a jump; audio pauses and resumes; mute silences the output
  await quiet(g, 'pause', async (q0) => {
    await page.keyboard.down('KeyJ');
    let q = await until((x) => x.player.state === 'charge' || x.stats.hitsTaken > q0.stats.hitsTaken, 'charge before pause', 3000);
    if (q.player.state !== 'charge') { await page.keyboard.up('KeyJ'); return 'retry'; }
    await page.keyboard.press('KeyP');
    q = await until((x) => x.paused, 'paused', 3000);
    const vis = await page.locator('#pause').isVisible();
    await sleep(500); const q2 = await snap();
    await page.keyboard.up('KeyJ'); await page.keyboard.press('Space'); await page.keyboard.press('KeyR'); await page.keyboard.press('ShiftLeft');
    await sleep(300); const q3 = await snap();
    ok(vis && q2.player.state === 'idle' && q3.time === q2.time && q3.steps === q2.steps, 'P pauses: overlay shown, simulation frozen, the charge is dropped');
    ok(q3.stats.jumps === q0.stats.jumps && q3.stats.dodges === q0.stats.dodges && q3.stats.heavies === q0.stats.heavies && q3.stats.drinkFails === q0.stats.drinkFails, 'keys pressed while paused do nothing');
    ok(q3.audio.state === 'suspended' && Math.abs(q3.audio.time - q2.audio.time) < 0.05, 'audio is suspended while paused', `context ${q3.audio.state}`);
    await page.keyboard.press('KeyP');
    q = await until((x) => !x.paused && x.audio.state === 'running' && x.time > q3.time + 0.2, 'resume', 5000);
    ok(q.stats.heavies === q0.stats.heavies && q.player.state !== 'charge' && q.player.state !== 'heavy', 'P resumes: no cut fires from the dropped charge, audio running again');
  });
  await page.keyboard.press('KeyM'); await sleep(400); s = await snap();
  ok(s.audio.muted && s.audio.masterGain === 0 && s.audio.peak === 0 && await page.locator('#muteTag').isVisible(), 'M mutes: master gain 0, measured output peak 0');
  await page.keyboard.press('KeyM');
  s = await until((q) => !q.audio.muted && q.audio.masterGain > 0 && q.audio.peak > 0, 'unmute', 6000);
  ok(true, 'M again restores the sound', `output peak ${s.audio.peak.toFixed(4)}`);
  // jump, then a window blur mid-air: the jump is dropped, the fighter is on the ground, input still works
  await quiet(g, 'blur', async (q0) => {
    await page.keyboard.down('KeyJ');
    let q = await until((x) => x.player.state === 'charge' || x.stats.hitsTaken > q0.stats.hitsTaken, 'charge before blur', 3000);
    if (q.player.state !== 'charge') { await page.keyboard.up('KeyJ'); return 'retry'; }
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await sleep(250); q = await snap(); await page.keyboard.up('KeyJ'); await sleep(400); const q2 = await snap();
    if (q2.stats.hitsTaken !== q0.stats.hitsTaken) return 'retry';
    ok(q.player.state !== 'charge' && q2.stats.heavies === q0.stats.heavies, 'window blur drops the charge; releasing afterwards fires nothing');
  });

  // ---- a hit interrupts the charge: no cut comes out
  let broke = null;
  for (let i = 0; i < 10 && !broke; i++) {
    s = await until((q) => q.mode !== 'fight' || (q.nextHit && q.nextHit.type !== 'thrust' && q.nextHit.inT <= 0.6 && q.nextHit.inT > 0.3 && q.player.state === 'idle' && q.dist < 3.3), 'a blow on its way', 90000);
    const q0 = s;
    await page.mouse.down();
    s = await until((q) => q.stats.hitsTaken > q0.stats.hitsTaken || q.stats.guards > q0.stats.guards || q.hitSeq > q0.hitSeq + 3 || q.stats.heavies > q0.stats.heavies, 'the blow', 6000);
    await sleep(120); await page.mouse.up();
    s = await until((q) => q.player.state === 'idle', 'recover', 6000);
    await sleep(700); const q1 = await snap();
    if (q1.stats.chargeBreaks > q0.stats.chargeBreaks && q1.stats.heavies === q0.stats.heavies) broke = { q0, q1 };
  }
  ok(!!broke, 'a hit during the charge interrupts it: no heavy cut, state back to normal', broke ? `charge breaks ${broke.q1.stats.chargeBreaks}, heavies ${broke.q1.stats.heavies}` : '');

  // ---- a charged cut that reaches the Warden registers (hit or beaten-down guard)
  let landed = null;
  for (let i = 0; i < 16 && !landed; i++) {
    // stand and guard through one of the Warden's moves; the pause it takes afterwards (0.9 s or
    // more, then a wind-up) is longer than the 0.83 s a charged cut needs
    await page.mouse.down({ button: 'right' });
    await until((q) => q.mode !== 'fight' || q.boss.state === 'attack', 'the Warden to attack', 60000);
    await until((q) => q.mode !== 'fight' || q.boss.state !== 'attack', 'its move to end', 20000);
    await page.mouse.up({ button: 'right' });
    s = await snap();
    if (s.boss.state !== 'approach' || !['idle', 'guard'].includes(s.player.state) || s.dist > 3.8) { await until((q) => ['idle', 'guard'].includes(q.player.state) || q.mode !== 'fight', 'recover', 6000); continue; }
    const q0 = s;
    await page.keyboard.down('KeyW'); await page.keyboard.down('KeyJ');
    await until((q) => q.stats.swings > q0.stats.swings || q.stats.hitsTaken > q0.stats.hitsTaken, 'the press to register', 2000).catch(() => {});
    s = await until((q) => q.player.chargeFull || q.stats.hitsTaken > q0.stats.hitsTaken || (q.player.state !== 'charge' && q.player.state !== 'attack'), 'charge', 3000);
    await page.keyboard.up('KeyJ'); await page.keyboard.up('KeyW');
    await sleep(600); s = await until((q) => ['idle', 'guard', 'stagger'].includes(q.player.state), 'recover', 5000);
    if (s.stats.heavyHits > q0.stats.heavyHits) landed = { q0, s };
  }
  ok(!!landed && (landed.s.boss.hp < landed.q0.boss.hp), 'a charged cut that reaches the Warden deals damage', landed ? `boss hp ${landed.q0.boss.hp.toFixed(0)} -> ${landed.s.boss.hp.toFixed(0)}, balance ${landed.q0.boss.stance.toFixed(0)} -> ${landed.s.boss.stance.toFixed(0)}` : '');
  await renderStats(page, '07-controls');
  await g.context.close();
}

const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
let failed = null;
try {
  if (!only || only === 'win') { console.log('win run'); await winRun(); }
  if (!only || only === 'loss') { console.log('loss run'); await lossRun(); }
  if (!only || only === 'controls') { console.log('controls run'); await controlsRun(); }
  current = 'global';
  ok(external.length === 0, 'no network requests attempted', external.slice(0, 3).join(' '));
  ok(pageErrors.length === 0, 'no uncaught page errors', pageErrors.slice(0, 3).join(' | '));
} catch (e) { failed = e; }
await browser.close();
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
if (pageErrors.length) console.error('page errors:\n' + pageErrors.join('\n'));
if (failed) { console.error('\n' + failed.message); console.error(`\nFAILED after ${results.length} passed checks`); process.exit(1); }
console.log(`\nPASSED ${results.length} checks, 0 page errors`);
