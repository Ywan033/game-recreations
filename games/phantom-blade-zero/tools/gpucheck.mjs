// Developer helper: reports whether headless Chromium exposes a WebGPU adapter with the given flags,
// and which backend the built game picks. Usage: node tools/gpucheck.mjs [extra chromium flags...]
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(path.resolve(here, '..', 'dist', 'play.html')).href + '#seed=3';
// "channel=chromium" selects the full Chromium build (new headless mode); "headed" opens a window.
const raw = process.argv.slice(2);
const args = raw.filter((a) => a.startsWith('--'));
const channel = (raw.find((a) => a.startsWith('channel=')) || '').slice(8) || undefined;
const browser = await chromium.launch({ args, channel, headless: !raw.includes('headed') });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.type(), m.text()); });
await page.goto(url);
const adapter = await page.evaluate(async () => {
  if (!navigator.gpu) return 'no navigator.gpu';
  try {
    const a = await navigator.gpu.requestAdapter();
    if (!a) return 'no adapter';
    return 'adapter: ' + JSON.stringify({ vendor: a.info?.vendor, arch: a.info?.architecture, desc: a.info?.description, fallback: a.isFallbackAdapter });
  } catch (e) { return 'error ' + e.message; }
});
console.log('flags:', args.join(' ') || '(none)');
console.log(adapter);
try {
  await page.waitForFunction(() => !!window.__game && window.__game.snapshot().frames > 20, null, { timeout: 30000 });
  const s = await page.evaluate(() => window.__game.snapshot());
  console.log('backend:', s.backend, 'fps:', s.fps);
  await page.keyboard.press('Enter');
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.snapshot().engaged, null, { timeout: 20000 });
  await page.keyboard.up('KeyW');
  await new Promise((r) => setTimeout(r, 2500));
  const out = path.resolve(here, '..', 'test-results', 'debug', 'gpucheck-' + s.backend + '.png');
  await page.screenshot({ path: out });
  console.log('fps in yard:', (await page.evaluate(() => window.__game.snapshot())).fps, 'shot:', out);
} catch (e) { console.log('game did not start:', e.message); }
await browser.close();
