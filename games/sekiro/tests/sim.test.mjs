// Code-level test of the fight simulation (no browser, synthetic inputs).
// Reported separately from the real-input offline suite.
import assert from 'node:assert/strict';
import { createSim, C, MOVES } from '../src/sim.js';

function run(seed, bot, maxT = 400) {
  const s = createSim({ seed });
  const log = { events: {}, p1Moves: null };
  let prevGuard = false;
  while (s.mode !== 'victory' && s.mode !== 'defeat' && s.time < maxT) {
    const inp = { mx: 0, mz: 0, attack: false, guardPress: false, guard: false, dodge: false, finisher: false, locked: true, ...bot(s) };
    inp.guardPress = inp.guard && !prevGuard; prevGuard = inp.guard;
    s.step(inp);
    for (const e of s.events) log.events[e.type] = (log.events[e.type] || 0) + 1;
    s.events.length = 0;
  }
  return { s, log };
}

// 1. idle player loses
{
  const { s } = run(5, () => ({}));
  assert.equal(s.mode, 'defeat');
  assert.ok(s.stats.hitsTaken >= 3);
}

// 2. holding guard: guarded hits fill the player's balance, thrust still wounds
{
  const { s, log } = run(6, () => ({ guard: true }));
  assert.ok(s.stats.guards >= 3, 'guards');
  assert.equal(s.stats.deflects <= 1, true);
  assert.ok(log.events.playerBroken >= 1, 'guard break happens');
  assert.equal(s.mode, 'defeat');
}

// 3. a reactive bot wins through two breaks and two finishers
for (const seed of [1, 2, 3, 4]) {
  let hold = 0;
  const { s, log } = run(seed, (s) => {
    const p = s.player, b = s.boss, h = s.nextHit();
    const toB = { mx: (b.x - p.x), mz: (b.z - p.z) };
    if (s.promptOpen) return { finisher: true };
    if (b.state === 'broken') return toB;
    if (h && h.type === 'thrust') return h.inT <= 0.25 && p.state !== 'dodge' ? { ...toB, dodge: true } : {};
    if (h && h.inT <= 0.15) { hold = 3; return { guard: true }; }
    if (hold > 0) { hold--; return { guard: true }; }
    return {};
  });
  assert.equal(s.mode, 'victory', 'seed ' + seed + ' wins');
  assert.equal(s.stats.breaks, 2);
  assert.equal(s.stats.finishers, 2);
  assert.ok(s.stats.maxChain >= 3, 'chained deflects');
  assert.ok(s.stats.counters >= 1, 'bind-step');
  assert.equal(s.boss.phase, 2);
  assert.equal(s.boss.movesSeen[2][0], 'string5', 'phase two opens with its new string');
  assert.ok(s.boss.movesSeen[1].every((m) => !MOVES[m].p2), 'phase one uses no phase-two moves');
  assert.ok(log.events.phase2 === 1 && log.events.cue >= 1);
  console.log('seed', seed, 'victory at', s.time.toFixed(1) + 's', JSON.stringify(s.stats));
}

// 4. attacking deals health damage and can force a break
{
  const { s } = run(9, (s) => {
    const p = s.player, b = s.boss, h = s.nextHit();
    if (s.promptOpen) return { finisher: true };
    if (h && h.type === 'thrust') return h.inT <= 0.25 && p.state !== 'dodge' ? { mx: b.x - p.x, mz: b.z - p.z, dodge: true } : {};
    if (h && h.inT <= 0.15) return { guard: true };
    return { mx: b.x - p.x, mz: b.z - p.z, attack: (Math.round(s.time * 60) % 20) === 0 };
  });
  assert.ok(s.stats.hitsDealt > 0 && s.stats.blocked > 0);
  assert.equal(s.mode, 'victory');
}
assert.equal(C.STEP, 1 / 60);
console.log('sim tests passed');
