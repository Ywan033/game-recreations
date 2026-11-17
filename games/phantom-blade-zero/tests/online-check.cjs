// Live-page check used by the repository launcher (scripts/verify-online.cjs).
// Receives a Playwright page already navigated to the game with the canvas
// visible. Uses only real mouse and keyboard input; the probe is read-only.
module.exports = async function onlineCheck(page) {
  const snap = () => page.evaluate(() => window.__game.snapshot());
  await page.waitForFunction(() => window.__game && window.__game.snapshot().frames > 3, null, { timeout: 90000 });

  // Start the fight with a real mouse click.
  await page.locator('#startbtn').click();
  await page.locator('#title').waitFor({ state: 'hidden', timeout: 15000 });
  await page.locator('#hud').waitFor({ state: 'visible', timeout: 15000 });
  const s0 = await snap();
  await page.waitForFunction((f) => window.__game.snapshot().frames > f + 5, s0.frames, { timeout: 60000 });
  console.log(`[online] started: backend=${s0.backend} mode=${s0.mode}`);

  // Keyboard: walk forward.
  await page.keyboard.down('KeyW');
  await page.waitForFunction(
    (p) => { const q = window.__game.snapshot().player; return Math.hypot(q.x - p.x, q.z - p.z) > 0.5; },
    s0.player, { timeout: 60000 });
  await page.keyboard.up('KeyW');
  const s1 = await snap();
  console.log(`[online] keyboard moved the player ${Math.hypot(s1.player.x - s0.player.x, s1.player.z - s0.player.z).toFixed(2)} m`);

  // Mouse: movement turns the camera, left button swings the sword.
  await page.mouse.move(400, 360);
  await page.mouse.move(900, 360, { steps: 12 });
  await page.waitForFunction((y) => Math.abs(window.__game.snapshot().cam.yaw - y) > 0.05, s1.cam.yaw, { timeout: 30000 });
  const idle = s1.player.st;
  await page.mouse.down();
  await page.waitForFunction(
    (st) => { const q = window.__game.snapshot().player; return q.st !== st || q.combo > 0; },
    idle, { timeout: 30000 });
  await page.mouse.up();
  const s2 = await snap();
  console.log(`[online] mouse turned the camera and attacked (player state ${idle} -> ${s2.player.st})`);
};
