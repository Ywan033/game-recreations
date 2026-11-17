// Code-level tests of the controls pass (jump, charged heavy, healing flask) in the fixed-step
// simulation. No browser and no real input: these call step() directly and may set state.
// They are reported separately from the real-input offline suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, startFight, step, retry, hitIn, ARENA, PLAYER_R, ATTACKS,
  JUMP, CHARGE, HEAVY, FLASK, DT, cancelActions,
} from '../src/sim.js';

const idle = { mx: 0, mz: 0, attack: false, guard: false, dodge: false, lock: true };

function run(g, frames, fn) {
  for (let i = 0; i < frames && g.mode === 'fight'; i++) step(g, fn ? fn(g, i) : idle);
}
function collect(g, frames, fn) {
  const all = [];
  for (let i = 0; i < frames && g.mode === 'fight'; i++) {
    if (g.parked && g.boss.st === 'idle') g.boss.idleDur = 1e9; // a struck boss would otherwise answer
    step(g, fn ? fn(g, i) : idle);
    all.push(...g.events);
    g.events = [];
  }
  return all;
}
// a fight with the boss parked in its ready stance next to the player (no attacks for a long while)
function parked(seed = 3) {
  const g = createGame({ seed });
  startFight(g);
  for (let i = 0; i < 400 && !g.engaged; i++) step(g, { ...idle, mz: -1 });
  assert.equal(g.engaged, true);
  g.parked = true;
  const p = g.player, b = g.boss;
  b.st = 'idle'; b.t = 0; b.idleDur = 1e9; b.move = null;
  p.x = 0; p.z = 2.2; p.yaw = Math.PI; b.x = 0; b.z = 0; b.yaw = 0;
  g.events = [];
  return g;
}
const oneHit = () => ({ name: 'chain', phase: 1, segs: [{ k: 'hit', d: 0.1, dmg: 9, reach: 3, arc: 1.05, adv: 0, anim: 'slashR' }, { k: 'rec', d: 0.2 }] });
function bossStrikesNow(g) {
  const b = g.boss;
  b.st = 'attack'; b.si = 0; b.segT = 0; b.segDone = false; b.move = oneHit();
}

test('jump: edge-triggered, take-off / air / landing, air steering stays inside the walls', () => {
  const g = createGame({ seed: 3 });
  startFight(g);
  const seen = [];
  let apex = 0;
  // Space held the whole time while running into the lane wall
  const ev = collect(g, 150, (gg) => {
    const st = gg.player.st;
    if (seen[seen.length - 1] !== st) seen.push(st);
    apex = Math.max(apex, gg.player.y);
    assert.ok(gg.player.x <= ARENA.lane.maxX - PLAYER_R + 1e-6, 'airborne player stays inside the lane wall');
    return { ...idle, mx: 1, jump: true };
  });
  assert.equal(ev.filter((e) => e.type === 'jump').length, 1, 'holding jump does not re-jump');
  assert.equal(ev.filter((e) => e.type === 'land').length, 1);
  assert.deepEqual(seen.slice(0, 5), ['idle', 'jumpStart', 'air', 'land', 'idle']);
  assert.ok(Math.abs(apex - (JUMP.v0 ** 2) / (2 * JUMP.g)) < 0.12, 'apex ' + apex);
  assert.equal(g.player.y, 0);
  assert.equal(g.stats.jumps, 1);
  // a second, separate press jumps again; normal input works after landing
  const ev3 = collect(g, 120, (gg, i) => ({ ...idle, jump: i >= 5 && i < 8, attack: i === 90 }));
  assert.equal(ev3.filter((e) => e.type === 'jump').length, 1);
  assert.equal(ev3.filter((e) => e.type === 'swing').length, 1);
  // air steering: a standing jump with the stick pushed in the air covers some ground
  const a = createGame({ seed: 3 }); startFight(a);
  const z0 = a.player.z;
  collect(a, 8, () => ({ ...idle, jump: true }));
  collect(a, 40, () => ({ ...idle, mz: -1, jump: true }));
  const steer = z0 - a.player.z;
  console.log(`apex ${apex.toFixed(2)} m; standing jump steered ${steer.toFixed(2)} m`);
  assert.ok(steer > 0.4 && steer < 3.2, 'steered ' + steer);
});

test('jump gives no free invulnerability: low sweeps pass under, other hits land', () => {
  let over = 0, airHits = 0;
  for (const seed of [1, 2, 4, 7, 9, 11]) {
    const g = createGame({ seed, playerHpScale: 20 });
    startFight(g);
    const ev = collect(g, 60 * 150, (gg) => {
      const b = gg.boss, p = gg.player;
      if (!gg.engaged) return { ...idle, mz: -1 };
      const h = hitIn(b);
      const d = Math.hypot(b.x - p.x, b.z - p.z) || 1;
      const inp = { ...idle };
      // back off so the boss lunges; hop just before any hit arrives
      if (b.st !== 'attack' && d < 7) { inp.mx = (p.x - b.x) / d; inp.mz = (p.z - b.z) / d; }
      inp.jump = b.st === 'attack' && h >= 0 && h < 0.22;
      return inp;
    });
    for (const e of ev) {
      if (e.type === 'jumpedOver') { over++; assert.ok(e.anim === 'dash' || e.anim === 'spin'); }
      if (e.type === 'playerHurt' && e.airborne) { airHits++; assert.equal(e.dmg, e.raw); }
    }
  }
  console.log(`jumped over ${over} low attacks; ${airHits} other hits landed on an airborne player at full damage`);
  assert.ok(over > 0, 'a low attack was jumped');
  assert.ok(airHits > 0, 'non-low attacks still hit in the air');
});

test('attack key: tap = one light, early release = one light, full hold = one heavy, never both', () => {
  // tap
  let g = parked();
  let ev = collect(g, 90, (gg, i) => ({ ...idle, attack: i === 0, attackHeld: i < 2 }));
  let hits = ev.filter((e) => e.type === 'bossHurt');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].heavy, false);
  assert.ok(Math.abs(hits[0].t - ev.find((e) => e.type === 'swing').t - ATTACKS[0].wind) < DT * 1.5, 'tap hit lands after the unchanged wind-up');
  assert.equal(g.stats.heavies, 0);
  // early release (held past the wind-up, let go before the charge is full)
  g = parked();
  const holdFrames = Math.round((ATTACKS[0].wind + CHARGE.full * 0.5) / DT);
  ev = collect(g, 120, (gg, i) => ({ ...idle, attack: i === 0, attackHeld: i < holdFrames }));
  hits = ev.filter((e) => e.type === 'bossHurt');
  assert.equal(ev.filter((e) => e.type === 'chargeStart').length, 1);
  assert.equal(ev.filter((e) => e.type === 'charged').length, 0);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].heavy, false);
  assert.equal(g.stats.heavies, 0);
  assert.equal(g.player.st, 'idle');
  // full hold
  g = parked();
  const full = Math.round((ATTACKS[0].wind + CHARGE.full + 0.2) / DT);
  ev = collect(g, 200, (gg, i) => ({ ...idle, attack: i === 0, attackHeld: i < full }));
  hits = ev.filter((e) => e.type === 'bossHurt');
  assert.equal(ev.filter((e) => e.type === 'charged').length, 1);
  assert.equal(hits.length, 1, 'exactly one strike from one input');
  assert.equal(hits[0].heavy, true);
  assert.equal(hits[0].base, HEAVY.dmg);
  assert.equal(g.stats.heavies, 1);
  assert.equal(g.stats.heavyHits, 1);
  assert.equal(g.player.st, 'idle');
  assert.equal(g.player.chargeT, 0);
  // held forever: auto-release at maxHold, still exactly one heavy and nothing afterwards
  g = parked();
  ev = collect(g, Math.round((CHARGE.maxHold + 3) / DT), (gg, i) => ({ ...idle, attack: i === 0, attackHeld: true }));
  assert.equal(ev.filter((e) => e.type === 'bossHurt').length, 1);
  assert.equal(g.stats.heavies, 1);
  assert.equal(g.stats.swings, 1);
});

test('three quick presses still make the 3-hit combo with the original timing', () => {
  const g = parked();
  const press = [0, 14, 40];
  const ev = collect(g, 150, (gg, i) => ({ ...idle, attack: press.includes(i), attackHeld: press.some((f) => i >= f && i < f + 4) }));
  const hits = ev.filter((e) => e.type === 'bossHurt');
  assert.deepEqual(hits.map((h) => h.n), [1, 2, 3]);
  assert.equal(g.stats.comboMax, 3);
  assert.equal(g.stats.heavies, 0);
  const t0 = ev.find((e) => e.type === 'swing').t;
  const A = ATTACKS;
  const second = A[0].wind + A[0].act + A[0].rec * 0.3 + A[1].wind;
  assert.ok(Math.abs(hits[0].t - t0 - A[0].wind) < DT * 1.5);
  assert.ok(Math.abs(hits[1].t - t0 - second) < DT * 2.5);
});

test('a hit interrupts the charge; pause/blur cancel clears it; no stray swing afterwards', () => {
  const h = parked(5);
  collect(h, 20, (gg, i) => ({ ...idle, attack: i === 0, attackHeld: true }));
  assert.equal(h.player.st, 'charge');
  bossStrikesNow(h);
  const ev2 = collect(h, 120, () => ({ ...idle, attackHeld: true }));
  assert.equal(ev2.filter((e) => e.type === 'chargeBreak').length, 1);
  assert.equal(ev2.filter((e) => e.type === 'playerHurt').length, 1);
  assert.equal(ev2.filter((e) => e.type === 'bossHurt').length, 0);
  assert.equal(ev2.filter((e) => e.type === 'swing').length, 0, 'still holding after the hit starts nothing');
  assert.equal(h.stats.heavies, 0);
  assert.equal(h.player.chargeT, 0);
  assert.equal(h.player.charged, false);
  // pause / blur
  const c = parked();
  collect(c, 30, (gg, i) => ({ ...idle, attack: i === 0, attackHeld: true }));
  assert.equal(c.player.st, 'charge');
  cancelActions(c);
  assert.equal(c.player.st, 'idle');
  const ev3 = collect(c, 90, () => idle);
  assert.equal(ev3.filter((e) => e.type === 'bossHurt' || e.type === 'swing').length, 0);
  // death clears it too
  const d = parked();
  collect(d, 30, (gg, i) => ({ ...idle, attack: i === 0, attackHeld: true }));
  d.player.hp = 1;
  bossStrikesNow(d);
  collect(d, 30, () => ({ ...idle, attackHeld: true }));
  assert.equal(d.player.st, 'dead');
  assert.equal(d.player.chargeT, 0);
  assert.equal(d.stats.heavies, 0);
});

test('flask: one charge and one heal per drink at one moment, capped, refused when full or empty, restored on retry', () => {
  const g = parked();
  const p = g.player;
  const amount = Math.round(p.maxHp * FLASK.healFrac);
  assert.equal(p.flask, FLASK.charges);
  // full health: refused, nothing spent
  let ev = collect(g, 60, (gg, i) => ({ ...idle, drink: i === 0 }));
  assert.equal(ev.filter((e) => e.type === 'drinkFail' && e.reason === 'full').length, 1);
  assert.equal(p.flask, FLASK.charges);
  // damaged: R held for 5 s drinks exactly once
  p.hp = 20;
  let hpBefore = null, flaskBefore = null;
  ev = [];
  for (let i = 0; i < 300; i++) {
    const hp0 = p.hp, f0 = p.flask;
    step(g, { ...idle, drink: true });
    if (p.hp !== hp0 || p.flask !== f0) {
      assert.ok(p.hp !== hp0 && p.flask !== f0, 'charge and heal happen in the same step');
      hpBefore = hp0; flaskBefore = f0;
    }
    ev.push(...g.events); g.events = [];
  }
  const heals = ev.filter((e) => e.type === 'heal');
  assert.equal(heals.length, 1);
  assert.equal(heals[0].amount, amount);
  assert.equal(p.hp, hpBefore + amount);
  assert.equal(p.flask, flaskBefore - 1);
  assert.ok(Math.abs(heals[0].t - ev.find((e) => e.type === 'drink').t - FLASK.wind) < DT * 1.5);
  // cap at max health
  p.hp = p.maxHp - 5;
  ev = collect(g, 90, (gg, i) => ({ ...idle, drink: i === 3 })); // (a fresh press after the long hold)
  assert.equal(ev.find((e) => e.type === 'heal').amount, 5);
  assert.equal(p.hp, p.maxHp);
  assert.equal(p.flask, FLASK.charges - 2);
  // interrupted before the sip: nothing spent, nothing healed
  p.hp = 30;
  collect(g, 10, (gg, i) => ({ ...idle, drink: i === 0 }));
  assert.equal(p.st, 'drink');
  bossStrikesNow(g);
  ev = collect(g, 90, () => idle);
  assert.equal(ev.filter((e) => e.type === 'drinkBreak').length, 1);
  assert.equal(ev.filter((e) => e.type === 'heal').length, 0);
  assert.equal(p.hp, 30 - 9);
  assert.equal(p.flask, FLASK.charges - 2);
  // hit after the sip: both have already happened
  g.boss.st = 'idle'; g.boss.move = null; g.boss.idleDur = 1e9; g.boss.t = 0;
  collect(g, Math.round(FLASK.wind / DT) + 3, (gg, i) => ({ ...idle, drink: i === 0 }));
  assert.equal(p.st, 'drink');
  bossStrikesNow(g);
  collect(g, 60, () => idle);
  assert.equal(p.flask, FLASK.charges - 3);
  assert.equal(p.hp, 21 + amount - 9);
  // empty: refused
  g.boss.st = 'idle'; g.boss.move = null; g.boss.idleDur = 1e9; g.boss.t = 0;
  p.hp = 10;
  ev = collect(g, 120, (gg, i) => ({ ...idle, drink: i === 40 }));
  assert.equal(ev.filter((e) => e.type === 'drinkFail' && e.reason === 'empty').length, 1);
  assert.equal(p.hp, 10);
  assert.equal(p.flask, 0);
  // retry restores the charges
  p.hp = 0; p.st = 'dead'; g.endT = 0;
  run(g, 200);
  assert.equal(g.mode, 'defeat');
  retry(g);
  assert.equal(g.player.flask, FLASK.charges);
  assert.equal(g.player.y, 0);
  assert.equal(g.player.chargeT, 0);
});
