// Deterministic gameplay simulation for 雨巷双刃 / Rainlane Blades.
// No rendering or DOM here: the same code runs in the browser and in Node tests.

export const DT = 1 / 60;
const TAU = Math.PI * 2;

export const ARENA = {
  yard: { minX: -11, maxX: 11, minZ: -9, maxZ: 9 },
  lane: { minX: -1.6, maxX: 1.6, minZ: 8, maxZ: 18 },
  engageZ: 7.4,
};
// Props at the yard edges (circle colliders).
export const OBSTACLES = [
  { x: -9.3, z: -7.3, r: 1.35 }, // barrel stack, NW
  { x: 9.2, z: -7.1, r: 1.5 }, // boiler, NE
  { x: 9.6, z: 7.6, r: 1.1 }, // crates, SE
  { x: -9.6, z: 7.5, r: 1.05 }, // rain vat, SW
];

export const PLAYER_R = 0.45;
export const BOSS_R = 0.62;

export const ATTACKS = [
  { wind: 0.13, act: 0.09, rec: 0.27, dmg: 8, step: 0.55 },
  { wind: 0.12, act: 0.09, rec: 0.27, dmg: 9, step: 0.55 },
  { wind: 0.19, act: 0.1, rec: 0.43, dmg: 15, step: 0.8 },
];
export const PUNISH_MULT = 1.8;
export const DEFLECT_MULT = 0.4;
export const GUARD_MULT = 0.25;
export const GUARD_HEAVY_MULT = 0.4;
export const PERFECT_WINDOW = 0.2;
export const DODGE = { dur: 0.4, inv: 0.3, dist: 3.8, cd: 0.62 };
const PLAYER_REACH = 2.75;
const PLAYER_ARC = 1.15;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function angDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
function turnToward(cur, target, maxStep) {
  const d = angDiff(target, cur);
  return cur + Math.max(-maxStep, Math.min(maxStep, d));
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function clampRect(x, z, r, rect) {
  return {
    x: clamp(x, rect.minX + r, rect.maxX - r),
    z: clamp(z, rect.minZ + r, rect.maxZ - r),
  };
}

// Keep a circle inside the walkable area (yard, plus the lane while the gate is open).
export function confine(ent, r, laneOpen) {
  const a = clampRect(ent.x, ent.z, r, ARENA.yard);
  let best = a;
  if (laneOpen) {
    const b = clampRect(ent.x, ent.z, r, ARENA.lane);
    const da = (a.x - ent.x) ** 2 + (a.z - ent.z) ** 2;
    const db = (b.x - ent.x) ** 2 + (b.z - ent.z) ** 2;
    if (db < da) best = b;
  }
  ent.x = best.x;
  ent.z = best.z;
  for (const o of OBSTACLES) {
    const dx = ent.x - o.x;
    const dz = ent.z - o.z;
    const d = Math.hypot(dx, dz);
    const min = o.r + r;
    if (d < min) {
      if (d < 1e-4) {
        ent.x = o.x + min;
      } else {
        ent.x = o.x + (dx / d) * min;
        ent.z = o.z + (dz / d) * min;
      }
      const c = clampRect(ent.x, ent.z, r, ARENA.yard);
      if (!laneOpen || ent.z < ARENA.yard.maxZ) {
        ent.x = c.x;
        ent.z = c.z;
      }
    }
  }
}

// ---------------------------------------------------------------- boss moves

function buildMove(name, phase, rng, dist) {
  const p2 = phase === 2;
  const segs = [];
  if (name === 'chain') {
    segs.push({ k: 'wind', d: p2 ? 0.36 : 0.5, tele: 'chain', turn: 7 });
    const gap = p2 ? 0.18 : 0.26;
    for (let i = 0; i < 3; i++) {
      segs.push({ k: 'hit', d: 0.1, dmg: 9, reach: 3.0, arc: 1.05, adv: 0.85, n: i, anim: i % 2 ? 'slashL' : 'slashR' });
      if (i < 2) segs.push({ k: 'gap', d: gap, turn: 5, n: i + 1 });
    }
    if (p2) {
      // Phase-two follow-up: a held coil, then a full-circle spinning sweep.
      segs.push({ k: 'hold', d: 0.42, tele: 'spin', turn: 3 });
      segs.push({ k: 'hit', d: 0.14, dmg: 16, reach: 3.4, arc: Math.PI, adv: 0.4, heavy: true, anim: 'spin', follow: 'spin' });
    }
    segs.push({ k: 'rec', d: p2 ? 0.95 : 1.15 });
  } else if (name === 'delay') {
    segs.push({ k: 'wind', d: p2 ? 0.7 : 0.85, tele: 'delay', turn: 5 });
    const hold = p2 ? [0.18, 0.5, 0.85][Math.floor(rng() * 3)] : 0.5;
    segs.push({ k: 'hold', d: hold, tele: 'delayHold', turn: 2.2 });
    segs.push({ k: 'hit', d: 0.12, dmg: 24, reach: 3.7, arc: 0.7, adv: 1.2, heavy: true, anim: 'slam' });
    if (p2 && rng() < 0.5) {
      // Mixed delays: a second overhead with a different pause.
      segs.push({ k: 'wind', d: 0.32, tele: 'delay', turn: 6, again: true });
      segs.push({ k: 'hold', d: [0.12, 0.6][Math.floor(rng() * 2)], tele: 'delayHold', turn: 2.2 });
      segs.push({ k: 'hit', d: 0.12, dmg: 20, reach: 3.7, arc: 0.7, adv: 1.2, heavy: true, anim: 'slam', follow: 'double' });
    }
    segs.push({ k: 'rec', d: p2 ? 1.15 : 1.4 });
  } else if (name === 'lunge') {
    segs.push({ k: 'wind', d: p2 ? 0.5 : 0.7, tele: 'lunge', turn: 8 });
    segs.push({ k: 'dash', d: 0.3, speed: 24, dmg: 18, reach: 2.0, arc: 1.2, anim: 'dash' });
    if (p2) {
      // Phase-two follow-up: a reverse cut after the lunge.
      segs.push({ k: 'hold', d: 0.32, tele: 'reverse', turn: 14 });
      segs.push({ k: 'hit', d: 0.12, dmg: 13, reach: 3.1, arc: 1.7, adv: 0.5, anim: 'reverse', follow: 'reverse' });
    }
    segs.push({ k: 'rec', d: p2 ? 1.0 : 1.25 });
  }
  void dist;
  return { name, phase, segs };
}

// ---------------------------------------------------------------- game state

export function createGame(opts = {}) {
  const g = {
    opts: {
      seed: opts.seed ?? 1,
      bossHpScale: opts.bossHpScale ?? 1,
      playerHpScale: opts.playerHpScale ?? 1,
    },
    mode: 'title',
    fights: 0,
  };
  resetFight(g);
  g.mode = 'title';
  return g;
}

export function resetFight(g) {
  g.rng = mulberry32(g.opts.seed + g.fights * 7919);
  g.fights++;
  g.mode = 'fight';
  g.time = 0;
  g.engaged = false;
  g.gateClosed = false;
  g.endT = 0;
  g.events = [];
  g.log = [];
  g.stats = {
    swings: 0, hitsLanded: 0, comboMax: 0, punishHits: 0, guarded: 0, perfect: 0,
    dodged: 0, hurt: 0, damageDealt: 0, damageTaken: 0, bossMoves: 0, followUps: 0,
  };
  const php = Math.max(1, Math.round(120 * g.opts.playerHpScale));
  const bhp = Math.max(2, Math.round(640 * g.opts.bossHpScale));
  g.player = {
    x: 0, z: 14.5, yaw: Math.PI, hp: php, maxHp: php,
    st: 'idle', t: 0, combo: 0, queued: false, hitDone: false,
    guard: false, guardT: 0, inv: 0, dodgeCd: 0, dodgeX: 0, dodgeZ: 0,
    bufAttack: 0, bufDodge: 0, moving: false, kx: 0, kz: 0, hurtDur: 0.4,
  };
  g.boss = {
    x: 0, z: -2.5, yaw: 0, hp: bhp, maxHp: bhp, phase: 1,
    st: 'wait', t: 0, move: null, si: 0, segT: 0, segDone: false,
    idleDur: 1.2, flash: 0, strafe: 1, last: '', repeat: 0,
    dashX: 0, dashZ: 0, dashLeft: 0, moving: false, burst: false,
  };
}

function emit(g, type, data) {
  const e = { type, t: +g.time.toFixed(3), ...data };
  g.events.push(e);
  g.log.push(e);
  if (g.log.length > 400) g.log.shift();
}

export function startFight(g) {
  if (g.mode === 'title') {
    g.mode = 'fight';
    emit(g, 'start', {});
  }
}

export function retry(g) {
  if (g.mode === 'victory' || g.mode === 'defeat') {
    resetFight(g);
    emit(g, 'retry', {});
  }
}

export function currentSeg(b) {
  return b.move ? b.move.segs[b.si] : null;
}

// Seconds until the next boss hit becomes active (0 while one is live, -1 if none pending).
export function hitIn(b) {
  if (!b.move || (b.st !== 'attack')) return -1;
  let t = -b.segT;
  for (let i = b.si; i < b.move.segs.length; i++) {
    const s = b.move.segs[i];
    if (s.k === 'hit' || s.k === 'dash') {
      if (i === b.si) {
        if (!b.segDone) return 0;
      } else return Math.max(0, t);
    }
    t += s.d;
  }
  return -1;
}

// ---------------------------------------------------------------- player

function stepPlayer(g, inp, dt) {
  const p = g.player;
  const b = g.boss;
  p.t += dt;
  p.inv = Math.max(0, p.inv - dt);
  p.dodgeCd = Math.max(0, p.dodgeCd - dt);
  p.moving = false;
  if (p.st === 'dead') return;

  let mx = inp.mx || 0;
  let mz = inp.mz || 0;
  const ml = Math.hypot(mx, mz);
  if (ml > 0.01) { mx /= ml; mz /= ml; } else { mx = 0; mz = 0; }
  const bossAlive = b.st !== 'dead';
  const toBoss = Math.atan2(b.x - p.x, b.z - p.z);
  const distBoss = Math.hypot(b.x - p.x, b.z - p.z);
  const faceBoss = inp.lock && g.engaged && bossAlive;

  p.bufAttack = inp.attack ? 0.22 : Math.max(0, p.bufAttack - dt);
  p.bufDodge = inp.dodge ? 0.18 : Math.max(0, p.bufDodge - dt);

  // Sidestep: cancels idle, guard, and the recovery part of a swing.
  const A = ATTACKS[p.combo];
  const canDodge = p.dodgeCd <= 0 && (p.st === 'idle' || (p.st === 'attack' && p.t >= A.wind + A.act));
  if (p.bufDodge > 0 && canDodge) {
    p.bufDodge = 0;
    if (ml > 0.01) { p.dodgeX = mx; p.dodgeZ = mz; }
    else { p.dodgeX = -Math.sin(p.yaw); p.dodgeZ = -Math.cos(p.yaw); }
    p.st = 'dodge'; p.t = 0; p.inv = Math.max(p.inv, DODGE.inv); p.dodgeCd = DODGE.cd;
    p.combo = 0; p.queued = false; p.guard = false;
    emit(g, 'dodge', {});
  }

  if (p.st === 'idle') {
    const guard = !!inp.guard && p.bufAttack <= 0;
    if (guard && !p.guard) { p.guardT = 0; emit(g, 'guardUp', {}); }
    p.guard = guard;
    if (guard) p.guardT += dt;
    if (p.bufAttack > 0) {
      p.bufAttack = 0;
      beginSwing(g, 0);
    } else {
      const sp = guard ? 2.0 : 5.4;
      p.x += mx * sp * dt;
      p.z += mz * sp * dt;
      p.moving = ml > 0.01;
      if (faceBoss) p.yaw = turnToward(p.yaw, toBoss, 14 * dt);
      else if (p.moving) p.yaw = turnToward(p.yaw, Math.atan2(mx, mz), 12 * dt);
    }
  } else if (p.st === 'attack') {
    p.guard = false;
    if (inp.attack && p.t > 0.04) p.queued = true;
    if (p.t < A.wind) {
      const assist = bossAlive && g.engaged && (faceBoss || distBoss < 4.5);
      if (assist) p.yaw = turnToward(p.yaw, toBoss, 16 * dt);
      else if (ml > 0.01) p.yaw = turnToward(p.yaw, Math.atan2(mx, mz), 10 * dt);
      if (!assist || distBoss > 1.7) {
        const v = A.step / A.wind;
        p.x += Math.sin(p.yaw) * v * dt;
        p.z += Math.cos(p.yaw) * v * dt;
      }
    }
    if (!p.hitDone && p.t >= A.wind) {
      p.hitDone = true;
      playerStrike(g, A);
    }
    const total = A.wind + A.act + A.rec;
    if (p.queued && p.combo < 2 && p.t >= A.wind + A.act + A.rec * 0.3) {
      beginSwing(g, p.combo + 1);
    } else if (p.t >= total) {
      p.st = 'idle'; p.t = 0; p.combo = 0; p.queued = false;
    }
  } else if (p.st === 'dodge') {
    p.guard = false;
    const v = (DODGE.dist / DODGE.dur) * 2 * (1 - p.t / DODGE.dur);
    p.x += p.dodgeX * v * dt;
    p.z += p.dodgeZ * v * dt;
    if (faceBoss) p.yaw = turnToward(p.yaw, toBoss, 10 * dt);
    if (p.t >= DODGE.dur) { p.st = 'idle'; p.t = 0; }
  } else if (p.st === 'hurt') {
    p.guard = false;
    const k = Math.max(0, 1 - p.t / p.hurtDur);
    p.x += p.kx * k * dt;
    p.z += p.kz * k * dt;
    if (p.t >= p.hurtDur) { p.st = 'idle'; p.t = 0; }
  }
}

function beginSwing(g, idx) {
  const p = g.player;
  p.st = 'attack'; p.t = 0; p.combo = idx; p.queued = false; p.hitDone = false; p.guard = false;
  g.stats.swings++;
  g.stats.comboMax = Math.max(g.stats.comboMax, idx + 1);
  emit(g, 'swing', { n: idx + 1 });
}

function playerStrike(g, A) {
  const p = g.player;
  const b = g.boss;
  if (!g.engaged || b.st === 'dead') return;
  const d = Math.hypot(b.x - p.x, b.z - p.z);
  const ang = Math.abs(angDiff(Math.atan2(b.x - p.x, b.z - p.z), p.yaw));
  if (d > PLAYER_REACH || ang > PLAYER_ARC) return;
  if (b.st === 'phase' || b.st === 'intro') {
    emit(g, 'clank', {});
    return;
  }
  const punish = b.st === 'recover';
  // A ready boss turns hits aside on its blades; only openings take full or bonus damage.
  const blocked = b.st === 'idle';
  const dmg = Math.max(1, Math.round(A.dmg * (punish ? PUNISH_MULT : blocked ? DEFLECT_MULT : 1)));
  damageBoss(g, dmg, punish, A.dmg, p.combo + 1, blocked);
}

function damageBoss(g, dmg, punish, base, n, blocked) {
  const b = g.boss;
  const before = b.hp;
  b.hp = Math.max(0, b.hp - dmg);
  b.flash = 0.16;
  g.stats.hitsLanded++;
  g.stats.damageDealt += before - b.hp;
  if (punish) g.stats.punishHits++;
  emit(g, 'bossHurt', { dmg, base, punish, blocked: !!blocked, n, hp: b.hp, phase: b.phase, bossSt: b.st });
  if (b.st === 'idle') b.idleDur = Math.min(b.idleDur, b.t + 0.3);
  if (b.hp <= 0) {
    b.st = 'dead'; b.t = 0; b.move = null;
    g.endT = 0;
    emit(g, 'bossDead', {});
  } else if (b.phase === 1 && b.hp <= b.maxHp / 2) {
    b.st = 'phase'; b.t = 0; b.move = null; b.burst = false;
    emit(g, 'phaseStart', {});
  }
}

function damagePlayer(g, seg, moveName) {
  const p = g.player;
  const b = g.boss;
  const raw = seg.dmg;
  if (p.st === 'dead') return 'none';
  if (p.inv > 0) {
    if (p.st === 'dodge') {
      g.stats.dodged++;
      emit(g, 'dodged', { move: moveName, raw });
    }
    return 'dodged';
  }
  const dirX = p.x - b.x;
  const dirZ = p.z - b.z;
  const dl = Math.hypot(dirX, dirZ) || 1;
  const frontal = Math.abs(angDiff(Math.atan2(b.x - p.x, b.z - p.z), p.yaw)) < 1.75;
  let dmg = raw;
  let guarded = false;
  let perfect = false;
  if (p.guard && frontal) {
    guarded = true;
    if (p.guardT <= PERFECT_WINDOW) { perfect = true; dmg = 0; }
    else dmg = Math.max(1, Math.round(raw * (seg.heavy ? GUARD_HEAVY_MULT : GUARD_MULT)));
  }
  const before = p.hp;
  p.hp = Math.max(0, p.hp - dmg);
  g.stats.damageTaken += before - p.hp;
  if (guarded) {
    if (perfect) g.stats.perfect++; else g.stats.guarded++;
    p.x += (dirX / dl) * 0.25;
    p.z += (dirZ / dl) * 0.25;
    if (seg.heavy && !perfect && p.hp > 0) {
      p.st = 'hurt'; p.t = 0; p.hurtDur = 0.28; p.kx = (dirX / dl) * 4; p.kz = (dirZ / dl) * 4; p.guard = false;
    }
  } else {
    g.stats.hurt++;
    p.st = 'hurt'; p.t = 0; p.hurtDur = 0.42; p.combo = 0; p.queued = false;
    p.kx = (dirX / dl) * 6; p.kz = (dirZ / dl) * 6;
    p.inv = 0.28;
  }
  emit(g, 'playerHurt', { raw, dmg, guarded, perfect, heavy: !!seg.heavy, move: moveName, hp: p.hp });
  if (p.hp <= 0) {
    p.st = 'dead'; p.t = 0; p.guard = false;
    g.endT = 0;
    emit(g, 'playerDead', {});
  }
  return guarded ? 'guarded' : 'hit';
}

// ---------------------------------------------------------------- boss

function pickMove(g, dist) {
  const b = g.boss;
  let name;
  if (dist > 5.2) name = 'lunge';
  else {
    const r = g.rng();
    name = r < 0.5 ? 'chain' : 'delay';
    if (dist > 3.9 && r > 0.8) name = 'lunge';
  }
  if (name === b.last) {
    b.repeat++;
    if (b.repeat >= 2) {
      name = name === 'chain' ? 'delay' : name === 'delay' ? 'chain' : (dist < 6 ? 'chain' : 'lunge');
      b.repeat = 0;
    }
  } else b.repeat = 0;
  b.last = name;
  return name;
}

function startMove(g, name) {
  const b = g.boss;
  const p = g.player;
  const dist = Math.hypot(p.x - b.x, p.z - b.z);
  b.move = buildMove(name, b.phase, g.rng, dist);
  b.st = 'attack'; b.t = 0; b.si = 0; b.segT = 0; b.segDone = false;
  g.stats.bossMoves++;
  emit(g, 'bossMove', {
    name, phase: b.phase,
    wind: b.move.segs[0].d,
    holds: b.move.segs.filter((s) => s.k === 'hold').map((s) => s.d),
    hits: b.move.segs.filter((s) => s.k === 'hit' || s.k === 'dash').length,
    rec: b.move.segs[b.move.segs.length - 1].d,
    follow: b.move.segs.filter((s) => s.follow).map((s) => s.follow),
  });
  emit(g, 'tele', { tele: b.move.segs[0].tele, d: b.move.segs[0].d });
}

function enterSeg(g) {
  const b = g.boss;
  const p = g.player;
  const s = currentSeg(b);
  b.segT = 0; b.segDone = false;
  if (s.k === 'rec') {
    b.st = 'recover';
    emit(g, 'recover', { d: s.d, move: b.move.name });
  } else if (s.k === 'dash') {
    const dx = p.x - b.x;
    const dz = p.z - b.z;
    const d = Math.hypot(dx, dz) || 1;
    b.yaw = Math.atan2(dx, dz);
    b.dashX = dx / d; b.dashZ = dz / d;
    b.dashLeft = clamp(d - 1.25, 0.8, 10.5);
    s.d = Math.max(0.12, b.dashLeft / s.speed);
    emit(g, 'bossSwing', { anim: 'dash', heavy: false });
  } else if (s.k === 'hit') {
    if (s.follow) { g.stats.followUps++; emit(g, 'followUp', { follow: s.follow, move: b.move.name }); }
    emit(g, 'bossSwing', { anim: s.anim, heavy: !!s.heavy });
  } else if (s.tele && (s.k === 'hold' || s.again)) {
    emit(g, 'tele', { tele: s.tele, d: s.d });
  }
}

function bossHitCheck(g, s) {
  const b = g.boss;
  const p = g.player;
  if (b.segDone) return;
  const dx = p.x - b.x;
  const dz = p.z - b.z;
  const d = Math.hypot(dx, dz);
  if (d > s.reach) return;
  if (Math.abs(angDiff(Math.atan2(dx, dz), b.yaw)) > s.arc) return;
  const res = damagePlayer(g, s, b.move.name);
  if (res !== 'none') b.segDone = true;
}

function stepBoss(g, dt) {
  const b = g.boss;
  const p = g.player;
  b.t += dt;
  b.flash = Math.max(0, b.flash - dt);
  b.moving = false;
  const dx = p.x - b.x;
  const dz = p.z - b.z;
  const dist = Math.hypot(dx, dz);
  const toP = Math.atan2(dx, dz);
  const p2 = b.phase === 2;

  if (b.st === 'wait') {
    b.yaw = turnToward(b.yaw, toP, 1.5 * dt);
    return;
  }
  if (b.st === 'intro') {
    b.yaw = turnToward(b.yaw, toP, 4 * dt);
    if (b.t >= 1.6) { b.st = 'idle'; b.t = 0; b.idleDur = 0.9; }
    return;
  }
  if (b.st === 'dead') return;
  if (b.st === 'phase') {
    b.yaw = turnToward(b.yaw, toP, 3 * dt);
    if (!b.burst && b.t >= 1.25) {
      b.burst = true;
      emit(g, 'burst', {});
      if (dist < 5.5 && p.st !== 'dead') {
        const nx = dist > 0.01 ? dx / dist : 0;
        const nz = dist > 0.01 ? dz / dist : 1;
        p.st = 'hurt'; p.t = 0; p.hurtDur = 0.45; p.guard = false; p.combo = 0;
        const push = (5.6 - dist) / 0.225; // integrates to roughly reach 5.6 m
        p.kx = nx * push; p.kz = nz * push;
      }
    }
    if (b.t >= 2.8) {
      b.phase = 2; b.st = 'idle'; b.t = 0; b.idleDur = 0.6;
      emit(g, 'phaseTwo', {});
    }
    return;
  }
  if (p.st === 'dead') {
    if (b.st === 'idle') { b.yaw = turnToward(b.yaw, toP, 3 * dt); return; }
  }

  if (b.st === 'idle') {
    b.yaw = turnToward(b.yaw, toP, 6 * dt);
    const sp = p2 ? 3.9 : 3.2;
    if (dist > 2.7) {
      b.x += Math.sin(b.yaw) * sp * dt;
      b.z += Math.cos(b.yaw) * sp * dt;
      b.moving = true;
    } else if (dist > 1.6) {
      // circle slowly
      b.x += Math.cos(b.yaw) * b.strafe * 1.1 * dt;
      b.z += -Math.sin(b.yaw) * b.strafe * 1.1 * dt;
      b.moving = true;
    }
    if (b.t >= b.idleDur) {
      if (dist <= 4.2 || dist > 5.2 || b.t > b.idleDur + 0.9) startMove(g, pickMove(g, dist));
    }
    return;
  }

  // attack / recover: run the segment timeline
  let s = currentSeg(b);
  b.segT += dt;
  if (s.k === 'wind' || s.k === 'gap' || s.k === 'hold') {
    b.yaw = turnToward(b.yaw, toP, (s.turn || 0) * dt);
  } else if (s.k === 'hit') {
    if (dist > 1.5 && s.adv) {
      const v = s.adv / s.d;
      b.x += Math.sin(b.yaw) * v * dt;
      b.z += Math.cos(b.yaw) * v * dt;
    }
    bossHitCheck(g, s);
  } else if (s.k === 'dash') {
    const stepLen = Math.min(b.dashLeft, s.speed * dt);
    if (dist > 1.2 || b.segDone) {
      b.x += b.dashX * stepLen;
      b.z += b.dashZ * stepLen;
    }
    b.dashLeft -= stepLen;
    bossHitCheck(g, s);
  }
  if (b.segT >= s.d) {
    b.si++;
    if (b.si >= b.move.segs.length) {
      b.move = null; b.st = 'idle'; b.t = 0;
      b.idleDur = p2 ? 0.45 + g.rng() * 0.5 : 1.1 + g.rng() * 0.7;
      b.strafe = g.rng() < 0.5 ? -1 : 1;
    } else enterSeg(g);
  }
}

function separate(g) {
  const p = g.player;
  const b = g.boss;
  if (b.st === 'dead') return;
  const dx = p.x - b.x;
  const dz = p.z - b.z;
  const d = Math.hypot(dx, dz);
  const min = PLAYER_R + BOSS_R;
  if (d >= min) return;
  const nx = d > 1e-4 ? dx / d : 0;
  const nz = d > 1e-4 ? dz / d : 1;
  const pen = min - d;
  p.x += nx * pen * 0.7; p.z += nz * pen * 0.7;
  b.x -= nx * pen * 0.3; b.z -= nz * pen * 0.3;
}

// ---------------------------------------------------------------- step

export function step(g, inp) {
  const dt = DT;
  if (g.mode !== 'fight') return;
  g.time += dt;
  const p = g.player;
  const b = g.boss;

  stepPlayer(g, inp, dt);
  if (!g.engaged && p.z < ARENA.engageZ) {
    g.engaged = true;
    g.gateClosed = true;
    b.st = 'intro'; b.t = 0;
    emit(g, 'engage', {});
  }
  stepBoss(g, dt);

  for (let i = 0; i < 2; i++) {
    separate(g);
    confine(p, PLAYER_R, !g.gateClosed);
    confine(b, BOSS_R, false);
  }

  if (b.st === 'dead') {
    g.endT += dt;
    if (g.endT >= 2.6) { g.mode = 'victory'; emit(g, 'victory', {}); }
  } else if (p.st === 'dead') {
    g.endT += dt;
    if (g.endT >= 2.0) { g.mode = 'defeat'; emit(g, 'defeat', {}); }
  }
}

export function drainEvents(g) {
  const e = g.events;
  g.events = [];
  return e;
}
