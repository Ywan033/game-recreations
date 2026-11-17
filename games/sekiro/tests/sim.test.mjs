// Code-level test of the fight simulation (no browser, synthetic inputs).
// Reported separately from the real-input offline suite.
import assert from 'node:assert/strict';
import { createSim, C, MOVES, JUMP, CHARGE, FLASK } from '../src/sim.js';

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
// ---------------------------------------------------------------- controls pass: jump, charged heavy, flask
const IN = { mx: 0, mz: 0, attack: false, attackHeld: false, guardPress: false, guard: false, dodge: false, finisher: false, jump: false, drink: false, locked: true };
function fresh(seed = 21) { // a sim stepped to the first frame of the fight (boss still ~9 m away)
  const s = createSim({ seed });
  while (s.mode !== 'fight') s.step(IN);
  s.events.length = 0;
  return s;
}
const stepN = (s, n, inp = {}) => { const seen = []; for (let i = 0; i < n; i++) { s.step({ ...IN, ...inp }); for (const e of s.events) seen.push(e.type); s.events.length = 0; } return seen; };
const secs = (t) => Math.round(t / C.STEP);

// 5. jump: take-off, airborne, landing; one jump per press; ground and boundary hold; air steering is moderate
{
  const s = fresh(), p = s.player;
  s.step({ ...IN, jump: true });
  assert.equal(p.state, 'takeoff');
  let peak = 0, airSteps = 0, states = new Set();
  for (let i = 0; i < 90; i++) { s.step(IN); states.add(p.state); peak = Math.max(peak, p.y); if (p.state === 'air') airSteps++; assert.ok(p.y >= 0, 'never below the ground'); }
  assert.ok(states.has('air') && states.has('land') && p.state === 'idle', 'takeoff -> air -> land -> idle');
  assert.ok(Math.abs(peak - JUMP.V0 * JUMP.V0 / (2 * JUMP.G)) < 0.06, 'peak height ' + peak);
  assert.ok(Math.abs(airSteps * C.STEP - 2 * JUMP.V0 / JUMP.G) < 0.05, 'air time ' + airSteps * C.STEP);
  assert.equal(s.stats.jumps, 1); assert.equal(s.stats.lands, 1); assert.equal(p.y, 0);
  // normal input returns after landing
  const x0 = p.x; stepN(s, 20, { mx: 1 }); assert.ok(p.x - x0 > 1, 'walks after landing');
  // boundary: a running jump outward still stops at the reed line
  const s2 = fresh(), q = s2.player;
  stepN(s2, 60, { mz: 1 }); s2.step({ ...IN, mz: 1, jump: true });
  for (let i = 0; i < 200; i++) { s2.step({ ...IN, mz: 1, jump: i % 50 === 49 }); assert.ok(Math.hypot(q.x, q.z) <= C.ARENA_R + 1e-6, 'inside the boundary while airborne'); }
  assert.ok(s2.stats.jumps >= 3 && Math.hypot(q.x, q.z) > C.ARENA_R - 0.01);
  // air steering: reversing the stick mid-air cannot reverse the jump at once
  const s3 = fresh(), r = s3.player;
  stepN(s3, 20, { mx: 1 }); s3.step({ ...IN, mx: 1, jump: true }); stepN(s3, secs(JUMP.TAKEOFF) + 1, { mx: 1 });
  assert.equal(r.state, 'air'); const v0 = r.jvx; stepN(s3, 6, { mx: -1 });
  assert.ok(r.jvx > 0 && r.jvx < v0, 'steered, not snapped: ' + v0 + ' -> ' + r.jvx);
  // jump/step/attack/drink are ignored while airborne
  const s4 = fresh(); s4.step({ ...IN, jump: true }); stepN(s4, 8);
  const seen = stepN(s4, 5, { jump: true, dodge: true, attack: true, attackHeld: true, drink: true });
  assert.equal(s4.player.state, 'air'); assert.equal(s4.stats.jumps, 1); assert.equal(s4.stats.dodges, 0); assert.equal(s4.stats.swings, 0); assert.equal(seen.length, 0);
}

// 6. no free invulnerability: a blow that reaches an airborne fighter lands
{
  let jumped = false;
  const { s } = run(5, (s) => { const h = s.nextHit(); if (!jumped && h && h.inT <= 0.3 && s.player.state === 'idle') { jumped = true; return { jump: true }; } return {}; }, 30);
  assert.ok(jumped && s.stats.jumps === 1);
  const s2 = createSim({ seed: 5 }); let hitInAir = false, j = false;
  while (s2.time < 30 && !hitInAir) {
    const h = s2.nextHit(), before = s2.stats.hitsTaken, y = s2.player.y;
    s2.step({ ...IN, jump: !j && h && h.inT <= 0.3 && s2.player.state === 'idle' ? (j = true) : false });
    if (s2.stats.hitsTaken > before && y > 0.2) hitInAir = true;
  }
  assert.ok(hitInAir, 'hit while airborne');
  stepN(s2, 60); assert.equal(s2.player.y, 0, 'knocked out of the air, back on the ground');
}

// 7. charged heavy: tap = one light cut, hold past the threshold = one heavy cut, never both
{
  const s = fresh(), p = s.player;
  let seen = stepN(s, 1, { attack: true, attackHeld: true }).concat(stepN(s, 3, { attackHeld: true }), stepN(s, 40));
  assert.deepEqual(seen.filter((e) => /swing|charge|heavy/i.test(e)), ['swing'], 'tap: light cut only');
  assert.equal(p.state, 'idle');
  // three quick presses chain the combo exactly as before
  const t = fresh(); const combos = [];
  for (let i = 0; i < 70; i++) { const press = i === 0 || i === 15 || i === 36; t.step({ ...IN, attack: press, attackHeld: press }); for (const e of t.events) if (e.type === 'swing') combos.push([e.combo, i]); t.events.length = 0; }
  assert.deepEqual(combos.map((c) => c[0]), [0, 1, 2], 'combo steps'); assert.equal(combos[1][1], 21, 'second cut starts at 0.34 s as before');
  assert.equal(t.stats.heavies, 0);
  // hold: wind-up, full-charge cue at CHARGE.FULL, release -> heavy
  const hs = fresh(), hp = hs.player;
  seen = stepN(hs, 1, { attack: true, attackHeld: true });
  let lightHit = false, fullAt = -1;
  for (let i = 0; i < 55; i++) { hs.step({ ...IN, attackHeld: true }); if (hp.state === 'attack' && hp.hitDone) lightHit = true; for (const e of hs.events) { seen.push(e.type); if (e.type === 'chargeFull') fullAt = hp.t; } hs.events.length = 0; }
  assert.equal(hp.state, 'charge'); assert.ok(!lightHit, 'no light hit during a hold');
  assert.ok(Math.abs(fullAt - CHARGE.FULL) < 0.02, 'full cue at ' + fullAt);
  seen = seen.concat(stepN(hs, 1)); assert.equal(hp.state, 'heavy');
  seen = seen.concat(stepN(hs, secs(CHARGE.RECOVER) + 2)); assert.equal(hp.state, 'idle');
  assert.deepEqual(seen.filter((e) => /swing|charge|heavy/i.test(e)), ['swing', 'chargeStart', 'chargeFull', 'heavySwing'], 'hold: ' + seen.join(','));
  assert.equal(hs.stats.heavies, 1); assert.equal(hs.stats.swings, 1);
  // released before the threshold: the ordinary cut, no heavy
  const u = fresh();
  seen = stepN(u, 1, { attack: true, attackHeld: true }).concat(stepN(u, 25, { attackHeld: true }));
  assert.equal(u.player.state, 'charge'); seen = seen.concat(stepN(u, 40));
  assert.ok(!seen.includes('heavySwing') && !seen.includes('chargeFull')); assert.equal(u.stats.heavies, 0); assert.equal(u.player.state, 'idle');
  // stepping out of a charge abandons it
  stepN(u, 1, { attack: true, attackHeld: true }); stepN(u, 30, { attackHeld: true }); stepN(u, 1, { attackHeld: true, dodge: true });
  assert.equal(u.player.state, 'dodge'); stepN(u, 40); assert.equal(u.stats.heavies, 0);
}

// 8. heavy damage: real against an open Warden, chip against its guard; a hit interrupts the charge
{
  const s = fresh(), p = s.player, b = s.boss;
  // walk in, wait for the Warden to commit to a move, then land a full charge during it (code-level timing)
  let dealt = null, guardChip = null, broke = false;
  for (let i = 0; i < 6000 && !(dealt && guardChip && broke); i++) {
    const d = Math.hypot(b.x - p.x, b.z - p.z), h = s.nextHit();
    const hold = p.state === 'charge' ? !(p.chargeFull && d < 3.4) : p.state === 'attack';
    const ready = (p.state === 'idle' || p.state === 'guard') && d < 3.4 && s.mode === 'fight';
    const punish = b.state === 'attack' && !h && MOVES[b.move].dur - b.t > 0.9, lull = b.state === 'approach' && b.cooldown > 1.0;
    // first collect an open hit and a guard chip (guarding in between); afterwards charge blindly to get interrupted
    const start = ready && (dealt && guardChip ? true : !dealt ? punish : lull);
    const guard = !start && p.state !== 'charge' && !!h && h.inT < 0.5 && !(dealt && guardChip);
    if (p.hp < 60) p.hp = 100; // code-level: keep the fighter alive through the unguardable lunges
    const hp0 = b.hp, st0 = b.state, hv0 = s.stats.heavyHits, cb0 = s.stats.chargeBreaks, hv = s.stats.heavies;
    s.step({ ...IN, mx: b.x - p.x, mz: b.z - p.z, guard, guardPress: guard && p.state !== 'guard' && h.inT > 0.3, attack: start, attackHeld: start || hold });
    if (s.stats.heavyHits > hv0) { if (st0 === 'attack') dealt = hp0 - b.hp; else if (st0 === 'approach' || st0 === 'block') guardChip = hp0 - b.hp; }
    if (s.stats.chargeBreaks > cb0) { broke = true; assert.equal(s.stats.heavies, hv, 'interrupted charge gives no cut'); assert.ok(p.state === 'stagger' || p.state === 'dead'); }
    s.events.length = 0;
    if (s.mode !== 'fight') { s.reset(); while (s.mode !== 'fight') s.step(IN); }
  }
  assert.equal(dealt, CHARGE.DMG, 'open hit damage'); assert.equal(guardChip, CHARGE.CHIP, 'guard chip'); assert.ok(broke, 'a hit interrupted a charge');
}

// 9. flask: one charge per drink at one moment, capped heal, refusals, interruption, restore on retry
{
  const s = fresh(), p = s.player;
  let seen = stepN(s, 1, { drink: true });
  assert.deepEqual(seen, ['drinkFail']); assert.equal(p.flask, FLASK.CHARGES); assert.equal(p.state, 'idle'); assert.equal(s.stats.drinkFails, 1);
  p.hp = 40; // code-level state set-up
  s.step({ ...IN, drink: true }); assert.equal(p.state, 'drink');
  stepN(s, secs(FLASK.SIP) - 3, { drink: true }); assert.equal(p.flask, FLASK.CHARGES, 'not consumed before the sip'); assert.equal(p.hp, 40);
  seen = stepN(s, 4); assert.equal(p.flask, FLASK.CHARGES - 1); assert.equal(p.hp, 40 + FLASK.HEAL); assert.deepEqual(seen, ['heal']);
  stepN(s, secs(FLASK.RECOVER) + 2, { drink: false }); assert.equal(p.state, 'idle'); assert.equal(p.hp, 40 + FLASK.HEAL, 'healed exactly once');
  p.hp = 90; s.step({ ...IN, drink: true }); stepN(s, secs(FLASK.SIP + FLASK.RECOVER) + 2);
  assert.equal(p.hp, C.PLAYER_HP, 'heal capped at max'); assert.equal(p.flask, FLASK.CHARGES - 2); assert.equal(s.stats.healed, FLASK.HEAL + 10);
  const e = fresh(), ep = e.player; ep.flask = 1; // code-level set-up: last charge
  ep.hp = 30; e.step({ ...IN, drink: true }); stepN(e, 10); e.clearActions(); // pause / blur before the sip
  assert.equal(ep.state, 'idle'); assert.equal(ep.flask, 1); assert.equal(ep.hp, 30);
  e.step({ ...IN, drink: true }); stepN(e, secs(FLASK.SIP + FLASK.RECOVER) + 2); assert.equal(ep.flask, 0); assert.equal(ep.hp, 30 + FLASK.HEAL);
  ep.hp = 20; seen = stepN(e, 1, { drink: true }); assert.deepEqual(seen, ['drinkFail']); assert.equal(ep.hp, 20); assert.equal(ep.flask, 0); assert.equal(ep.state, 'idle');
  e.reset(); assert.equal(e.player.flask, FLASK.CHARGES, 'retry restores the charges');
  // interrupted by a hit before the sip: nothing consumed, nothing healed
  const s2 = createSim({ seed: 5 }), q = s2.player; let done = false, started = false;
  while (s2.time < 60 && !done) {
    const h = s2.nextHit(), db = s2.stats.drinkBreaks;
    if (q.hp === C.PLAYER_HP && s2.mode === 'fight') q.hp = 99; // so the flask is not refused
    const hp0 = q.hp;
    const go = !started && h && h.inT <= 0.35 && h.inT > 0.2 && q.state === 'idle';
    if (go) started = true;
    s2.step({ ...IN, drink: go });
    if (s2.stats.drinkBreaks > db) { done = true; assert.equal(q.flask, FLASK.CHARGES); assert.ok(q.hp < hp0); assert.equal(s2.stats.drinks, 0); }
    s2.events.length = 0;
  }
  assert.ok(done, 'drink interrupted by a hit');
}

// 10. clearActions (pause / blur): charge, jump and drink are dropped and nothing fires afterwards
{
  const s = fresh(), p = s.player;
  stepN(s, 1, { attack: true, attackHeld: true }); stepN(s, 60, { attackHeld: true }); assert.equal(p.state, 'charge'); assert.ok(p.chargeFull);
  s.clearActions(); assert.equal(p.state, 'idle'); const seen = stepN(s, 30); assert.equal(s.stats.heavies, 0); assert.ok(!seen.includes('heavySwing'));
  s.step({ ...IN, jump: true }); stepN(s, 15); assert.ok(p.y > 0.3); s.clearActions(); assert.equal(p.y, 0); assert.equal(p.state, 'idle');
}
assert.equal(C.STEP, 1 / 60);
console.log('sim tests passed');
