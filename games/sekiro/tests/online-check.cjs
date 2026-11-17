// Online check hook for the launcher. Receives a Playwright page already navigated to the built
// game (https or file URL) with the canvas visible. Uses only real keyboard and mouse input;
// window.__game.snap is read-only state used to observe the result. Throws on any failure.
module.exports = async function onlineCheck(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const snap = () => page.evaluate(() => window.__game && window.__game.snap);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (cond, label, timeout) => {
    const t0 = Date.now(); let s;
    for (;;) {
      s = await snap();
      if (s && cond(s)) return s;
      if (Date.now() - t0 > timeout) throw new Error('online-check: timeout waiting for ' + label + ' — ' + JSON.stringify(s).slice(0, 300));
      await sleep(25);
    }
  };

  await until((s) => s.frames > 2, 'first rendered frames', 20000);
  // start the fight with a real mouse click on the Begin button (falls back to Enter)
  const btn = page.locator('#start');
  const box = await btn.boundingBox();
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); else await page.keyboard.press('Enter');
  let s = await until((q) => q.mode === 'fight', 'fight to start', 15000);

  // scene rendered: frames advance and a screenshot of the canvas area is not flat
  const f0 = s.frames;
  const vp = page.viewportSize() || { width: 1280, height: 720 };
  const clip = { x: Math.round(vp.width * 0.15), y: Math.round(vp.height * 0.25), width: Math.round(vp.width * 0.7), height: Math.round(vp.height * 0.5) };
  const a = await page.screenshot({ clip });
  if (a.length < 4000) throw new Error('online-check: scene looks blank (screenshot ' + a.length + ' bytes)');
  s = await until((q) => q.frames > f0 + 3, 'frames to advance', 10000);

  // keyboard movement
  const p0 = s.player;
  await page.keyboard.down('KeyA');
  s = await until((q) => Math.hypot(q.player.x - p0.x, q.player.z - p0.z) > 0.4, 'player to move under keyboard input', 8000);
  await page.keyboard.up('KeyA');

  // mouse attack registers
  const sw = s.stats.swings;
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    await page.mouse.click(Math.round(vp.width / 2), Math.round(vp.height / 2));
    await sleep(150);
    s = await snap();
    if (s.stats.swings > sw) break;
  }
  if (!(s.stats.swings > sw)) throw new Error('online-check: mouse attack did not register');
  if (errors.length) throw new Error('online-check: uncaught page error: ' + errors[0]);
};
