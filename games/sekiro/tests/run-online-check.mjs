// Dev helper: run tests/online-check.cjs against the local build (or a URL given as argv[2]).
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const check = createRequire(import.meta.url)('./online-check.cjs');
const url = process.argv[2] || pathToFileURL(path.resolve('dist/play.html')).href;
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const t0 = Date.now();
try {
  await page.goto(url);
  await page.waitForSelector('canvas', { timeout: 30000 });
  await check(page);
  console.log(`online-check passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (e) { console.error(e.message); process.exitCode = 1; }
await browser.close();
