// Evidence capture for the duel readability / characters / steel audio pass, driven with real input.
// usage: node tests/duel-evidence.mjs <before|after> [--gl] [--shots] [--clip]
// Writes into compare/duel/ (1280x720, default quality, fixed seed):
//   <prefix>-title.png, -explore.png, -combat.png (locked on, Warden in a wind-up),
//   <prefix>-character-lock.png (both at normal lock distance), -character-close.png (close crop of both)
//   before.webm | gameplay.webm  clip with game audio (in-page MediaRecorder hook, #rec=1): a whiff, locked-on
//                                strafing both ways, one Warden move taken unguarded (wind-up -> strike -> direct
//                                hit), a held guard, a Glance
//   review/<prefix>-clip-*.png   frames read back out of the clip;  <prefix>-clip.json  what the clip contains
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);
const prefix = args.find((a) => !a.startsWith('--')) || 'after';
const only = args.includes('--shots') ? 'shots' : args.includes('--clip') ? 'clip' : 'all';
const outDir = path.join(root, 'compare', 'duel'), revDir = path.join(outDir, 'review');
fs.mkdirSync(revDir, { recursive: true });
const built = path.join(root, 'dist', 'play.html');
if (!fs.existsSync(built)) { console.error('dist/play.html missing — run `npm run build` first'); process.exit(1); }
const GPU = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'];
const SOFT = { name: 'bundled Chromium, SwiftShader', opts: { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }, gl: '&gl=1' };
const attempts = args.includes('--gl') ? [SOFT] : [{ name: 'Chrome (channel) with WebGPU flags', opts: { channel: 'chrome', args: GPU }, gl: '' }, { name: 'bundled Chromium with WebGPU flags', opts: { args: GPU }, gl: '' }, SOFT];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser, used;
async function open(hash) {
  for (const a of used ? [used] : attempts) {
    try {
      if (!browser) browser = await chromium.launch(a.opts);
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      page.on('pageerror', (e) => { console.log('PAGEERROR', e.message); process.exitCode = 1; });
      await page.goto(pathToFileURL(built).href + '#' + hash + a.gl);
      await page.waitForFunction(() => window.__game && window.__game.snap.frames > 20, null, { timeout: 45000 });
      used = a;
      const snap = () => page.evaluate(() => window.__game.snap);
      const until = async (cond, label, timeout = 40000) => { const t0 = Date.now(); let s; for (;;) { s = await snap(); if (cond(s)) return s; if (Date.now() - t0 > timeout) throw new Error('timeout: ' + label); await sleep(8); } };
      return { page, snap, until };
    } catch (e) {
      console.log(`launch attempt failed (${a.name}): ${String(e.message).split('\n')[0]}`);
      if (browser) await browser.close().catch(() => {});
      browser = null;
    }
  }
  throw new Error('no browser could render the game');
}
const out = (n) => path.join(outDir, `${prefix}-${n}.png`);

// ---------------------------------------------------------------- stills
if (only !== 'clip') {
  const { page, snap, until } = await open('seed=3&hurt=0.05&mute=1');
  let s = await snap();
  console.log(`browser: ${used.name}; render backend: ${s.backend}`);
  await sleep(1500);
  await page.screenshot({ path: out('title') });
  // exploration: free camera, pitch lowered a little with the mouse, running left
  await page.mouse.move(640, 400);
  await page.keyboard.press('Enter');
  s = await until((q) => q.mode === 'fight', 'fight start');
  const tFight = s.time;
  await page.keyboard.press('KeyQ');
  await page.mouse.move(640, 352, { steps: 6 });
  await page.keyboard.down('KeyA');
  await until((q) => q.time >= tFight + 0.75, 'explore time');
  await page.screenshot({ path: out('explore') });
  await page.keyboard.up('KeyA');
  // combat: locked on, guard held, Warden in the wind-up of the first blow of a move, 3-5 m if it happens
  await page.keyboard.press('KeyQ');
  await page.mouse.down({ button: 'right' });
  const wind = (lo, hi) => (q) => q.nextHit && q.nextHit.idx === 0 && q.nextHit.inT < 0.42 && q.nextHit.inT > 0.1 && q.dist >= lo && q.dist < hi;
  s = await until(wind(3, 5), 'wind-up at 3-5 m', 20000).catch(() => until(wind(0, 6), 'wind-up'));
  await page.screenshot({ path: out('combat') });
  console.log(`combat shot: dist ${s.dist.toFixed(2)} m, move ${s.boss.move}, hit in ${s.nextHit.inT.toFixed(2)} s`);
  await page.mouse.up({ button: 'right' });
  // both fighters at normal lock distance, between moves
  const rest = (lo, hi) => (q) => q.boss.state === 'approach' && q.player.state === 'idle' && q.dist >= lo && q.dist < hi;
  s = await until(rest(3, 5), 'rest at 3-5 m', 15000).catch(() => until(rest(0, 7), 'rest', 15000)).catch(() => snap());
  await sleep(120);
  await page.screenshot({ path: out('character-lock') });
  console.log(`character-lock shot: dist ${s.dist.toFixed(2)} m`);
  // review extras (not part of the before/after set): wind-ups of a slash and of a heavy, guard held
  if (args.includes('--extra')) {
    await page.mouse.down({ button: 'right' });
    for (const [type, n] of [['slash', 'windup-slash'], ['heavy', 'windup-heavy'], ['slash', 'windup-slash2']]) {
      const q = await until((x) => x.nextHit && x.nextHit.type === type && x.nextHit.inT < 0.2 && x.nextHit.inT > 0.08, type, 14000).catch(() => null);
      if (q) { await page.screenshot({ path: path.join(revDir, `${prefix}-${n}.png`) }); console.log(`${n}: ${q.boss.move} hit ${q.nextHit.idx} side ${q.nextHit.side || ''} in ${q.nextHit.inT.toFixed(2)} s at ${q.dist.toFixed(2)} m`); await sleep(400); }
    }
    await page.mouse.up({ button: 'right' });
  }
  // close view: walk up to the Warden with W, guard up, then crop around both fighters
  await page.keyboard.down('KeyW');
  await until((q) => q.dist < 1.9, 'close', 5000).catch(() => {});
  await page.keyboard.up('KeyW');
  await page.mouse.down({ button: 'right' });
  await sleep(450);
  s = await snap();
  const cx = ((s.bossScreen.x + s.playerScreen.x) / 2 * 0.5 + 0.5) * 1280, cy = (0.5 - (s.bossScreen.y + s.playerScreen.y) / 2 * 0.5) * 720;
  const clip = { x: Math.max(0, Math.min(640, Math.round(cx - 320))), y: Math.max(0, Math.min(360, Math.round(cy - 180))), width: 640, height: 360 };
  await page.screenshot({ path: out('character-close'), clip });
  await page.screenshot({ path: path.join(revDir, `${prefix}-close-full.png`) });
  console.log(`character-close shot: dist ${s.dist.toFixed(2)} m; fps ${s.fps.toFixed(1)}`);
  await page.mouse.up({ button: 'right' });
  await page.close();
}

// ---------------------------------------------------------------- clip with game audio
if (only !== 'shots') {
  const { page, snap, until } = await open('seed=3&hurt=0.3&rec=1');
  let s = await snap();
  console.log(`clip browser: ${used.name}; render backend: ${s.backend}`);
  await page.mouse.move(640, 400);
  await page.keyboard.press('Enter');
  await until((q) => q.audio.state === 'running', 'audio');
  const tracks = await page.evaluate(() => window.__rec.startVideo(1500000));
  s = await until((q) => q.mode === 'fight', 'fight');
  const t0 = Date.now(), log = [];
  const note = (what, q) => { log.push({ at: +((Date.now() - t0) / 1000).toFixed(2), what, dist: +q.dist.toFixed(2) }); };
  // 1. whiff: a cut in the air while the Warden is still far away
  await page.mouse.down(); await sleep(60); await page.mouse.up(); note('cut in the air (whiff)', s);
  await sleep(700);
  // 2. locked-on strafing, both ways (the camera lags the circle: this is where the Reedcutter covers the Warden)
  await page.keyboard.down('KeyA'); note('strafe left, locked on', await snap()); await sleep(2600); await page.keyboard.up('KeyA');
  await page.keyboard.down('KeyD'); note('strafe right, locked on', await snap()); await sleep(2600); await page.keyboard.up('KeyD');
  // 3. one Warden move from the start of its wind-up to the strike, taken unguarded (direct hit)
  await until((q) => q.boss.state !== 'attack' && q.player.state === 'idle', 'lull', 6000).catch(() => {});
  await page.keyboard.down('KeyS'); await until((q) => q.dist > 4.3, 'back off to 4 m', 1800).catch(() => {}); await page.keyboard.up('KeyS');
  s = await until((q) => q.nextHit && q.nextHit.idx === 0 && q.nextHit.inT > 0.3, 'wind-up start', 15000).catch(() => snap());
  const h0 = s.stats.hitsTaken;
  note(`Warden wind-up (${s.boss.move}), no guard`, s);
  s = await until((q) => q.stats.hitsTaken > h0, 'direct hit', 8000).catch(() => snap()); note('direct hit taken', s);
  await until((q) => q.boss.state !== 'attack', 'move over', 6000).catch(() => {});
  // 4. normal guard: right button held well before the blow
  s = await snap(); const g0 = s.stats.guards;
  await until((q) => q.player.state === 'idle' || q.player.state === 'guard', 'on feet', 5000).catch(() => {});
  await page.mouse.down({ button: 'right' }); note('guard held', await snap());
  s = await until((q) => q.stats.guards > g0, 'guarded blow', 15000).catch(() => snap()); note('blow guarded', s);
  await page.mouse.up({ button: 'right' });
  await until((q) => q.boss.state !== 'attack', 'move over', 6000).catch(() => {});
  // 5. Glance: right button pressed just before impact
  const d0 = (await snap()).stats.deflects;
  for (let i = 0; i < 8; i++) {
    s = await until((q) => q.nextHit && q.nextHit.type !== 'thrust' && q.nextHit.inT < 0.13 && q.nextHit.inT > 0.03 && q.player.state !== 'stagger', 'blow about to land', 15000).catch(() => null);
    if (!s) break;
    await page.mouse.down({ button: 'right' }); await sleep(230); await page.mouse.up({ button: 'right' });
    s = await snap(); if (s.stats.deflects > d0) { note(`Glance (${s.stats.deflects - d0})`, s); if (s.stats.deflects - d0 >= 2 || !s.nextHit) break; }
  }
  // 6. a second whiff once the Warden is out of reach, if there is time
  await page.keyboard.down('KeyS'); await sleep(900); await page.keyboard.up('KeyS');
  await page.mouse.down(); await sleep(60); await page.mouse.up(); note('cut (second swing)', await snap());
  while (Date.now() - t0 < 20000) await sleep(100);
  await sleep(700);
  const b64 = await page.evaluate(() => window.__rec.stopVideo());
  const clip = Buffer.from(b64, 'base64'), name = prefix === 'after' ? 'gameplay.webm' : `${prefix}.webm`;
  fs.writeFileSync(path.join(outDir, name), clip);
  s = await snap();
  const rep = { file: name, bytes: clip.length, browser: used.name, backend: s.backend, recorder: tracks, steps: log, stats: s.stats, note: 'Nobody listened to this clip in the capture session.' };
  rep.audio = await page.evaluate(async () => {
    const buf = await window.__rec.blob.arrayBuffer(), ac = new AudioContext();
    const ab = await ac.decodeAudioData(buf);
    let pk = 0, sq = 0, n = 0; const win = Math.floor(ab.sampleRate * 0.1), wins = new Float64Array(Math.ceil(ab.length / win));
    for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = d[i]; if (Math.abs(v) > pk) pk = Math.abs(v); sq += v * v; wins[(i / win) | 0] += v * v; n++; } }
    let loud = 0; for (const w of wins) if (Math.sqrt(w / (win * ab.numberOfChannels)) > 0.001) loud++;
    const db = (v) => +(20 * Math.log10(v)).toFixed(1);
    return { seconds: +ab.duration.toFixed(2), channels: ab.numberOfChannels, rate: ab.sampleRate, peakDb: db(pk), rmsDb: db(Math.sqrt(sq / n)), windows100ms: wins.length, windowsAboveMinus60dB: loud };
  });
  const frames = await page.evaluate(async () => {
    const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(window.__rec.blob);
    await new Promise((r) => { v.onloadedmetadata = r; });
    if (!isFinite(v.duration)) { v.currentTime = 1e6; await new Promise((r) => { v.onseeked = r; }); }
    const dur = v.duration, c = document.createElement('canvas'); c.width = 640; c.height = 360; const g = c.getContext('2d'), o = [];
    for (const f of [0.08, 0.2, 0.32, 0.45, 0.6, 0.75, 0.9]) {
      v.currentTime = dur * f; await new Promise((r) => { v.onseeked = r; setTimeout(r, 4000); });
      g.drawImage(v, 0, 0, 640, 360); o.push(c.toDataURL('image/png').split(',')[1]);
    }
    return { dur, w: v.videoWidth, h: v.videoHeight, o };
  });
  frames.o.forEach((f, i) => fs.writeFileSync(path.join(revDir, `${prefix}-clip-${i}.png`), Buffer.from(f, 'base64')));
  rep.video = { seconds: +frames.dur.toFixed(2), width: frames.w, height: frames.h };
  fs.writeFileSync(path.join(outDir, `${prefix}-clip.json`), JSON.stringify(rep, null, 2));
  console.log(JSON.stringify(rep, null, 1));
  await page.close();
  const bad = [];
  if (!(rep.audio.windowsAboveMinus60dB > rep.audio.windows100ms * 0.8)) bad.push('clip audio track is (partly) silent');
  if (clip.length > 8.2e6) bad.push('clip larger than 8 MB');
  if (bad.length) { console.error('FAILED: ' + bad.join('; ')); process.exitCode = 1; }
}
await browser.close();
console.log(`evidence (${prefix}) written to compare/duel/`);
