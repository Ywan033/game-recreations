// Code-level tests of the deterministic simulation (no browser, no real input).
// These are reported separately from the real-input offline suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, startFight, step, retry, hitIn, ARENA, PLAYER_R, BOSS_R, PUNISH_MULT, ATTACKS,
} from '../src/sim.js';

const idle = { mx: 0, mz: 0, attack: false, guard: false, dodge: false, lock: true };

function run(g, frames, fn) {
  for (let i = 0; i < frames && g.mode === 'fight'; i++) step(g, fn ? fn(g, i) : idle);
}

// A simple scripted fighter: walk in, guard telegraphed hits, dodge the delayed strike, punish recoveries.
function bot(g) {
  const p = g.player;
  const b = g.boss;
  const dx = b.x - p.x;
  const dz = b.z - p.z;
  const d = Math.hypot(dx, dz);
  const inp = { ...idle };
  const h = hitIn(b);
  if (!g.engaged) { inp.mz = -1; return inp; }
  if (b.st === 'attack') {
    const name = b.move.name;
    if (name === 'delay' && h >= 0 && h < 0.1) inp.dodge = true;
    else inp.guard = true;
    return inp;
  }
  if (d > 2.2) { inp.mx = dx / d; inp.mz = dz / d; }
  // strike only into openings: swinging at a ready boss gets the bot caught mid-swing
  if (d < 2.6 && b.st === 'recover') inp.attack = g.time % 0.1 < 0.02;
  return inp;
}

test('walking into the yard engages the boss and closes the gate', () => {
  const g = createGame({ seed: 3 });
  startFight(g);
  run(g, 240, () => ({ ...idle, mz: -1 }));
  assert.equal(g.engaged, true);
  assert.equal(g.gateClosed, true);
  assert.ok(g.player.z < ARENA.engageZ);
});

test('entities stay inside the arena and apart', () => {
  const g = createGame({ seed: 5 });
  startFight(g);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]];
  run(g, 60 * 40, (gg, i) => {
    const d = dirs[Math.floor(i / 240) % dirs.length];
    const p = gg.player;
    const b = gg.boss;
    if (gg.engaged) {
      assert.ok(p.x >= ARENA.yard.minX + PLAYER_R - 1e-6 && p.x <= ARENA.yard.maxX - PLAYER_R + 1e-6);
      assert.ok(p.z >= ARENA.yard.minZ + PLAYER_R - 1e-6 && p.z <= ARENA.yard.maxZ - PLAYER_R + 1e-6);
      assert.ok(b.x >= ARENA.yard.minX + BOSS_R - 1e-6 && b.x <= ARENA.yard.maxX - BOSS_R + 1e-6);
      if (b.st !== 'dead') assert.ok(Math.hypot(p.x - b.x, p.z - b.z) > PLAYER_R + BOSS_R - 0.15);
    }
    return { ...idle, mx: d[0], mz: gg.engaged ? d[1] : -1, guard: true };
  });
});

test('standing still loses; retry resets', () => {
  const g = createGame({ seed: 2, playerHpScale: 0.5 });
  startFight(g);
  run(g, 200, () => ({ ...idle, mz: -1 }));
  run(g, 60 * 90);
  assert.equal(g.mode, 'defeat');
  retry(g);
  assert.equal(g.mode, 'fight');
  assert.equal(g.player.hp, g.player.maxHp);
  assert.equal(g.boss.phase, 1);
});

test('bot wins through phase two with punishes, guards, dodges and follow-ups', () => {
  for (const seed of [1, 7, 11, 23]) {
    const g = createGame({ seed });
    startFight(g);
    run(g, 60 * 400, bot);
    const types = new Set(g.log.map((e) => e.type));
    console.log(`seed ${seed}: mode=${g.mode} t=${g.time.toFixed(1)} php=${g.player.hp}`, JSON.stringify(g.stats));
    assert.equal(g.mode, 'victory', `seed ${seed}`);
    assert.ok(g.stats.punishHits > 0);
    assert.ok(g.stats.guarded + g.stats.perfect > 0);
    assert.ok(g.stats.followUps > 0);
    assert.ok(types.has('victory'));
  }
});

test('punish hits deal bonus damage and phase two changes timing', () => {
  const g = createGame({ seed: 7 });
  startFight(g);
  const all = [];
  for (let i = 0; i < 60 * 400 && g.mode === 'fight'; i++) {
    step(g, bot(g));
    all.push(...g.events);
    g.events = [];
  }
  const pun = all.find((e) => e.type === 'bossHurt' && e.punish);
  assert.ok(pun);
  assert.equal(pun.dmg, Math.round(ATTACKS[pun.n - 1].dmg * PUNISH_MULT));
  const m1 = all.filter((e) => e.type === 'bossMove' && e.phase === 1);
  const m2 = all.filter((e) => e.type === 'bossMove' && e.phase === 2);
  assert.ok(m1.length && m2.length);
  assert.ok(m1.every((m) => m.follow.length === 0));
  assert.ok(m2.some((m) => m.follow.length > 0));
  for (const name of ['chain', 'delay', 'lunge']) {
    const a = m1.find((m) => m.name === name);
    const b = m2.find((m) => m.name === name);
    if (a && b) { assert.ok(b.wind < a.wind); assert.ok(b.rec < a.rec); }
  }
  assert.ok(all.some((e) => e.type === 'phaseStart'));
  assert.ok(all.some((e) => e.type === 'phaseTwo'));
});
