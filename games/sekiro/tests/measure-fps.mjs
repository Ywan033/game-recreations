// Dev helper: measure the frame rate of dist/play.html on a given browser / render path.
// usage: node tests/measure-fps.mjs [--chrome] [--gpu] [--hash=<extra hash options>] [--file=<path>]
//   default   bundled Chromium, headless, no hardware GPU (the same kind of browser as the published-page check)
//   --chrome  installed Google Chrome instead of the bundled Chromium
//   --gpu     pass the WebGPU / hardware flags
// Starts the fight with a real Enter key press and reports fps on the title screen and in the fight.
import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const arg = (k) => { const a = args.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : ''; };
const file = path.resolve(arg('file') || 'dist/play.html');
const hash = ['seed=3', 'mute=1', arg('hash')].filter(Boolean).join('&');
const GPU = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu'];
const SOFT = ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
// --swgpu: WebGPU on the SwiftShader (CPU) adapter
const SWGPU = ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ ...(args.includes('--chrome') ? { channel: 'chrome' } : {}), args: args.includes('--swgpu') ? SWGPU : args.includes('--gpu') ? GPU : SOFT });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snap = () => page.evaluate(() => window.__game.snap);
const rate = async (ms) => { const a = await snap(), t = Date.now(); await sleep(ms); const b = await snap(); return (b.frames - a.frames) / ((Date.now() - t) / 1000); };
const t0 = Date.now();
await page.goto(pathToFileURL(file).href + '#' + hash);
await page.waitForFunction(() => window.__game && window.__game.snap.frames > 2, null, { timeout: 90000 });
const tLoad = (Date.now() - t0) / 1000;
const first = await rate(3000);
const settled = await rate(4000);
await page.keyboard.press('Enter');
const tb = Date.now();
while ((await snap()).mode !== 'fight' && Date.now() - tb < 60000) await sleep(50);
const tIntro = (Date.now() - tb) / 1000;
const fight = await rate(4000);
const s = await snap();
console.log(JSON.stringify({ hash, backend: s.backend, loadS: +tLoad.toFixed(1), titleFpsFirst3s: +first.toFixed(1), titleFps: +settled.toFixed(1), introWallS: +tIntro.toFixed(1), fightFps: +fight.toFixed(1), mode: s.mode, quality: s.quality || null }));
await browser.close();
