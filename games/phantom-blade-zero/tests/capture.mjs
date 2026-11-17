// Evidence capture for the controls / motion / rain-audio pass of 雨巷双刃 / Rainlane Blades.
//
//   node tests/capture.mjs            (after "npm run build")
//
// Opens dist/play.html via file:// with the documented `rec` hash option and drives it with real
// keyboard input only. Writes into compare/controls/:
//   gameplay.webm            one gameplay clip (canvas + the game's heard audio, MediaRecorder in the page)
//   ambience.wav             the rain bed alone (ambience bus as heard), walking between zones
//   frame-*.png              page screenshots taken during the clip (jump, charge, heavy, drink, boss attack)
//   audio-measurements.json  measured levels (peak, RMS, clipped samples) of the captured mix
// Nothing here is listened to by a person; the numbers are measurements of the captured signal.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.join(root, 'compare', 'controls');
fs.mkdirSync(out, { recursive: true });
const dist = path.join(root, 'dist', 'play.html');
if (!fs.existsSync(dist)) { console.error('dist/play.html not found — run "npm run build" first'); process.exit(1); }
const argv = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const audio = ['--autoplay-policy=no-user-gesture-required'];
  if (!argv.includes('shell')) {
    const args = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu', ...audio];
    if (process.platform === 'win32') args.push('--use-angle=d3d11');
    for (let i = 0; i < 2; i++) {
      try {
        return { browser: await chromium.launch({ channel: 'chromium', headless: true, args }), kind: 'full Chromium build (GPU flags)' };
      } catch (e) {
        console.log('full Chromium build not launchable:', String(e.message).split(/\r?\n/)[0]);
        await sleep(1500);
      }
    }
  }
  return { browser: await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...audio] }), kind: 'headless shell (software GL)' };
}

const { browser, kind } = await launch();
const errors = [];
async function open(hash) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERROR', e.message); });
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  await page.goto(pathToFileURL(dist).href + '#' + hash);
  await page.waitForFunction(() => !!window.__game && window.__game.snapshot().frames > 10, null, { timeout: 60000 });
  await page.mouse.move(640, 360);
  const held = new Set();
  const h = {
    page,
    snap: () => page.evaluate(() => window.__game.snapshot()),
    events: (since = -1) => page.evaluate((s) => window.__game.events(s), since),
    hold: async (k) => { if (!held.has(k)) { held.add(k); await page.keyboard.down(k); } },
    rel: async (k) => { if (held.has(k)) { held.delete(k); await page.keyboard.up(k); } },
    relAll: async () => { for (const k of [...held]) { held.delete(k); await page.keyboard.up(k); } },
    press: (k) => page.keyboard.press(k),
    async until(fn, timeout, label, every = 15) {
      const t0 = Date.now();
      for (;;) {
        const s = await h.snap();
        if (await fn(s)) return s;
        if (Date.now() - t0 > timeout) throw new Error('timed out waiting for: ' + label);
        await sleep(every);
      }
    },
    async capture(bus, ms, withWav) {
      await page.evaluate((b) => window.__rec.captureStart(b), bus);
      await sleep(ms);
      return page.evaluate((w) => window.__rec.captureStop(w), !!withWav);
    },
  };
  return h;
}
const dist2 = (s) => Math.hypot(s.player.x - s.boss.x, s.player.z - s.boss.z);

// ---------------------------------------------------------------- 1. measurements + ambience.wav
const report = { browser: kind, note: 'Measured from the captured signal; not listened to by a person.' };
{
  const g = await open('seed=7&php=8&rec&nomusic');
  const s0 = await g.snap();
  report.backend = s0.backend;
  console.log(`browser: ${kind}; backend ${s0.backend}`);
  await g.press('Enter');
  await g.until((s) => s.mode === 'fight' && s.audio.state === 'running', 8000, 'fight + audio running');
  await sleep(1200);

  // rain bed alone at the output, standing still in the lane (no music, no cues)
  const still = await g.capture('out', 6000, false);
  report.ambienceAloneLaneOutput = { ...still.stats, zones: (await g.snap()).audio.zones };
  console.log('ambience alone (output, standing in the lane):', JSON.stringify(still.stats));

  // ambience.wav: the rain bus while walking lane -> lane mouth (open sky) -> along an eave -> back
  await g.page.evaluate(() => window.__rec.captureStart('amb'));
  const zonesSeen = [];
  const note = async (label) => { const s = await g.snap(); zonesSeen.push({ label, x: +s.player.x.toFixed(2), z: +s.player.z.toFixed(2), ...Object.fromEntries(Object.entries(s.audio.zones).map(([k, v]) => [k, +v.toFixed(2)])) }); };
  const t0 = Date.now();
  await note('deep lane');
  await sleep(3000);
  await g.hold('KeyW');
  await g.until((s) => s.player.z < 7.75, 20000, 'lane mouth');
  await g.rel('KeyW');
  await note('lane mouth (open yard side)');
  await sleep(5000);
  await g.hold('KeyS');
  await g.until((s) => s.player.z > 11.5, 20000, 'back into the lane');
  await g.rel('KeyS');
  await g.hold('KeyD');
  await sleep(900);
  await g.rel('KeyD');
  await note('under the lane eave (wall side)');
  await sleep(4500);
  await g.hold('KeyS');
  await g.until((s) => s.player.z > 16.5, 20000, 'far end of the lane');
  await g.rel('KeyS');
  await note('far end of the lane');
  while (Date.now() - t0 < 21000) await sleep(100);
  const amb = await g.page.evaluate(() => window.__rec.captureStop(true));
  fs.writeFileSync(path.join(out, 'ambience.wav'), Buffer.from(amb.wav, 'base64'));
  report.ambienceWav = { file: 'compare/controls/ambience.wav', bus: 'rain bus after ducking/tone filter, before master', ...amb.stats, walk: zonesSeen };
  console.log('ambience.wav:', JSON.stringify(amb.stats), JSON.stringify(zonesSeen));

  // into the yard: rain bed alone in the open (output), before the boss has finished its entrance
  await g.hold('KeyW');
  await g.until((s) => s.engaged, 20000, 'engaged');
  await g.rel('KeyW');

  // the mix with combat cues: fight for a while with real input, capturing the output
  await g.page.evaluate(() => window.__rec.captureStart('out'));
  const tf = Date.now();
  let lastJ = 0;
  while (Date.now() - tf < 26000) {
    const s = await g.snap();
    const b = s.boss, p = s.player, d = dist2(s);
    if (b.st === 'attack') { await g.rel('KeyW'); await g.rel('KeyJ'); await g.hold('KeyK'); } else {
      await g.rel('KeyK');
      if (d > 2.3) await g.hold('KeyW'); else await g.rel('KeyW');
      if (b.st === 'recover' && d < 2.8 && p.st === 'idle' && Date.now() - lastJ > 120) { lastJ = Date.now(); await g.press('KeyJ'); }
      if (b.st === 'idle' && p.st === 'idle' && p.hp < p.maxHp && p.flask > 1 && d > 3) await g.press('KeyR');
      if (b.st === 'idle' && p.st === 'idle' && d > 4 && Math.random() < 0.05) await g.press('Space');
    }
    await sleep(15);
  }
  await g.relAll();
  const fight = await g.page.evaluate(() => window.__rec.captureStop(false));
  const evs = await g.events(-1);
  const kinds = {};
  for (const e of evs) kinds[e.type] = (kinds[e.type] || 0) + 1;
  report.withCombatCuesOutput = { ...fight.stats, eventsDuringFight: kinds };
  console.log('with combat cues (output):', JSON.stringify(fight.stats));

  // the rain bus during combat (ducked) for comparison with the lane walk
  await g.page.evaluate(() => window.__rec.captureStart('amb'));
  const td = Date.now();
  while (Date.now() - td < 9000) {
    const s = await g.snap();
    if (s.boss.st === 'attack') { await g.rel('KeyW'); await g.hold('KeyK'); } else { await g.rel('KeyK'); if (dist2(s) > 2.3) await g.hold('KeyW'); else await g.rel('KeyW'); }
    await sleep(15);
  }
  await g.relAll();
  const duck = await g.page.evaluate(() => window.__rec.captureStop(false));
  report.rainBusDuringCombat = { ...duck.stats, zones: (await g.snap()).audio.zones };
  console.log('rain bus during combat:', JSON.stringify(duck.stats));

  // muted (M): the output after the mute gain
  await g.press('KeyM');
  await sleep(600);
  const muted = await g.capture('out', 2500, false);
  report.muted = { ...muted.stats, audio: (await g.snap()).audio };
  console.log('muted:', JSON.stringify(muted.stats));
  await g.press('KeyM');
  await sleep(300);
  // paused (P): the audio clock is suspended, so no samples are produced at all
  await g.press('KeyP');
  await sleep(500);
  const a1 = (await g.snap()).audio;
  const paused = await g.capture('out', 2000, false);
  const a2 = (await g.snap()).audio;
  report.paused = { ...paused.stats, audioState: a2.state, audioClockAdvanced: +(a2.time - a1.time).toFixed(4) };
  console.log('paused:', JSON.stringify(report.paused));
  await g.press('KeyP');
  await g.until((s) => !s.paused && s.audio.state === 'running', 5000, 'resumed');
  const resumed = await g.capture('out', 2000, false);
  report.resumed = resumed.stats;
  console.log('resumed:', JSON.stringify(resumed.stats));
  report.fpsMeasure = (await g.snap()).fps;
  await g.page.close();
}

// ---------------------------------------------------------------- 2. gameplay clip
{
  const g = await open('seed=7&php=6&rec');
  await g.press('Enter');
  await g.until((s) => s.mode === 'fight' && s.audio.state === 'running', 8000, 'fight + audio running');
  await sleep(400);
  const info = await g.page.evaluate(() => window.__rec.videoStart(1500000));
  const shot = async (name) => { await g.page.screenshot({ path: path.join(out, `frame-${name}.png`) }); console.log('frame', name); };
  const done = {};
  const tStart = Date.now();
  // run down the lane, jump on the way
  await g.hold('KeyW');
  await g.until((s) => s.player.z < 12.2, 15000, 'running');
  await shot('run');
  await g.press('Space');
  await g.until((s) => s.player.st === 'air' && s.player.y > 0.55, 5000, 'airborne');
  await shot('jump');
  done.jump = true;
  await g.until((s) => s.engaged, 20000, 'engaged');
  await g.rel('KeyW');
  await g.until((s) => s.boss.st !== 'intro', 8000, 'boss ready');
  let fps = [];
  // the fight: guard attacks, charge a heavy into each recovery, drink once hurt, jump a lunge
  let lastJ = 0;
  while (Date.now() - tStart < 34000 && !(done.heavy && done.drink && done.boss && Date.now() - tStart > 24000)) {
    const s = await g.snap();
    fps.push(s.fps);
    const b = s.boss, p = s.player, d = dist2(s);
    if (p.st === 'charge' || p.st === 'heavy') {
      if (p.st === 'charge' && p.charged) {
        if (!done.chargedShot) { done.chargedShot = true; await shot('charged'); }
        await g.rel('KeyJ');
        const hv = await g.until((q) => q.player.st !== 'charge', 2000, 'released');
        if (hv.player.st === 'heavy') {
          await g.until((q) => q.player.st !== 'heavy' || q.time > hv.time + 0.2, 2000, 'heavy cut');
          await shot('heavy');
          done.heavy = true;
        }
      }
    } else if (p.st === 'drink') {
      if (!done.drinkShot && s.player.st === 'drink') { await sleep(380); done.drinkShot = true; await shot('drink'); }
      done.drink = true;
    } else if (b.st === 'attack') {
      await g.rel('KeyW');
      if (!done.boss && b.seg === 'hold') { done.boss = true; await shot('boss-attack'); }
      if (b.move === 'lunge' && b.hitIn >= 0 && b.hitIn < 0.16 && p.st === 'idle') { await g.rel('KeyK'); await g.press('Space'); } else if (s.stats.hurt > 0 || b.move !== 'chain') await g.hold('KeyK'); // (the first chain is taken on the chin, so there is something to heal)
    } else {
      await g.rel('KeyK');
      if (d > 2.4) await g.hold('KeyW'); else await g.rel('KeyW');
      if (p.st === 'idle' && p.hp < p.maxHp - 20 && !done.drink && b.st === 'recover') { await g.rel('KeyW'); await g.press('KeyR'); } else if (b.st === 'recover' && d < 2.9 && p.st === 'idle') {
        if (!done.heavy) await g.hold('KeyJ'); else if (Date.now() - lastJ > 110) { lastJ = Date.now(); await g.press('KeyJ'); }
      }
    }
    await sleep(12);
  }
  await g.relAll();
  await sleep(1200);
  const res = await g.page.evaluate(() => window.__rec.videoStop());
  fs.writeFileSync(path.join(out, 'gameplay.webm'), Buffer.from(res.data, 'base64'));
  const s = await g.snap();
  fps = fps.filter((v) => v > 0).sort((a, b) => a - b);
  report.gameplayClip = {
    file: 'compare/controls/gameplay.webm', bytes: res.size, mime: info.type, audioTracksAtStart: info.audioTracks,
    decodedAudioTrack: res.track, seconds: +((Date.now() - tStart) / 1000).toFixed(1), shown: done,
    stats: { jumps: s.stats.jumps, heavies: s.stats.heavies, heavyHits: s.stats.heavyHits, heals: s.stats.heals, bossMoves: s.stats.bossMoves, hurt: s.stats.hurt },
    backend: s.backend, fpsMedian: fps[Math.floor(fps.length / 2)] || 0, fpsMin: fps[0] || 0,
  };
  console.log('gameplay.webm:', JSON.stringify({ ...report.gameplayClip }));
  await g.page.close();
}

fs.writeFileSync(path.join(out, 'audio-measurements.json'), JSON.stringify(report, null, 2) + '\n');
await browser.close();
if (errors.length) { console.error('page errors:', errors); process.exit(1); }
const t = report.gameplayClip.decodedAudioTrack;
if (!t || t.error || !(t.rms > 0.0005)) { console.error('gameplay.webm has no usable audio track:', JSON.stringify(t)); process.exit(1); }
if (report.gameplayClip.bytes > 8 * 1024 * 1024) { console.error('gameplay.webm is larger than 8 MB'); process.exit(1); }
console.log('done');
