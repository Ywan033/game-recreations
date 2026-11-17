// Dev helper: run tests/online-check.cjs against the local build (or a URL given as an argument).
// usage: node tests/run-online-check.mjs [url] [--webgpu] [--swgpu]
//   default    bundled Chromium, headless, no hardware GPU (the kind of browser the launcher uses)
//   --webgpu   installed Google Chrome with WebGPU flags (hardware WebGPU smoke run)
//   --swgpu    installed Google Chrome, WebGPU on the SwiftShader (CPU) adapter
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const check = createRequire(import.meta.url)('./online-check.cjs');
const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--')) || pathToFileURL(path.resolve('dist/play.html')).href;
const launch = args.includes('--webgpu')
  ? { channel: 'chrome', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu'] }
  : args.includes('--swgpu')
    ? { channel: 'chrome', args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }
    : { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const t0 = Date.now();
try {
  await page.goto(url);
  await page.waitForSelector('canvas', { timeout: 30000 });
  await check(page);
  const s = await page.evaluate(() => window.__game.snap);
  console.log(`online-check passed in ${((Date.now() - t0) / 1000).toFixed(1)}s — backend ${s.backend}, ${s.fps.toFixed(1)} fps, quality ${JSON.stringify(s.quality)}`);
} catch (e) { console.error(e.message); process.exitCode = 1; }
await browser.close();
