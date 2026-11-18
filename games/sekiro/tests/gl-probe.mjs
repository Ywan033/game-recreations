// Dev helper: does the bundled Chromium give a WebGL 2 context on this machine right now?
// usage: node tests/gl-probe.mjs   (prints the renderer string, or "no webgl2 context")
import { chromium } from 'playwright';
// extra arguments are passed to the browser, e.g. node tests/gl-probe.mjs --use-angle=swiftshader
// --full uses the full Chromium build (new headless) instead of the headless shell
const xa = process.argv.slice(2).filter((a) => a !== '--full');
const browser = await chromium.launch({ ...(process.argv.includes('--full') ? { channel: 'chromium' } : {}), args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...xa] });
const page = await browser.newPage();
page.on('console', (m) => console.log('console', m.text().slice(0, 200)));
await page.goto('chrome://gpu').catch(() => {});
console.log((await page.evaluate(() => document.body.innerText).catch(() => '')).split('\n').filter((l) => /WebGL|GL_RENDERER|Problems|disabled|crash|Display type|ANGLE/i.test(l)).slice(0, 14).join('\n'));
const r = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return 'no webgl2 context';
  const e = gl.getExtension('WEBGL_debug_renderer_info');
  return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'webgl2 ok';
});
console.log(browser.version(), '->', r);
await browser.close();
