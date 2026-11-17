// Verifies a published game URL in a fresh, logged-out browser session.
// Usage (cwd = games/<id>, so the game's own Playwright is used):
//   node <repo>/scripts/verify-online.cjs <id> <url>
// The game supplies tests/online-check.cjs exporting
//   async function (page) { ... }   // throws on failure
// which starts the fight with real keyboard/mouse input and asserts that the
// scene rendered and input was accepted. This script adds the common checks:
// HTTP 200, a visible canvas, and no uncaught page errors.
const path = require('path');

async function main() {
  const [id, url] = process.argv.slice(2);
  if (!id || !url) throw new Error('usage: verify-online.cjs <id> <url>');
  const cwd = process.cwd();
  const { chromium } = require(require.resolve('playwright', { paths: [cwd] }));
  let check;
  try {
    check = require(path.join(cwd, 'tests', 'online-check.cjs'));
  } catch (e) {
    throw new Error(`games/${id}/tests/online-check.cjs is missing or failed to load: ${e.message}`);
  }
  if (typeof check !== 'function') throw new Error('online-check.cjs must export a function');

  const browser = await chromium.launch({
    args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const resp = await page.goto(url, { waitUntil: 'load', timeout: 120000 });
    if (!resp || resp.status() !== 200) throw new Error(`HTTP ${resp ? resp.status() : 'no response'} for ${url}`);
    await page.waitForSelector('canvas', { state: 'visible', timeout: 60000 });
    console.log(`[online] loaded ${url}, canvas visible`);
    await check(page);
    console.log('[online] game check passed: fight started and input accepted');
    if (errors.length) throw new Error('uncaught page errors: ' + errors.join(' | '));
    console.log('[online] no uncaught page errors');
  } finally {
    await browser.close();
  }
}

main().then(
  () => { console.log('[online] PASS'); process.exit(0); },
  (e) => { console.error('[online] FAIL: ' + (e && e.stack ? e.stack : e)); process.exit(1); }
);
