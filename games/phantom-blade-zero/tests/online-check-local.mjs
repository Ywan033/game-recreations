// Runs tests/online-check.cjs (the launcher's live-page check) against the local build instead of
// the published URL, in a plain headless Chromium, so the check itself can be verified before
// publishing:  node tests/online-check-local.mjs   (after "npm run build")
import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const check = createRequire(import.meta.url)('./online-check.cjs');
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(pathToFileURL(path.resolve(here, '..', 'dist', 'play.html')).href);
await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 60000 });
await check(page);
await browser.close();
if (errors.length) { console.error('page errors:', errors); process.exit(1); }
console.log('online-check passed against the local build');
