// Evidence capture for the controls / motion / audio pass, driven with real keyboard and mouse input.
// usage: node tests/record-clip.mjs [--gl]
// Writes into compare/controls/:
//   ambience.wav        ~20 s of the ambience bus while moving around the field (16-bit stereo, half the context rate)
//   gameplay.webm       one gameplay clip with sound (MediaRecorder over canvas.captureStream() + the master output)
//   audio-measure.json  measured numbers: ambience alone, mix with combat cues, muted, paused, and the decoded clip audio
//   review/clip-*.png   frames grabbed back out of the recorded clip
// The page is opened with #rec=1, the only mode in which the recording hook (window.__rec) exists.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, 'compare', 'controls'), revDir = path.join(outDir, 'review');
fs.mkdirSync(revDir, { recursive: true });
const built = path.join(root, 'dist', 'play.html');
if (!fs.existsSync(built)) { console.error('dist/play.html missing — run `npm run build` first'); process.exit(1); }
const GPU = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu'];
const SOFT = { name: 'bundled Chromium, SwiftShader', opts: { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }, gl: '&gl=1' };
const attempts = process.argv.includes('--gl') ? [SOFT] : [{ name: 'Chrome (channel) with WebGPU flags', opts: { channel: 'chrome', args: GPU }, gl: '' }, { name: 'bundled Chromium with WebGPU flags', opts: { args: GPU }, gl: '' }, SOFT];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { note: 'Measured by tests/record-clip.mjs from PCM captured inside the page. Nobody listened to this audio.' };

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
      const until = async (cond, label, timeout = 40000) => { const t0 = Date.now(); let s; for (;;) { s = await snap(); if (cond(s)) return s; if (Date.now() - t0 > timeout) throw new Error('timeout: ' + label); await sleep(15); } };
      return { page, snap, until };
    } catch (e) {
      console.log(`launch attempt failed (${a.name}): ${String(e.message).split('\n')[0]}`);
      if (browser) await browser.close().catch(() => {});
      browser = null;
    }
  }
  throw new Error('no browser could render the game');
}

// ---------------------------------------------------------------- 1. ambience sample + numbers
{
  const { page, snap, until } = await open('seed=3&hurt=0.05&rec=1');
  let s = await snap();
  console.log(`browser: ${used.name}; render backend: ${s.backend}`);
  report.browser = used.name; report.backend = s.backend;
  await page.keyboard.press('Enter');
  await until((q) => q.mode === 'fight' && q.audio.state === 'running', 'fight + audio');
  await page.evaluate(() => window.__rec.startPcm('amb'));
  // wander the field: a loop of the clearing with real movement keys (the Warden follows; its cues duck the bed)
  for (const [k, ms] of [['KeyA', 3200], ['KeyS', 2600], ['KeyD', 3800], ['KeyW', 2400], ['KeyA', 3000], ['KeyS', 2400], ['KeyD', 2600]]) { await page.keyboard.down(k); await sleep(ms); await page.keyboard.up(k); }
  const amb = await page.evaluate(() => window.__rec.stopPcm(true));
  fs.writeFileSync(path.join(outDir, 'ambience.wav'), Buffer.from(amb.wav, 'base64')); delete amb.wav;
  s = await snap();
  report.ambience = { what: 'ambience bus alone (drizzle curtain, reed wind, drops, insects), after ducking, scaled by the master gain 0.7; before the master compressor', ...amb, dropsScheduled: s.audio.drops };
  console.log('ambience:', JSON.stringify(report.ambience));
  await page.close();
}

// ---------------------------------------------------------------- 2. gameplay clip + mix numbers
{
  const { page, snap, until } = await open('seed=3&hurt=0.3&rec=1');
  await page.keyboard.press('Enter');
  let s = await until((q) => q.audio.state === 'running', 'audio');
  const tracks = await page.evaluate(() => window.__rec.startVideo(1400000));
  console.log('recorder:', JSON.stringify(tracks));
  s = await until((q) => q.mode === 'fight', 'fight');
  await page.evaluate(() => window.__rec.startPcm('mix'));
  const t0 = Date.now();
  // run, and jump while running
  await page.keyboard.down('KeyA'); await sleep(1100); await page.keyboard.press('Space'); await sleep(900); await page.keyboard.up('KeyA');
  // charged heavy: hold the left mouse button until the flare, release
  await page.mouse.move(640, 400); await page.mouse.down();
  await until((q) => q.player.chargeFull || q.player.state === 'stagger', 'charge', 4000).catch(() => {});
  await sleep(150); await page.mouse.up(); await sleep(900);
  // a boss attack: stand and take / guard it, then drink in the lull after the move
  s = await until((q) => q.stats.hitsTaken >= 1, 'a blow from the Warden', 30000);
  for (let i = 0; i < 6 && (await snap()).stats.drinks === 0; i++) {
    await until((q) => q.boss.state === 'approach' && q.player.state === 'idle', 'lull', 15000).catch(() => {});
    await page.keyboard.press('KeyR');
    await until((q) => q.player.state !== 'drink' && q.player.state !== 'stagger', 'drink end', 5000).catch(() => {});
  }
  // guard the next string with the right mouse button, then a running jump and a charged cut into the Warden
  await page.mouse.down({ button: 'right' }); await until((q) => q.stats.guards + q.stats.deflects >= 2, 'guarded blows', 12000).catch(() => {}); await page.mouse.up({ button: 'right' });
  await page.keyboard.down('KeyD'); await sleep(900); await page.keyboard.press('Space'); await sleep(800); await page.keyboard.up('KeyD');
  for (let i = 0; i < 3 && (await snap()).stats.heavyHits === 0; i++) {
    await until((q) => q.boss.state === 'approach' && q.player.state === 'idle', 'lull', 12000).catch(() => {});
    await page.keyboard.down('KeyW'); await page.keyboard.down('KeyJ');
    await until((q) => q.player.chargeFull || q.player.state === 'stagger', 'charge', 3000).catch(() => {});
    await sleep(120); await page.keyboard.up('KeyJ'); await page.keyboard.up('KeyW'); await sleep(900);
  }
  while (Date.now() - t0 < 26000) await sleep(200);
  const mix = await page.evaluate(() => window.__rec.stopPcm(false));
  const b64 = await page.evaluate(() => window.__rec.stopVideo());
  const clip = Buffer.from(b64, 'base64');
  fs.writeFileSync(path.join(outDir, 'gameplay.webm'), clip);
  s = await snap();
  report.mix = { what: 'final output after the master compressor during the recorded fight (ambience + footsteps + blade, cue and flask sounds + music)', ...mix };
  report.clip = { file: 'gameplay.webm', bytes: clip.length, recorder: tracks, stats: { jumps: s.stats.jumps, heavies: s.stats.heavies, heavyHits: s.stats.heavyHits, drinks: s.stats.drinks, hitsTaken: s.stats.hitsTaken, guards: s.stats.guards, deflects: s.stats.deflects } };
  console.log('mix:', JSON.stringify(report.mix));
  // muted and paused levels on the final output
  await page.keyboard.press('KeyM'); await sleep(400);
  await page.evaluate(() => window.__rec.startPcm('mix')); await sleep(1500);
  report.muted = await page.evaluate(() => window.__rec.stopPcm(false));
  await page.keyboard.press('KeyM'); await sleep(300);
  if ((await snap()).mode === 'fight') {
    await page.keyboard.press('KeyP'); await sleep(400);
    await page.evaluate(() => window.__rec.startPcm('mix')); await sleep(1500);
    const st = (await snap()).audio.state;
    report.paused = { contextState: st, ...(await page.evaluate(() => window.__rec.stopPcm(false))) };
    await page.keyboard.press('KeyP');
  }
  console.log('muted:', JSON.stringify(report.muted), 'paused:', JSON.stringify(report.paused));
  // decode the clip's own audio track and grab frames back out of it
  report.clip.decoded = await page.evaluate(async () => {
    const buf = await window.__rec.blob.arrayBuffer(), ac = new AudioContext();
    const ab = await ac.decodeAudioData(buf);
    let pk = 0, sq = 0, n = 0; const win = Math.floor(ab.sampleRate * 0.1), wins = new Float64Array(Math.ceil(ab.length / win));
    for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = d[i]; if (Math.abs(v) > pk) pk = Math.abs(v); sq += v * v; wins[(i / win) | 0] += v * v; n++; } }
    let loud = 0; for (const w of wins) if (Math.sqrt(w / (win * ab.numberOfChannels)) > 0.001) loud++;
    const db = (v) => +(20 * Math.log10(v)).toFixed(1);
    return { seconds: +ab.duration.toFixed(2), channels: ab.numberOfChannels, rate: ab.sampleRate, peak: +pk.toFixed(4), peakDb: db(pk), rmsDb: db(Math.sqrt(sq / n)), windows100ms: wins.length, windowsAboveMinus60dB: loud };
  });
  console.log('clip audio:', JSON.stringify(report.clip.decoded), `${(clip.length / 1048576).toFixed(2)} MB`);
  const frames = await page.evaluate(async () => {
    const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(window.__rec.blob);
    await new Promise((r) => { v.onloadedmetadata = r; });
    if (!isFinite(v.duration)) { v.currentTime = 1e6; await new Promise((r) => { v.onseeked = r; }); }
    const dur = v.duration, c = document.createElement('canvas'); c.width = 640; c.height = 360; const g = c.getContext('2d'), out = [];
    for (const f of [0.1, 0.2, 0.35, 0.55, 0.75, 0.92]) {
      v.currentTime = dur * f; await new Promise((r) => { v.onseeked = r; setTimeout(r, 4000); });
      g.drawImage(v, 0, 0, 640, 360); out.push(c.toDataURL('image/png').split(',')[1]);
    }
    return { dur, w: v.videoWidth, h: v.videoHeight, out };
  });
  frames.out.forEach((f, i) => fs.writeFileSync(path.join(revDir, `clip-${i}.png`), Buffer.from(f, 'base64')));
  report.clip.video = { seconds: +frames.dur.toFixed(2), width: frames.w, height: frames.h, frames: frames.out.length };
  await page.close();
}
fs.writeFileSync(path.join(outDir, 'audio-measure.json'), JSON.stringify(report, null, 2));
await browser.close();
const c = report.clip, bad = [];
if (!(c.decoded.windowsAboveMinus60dB > c.decoded.windows100ms * 0.8)) bad.push('clip audio track is (partly) silent');
if (c.bytes > 8.4e6) bad.push('clip larger than 8 MB');
if (!(c.stats.jumps >= 1 && c.stats.heavies >= 1 && c.stats.drinks >= 1 && c.stats.hitsTaken + c.stats.guards >= 1)) bad.push('clip is missing an action: ' + JSON.stringify(c.stats));
if (report.muted.peak !== 0) bad.push('output not silent while muted');
if (report.ambience.clipped || report.mix.clipped) bad.push('clipped samples');
if (bad.length) { console.error('FAILED: ' + bad.join('; ')); process.exit(1); }
console.log('evidence written to compare/controls/');
