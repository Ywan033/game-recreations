// Blade contact audio measurements for the duel pass. Nobody listens here; these are numbers only.
// usage: node tests/measure-audio.mjs [--gl]
//  1. every blade sound rendered alone (OfflineAudioContext, sfx bus before master gain / compressor / ceiling):
//     onset after the scheduled start, peak, RMS, spectral centroid, spectral flatness, ring time
//  2. a real-input exchange (cuts in the air, guards, Glances and chains, direct hits): time from each
//     simulation event reaching the audio thread (marker) to the onset of its sound on the blade bus,
//     plus peak / clipped samples of the final output and of the master bus before compressor and ceiling
// Writes compare/duel/audio-measure.json.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, 'compare', 'duel'); fs.mkdirSync(outDir, { recursive: true });
const built = path.join(root, 'dist', 'play.html');
const soft = process.argv.includes('--gl');
const GPU = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;
try { browser = await chromium.launch(soft ? { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } : { channel: 'chrome', args: GPU }); }
catch (e) { browser = await chromium.launch({ args: GPU }); }
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => { console.log('PAGEERROR', e.message); process.exitCode = 1; });
await page.goto(pathToFileURL(built).href + '#seed=3&hurt=0.3&rec=1' + (soft ? '&gl=1&q=low' : ''));
await page.waitForFunction(() => window.__game && window.__game.snap.frames > 20, null, { timeout: 45000 });
const snap = () => page.evaluate(() => window.__game.snap);
const db = (v) => (v > 0 ? +(20 * Math.log10(v)).toFixed(1) : null);

// ---------------------------------------------------------------- 1. each sound alone
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr; re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}
const SOUNDS = [
  ['whiff — Reedcutter cut through air', 'swing'], ['whiff — Warden blade through air', 'bossSwing'],
  ['normal guard', 'guard', false], ['guarded heavy (clank + scrape)', 'guard', true],
  ['Glance (first)', 'deflect', 1], ['Glance (third in a chain)', 'deflect', 3],
  ['direct hit on the Reedcutter', 'hitPlayer', false], ['cut landing on the Warden', 'hitBoss'],
  ['Warden guards a light cut', 'bossBlock'], ['Reaping Cut on the Warden\'s guard (clank + scrape)', 'heavyBlock'], ['Bind-Step pin (stomp + clap + scrape)', 'counter'],
];
const sounds = [];
for (const [label, name, a] of SOUNDS) {
  const b64 = await page.evaluate(([n, x]) => window.__rec.render(n, x), [name, a]);
  const buf = Buffer.from(b64, 'base64'), x = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4), R = 48000;
  let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v));
  let on = 0; while (on < x.length && Math.abs(x[on]) < Math.max(0.003, pk * 0.05)) on++;
  let pkAt = 0; for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) === pk) { pkAt = i; break; }
  let end = x.length - 1; while (end > on && Math.abs(x[end]) < pk * 0.0316) end--; // last sample within 30 dB of the peak
  let sq = 0; const n250 = Math.min(x.length - on, R / 4); for (let i = 0; i < n250; i++) sq += x[on + i] ** 2;
  const N = 16384, re = new Float64Array(N), im = new Float64Array(N); for (let i = 0; i < N && on + i < x.length; i++) re[i] = x[on + i];
  fft(re, im);
  let num = 0, den = 0, lg = 0, ar = 0, cnt = 0, hi = 0;
  for (let k = 1; k < N / 2; k++) { const f = k * R / N, p = re[k] ** 2 + im[k] ** 2; num += f * p; den += p; if (f >= 2000) hi += p; if (f >= 150 && f <= 12000) { lg += Math.log(p + 1e-20); ar += p; cnt++; } }
  sounds.push({ label, name, arg: a ?? null, onsetMsAfterEvent: +(on / R * 1000).toFixed(2), peakAtMs: +(pkAt / R * 1000).toFixed(1), peak: +pk.toFixed(3), peakDb: db(pk), rms250msDb: db(Math.sqrt(sq / n250)),
    centroidHz: Math.round(num / den), above2kHzPct: +(100 * hi / den).toFixed(1), flatness: +(Math.exp(lg / cnt) / (ar / cnt)).toFixed(4), ringMsTo30dB: +((end - on) / R * 1000).toFixed(0) });
  console.log(JSON.stringify(sounds[sounds.length - 1]));
}

// ---------------------------------------------------------------- 2. real-input exchange
await page.mouse.move(640, 400);
await page.keyboard.press('Enter');
let s; for (;;) { s = await snap(); if (s.mode === 'fight' && s.audio.state === 'running') break; await sleep(30); }
await page.evaluate(() => { window.__rec.startPcm('mix'); window.__rec.startPcm('pre'); window.__rec.startPcm('lat'); });
await page.mouse.down(); await sleep(60); await page.mouse.up(); await sleep(500); // cut in the air
const t0 = Date.now(); let lastClick = 0, guardMode = 0;
while (Date.now() - t0 < 30000) {
  s = await snap(); if (s.mode !== 'fight') break;
  const h = s.nextHit, el = Date.now() - t0;
  if (h && h.type !== 'thrust' && s.player.state !== 'stagger') {
    // alternate: Glance attempts (press just before impact) and plain held guards (press early)
    const early = guardMode % 3 === 2;
    if ((early && h.inT < 0.5 && h.inT > 0.3) || (!early && h.inT < 0.13 && h.inT > 0.02)) {
      await page.mouse.down({ button: 'right' }); const seq = s.hitSeq;
      const tw = Date.now(); while (Date.now() - tw < 700) { const q = await snap(); if (q.hitSeq !== seq) break; await sleep(5); }
      await sleep(40); await page.mouse.up({ button: 'right' });
      if (!(await snap()).nextHit) guardMode++;
    }
  } else if (!h && s.dist < 2.6 && el - lastClick > 450 && s.player.state === 'idle') { lastClick = el; await page.mouse.down(); await sleep(50); await page.mouse.up(); }
  await sleep(5);
}
const [mix, pre, lat] = await page.evaluate(() => [window.__rec.stopPcm(false, 'mix'), window.__rec.stopPcm(false, 'pre'), window.__rec.stopPcm(false, 'lat')]);
s = await snap();
const by = {};
for (const o of lat.onsets) { const e = by[o.name] = by[o.name] || { n: 0, missed: 0, ms: [] }; e.n++; if (o.ms === null) e.missed++; else e.ms.push(o.ms); }
const latency = Object.fromEntries(Object.entries(by).map(([k, e]) => { e.ms.sort((a, b) => a - b); return [k, { events: e.n, onsetNotFound: e.missed, minMs: e.ms[0] ?? null, medianMs: e.ms[e.ms.length >> 1] ?? null, maxMs: e.ms[e.ms.length - 1] ?? null }]; }));
const report = {
  note: 'Measured by tests/measure-audio.mjs. Nobody listened to any of this audio in the session that produced it.',
  backend: s.backend, fps: +s.fps.toFixed(1),
  sounds: { what: 'each blade sound rendered alone in an OfflineAudioContext at 48 kHz: sfx-bus signal before the master gain (0.7), compressor and ceiling; scheduled 3 ms after the event', list: sounds },
  exchange: {
    what: 'about 30 s of real-input fighting (cuts in the air, held guards, Glance attempts, cuts at the Warden, blows taken)', stats: s.stats,
    eventToOnset: { what: 'ms from the marker (the simulation event reaching the audio thread, started in the same call as the sound) to the first sample of that sound on the blade-only bus; the event handler runs in the same JS task as the 60 Hz simulation step that resolved the contact', paired: lat.paired, events: lat.events, markers: lat.markers, contextBaseLatencyMs: lat.baseLatencyMs, contextOutputLatencyMs: lat.outputLatencyMs, byName: latency },
    finalOutput: { what: 'after compressor and soft ceiling (0.92)', ...mix },
    masterBeforeDynamics: { what: 'master bus before the compressor and ceiling', ...pre },
  },
};
fs.writeFileSync(path.join(outDir, 'audio-measure.json'), JSON.stringify(report, null, 2));
console.log('latency', JSON.stringify(latency));
console.log('final', JSON.stringify({ peakDb: mix.peakDb, rmsDb: mix.rmsDb, clipped: mix.clipped }), 'pre', JSON.stringify({ peakDb: pre.peakDb, clipped: pre.clipped }));
console.log('stats', JSON.stringify({ swings: s.stats.swings, guards: s.stats.guards, deflects: s.stats.deflects, maxChain: s.stats.maxChain, hitsTaken: s.stats.hitsTaken, hitsDealt: s.stats.hitsDealt, blocked: s.stats.blocked }));
await browser.close();
