// Reedmoon Duel — deterministic fight simulation (no rendering, no DOM).
// Stepped at a fixed timestep by main.js; also runnable under Node for code-level tests.

export const C = {
  STEP: 1 / 60,
  ARENA_R: 10.5,
  DEFLECT_WINDOW: 0.22, // guard pressed at most this long before a hit lands => Glance (deflect)
  DEFLECT_SPAM_WINDOW: 0.1, // window when guard is being mashed
  SPAM_GAP: 0.25,
  COUNTER_WINDOW: 0.38, // forward step started at most this long before the thrust lands => Bind-Step
  PLAYER_HP: 100,
  BOSS_HP: 100,
  STANCE_MAX: 100,
  MOVE_SPEED: 5.2,
  GUARD_SPEED: 2.2,
  DODGE_TIME: 0.4,
  DODGE_DIST: 3.0,
  ATTACK_REACH: 2.8,
  FINISH_RANGE: 3.6,
  BROKEN_TIME: 5.5,
  FINISHER_TIME: 1.9,
  FINISHER_IMPACT: 1.05,
  INTRO_TIME: 2.2,
};

// ---- controls pass: jump, charged heavy cut (Reaping Cut) and the healing flask (Dew Gourd).
// All tuning for the three lives in these blocks. Times in seconds, distances in metres.
export const JUMP = {
  TAKEOFF: 0.08, // grounded crouch before leaving the ground
  V0: 6.4, G: 21, // peak ~0.98 m, ~0.61 s airborne
  LAND: 0.14, // landing recovery before normal input returns
  AIR_SPEED: 4.6, AIR_ACCEL: 9, // moderate air steering
};
export const CHARGE = {
  COMMIT: 0.12, // attack still held this long after the press => the cut becomes a charge (before the light hit frame)
  FULL: 0.65,// held this long after the press => fully charged; release from here on is a heavy cut
  MOVE: 1.3, // walking speed while charging
  HIT: 0.18, RECOVER: 0.85, DODGE_AFTER: 0.5, REACH: 3.2,
  DMG: 18, DMG_BROKEN: 24, STANCE: 15, // against an open Warden (attacking, pinned, Unbalanced)
  CHIP: 6, CHIP_STANCE: 11, // against the Warden's guard: beats it down, small chip, no riposte
};
export const FLASK = {
  CHARGES: 3, HEAL: 38,
  SIP: 0.7, // the single moment at which one charge is consumed and the heal applied
  RECOVER: 0.35, MOVE: 1.4,
};

const S = (t, side, o = {}) => ({ t, side, type: 'slash', dmg: 12, gs: 16, ds: 9, reach: 3.1, arc: 0.3, lunge: 1.2, lt: 0.2, ...o });
const HEAVY = (t, o = {}) => ({ t, side: 'O', type: 'heavy', dmg: 30, gs: 45, ds: 20, reach: 3.4, arc: 0.35, lunge: 2.2, lt: 0.25, ...o });
const THRUST = (t, o = {}) => ({ t, side: 'T', type: 'thrust', dmg: 34, gs: 0, ds: 0, reach: 4.6, arc: 0.8, lunge: 3.8, lt: 0.22, cue: 0.9, ...o });

// Boss move table. Times are seconds from the start of the move.
export const MOVES = {
  string3: { label: 'Three-Stalk Cut', range: 3.4, dur: 2.45, hits: [S(0.7, 'R'), S(1.15, 'L'), S(1.65, 'O', { dmg: 16, gs: 20, ds: 11 })] },
  quick2: { label: 'Twin Rustle', range: 3.2, dur: 1.7, hits: [S(0.55, 'L', { dmg: 10, gs: 14 }), S(0.95, 'R', { dmg: 10, gs: 14 })] },
  heavy: { label: 'Fenfall', range: 4.2, dur: 2.3, hits: [HEAVY(1.2)] },
  thrust: { label: 'Bittern Lunge', range: 6.5, dur: 2.2, hits: [THRUST(1.05)] },
  // phase two only
  string5: {
    label: 'Gale Through Reeds', range: 3.6, dur: 3.15, p2: true,
    hits: [S(0.55, 'R'), S(0.9, 'L'), S(1.25, 'R'), S(1.95, 'L', { lunge: 1.8 }), S(2.3, 'O', { dmg: 16, gs: 20, ds: 11 })],
  },
  feint: { label: 'False Tide', range: 4.0, dur: 3.0, p2: true, hits: [S(0.95, 'O', { dmg: 14 }), THRUST(1.95, { cue: 0.75 })] },
  leap: { label: 'Moonward Drop', range: 8.5, dur: 2.4, p2: true, hits: [HEAVY(1.25, { lunge: 6.5, lt: 0.5, leap: true })] },
};
const BAGS = { 1: ['string3', 'heavy', 'thrust', 'quick2'], 2: ['string5', 'feint', 'thrust', 'leap', 'string3'] };

function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const turnTo = (cur, target, max) => { const d = angDiff(target, cur); return cur + clamp(d, -max, max); };
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

export function createSim(opts = {}) {
  const gain = opts.gain || 1; // scales stance gained by the boss (test option)
  const hurt = opts.hurt || 1; // scales health damage dealt to the player (test option)
  const s = { opts: { seed: opts.seed || 0, gain, hurt }, events: [] };
  let rand;

  function reset() {
    rand = rng(opts.seed || ((Math.random() * 1e9) | 0));
    s.mode = 'intro'; s.time = 0; s.modeT = 0; s.hitstop = 0; s.hitSeq = 0; s.chain = 0; s.promptOpen = false;
    s.player = { x: 0, z: 5, face: Math.PI, hp: C.PLAYER_HP, stance: 0, state: 'idle', t: 0, combo: 0, guardHeld: false, pressT: -9, prevPress: -9, speed: 0, hitDone: false, queued: false, dx: 0, dz: 0, dodgeFwd: false, stanceIdle: 0, kx: 0, kz: 0, fAng: 0, lastDeflectT: -9, y: 0, vy: 0, jvx: 0, jvz: 0, flask: FLASK.CHARGES, drank: false, chargeFull: false };
    s.boss = { x: 0, z: -4, face: 0, hp: C.BOSS_HP, stance: 0, state: 'approach', t: 0, move: null, hitIdx: 0, phase: 1, bag: [], next: null, last: null, blockStreak: 0, cooldown: 1.2, stanceIdle: 0, strafe: 1, speed: 0, cueT: -9, movesSeen: { 1: [], 2: [] } };
    s.stats = { swings: 0, hitsDealt: 0, blocked: 0, guards: 0, deflects: 0, maxChain: 0, counters: 0, breaks: 0, finishers: 0, hitsTaken: 0, evades: 0, dodges: 0, playerBreaks: 0, cues: 0, jumps: 0, lands: 0, heavies: 0, heavyHits: 0, chargeFulls: 0, chargeBreaks: 0, drinks: 0, drinkFails: 0, drinkBreaks: 0, healed: 0 };
    s.events.length = 0;
    pickNext();
  }
  const ev = (type, data) => s.events.push({ type, ...data });

  function pickNext() {
    const b = s.boss;
    if (!b.bag.length) {
      const src = BAGS[b.phase].slice();
      for (let i = src.length - 1; i > 0; i--) { const j = (rand() * (i + 1)) | 0; [src[i], src[j]] = [src[j], src[i]]; }
      if (src[src.length - 1] === b.last) src.reverse();
      b.bag = src;
    }
    b.next = b.bag.pop();
  }

  function nextHit() {
    const b = s.boss;
    if (b.state !== 'attack') return null;
    const h = MOVES[b.move].hits[b.hitIdx];
    return h ? { inT: h.t - b.t, type: h.type, idx: b.hitIdx, of: MOVES[b.move].hits.length } : null;
  }
  s.nextHit = nextHit;

  function addBossStance(v) {
    const b = s.boss;
    b.stance = Math.min(C.STANCE_MAX, b.stance + v * gain);
    b.stanceIdle = 0;
    if (b.stance >= C.STANCE_MAX && (b.state === 'approach' || b.state === 'attack' || b.state === 'block' || b.state === 'pinned')) {
      b.state = 'broken'; b.t = 0; s.stats.breaks++; s.chain = 0;
      ev('break', { x: b.x, z: b.z });
    }
  }

  function playerAttackHit(heavy = false) {
    const p = s.player, b = s.boss;
    const dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz);
    const dot = (Math.sin(p.face) * dx + Math.cos(p.face) * dz) / (d || 1);
    if (d > (heavy ? CHARGE.REACH : C.ATTACK_REACH) || dot < 0.3) return;
    const mx = (p.x + b.x) / 2, mz = (p.z + b.z) / 2;
    const open = b.state === 'broken' || b.state === 'pinned' || b.state === 'attack';
    if (b.state === 'finished' || b.state === 'phaseShift' || b.state === 'dying') return;
    if (open || (!heavy && b.state === 'approach' && rand() < 0.3)) {
      const dmg = heavy ? (b.state === 'broken' ? CHARGE.DMG_BROKEN : CHARGE.DMG) : b.state === 'broken' ? 11 : 7;
      b.hp = Math.max(0, b.hp - dmg);
      s.stats.hitsDealt++; if (heavy) s.stats.heavyHits++;
      ev('hitBoss', { x: mx, z: mz, heavy });
      addBossStance(b.hp <= 0 ? C.STANCE_MAX : (heavy ? CHARGE.STANCE : 6) * (1 + (1 - b.hp / C.BOSS_HP) * 0.8));
    } else if (heavy) {
      // Reaping Cut on a raised guard: the guard is beaten down (chip + Balance), no riposte follows
      b.hp = Math.max(1, b.hp - CHARGE.CHIP);
      s.stats.blocked++; s.stats.heavyHits++;
      ev('bossBlock', { x: mx, z: mz, heavy: true });
      addBossStance(CHARGE.CHIP_STANCE);
      if (b.state !== 'broken') { b.state = 'block'; b.t = 0; }
    } else {
      s.stats.blocked++; b.blockStreak++;
      ev('bossBlock', { x: mx, z: mz });
      addBossStance(4);
      if (b.state === 'broken') return;
      b.state = 'block'; b.t = 0;
      if (b.blockStreak >= (b.phase === 2 ? 2 : 3)) {
        // the boss turns the blade aside and answers at once
        b.blockStreak = 0; ev('bossDeflect', { x: mx, z: mz });
        p.state = 'stagger'; p.t = 0.15; p.kx = -dx / (d || 1) * 2; p.kz = -dz / (d || 1) * 2;
        startMove('quick2');
      }
    }
  }

  function startMove(name) {
    const b = s.boss;
    b.state = 'attack'; b.move = name; b.t = 0; b.hitIdx = 0; b.last = name; s.chain = 0;
    const seen = b.movesSeen[b.phase]; if (!seen.includes(name)) seen.push(name);
    ev('bossMove', { move: name });
  }

  function hurtPlayer(h, dirx, dirz) {
    const p = s.player;
    // a blow interrupts a charge (no cut comes out) and a drink before the sip (nothing consumed, nothing healed)
    if (p.state === 'charge' || (p.state === 'heavy' && !p.hitDone)) { s.stats.chargeBreaks++; ev('chargeBreak', {}); }
    if (p.state === 'drink' && !p.drank) { s.stats.drinkBreaks++; ev('drinkBreak', {}); }
    p.chargeFull = false;
    p.hp = Math.max(0, p.hp - h.dmg * hurt);
    s.stats.hitsTaken++; s.chain = 0;
    ev('hitPlayer', { x: p.x, z: p.z, heavy: h.type !== 'slash' });
    const k = h.type === 'slash' ? 2.5 : 5;
    p.kx = dirx * k; p.kz = dirz * k;
    if (p.hp <= 0) { p.state = 'dead'; p.t = 0; ev('playerDown', {}); } else { p.state = 'stagger'; p.t = h.type === 'slash' ? 0 : -0.2; }
  }

  function bossHit(h, last) {
    const p = s.player, b = s.boss;
    s.hitSeq++;
    ev('bossSwing', { kind: h.type });
    if (p.state === 'dead' || p.state === 'counter' || p.state === 'finisher') return;
    const dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz) || 1;
    const fx = Math.sin(b.face), fz = Math.cos(b.face);
    const dot = (fx * dx + fz * dz) / d;
    const stepIn = h.type === 'thrust' && p.state === 'dodge' && p.dodgeFwd && p.t <= C.COUNTER_WINDOW && d <= h.reach + 0.6 && dot > 0.3;
    if (!stepIn && (d > h.reach || dot < h.arc)) { s.chain = 0; return; }
    const mx = b.x + dx * 0.6, mz = b.z + dz * 0.6;
    const iframe = p.state === 'dodge' && p.t >= 0.02 && p.t <= 0.3;
    if (h.type === 'thrust') {
      if (p.state === 'dodge' && p.dodgeFwd && p.t <= C.COUNTER_WINDOW) {
        // Bind-Step: step inside the lunge and pin the blade down
        s.stats.counters++; s.hitstop = 0.12;
        p.state = 'counter'; p.t = 0; p.face = Math.atan2(-dx, -dz);
        p.x = b.x + fx * 1.55 - fz * 0.45; p.z = b.z + fz * 1.55 + fx * 0.45;
        b.state = 'pinned'; b.t = 0;
        ev('counter', { x: mx, z: mz });
        addBossStance(32);
        return;
      }
      if (iframe) { s.stats.evades++; ev('evade', {}); return; }
      hurtPlayer(h, fx, fz);
      return;
    }
    if (iframe) { s.stats.evades++; ev('evade', {}); return; }
    if (p.state === 'guard') {
      const w = p.pressT - p.prevPress < C.SPAM_GAP ? C.DEFLECT_SPAM_WINDOW : C.DEFLECT_WINDOW;
      if (s.time - p.pressT <= w) {
        s.stats.deflects++; s.chain++; s.stats.maxChain = Math.max(s.stats.maxChain, s.chain);
        s.hitstop = 0.05; p.stanceIdle = 0.6; p.lastDeflectT = s.time;
        ev('deflect', { x: mx, z: mz, chain: s.chain, heavy: h.type === 'heavy' });
        addBossStance(h.ds + (last && s.chain >= 3 ? 8 : 0));
        return;
      }
      s.stats.guards++; s.chain = 0;
      p.stance = Math.min(C.STANCE_MAX, p.stance + h.gs); p.stanceIdle = 0;
      p.kx = fx * 2.2; p.kz = fz * 2.2;
      ev('guard', { x: mx, z: mz, heavy: h.type === 'heavy' });
      if (p.stance >= C.STANCE_MAX) { p.state = 'broken'; p.t = 0; s.stats.playerBreaks++; ev('playerBroken', {}); }
      return;
    }
    hurtPlayer(h, fx, fz);
  }

  function stepPlayer(dt, inp) {
    const p = s.player, b = s.boss;
    const toB = Math.atan2(b.x - p.x, b.z - p.z);
    const dist = Math.hypot(b.x - p.x, b.z - p.z);
    if (inp.guardPress) { p.prevPress = p.pressT; p.pressT = s.time; }
    p.guardHeld = !!inp.guard;
    const ml = Math.hypot(inp.mx, inp.mz);
    let mvx = 0, mvz = 0;
    p.t += dt;
    s.promptOpen = b.state === 'broken' && dist <= C.FINISH_RANGE && (p.state === 'idle' || p.state === 'guard' || p.state === 'attack');

    const startDodge = () => {
      let dx = inp.mx, dz = inp.mz;
      if (ml < 0.2) { dx = -Math.sin(p.face); dz = -Math.cos(p.face); } else { dx /= ml; dz /= ml; }
      p.dx = dx; p.dz = dz;
      p.dodgeFwd = (dx * (b.x - p.x) + dz * (b.z - p.z)) / (dist || 1) > 0.5;
      // a forward step is drawn straight onto the foe's line so it meets a lunge head-on
      if (p.dodgeFwd && dist > 0.01) { p.dx = (b.x - p.x) / dist; p.dz = (b.z - p.z) / dist; }
      p.state = 'dodge'; p.t = 0; s.stats.dodges++; ev('dodge', {});
    };
    const startAttack = (combo) => {
      p.state = 'attack'; p.t = 0; p.combo = combo; p.hitDone = false; p.queued = false; s.stats.swings++;
      if (inp.locked || Math.abs(angDiff(toB, p.face)) < 1.2) p.face = toB;
      ev('swing', { combo });
    };
    const startFinisher = () => {
      p.state = 'finisher'; p.t = 0; p.fAng = Math.atan2(p.x - b.x, p.z - b.z); p.hitDone = false;
      b.state = 'finished'; b.t = 0; s.stats.finishers++; s.promptOpen = false;
      ev('finisherStart', { n: b.phase });
    };

    const walk = (sp) => { if (ml > 0.1) { mvx = inp.mx / Math.max(1, ml) * sp; mvz = inp.mz / Math.max(1, ml) * sp; } };
    const tryDrink = () => {
      if (p.flask <= 0 || p.hp >= C.PLAYER_HP) { s.stats.drinkFails++; ev('drinkFail', { empty: p.flask <= 0 }); return false; }
      p.state = 'drink'; p.t = 0; p.drank = false; ev('drinkStart', {});
      return true;
    };

    switch (p.state) {
      case 'idle':
      case 'guard': {
        if (s.promptOpen && (inp.finisher || inp.attack)) { startFinisher(); break; }
        if (inp.dodge) { startDodge(); break; }
        if (inp.jump) {
          p.state = 'takeoff'; p.t = 0; s.stats.jumps++; ev('jump', {});
          p.jvx = ml > 0.1 ? inp.mx / Math.max(1, ml) * C.MOVE_SPEED : 0; p.jvz = ml > 0.1 ? inp.mz / Math.max(1, ml) * C.MOVE_SPEED : 0;
          break;
        }
        if (inp.drink && tryDrink()) break;
        if (inp.attack) { startAttack(0); break; }
        p.state = p.guardHeld ? 'guard' : 'idle';
        const sp = p.state === 'guard' ? C.GUARD_SPEED : C.MOVE_SPEED;
        if (ml > 0.1) { mvx = inp.mx / Math.max(1, ml) * sp; mvz = inp.mz / Math.max(1, ml) * sp; }
        if (p.state === 'guard' || inp.locked) p.face = turnTo(p.face, toB, 14 * dt);
        else if (ml > 0.1) p.face = turnTo(p.face, Math.atan2(inp.mx, inp.mz), 12 * dt);
        break;
      }
      case 'attack': {
        if (s.promptOpen && inp.finisher) { startFinisher(); break; }
        if (inp.attack && p.t > 0.08) p.queued = true;
        // still held just before the hit frame: this input becomes a charge and the light cut never lands
        if (!p.hitDone && p.t >= CHARGE.COMMIT && inp.attackHeld) { p.state = 'charge'; p.chargeFull = false; p.queued = false; ev('chargeStart', {}); break; }
        if (p.t < 0.2) { mvx = Math.sin(p.face) * 2.5; mvz = Math.cos(p.face) * 2.5; }
        if (!p.hitDone && p.t >= 0.16) { p.hitDone = true; playerAttackHit(); }
        if (p.state !== 'attack') break;
        if (p.t > 0.22 && inp.dodge) { startDodge(); break; }
        if (p.t > 0.22 && (inp.guardPress || (p.guardHeld && p.t > 0.3))) { p.state = 'guard'; break; }
        if (p.t >= 0.34 && p.queued) { startAttack((p.combo + 1) % 3); break; }
        if (p.t >= 0.5) p.state = 'idle';
        break;
      }
      case 'charge': { // p.t keeps counting from the press
        walk(CHARGE.MOVE);
        p.face = turnTo(p.face, toB, 10 * dt);
        if (!p.chargeFull && p.t >= CHARGE.FULL) { p.chargeFull = true; s.stats.chargeFulls++; ev('chargeFull', {}); }
        if (inp.dodge) { p.chargeFull = false; startDodge(); break; } // stepping or guarding abandons the charge
        if (inp.guardPress) { p.chargeFull = false; p.state = 'guard'; break; }
        if (!inp.attackHeld) {
          if (p.chargeFull) { p.state = 'heavy'; p.t = 0; p.hitDone = false; p.chargeFull = false; s.stats.heavies++; ev('heavySwing', {}); }
          else { p.state = 'attack'; p.t = CHARGE.COMMIT; } // let go early: the ordinary cut goes through
        }
        break;
      }
      case 'heavy': { // release -> hit -> recovery
        if (p.t < CHARGE.HIT) { mvx = Math.sin(p.face) * 4; mvz = Math.cos(p.face) * 4; }
        if (!p.hitDone && p.t >= CHARGE.HIT) { p.hitDone = true; playerAttackHit(true); }
        if (p.state !== 'heavy') break;
        if (p.t > CHARGE.DODGE_AFTER && inp.dodge) { startDodge(); break; }
        if (p.t >= CHARGE.RECOVER) p.state = 'idle';
        break;
      }
      case 'takeoff': {
        mvx = p.jvx * 0.6; mvz = p.jvz * 0.6;
        if (p.t >= JUMP.TAKEOFF) { p.state = 'air'; p.t = 0; p.vy = JUMP.V0; p.y = 0.001; }
        break;
      }
      case 'air': {
        if (ml > 0.1) { // moderate steering toward the held direction
          const tx = inp.mx / Math.max(1, ml) * JUMP.AIR_SPEED, tz = inp.mz / Math.max(1, ml) * JUMP.AIR_SPEED;
          const ex = tx - p.jvx, ez = tz - p.jvz, el = Math.hypot(ex, ez), st = Math.min(el, JUMP.AIR_ACCEL * dt);
          if (el > 1e-6) { p.jvx += ex / el * st; p.jvz += ez / el * st; }
        }
        mvx = p.jvx; mvz = p.jvz;
        if (inp.locked) p.face = turnTo(p.face, toB, 8 * dt);
        else if (Math.hypot(p.jvx, p.jvz) > 0.5) p.face = turnTo(p.face, Math.atan2(p.jvx, p.jvz), 8 * dt);
        break;
      }
      case 'land': {
        walk(C.MOVE_SPEED * 0.35);
        if (p.t >= JUMP.LAND) p.state = 'idle';
        break;
      }
      case 'drink': {
        walk(FLASK.MOVE);
        if (inp.locked) p.face = turnTo(p.face, toB, 8 * dt);
        if (!p.drank && p.t >= FLASK.SIP) {
          // the one moment: charge consumed and heal applied together
          p.drank = true; p.flask--;
          const before = p.hp; p.hp = Math.min(C.PLAYER_HP, p.hp + FLASK.HEAL);
          s.stats.drinks++; s.stats.healed += p.hp - before;
          ev('heal', { amount: p.hp - before, left: p.flask });
        }
        if (p.t >= FLASK.SIP + FLASK.RECOVER) p.state = 'idle';
        break;
      }
      case 'dodge': {
        const v =(C.DODGE_DIST / C.DODGE_TIME) * (p.t < 0.3 ? 1.25 : 0.25);
        if (!(p.dodgeFwd && dist < 1.7)) { mvx = p.dx * v; mvz = p.dz * v; }
        if (p.t >= C.DODGE_TIME) p.state = 'idle';
        break;
      }
      case 'stagger': if (p.t >= 0.45) p.state = 'idle'; break;
      case 'broken': if (p.t >= 1.4) { p.state = 'idle'; p.stance = 50; } break;
      case 'counter': if (p.t >= 0.8) p.state = 'idle'; break;
      case 'finisher': {
        // Moonwheel: hook the blade, wheel around the foe's flank, rising cut from behind
        const a = p.fAng + Math.PI * smooth((p.t - 0.3) / 0.65);
        const r = 1.55;
        p.x = b.x + Math.sin(a) * r; p.z = b.z + Math.cos(a) * r;
        p.face = Math.atan2(b.x - p.x, b.z - p.z);
        if (!p.hitDone && p.t >= C.FINISHER_IMPACT) {
          p.hitDone = true; s.hitstop = 0.16;
          ev('finisherHit', { n: b.phase, x: b.x, z: b.z });
        }
        if (p.t >= C.FINISHER_TIME) {
          p.state = 'idle';
          if (b.phase === 1) {
            b.phase = 2; b.state = 'phaseShift'; b.t = 0; b.hp = C.BOSS_HP; b.stance = 0; b.bag = []; b.next = 'string5'; b.blockStreak = 0;
            ev('phase2', { x: b.x, z: b.z });
          } else { b.state = 'dying'; b.t = 0; b.hp = 0; ev('bossDown', { x: b.x, z: b.z }); }
        }
        break;
      }
      case 'dead': break;
    }
    // knockback
    if (Math.abs(p.kx) + Math.abs(p.kz) > 0.01) {
      mvx += p.kx; mvz += p.kz;
      const f = Math.exp(-dt * 9); p.kx *= f; p.kz *= f;
    }
    if (p.state !== 'finisher') { p.x += mvx * dt; p.z += mvz * dt; }
    // gravity: whatever state the fighter is in, the ground holds
    if (p.y > 0 || p.vy > 0) {
      p.vy -= JUMP.G * dt; p.y += p.vy * dt;
      if (p.y <= 0) {
        p.y = 0; p.vy = 0;
        if (p.state === 'air') { p.state = 'land'; p.t = 0; s.stats.lands++; ev('land', {}); }
      }
    }
    p.speed = (p.state === 'idle' || p.state === 'guard') ? Math.hypot(mvx, mvz) : 0;
    // stance recovery
    p.stanceIdle += dt;
    if (p.stanceIdle > 1.5 && p.state !== 'broken') p.stance = Math.max(0, p.stance - 8 * dt);
  }

  function stepBoss(dt) {
    const p = s.player, b = s.boss;
    const dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz) || 1;
    const toP = Math.atan2(dx, dz);
    b.t += dt; b.speed = 0;
    b.stanceIdle += dt;
    const hpF = b.hp / C.BOSS_HP;
    if (b.stanceIdle > 2.5 && (b.state === 'approach' || b.state === 'attack')) b.stance = Math.max(0, b.stance - (2 + 6 * hpF) * dt);
    const p2 = b.phase === 2;
    switch (b.state) {
      case 'approach': {
        b.face = turnTo(b.face, toP, 5 * dt);
        const sp = p2 ? 3.4 : 2.6;
        let vx = 0, vz = 0;
        if (d > 2.7) { vx = dx / d * sp; vz = dz / d * sp; }
        else if (d < 1.7) { vx = -dx / d * 1.6; vz = -dz / d * 1.6; }
        else { vx = -dz / d * 0.9 * b.strafe; vz = dx / d * 0.9 * b.strafe; }
        b.x += vx * dt; b.z += vz * dt; b.speed = Math.hypot(vx, vz);
        b.cooldown -= dt;
        if (p.state === 'dead') break;
        if (b.cooldown <= 0 && d <= MOVES[b.next].range) { const n = b.next; pickNext(); startMove(n); b.strafe = rand() < 0.5 ? 1 : -1; }
        break;
      }
      case 'attack': {
        const mv = MOVES[b.move];
        const h = mv.hits[b.hitIdx];
        if (h) {
          const tt = h.t - b.t;
          if (tt > (h.type === 'thrust' ? 0.2 : 0.12)) b.face = turnTo(b.face, toP, (h.type === 'heavy' ? 3.2 : 5.5) * dt);
          if (h.cue && b.cueT < s.time - 1.5 && tt <= h.cue) { b.cueT = s.time; s.stats.cues++; ev('cue', { inT: tt }); }
          if (tt <= h.lt && tt > 0 && d > 1.5) {
            const v = Math.min(h.lunge / h.lt, (d - 1.4) / dt);
            b.x += Math.sin(b.face) * v * dt; b.z += Math.cos(b.face) * v * dt;
          }
          if (tt <= 0) { b.hitIdx++; bossHit(h, b.hitIdx === mv.hits.length); }
        }
        if (b.state === 'attack' && b.t >= mv.dur) { b.state = 'approach'; b.t = 0; b.cooldown = p2 ? 0.4 + rand() * 0.4 : 0.9 + rand() * 0.6; s.chain = 0; }
        break;
      }
      case 'block': if (b.t >= 0.32) { b.state = 'approach'; b.t = 0; } b.face = turnTo(b.face, toP, 6 * dt); break;
      case 'pinned': if (b.t >= 1.3) { b.state = 'approach'; b.t = 0; b.cooldown = 0.5; } break;
      case 'broken':
        if (b.t >= C.BROKEN_TIME) { b.state = 'approach'; b.t = 0; b.stance = 55; b.hp = Math.max(b.hp, 25); b.cooldown = 0.8; ev('bossRecover', {}); }
        break;
      case 'finished': break;
      case 'phaseShift': {
        // shove the player clear while the boss rises again
        if (d < 5.5) { const push = (5.5 - d) * 6; p.x += dx / d * push * dt; p.z += dz / d * push * dt; }
        b.face = turnTo(b.face, toP, 4 * dt);
        if (b.t >= 2.4) { b.state = 'approach'; b.t = 0; b.cooldown = 0.25; ev('phase2Go', {}); }
        break;
      }
      case 'dying': break;
    }
  }

  function constrain() {
    const p = s.player, b = s.boss;
    if (p.state !== 'finisher') {
      let dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz);
      if (d < 1.05) { if (d < 1e-4) { dx = 0; dz = 1; d = 1; } p.x = b.x + dx / d * 1.05; p.z = b.z + dz / d * 1.05; }
    }
    for (const f of [p, b]) { const r = Math.hypot(f.x, f.z); if (r > C.ARENA_R) { f.x *= C.ARENA_R / r; f.z *= C.ARENA_R / r; } }
  }

  // inp: { mx, mz (world-space move), attack, guardPress, guard, dodge, finisher, locked }
  function step(inp) {
    const dt = C.STEP;
    if (s.hitstop > 0) { s.hitstop -= dt; return; }
    s.time += dt; s.modeT += dt;
    if (s.mode === 'intro') {
      if (s.modeT >= C.INTRO_TIME) { s.mode = 'fight'; s.modeT = 0; ev('fightStart', {}); }
      return;
    }
    if (s.mode === 'victory' || s.mode === 'defeat') return;
    stepPlayer(dt, inp);
    stepBoss(dt);
    constrain();
    if (s.boss.state === 'dying' && s.boss.t >= 1.8) { s.mode = 'victory'; s.modeT = 0; ev('victory', {}); }
    if (s.player.state === 'dead' && s.player.t >= 1.5) { s.mode = 'defeat'; s.modeT = 0; ev('defeat', {}); }
  }

  // Pause / window blur: drop any charge, jump or unfinished drink so nothing fires or lingers on return.
  function clearActions() {
    const p = s.player;
    if (['charge', 'drink', 'takeoff', 'air', 'land'].includes(p.state) || (p.state === 'heavy' && !p.hitDone)) { p.state = 'idle'; p.t = 0; }
    if (p.state !== 'dead') { p.y = 0; p.vy = 0; }
    p.jvx = p.jvz = 0; p.queued = false; p.chargeFull = false; p.drank = false;
  }

  s.reset = reset; s.step = step; s.clearActions = clearActions;
  reset();
  return s;
}
