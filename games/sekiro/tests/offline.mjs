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

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
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
  await page.goto(url + '#' + hash);
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

// Reactive duelling with real inputs: right mouse button for guard/Glance, W+Space for the Bind-Step, F for the Moonwheel.
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
          await page.keyboard.down('KeyW'); await page.keyboard.press('Space'); await sleep(140); await page.keyboard.up('KeyW'); wDown = false;
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
  for (let i = 0; i < 12; i++) { await sleep(90); s = await snap(); if (s.mode === 'fight') worst = Math.min(worst, facing(s)); }
  await page.keyboard.up('KeyD');
  await sleep(500); s = await snap();
  ok(worst > 0.6 && inView(s), 'lock-on keeps tracking while strafing', `min facing ${worst.toFixed(2)}`);
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
  ok(s.stats.cues >= 1 && s.stats.counters >= 1, 'Bind-Step (step-in counter) against the dangerous thrust', `${s.stats.counters} of ${s.stats.cues} thrusts countered`);
  ok(s.stats.breaks === 2 && s.stats.finishers === 2, 'second stance break and second finisher');
  ok(s.mode === 'victory' && await page.locator('#result.win').isVisible(), 'victory screen shown');
  ok((await page.locator('#resSub').innerText()).length > 0, 'victory text present');
  console.log('  final stats: ' + JSON.stringify(s.stats) + `, player hp ${s.player.hp.toFixed(0)}`);
  await renderStats(page, '05-victory');

  // ---- retry from victory with the keyboard
  await sleep(600);
  await page.keyboard.press('KeyR');
  s = await until((q) => q.mode === 'fight', 'retry after victory', 20000);
  ok(s.boss.phase === 1 && s.boss.hp === 100 && s.player.hp === 100 && s.stats.deflects === 0, 'R restarts the fight from a clean state');
  ok(!(await page.locator('#result').isVisible()), 'result screen hidden after retry');
  await g.context.close();
}

async function lossRun() {
  current = 'loss-run';
  // hurt=1.5 raises damage taken so the defeat arrives quickly (documented test option)
  const g = await open('seed=5&q=low&hurt=1.5');
  const { page, snap, until } = g;
  await page.keyboard.press('Enter');
  let s = await until((q) => q.mode === 'fight', 'fight start via Enter', 30000);
  ok(true, 'Enter key starts the fight');
  // keyboard guard: hold K through at least one hit
  await page.keyboard.down('KeyK');
  s = await until((q) => q.stats.guards >= 1 || q.mode !== 'fight', 'guarded hit with K', 40000);
  ok(s.stats.guards >= 1 && s.player.state !== 'dead', 'K key guards (keyboard binding)', `balance ${s.player.stance.toFixed(0)}`);
  await page.keyboard.up('KeyK');
  // keyboard dodge registers
  const d0 = s.stats.dodges;
  for (let i = 0; i < 30 && s.stats.dodges <= d0 && s.mode === 'fight'; i++) { await page.keyboard.press('Space'); await sleep(200); s = await snap(); }
  ok(s.stats.dodges > d0, 'Space performs the step (dodge)');
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
  ok(!(await page.locator('#result').isVisible()), 'result screen hidden after retry');
  const a = s; await page.keyboard.down('KeyA'); await sleep(500); await page.keyboard.up('KeyA'); s = await snap();
  ok(Math.hypot(s.player.x - a.player.x, s.player.z - a.player.z) > 0.3, 'controls work after retry');
  await g.context.close();
}

let failed = null;
try {
  console.log('win run'); await winRun();
  console.log('loss run'); await lossRun();
  current = 'global';
  ok(external.length === 0, 'no network requests attempted', external.slice(0, 3).join(' '));
  ok(pageErrors.length === 0, 'no uncaught page errors', pageErrors.slice(0, 3).join(' | '));
} catch (e) { failed = e; }
await browser.close();
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
if (pageErrors.length) console.error('page errors:\n' + pageErrors.join('\n'));
if (failed) { console.error('\n' + failed.message); console.error(`\nFAILED after ${results.length} passed checks`); process.exit(1); }
console.log(`\nPASSED ${results.length} checks, 0 page errors`);
