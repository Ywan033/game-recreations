// Live-page check used by the repository launcher (scripts/verify-online.cjs).
// Receives a Playwright page already navigated to the game with the canvas
// visible. Uses only real mouse and keyboard input; the probe is read-only.
module.exports = async function onlineCheck(page) {
  const snap = () => page.evaluate(() => window.__game.snapshot());
  const events = (since) => page.evaluate((s) => window.__game.events(s), since);
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

  // Controls pass: Left Shift dodges, Space jumps, R is the flask key (real key presses).
  const idleNow = () => page.waitForFunction(
    () => { const q = window.__game.snapshot().player; return q.st === 'idle' && q.y === 0 && q.dodgeCd <= 0; }, null, { timeout: 30000 });
  const count = (ev, type) => ev.filter((e) => e.type === type).length;

  await idleNow();
  let t0 = (await snap()).time;
  await page.keyboard.press('ShiftLeft');
  await page.waitForFunction((t) => window.__game.events(t).some((e) => e.type === 'dodge'), t0, { timeout: 30000 });
  await idleNow();
  let ev = await events(t0);
  if (count(ev, 'dodge') !== 1 || count(ev, 'jump') !== 0) throw new Error('ShiftLeft must dodge exactly once and not jump: ' + JSON.stringify(ev.map((e) => e.type)));
  console.log('[online] ShiftLeft dodged (no jump)');

  t0 = (await snap()).time;
  await page.keyboard.down('Space');
  await page.waitForFunction(() => window.__game.snapshot().player.y > 0.3, null, { timeout: 30000 });
  await page.waitForFunction((t) => window.__game.events(t).some((e) => e.type === 'land'), t0, { timeout: 30000 });
  await idleNow();
  await page.keyboard.up('Space');
  ev = await events(t0);
  if (count(ev, 'jump') !== 1 || count(ev, 'dodge') !== 0) throw new Error('Space must jump exactly once and not dodge: ' + JSON.stringify(ev.map((e) => e.type)));
  console.log('[online] Space jumped and landed (no dodge, no re-jump while held)');

  // R during the fight is the flask: at full health it is refused (nothing spent) and the
  // fight is not restarted; once hurt it would drink. Either way it is handled as the flask.
  t0 = (await snap()).time;
  const before = await snap();
  await page.keyboard.press('KeyR');
  await page.waitForFunction(
    (t) => window.__game.events(t).some((e) => e.type === 'drinkFail' || e.type === 'drink'), t0, { timeout: 30000 });
  ev = await events(t0);
  const after = await snap();
  if (after.mode !== 'fight' || after.fights !== before.fights) throw new Error('R must not restart the fight');
  const full = before.player.hp >= before.player.maxHp;
  if (full && (count(ev, 'drinkFail') !== 1 || after.player.flask !== before.player.flask)) throw new Error('R at full health must be refused and spend nothing');
  console.log(`[online] R handled as the flask key (${full ? 'refused at full health' : 'drinking'}; flask ${after.player.flask}/${after.player.maxFlask})`);
};
