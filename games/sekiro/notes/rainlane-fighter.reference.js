// Procedural humanoid fighters (the wayfarer and the dual-blade boss).
// Bodies are lofted, skinned meshes on a shared skeleton (about 7.5 heads tall), dressed in layers.
// Animation is pose-driven for the upper body; legs are solved with two-bone IK onto feet that
// plant in world space and step when the body moves, so feet do not slide.
import * as THREE from 'three/webgpu';
import { ATTACKS, DODGE, currentSeg, angDiff } from './sim.js';
import { detailMaps, canvasTex } from './tex.js';

// ------------------------------------------------------------------ skeleton

const NAMES = ['body', 'torso', 'chest', 'neck', 'head', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR', 'legL', 'shinL', 'footL', 'legR', 'shinR', 'footR'];
const PARENT = {
  torso: 'body', chest: 'torso', neck: 'chest', head: 'neck',
  armL: 'chest', foreL: 'armL', handL: 'foreL', armR: 'chest', foreR: 'armR', handR: 'foreR',
  legL: 'body', shinL: 'legL', footL: 'shinL', legR: 'body', shinR: 'legR', footR: 'shinR',
};
// rest positions in metres, root space; +z is forward, +x is the fighter's left
const REST = {
  body: [0, 0.96, 0], torso: [0, 1.06, 0], chest: [0, 1.27, 0], neck: [0, 1.5, 0], head: [0, 1.585, 0],
  armL: [0.176, 1.455, 0], foreL: [0.191, 1.17, 0], handL: [0.196, 0.915, 0],
  legL: [0.095, 0.915, 0], shinL: [0.1, 0.49, 0], footL: [0.1, 0.075, -0.01],
};
for (const n of ['arm', 'fore', 'hand', 'leg', 'shin', 'foot']) { const p = REST[n + 'L']; REST[n + 'R'] = [-p[0], p[1], p[2]]; }
const BI = Object.fromEntries(NAMES.map((n, i) => [n, i]));
const THIGH = 0.425, SHIN = 0.415, ANKLE = 0.075;

// ------------------------------------------------------------------ pose helpers

const UPPER = ['body', 'torso', 'chest', 'head', 'armR', 'foreR', 'handR', 'armL', 'foreL', 'handL', 'legR', 'shinR', 'legL', 'shinL'];
const Z3 = [0, 0, 0];
const ST0 = [0.115, 0, -0.115, 0, 0.12, -0.12]; // default stance: Lx, Lz, Rx, Rz, Lyaw, Ryaw

function mirror(p) {
  const o = { y: p.y, yaw: p.yaw, pz: p.pz, fk: p.fk };
  for (const j of UPPER) {
    if (!p[j]) continue;
    let n = j;
    if (j.endsWith('R')) n = j.slice(0, -1) + 'L';
    else if (j.endsWith('L')) n = j.slice(0, -1) + 'R';
    o[n] = [p[j][0], -p[j][1], -p[j][2]];
  }
  if (p.st) { const s = p.st; o.st = [-s[2], s[3], -s[0], s[1], -s[5], -s[4]]; }
  return o;
}
function mix(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  const o = {
    y: (a.y || 0) * (1 - t) + (b.y || 0) * t, yaw: (a.yaw || 0) * (1 - t) + (b.yaw || 0) * t,
    pz: (a.pz || 0) * (1 - t) + (b.pz || 0) * t, fk: t > 0.5 ? b.fk : a.fk,
  };
  for (const j of UPPER) {
    const x = a[j] || Z3;
    const y = b[j] || Z3;
    if (x === Z3 && y === Z3) continue;
    o[j] = [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
  }
  const sa = a.st || ST0, sb = b.st || ST0;
  o.st = sa.map((v, i) => v + (sb[i] - v) * t);
  return o;
}
function add(a, d) {
  const o = { ...a };
  for (const k in d) {
    if (k === 'y' || k === 'yaw' || k === 'pz') o[k] = (a[k] || 0) + d[k];
    else { const x = a[k] || Z3; o[k] = [x[0] + d[k][0], x[1] + d[k][1], x[2] + d[k][2]]; }
  }
  return o;
}
const ease = (t) => t * t * (3 - 2 * t);
const sat = (t) => Math.max(0, Math.min(1, t));
const easeOut = (t) => 1 - (1 - sat(t)) ** 2;
const ramp = (x, a, b) => ease(sat((x - a) / (b - a)));

// ------------------------------------------------------------------ poses
// Rotations are XYZ eulers. torso is shared between the lumbar and chest joints, so hips (body) and
// shoulders (torso) can counter-rotate. st = foot stance in local metres; pz = pelvis shift forward.

const PP = {
  idle: {
    y: -0.05, body: [0, -0.38, 0], torso: [0.08, 0.16, 0], head: [0, 0.22, 0],
    armR: [-0.5, 0, -0.22], foreR: [-0.95, 0, 0], handR: [0.6, 0, 0],
    armL: [-0.28, 0, 0.26], foreL: [-0.95, 0, 0],
    st: [0.13, 0.2, -0.15, -0.2, 0.1, -0.7],
  },
  run: {
    y: -0.1, pz: 0.05, body: [0.06, 0, 0], torso: [0.3, 0, 0], head: [-0.16, 0, 0],
    armR: [0.3, 0, -0.26], foreR: [-0.7, 0, 0], handR: [0.55, 0, 0],
    armL: [-0.1, 0, 0.2], foreL: [-0.95, 0, 0],
  },
  s1a: {
    y: -0.11, pz: -0.05, body: [0, -0.5, 0], torso: [0.08, -0.6, 0], head: [0, 0.85, 0],
    armR: [-1.2, 0, -0.95], foreR: [-0.45, 0, 0], handR: [0.9, 0, 0],
    armL: [-0.5, 0, 0.5], foreL: [-1.0, 0, 0],
    st: [0.13, 0.22, -0.16, -0.24, 0.1, -0.8],
  },
  s1b: {
    y: -0.17, pz: 0.1, body: [0.05, 0.3, 0], torso: [0.2, 0.62, 0], head: [0, -0.7, 0],
    armR: [-1.3, 0, 0.55], foreR: [-0.15, 0, 0], handR: [1.1, 0, 0],
    armL: [0.5, 0, 0.5], foreL: [-0.6, 0, 0],
    st: [0.14, 0.44, -0.16, -0.3, 0, -0.85],
  },
  s2a: {
    y: -0.13, pz: 0.02, body: [0, 0.32, 0], torso: [0.14, 0.7, 0.08], head: [0, -0.8, 0],
    armR: [-1.0, 0, 0.75], foreR: [-0.55, 0, 0], handR: [1.0, 0, 0],
    armL: [0.3, 0, 0.4], foreL: [-0.7, 0, 0],
    st: [0.14, 0.34, -0.16, -0.28, 0, -0.8],
  },
  s2b: {
    y: -0.15, pz: 0.1, body: [0.04, -0.5, 0], torso: [0.08, -0.42, -0.08], head: [0, 0.75, 0],
    armR: [-1.5, 0, -0.9], foreR: [-0.1, 0, 0], handR: [0.9, 0, 0],
    armL: [-0.6, 0, 0.3], foreL: [-1.1, 0, 0],
    st: [0.15, 0.44, -0.17, -0.3, 0.1, -0.85],
  },
  s3a: {
    y: 0.03, pz: -0.06, body: [-0.1, -0.1, 0], torso: [-0.26, -0.1, 0], head: [0.25, 0.1, 0],
    armR: [-2.9, 0, -0.15], foreR: [-0.6, 0, 0], handR: [-0.2, 0, 0],
    armL: [-2.6, 0, 0.2], foreL: [-0.8, 0, 0],
    st: [0.13, 0.24, -0.15, -0.24, 0.05, -0.6],
  },
  s3b: {
    y: -0.3, pz: 0.16, body: [0.18, 0, 0], torso: [0.5, 0.1, 0], head: [-0.35, 0, 0],
    armR: [-0.85, 0, 0.1], foreR: [-0.1, 0, 0], handR: [1.3, 0, 0],
    armL: [-0.8, 0, -0.1], foreL: [-0.3, 0, 0],
    st: [0.15, 0.56, -0.17, -0.4, 0, -0.9],
  },
  guard: {
    y: -0.15, body: [0, -0.3, 0], torso: [0.12, 0.2, 0], head: [0.05, 0.1, 0],
    armR: [-1.15, 0, -0.1], foreR: [-1.2, 0, 0], handR: [0.85, 0.75, 0],
    armL: [-1.25, 0, -0.25], foreL: [-1.0, 0, 0],
    st: [0.14, 0.24, -0.17, -0.24, 0.1, -0.75],
  },
  dodge: {
    y: -0.32, torso: [0.5, 0, 0], head: [-0.3, 0, 0],
    armR: [0.5, 0, -0.5], foreR: [-0.9, 0, 0], handR: [0.8, 0, 0],
    armL: [0.2, 0, 0.6], foreL: [-1.0, 0, 0],
    st: [0.2, 0.12, -0.2, -0.14, 0.2, -0.4],
  },
  hurt: {
    y: -0.12, pz: -0.08, body: [-0.14, 0.1, 0], torso: [-0.42, 0.3, 0], head: [-0.35, 0, 0],
    armR: [-0.4, 0, -0.9], foreR: [-0.5, 0, 0], handR: [0.4, 0, 0],
    armL: [-0.2, 0, 1.0], foreL: [-0.6, 0, 0],
    st: [0.15, 0.1, -0.17, -0.34, 0.1, -0.6],
  },
  dead: {
    fk: true, y: -0.82, body: [-1.42, 0, 0.06], torso: [-0.1, 0.1, 0], head: [-0.15, 0.5, 0],
    armR: [-0.3, 0, -1.2], foreR: [-0.3, 0, 0], handR: [0.2, 0, 0],
    armL: [-0.2, 0, 1.1], foreL: [-0.4, 0, 0],
    legL: [-0.12, 0, 0.2], shinL: [0.22, 0, 0], legR: [0.02, 0, -0.16], shinR: [0.1, 0, 0],
  },
};
// follow-through poses: the blade and shoulders keep travelling after the hit
PP.s1c = add(PP.s1b, { y: -0.03, torso: [0.06, 0.3, 0], armR: [0.25, 0, 0.3], handR: [0.25, 0, 0], head: [0, -0.1, 0] });
PP.s2c = add(PP.s2b, { y: -0.03, torso: [0.05, -0.3, 0], armR: [0.3, 0, -0.25], handR: [0.2, 0, 0] });
PP.s3c = add(PP.s3b, { y: -0.05, torso: [0.12, 0, 0], armR: [0.3, 0, 0], armL: [0.3, 0, 0], handR: [0.15, 0, 0] });
const SWINGS = [[PP.s1a, PP.s1b, PP.s1c], [PP.s2a, PP.s2b, PP.s2c], [PP.s3a, PP.s3b, PP.s3c]];

const BP = {
  wait: {
    torso: [0.04, 0, 0], head: [0.22, 0, 0],
    armR: [0, 0, -0.12], foreR: [-0.1, 0, 0], handR: [1.25, 0, 0],
    armL: [0, 0, 0.12], foreL: [-0.1, 0, 0], handL: [1.25, 0, 0],
    st: [0.13, 0.02, -0.13, -0.02, 0.2, -0.2],
  },
  idle: {
    y: -0.13, body: [0, -0.22, 0], torso: [0.18, 0.22, 0], head: [-0.1, 0, 0],
    armR: [-0.45, 0, -0.5], foreR: [-0.6, 0, 0], handR: [0.45, -0.3, 0],
    armL: [-0.45, 0, 0.5], foreL: [-0.6, 0, 0], handL: [0.45, 0.3, 0],
    st: [0.17, 0.2, -0.19, -0.18, 0.15, -0.55],
  },
  chainWind: {
    y: -0.24, pz: -0.04, body: [0.05, 0, 0], torso: [0.26, 0, 0], head: [-0.2, 0, 0],
    armR: [-1.25, 0, 0.55], foreR: [-1.25, 0, 0], handR: [0.5, 0.8, 0],
    armL: [-1.25, 0, -0.55], foreL: [-1.25, 0, 0], handL: [0.5, -0.8, 0],
    st: [0.2, 0.24, -0.21, -0.24, 0.15, -0.6],
  },
  slashRa: {
    y: -0.19, body: [0, -0.4, 0], torso: [0.1, -0.7, 0], head: [0, 0.9, 0],
    armR: [-1.2, 0, -1.0], foreR: [-0.35, 0, 0], handR: [0.95, 0, 0],
    armL: [-0.9, 0, -0.2], foreL: [-1.2, 0, 0], handL: [0.5, -0.6, 0],
    st: [0.18, 0.26, -0.2, -0.26, 0.1, -0.7],
  },
  slashRb: {
    y: -0.25, pz: 0.12, body: [0.06, 0.34, 0], torso: [0.22, 0.62, 0], head: [0, -0.75, 0],
    armR: [-1.3, 0, 0.6], foreR: [-0.1, 0, 0], handR: [1.15, 0, 0],
    armL: [0.5, 0, 0.5], foreL: [-0.5, 0, 0], handL: [0.9, 0, 0],
    st: [0.18, 0.46, -0.2, -0.32, 0, -0.85],
  },
  spinWind: {
    y: -0.36, body: [0.05, -0.5, 0], torso: [0.26, -0.85, 0], head: [0, 1.1, 0],
    armR: [-0.9, 0, -1.3], foreR: [-0.2, 0, 0], handR: [1.4, 0, 0],
    armL: [-1.3, 0, -0.9], foreL: [-0.6, 0, 0], handL: [1.2, 0, 0],
    st: [0.24, 0.12, -0.24, -0.16, 0.2, -0.7],
  },
  spin: {
    y: -0.22, torso: [0.1, 0, 0],
    armR: [-0.25, 0, -1.5], foreR: [0, 0, 0], handR: [1.5, 0, 0],
    armL: [-0.25, 0, 1.5], foreL: [0, 0, 0], handL: [1.5, 0, 0],
    st: [0.2, 0.05, -0.2, -0.05, 0.3, -0.3],
  },
  delayWind: {
    y: 0.04, pz: -0.08, body: [-0.1, 0, 0], torso: [-0.3, 0, 0], head: [0.3, 0, 0],
    armR: [-2.85, 0, -0.3], foreR: [-0.35, 0, 0], handR: [-0.35, 0, 0],
    armL: [-2.85, 0, 0.3], foreL: [-0.35, 0, 0], handL: [-0.35, 0, 0],
    st: [0.15, 0.14, -0.16, -0.16, 0.15, -0.4],
  },
  slam: {
    y: -0.38, pz: 0.2, body: [0.2, 0, 0], torso: [0.62, 0, 0], head: [-0.45, 0, 0],
    armR: [-0.75, 0, 0.1], foreR: [-0.05, 0, 0], handR: [1.3, 0, 0],
    armL: [-0.75, 0, -0.1], foreL: [-0.05, 0, 0], handL: [1.3, 0, 0],
    st: [0.17, 0.6, -0.19, -0.42, 0, -0.9],
  },
  lungeWind: {
    y: -0.44, pz: -0.14, body: [0.2, 0, 0], torso: [0.55, 0, 0], head: [-0.6, 0, 0],
    armR: [0.95, 0, -0.45], foreR: [-0.1, 0, 0], handR: [1.3, 0, 0],
    armL: [0.95, 0, 0.45], foreL: [-0.1, 0, 0], handL: [1.3, 0, 0],
    st: [0.17, 0.34, -0.19, -0.46, 0.05, -0.8],
  },
  dash: {
    y: -0.3, pz: 0.12, body: [0.25, 0, 0], torso: [0.65, 0, 0], head: [-0.75, 0, 0],
    armR: [-1.6, 0, 0.35], foreR: [0, 0, 0], handR: [1.5, 0.3, 0],
    armL: [-1.6, 0, -0.35], foreL: [0, 0, 0], handL: [1.5, -0.3, 0],
    st: [0.15, 0.62, -0.17, -0.6, 0, -0.5],
  },
  revWind: {
    y: -0.3, body: [0.05, 0.55, 0], torso: [0.26, 0.9, 0], head: [0, -1.1, 0],
    armR: [-1.0, 0, 0.95], foreR: [-0.7, 0, 0], handR: [1.0, 0, 0],
    armL: [0.4, 0, 0.5], foreL: [-0.6, 0, 0], handL: [1.0, 0, 0],
    st: [0.2, 0.2, -0.22, -0.24, 0.1, -0.7],
  },
  revHit: {
    y: -0.22, pz: 0.08, body: [0.04, -0.42, 0], torso: [0.14, -0.72, 0], head: [0, 0.9, 0],
    armR: [-1.4, 0, -1.2], foreR: [-0.05, 0, 0], handR: [1.3, 0, 0],
    armL: [-0.6, 0, 0.4], foreL: [-0.9, 0, 0], handL: [0.7, 0, 0],
    st: [0.2, 0.36, -0.22, -0.3, 0.1, -0.8],
  },
  recover: {
    y: -0.3, pz: 0.06, body: [0.12, 0, 0], torso: [0.42, 0, 0], head: [0.15, 0, 0],
    armR: [-0.25, 0, -0.2], foreR: [-0.2, 0, 0], handR: [1.2, 0, 0],
    armL: [-0.25, 0, 0.2], foreL: [-0.2, 0, 0], handL: [1.2, 0, 0],
    st: [0.2, 0.3, -0.21, -0.26, 0.15, -0.6],
  },
  kneel: {
    y: -0.56, pz: 0.05, body: [0.2, 0, 0], torso: [0.6, 0, 0], head: [0.4, 0, 0],
    armR: [-0.5, 0, -0.3], foreR: [-0.3, 0, 0], handR: [1.5, 0, 0],
    armL: [-0.5, 0, 0.3], foreL: [-0.3, 0, 0], handL: [1.5, 0, 0],
    st: [0.17, 0.3, -0.2, -0.5, 0.1, -0.5],
  },
  roar: {
    y: 0.0, body: [-0.16, 0, 0], torso: [-0.34, 0, 0], head: [-0.45, 0, 0],
    armR: [-0.3, 0, -1.9], foreR: [-0.2, 0, 0], handR: [1.45, 0, 0],
    armL: [-0.3, 0, 1.9], foreL: [-0.2, 0, 0], handL: [1.45, 0, 0],
    st: [0.27, 0.06, -0.27, -0.06, 0.35, -0.35],
  },
  dead: {
    fk: true, y: -0.8, body: [1.42, 0, 0.05], torso: [0.12, 0, 0], head: [0.2, 0.6, 0],
    armR: [-2.4, 0, -0.6], foreR: [-0.3, 0, 0], handR: [0.6, 0, 0],
    armL: [-2.0, 0, 0.9], foreL: [-0.5, 0, 0], handL: [0.6, 0, 0],
    legL: [0.1, 0, 0.2], shinL: [0.2, 0, 0], legR: [0.2, 0, -0.15], shinR: [0.5, 0, 0],
  },
};
BP.slashLa = mirror(BP.slashRa);
BP.slashLb = mirror(BP.slashRb);

// ------------------------------------------------------------------ mesh builder

class Builder {
  constructor() { this.pos = []; this.uv = []; this.si = []; this.sw = []; this.idx = []; this.seams = []; }
  vert(p, u, v, w) {
    this.pos.push(p[0], p[1], p[2]);
    this.uv.push(u, v);
    const si = [0, 0, 0, 0], sw = [0, 0, 0, 0];
    let tot = 0;
    for (let i = 0; i < Math.min(4, w.length); i++) { si[i] = BI[w[i][0]]; sw[i] = w[i][1]; tot += w[i][1]; }
    for (let i = 0; i < 4; i++) sw[i] /= tot || 1;
    this.si.push(...si); this.sw.push(...sw);
    return this.pos.length / 3 - 1;
  }
  // rings: [{ c, u, v, n?, w }] — w is a weight list or a function (x, y, z) → weight list
  loft(rings, o = {}) {
    const seg = o.seg || 12;
    const closed = o.a0 === undefined;
    const a0 = closed ? 0 : o.a0, a1 = closed ? Math.PI * 2 : o.a1;
    const base = this.pos.length / 3;
    const cols = seg + 1;
    let len = 0;
    const lens = rings.map((r, i) => { if (i) len += Math.hypot(r.c[0] - rings[i - 1].c[0], r.c[1] - rings[i - 1].c[1], r.c[2] - rings[i - 1].c[2]); return len; });
    rings.forEach((r, i) => {
      for (let k = 0; k <= seg; k++) {
        const th = a0 + ((a1 - a0) * k) / seg;
        let cs = Math.cos(th), sn = Math.sin(th);
        if (r.n) { const e = 2 / r.n; cs = Math.sign(cs) * Math.abs(cs) ** e; sn = Math.sign(sn) * Math.abs(sn) ** e; }
        const p = [r.c[0] + r.u[0] * cs + r.v[0] * sn, r.c[1] + r.u[1] * cs + r.v[1] * sn, r.c[2] + r.u[2] * cs + r.v[2] * sn];
        const w = typeof r.w === 'function' ? r.w(p[0], p[1], p[2]) : r.w;
        this.vert(p, (k / seg) * (o.ur || 1), o.vNorm ? lens[i] / (len || 1) : lens[i] * (o.vr || 1), w);
      }
      if (closed) this.seams.push([base + i * cols, base + i * cols + seg]);
    });
    // decide the winding so normals face away from the ring centres
    const mi = Math.max(0, Math.min(rings.length - 2, Math.floor((rings.length - 1) / 2)));
    const P = (i, k) => { const o3 = (base + i * cols + k) * 3; return [this.pos[o3], this.pos[o3 + 1], this.pos[o3 + 2]]; };
    let flip = false;
    for (let k = 0; k < seg; k++) {
      const a = P(mi, k), b = P(mi + 1, k), c = P(mi, k + 1);
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
      const rc = rings[mi].c;
      const d = nx * (a[0] - rc[0]) + ny * (a[1] - rc[1]) + nz * (a[2] - rc[2]);
      if (Math.abs(d) > 1e-12) { flip = (d < 0) !== !!o.inside; break; }
    }
    const tri = (a, b, c) => { if (flip) this.idx.push(a, c, b); else this.idx.push(a, b, c); };
    for (let i = 0; i < rings.length - 1; i++) {
      for (let k = 0; k < seg; k++) {
        const a = base + i * cols + k, b = base + (i + 1) * cols + k;
        tri(a, b, a + 1); tri(b, b + 1, a + 1);
      }
    }
    const cap = (i, rev) => {
      const r = rings[i];
      const w = typeof r.w === 'function' ? r.w(r.c[0], r.c[1], r.c[2]) : r.w;
      const cidx = this.vert(r.c, 0.5, o.vNorm ? lens[i] / (len || 1) : lens[i] * (o.vr || 1), w);
      for (let k = 0; k < seg; k++) { const a = base + i * cols + k; if (rev) tri(cidx, a, a + 1); else tri(cidx, a + 1, a); }
    };
    if (o.cap0) cap(0, true);
    if (o.cap1) cap(rings.length - 1, false);
  }
  geometry(skinned) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    const n = g.attributes.normal;
    for (const [a, b] of this.seams) {
      const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
      const l = Math.hypot(x, y, z) || 1;
      n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
    }
    if (skinned) {
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    }
    return g;
  }
}

// vertical tube: rows [y, rx, rz, cx = 0, cz = 0, n]; side mirrors cx
function tubeY(B, rows, w, o = {}) {
  const s = o.side || 1;
  const inx = o.side && rows[0][3] > 0.15 ? -0.014 : 0; // arm rows were laid out for a slightly wider shoulder
  B.loft(rows.map((r) => ({
    c: [((r[3] || 0) + inx) * s + (o.ox || 0), r[0] + (o.oy || 0), (r[4] || 0) + (o.oz || 0)], u: [r[1], 0, 0], v: [0, 0, r[2]], n: r[5] || o.n,
    w: typeof w === 'function' ? (w.length >= 2 ? (x, y) => w(y, x) : w(r[0] + (o.oy || 0))) : w,
  })), o);
}
// tube along z: rows [z, rx, ry, cx, cy, n]
function tubeZ(B, rows, w, o = {}) {
  const s = o.side || 1;
  B.loft(rows.map((r) => ({ c: [(r[3] || 0) * s + (o.ox || 0), (r[4] || 0) + (o.oy || 0), r[0] + (o.oz || 0)], u: [r[1], 0, 0], v: [0, r[2], 0], n: r[5] || o.n, w })), o);
}
// flattened tube along a polyline; hint is the direction the flat face looks toward
function tubePath(B, pts, wid, thick, w, hint, o = {}) {
  const rings = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const t = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    const h = new THREE.Vector3(...(typeof hint === 'function' ? hint(i) : hint));
    const side = new THREE.Vector3().crossVectors(t, h).normalize();
    const nrm = new THREE.Vector3().crossVectors(side, t).normalize();
    const ww = typeof wid === 'function' ? wid(i) : wid, tt = typeof thick === 'function' ? thick(i) : thick;
    return { c: p, u: side.multiplyScalar(ww).toArray(), v: nrm.multiplyScalar(tt).toArray(), n: o.n, w: typeof w === 'function' ? w(p[1], p[0]) : w };
  });
  B.loft(rings, { seg: 8, cap0: true, cap1: true, ...o });
}

// ---- skin weights by height (rest pose)
const one = (n) => [[n, 1]];
const two = (a, b, t) => [[a, 1 - t], [b, t]];
function spineW(y) {
  if (y < 1.0) return one('body');
  if (y < 1.1) return two('body', 'torso', ramp(y, 1.0, 1.1));
  if (y < 1.2) return one('torso');
  if (y < 1.32) return two('torso', 'chest', ramp(y, 1.2, 1.32));
  if (y < 1.49) return one('chest');
  if (y < 1.535) return two('chest', 'neck', ramp(y, 1.49, 1.535));
  if (y < 1.57) return one('neck');
  return two('neck', 'head', ramp(y, 1.57, 1.6));
}
const skirtW = (hem, amt) => (y, x) => {
  if (y >= 0.98) return spineW(y);
  const wl = ramp(y, 0.98, hem + (0.98 - hem) * 0.5) * amt; // the skirt rides on the thighs from mid-length down
  const sl = ramp(x, -0.07, 0.07);
  return [['body', 1 - wl], ['legL', wl * sl], ['legR', wl * (1 - sl)]];
};
const armW = (S) => (y) => {
  if (y > 1.5) return one('chest');
  if (y > 1.42) return two('chest', 'arm' + S, ramp(y, 1.5, 1.42));
  if (y > 1.21) return one('arm' + S);
  if (y > 1.13) return two('arm' + S, 'fore' + S, ramp(y, 1.21, 1.13));
  if (y > 0.95) return one('fore' + S);
  return two('fore' + S, 'hand' + S, ramp(y, 0.95, 0.9));
};
const legW = (S) => (y) => {
  if (y > 0.95) return one('body');
  if (y > 0.84) return two('body', 'leg' + S, ramp(y, 0.95, 0.84));
  if (y > 0.54) return one('leg' + S);
  if (y > 0.44) return two('leg' + S, 'shin' + S, ramp(y, 0.54, 0.44));
  if (y > 0.12) return one('shin' + S);
  return two('shin' + S, 'foot' + S, ramp(y, 0.12, 0.05));
};

// ---- shared body parts

// A closed hand gripping a hilt that runs along z. side: +1 left hand, -1 right hand.
function fist(B, S, sc = 1) {
  const side = S === 'L' ? 1 : -1;
  const [ox, oy, oz] = REST['hand' + S];
  const w = one('hand' + S);
  tubeY(B, [[0.012, 0.02, 0.027], [-0.03 * sc, 0.021 * sc, 0.04 * sc], [-0.068 * sc, 0.02 * sc, 0.045 * sc], [-0.088 * sc, 0.011 * sc, 0.04 * sc]], w,
    { ox: ox + side * 0.012, oy, oz, seg: 8, cap1: true, n: 2.6 });
  const ax = ox - side * 0.005, ay = oy - 0.08 * sc, rg = 0.025 * sc;
  for (let f = 0; f < 4; f++) {
    const z = oz + (-0.034 + f * 0.0225) * sc;
    const pts = [];
    for (let i = 0; i <= 7; i++) {
      const ph = -0.5 + (i / 7) * 4.5;
      pts.push([ax + side * Math.cos(ph) * rg, ay - Math.sin(ph) * rg, z]);
    }
    tubePath(B, pts, 0.0105 * sc, 0.0105 * sc, w, [0, 0, 1], { seg: 6 });
  }
  tubePath(B, [[ax - side * 0.004, oy - 0.03 * sc, oz + 0.03 * sc], [ax - side * 0.03 * sc, oy - 0.055 * sc, oz + 0.05 * sc], [ax - side * 0.034 * sc, oy - 0.085 * sc, oz + 0.042 * sc]],
    0.012 * sc, 0.011 * sc, w, [0, 0, 1], { seg: 6 });
  return [-side * 0.005, -0.08 * sc, 0]; // hilt centre in hand-local space
}

function headRows(k, grow = 0) {
  // [y, rx, rz, cx, cz] relative to the skull base; front of the face is +z
  return [
    [-0.047, 0.012, 0.012, 0, 0.05], [-0.04, 0.032, 0.03, 0, 0.042], [-0.02, 0.054, 0.06, 0, 0.024], [0.0, 0.064, 0.074, 0, 0.014],
    [0.04, 0.071, 0.084, 0, 0.007], [0.085, 0.074, 0.091, 0, 0], [0.13, 0.074, 0.093, 0, -0.004], [0.165, 0.067, 0.085, 0, -0.007],
    [0.19, 0.046, 0.06, 0, -0.008], [0.2, 0.014, 0.018, 0, -0.008],
  ].map((r) => [r[0] * k, (r[1] + grow) * k, (r[2] + grow) * k, 0, r[4] * k]);
}

function boot(B, S, tall, k = 1) {
  const side = S === 'L' ? 1 : -1;
  const top = tall ? 0.47 : 0.445;
  tubeY(B, [[top, 0.071 * k, 0.078 * k, 0.1, -0.004], [top - 0.03, 0.066 * k, 0.073 * k, 0.1, -0.006], [0.33, 0.062 * k, 0.071 * k, 0.1, -0.013],
    [0.2, 0.049 * k, 0.055 * k, 0.1, -0.009], [0.105, 0.041 * k, 0.047 * k, 0.1, -0.008], [0.06, 0.044 * k, 0.056 * k, 0.1, 0]], legW(S), { side, seg: 10 });
  tubeZ(B, [[-0.088, 0.016, 0.018, 0.1, 0.034], [-0.074, 0.036 * k, 0.04, 0.1, 0.042], [-0.02, 0.043 * k, 0.056, 0.1, 0.057], [0.04, 0.047 * k, 0.043, 0.1, 0.044],
    [0.1, 0.049 * k, 0.031, 0.1, 0.032], [0.15, 0.043 * k, 0.023, 0.1, 0.024], [0.178, 0.02, 0.012, 0.1, 0.016]], one('foot' + S), { side, seg: 10, n: 2.8, cap0: true, cap1: true });
}

function trousers(B, S, k = 1) {
  const side = S === 'L' ? 1 : -1;
  tubeY(B, [[0.98, 0.1 * k, 0.11 * k, 0.07], [0.9, 0.1 * k, 0.108 * k, 0.09], [0.78, 0.091 * k, 0.1 * k, 0.098], [0.62, 0.079 * k, 0.087 * k, 0.1],
    [0.5, 0.067 * k, 0.075 * k, 0.1, 0.005], [0.41, 0.063 * k, 0.07 * k, 0.1, -0.006]], legW(S), { side, seg: 10 });
}

// hanging cloth strip made of short rigid links that sway
function strip(parent, pos, n, w, len, mat, taper = 0.75) {
  const segs = [];
  let p = parent;
  for (let i = 0; i < n; i++) {
    const g = new THREE.Group();
    if (i === 0) g.position.set(pos[0], pos[1], pos[2]); else g.position.y = -len;
    p.add(g);
    const w0 = w * (1 - (1 - taper) * (i / n)), w1 = w * (1 - (1 - taper) * ((i + 1) / n));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-w0 / 2, 0, 0, w0 / 2, 0, 0, -w1 / 2, -len, 0, w1 / 2, -len, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, i * 0.5, 1, i * 0.5, 0, i * 0.5 + 0.5, 1, i * 0.5 + 0.5], 2));
    geo.setIndex([0, 2, 1, 1, 2, 3]);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    g.add(m);
    segs.push(g);
    p = g;
  }
  return segs;
}

// ------------------------------------------------------------------ rig

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _e = new THREE.Euler();
const _YAX = new THREE.Vector3(0, 1, 0), _XAX = new THREE.Vector3(1, 0, 0);

function basisQuat(out, down, fwd) {
  // bone -y points along `down`; bone +z leans toward `fwd`
  _v3.copy(down).negate();
  _v4.copy(fwd).addScaledVector(_v3, -fwd.dot(_v3));
  if (_v4.lengthSq() < 1e-8) _v4.set(0, 0, 1).addScaledVector(_v3, -_v3.z);
  _v4.normalize();
  _v5.crossVectors(_v3, _v4);
  _m.makeBasis(_v5, _v3, _v4);
  return out.setFromRotationMatrix(_m);
}

let blobTex = null;
function makeRig(scale) {
  const root = new THREE.Group();
  const J = {};
  const bones = NAMES.map((n) => {
    const b = new THREE.Bone();
    b.name = n;
    J[n] = b;
    return b;
  });
  for (const n of NAMES) {
    const par = PARENT[n];
    const p = REST[n];
    if (par) { const q = REST[par]; J[n].position.set(p[0] - q[0], p[1] - q[1], p[2] - q[2]); J[par].add(J[n]); } else { J[n].position.set(p[0], p[1], p[2]); root.add(J[n]); }
  }
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  if (!blobTex) {
    blobTex = canvasTex(64, 64, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(0.55, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    });
  }
  // soft contact shadow: the lanterns cast no shadow maps, so this grounds the feet
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity: 0.8, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.022;
  blob.renderOrder = 2;
  root.add(blob);

  const rig = {
    root, J, skeleton, blades: [], s: scale, blob, meshes: [], sway: [], flashMats: [],
    cur: {}, curY: 0, curPz: 0, curSt: ST0.slice(), yawExtra: 0, drop: 0, gait: 0, steps: 0,
    vx: 0, vz: 0, px: null, pz: null, speed: 0, fk: false, armSwing: 0, lean: 0,
    feet: [0, 1].map(() => ({ x: 0, z: 0, yaw: 0, lift: 0, pitch: 0, sw: false, u: 0, dur: 0.2, fx: 0, fz: 0, fyaw: 0, h: 0.05, pa: 0, since: 1 })),
    addMesh(B, mat, skinned = true, parent = null) {
      const geo = B.geometry(skinned);
      let m;
      if (skinned) {
        m = new THREE.SkinnedMesh(geo, mat);
        root.add(m);
        m.bind(skeleton, new THREE.Matrix4());
        m.frustumCulled = false;
      } else { m = new THREE.Mesh(geo, mat); (parent || root).add(m); }
      m.castShadow = true;
      m.receiveShadow = true;
      this.meshes.push(m);
      return m;
    },
    finish() {
      root.scale.setScalar(scale); // the contact shadow is in root space and scales with the fighter
    },
    // place the fighter and estimate its ground velocity
    place(x, z, yaw, dt) {
      const jump = this.px === null || Math.hypot(x - this.px, z - this.pz) > 2.5;
      if (jump) { this.vx = 0; this.vz = 0; this.snap = true; } else if (dt > 1e-5) {
        const k = 1 - Math.exp(-dt * 18);
        this.vx += ((x - this.px) / dt - this.vx) * k;
        this.vz += ((z - this.pz) / dt - this.vz) * k;
      }
      this.px = x; this.pz = z;
      this.speed = Math.hypot(this.vx, this.vz);
      root.position.set(x, 0, z);
      root.rotation.y = yaw;
    },
    // pose: target pose; o: { mode: 'step' | 'glue' | 'hop', stepDur, armSwing, hop }
    animate(pose, rate, dt, o = {}) {
      const kB = 1 - Math.exp(-dt * rate * 1.35), kS = 1 - Math.exp(-dt * rate * 1.1), kA = 1 - Math.exp(-dt * rate * 0.9);
      for (const j of UPPER) {
        const want = pose[j] || Z3;
        const cur = this.cur[j] || (this.cur[j] = [0, 0, 0]);
        const k = j === 'body' ? kB : (j === 'torso' || j === 'chest' || j === 'head') ? kS : kA;
        cur[0] += (want[0] - cur[0]) * k; cur[1] += (want[1] - cur[1]) * k; cur[2] += (want[2] - cur[2]) * k;
      }
      this.curY += ((pose.y || 0) - this.curY) * kB;
      this.curPz += ((pose.pz || 0) - this.curPz) * kB;
      const st = pose.st || ST0;
      for (let i = 0; i < 6; i++) this.curSt[i] += (st[i] - this.curSt[i]) * kB;
      this.yawExtra = pose.yaw || 0;
      const fk = !!pose.fk;
      const mode = o.mode || 'step';
      if (!fk) this.updateFeet(dt, this.snap || this.fk ? 'snap' : mode, o);
      this.snap = false;
      this.fk = fk;

      // gait: how far the left foot is ahead of the right, relative to the stance
      const s = this.s, yaw = root.rotation.y, sn = Math.sin(yaw), cs = Math.cos(yaw);
      const f0 = this.feet[0], f1 = this.feet[1];
      const lz0 = (f0.x - root.position.x) * sn + (f0.z - root.position.z) * cs;
      const lz1 = (f1.x - root.position.x) * sn + (f1.z - root.position.z) * cs;
      const gWant = fk ? 0 : Math.max(-1, Math.min(1, ((lz0 - lz1) - (this.curSt[1] - this.curSt[3]) * s) / (0.55 * s))) * sat(this.speed / 1.5);
      this.gait += (gWant - this.gait) * (1 - Math.exp(-dt * 16));
      this.armSwing += ((o.armSwing ?? 0) - this.armSwing) * (1 - Math.exp(-dt * 10));
      const g = this.gait, as = this.armSwing, c = this.cur;
      // lean into acceleration a little (weight), measured in the fighter's frame
      const fwdSp = this.vx * sn + this.vz * cs, sideSp = this.vx * cs - this.vz * sn;
      const lean = fk ? 0 : Math.max(-0.2, Math.min(0.2, fwdSp * 0.014));
      const roll = fk ? 0 : Math.max(-0.14, Math.min(0.14, -sideSp * 0.02));
      J.body.rotation.set(c.body[0] + lean * 0.5, c.body[1] - 0.2 * g, c.body[2] + 0.05 * g + roll);
      J.torso.rotation.set(c.torso[0] * 0.5 + lean * 0.5, c.torso[1] * 0.5 + 0.2 * g, c.torso[2] * 0.5 - 0.03 * g);
      J.chest.rotation.set(c.torso[0] * 0.5 + c.chest[0], c.torso[1] * 0.5 + c.chest[1] + 0.22 * g, c.torso[2] * 0.5 + c.chest[2] - roll * 0.6);
      J.neck.rotation.set(c.head[0] * 0.4 - lean * 0.5, c.head[1] * 0.4 - 0.1 * g, c.head[2] * 0.4);
      J.head.rotation.set(c.head[0] * 0.6 - lean * 0.5, c.head[1] * 0.6 - 0.1 * g, c.head[2] * 0.6);
      J.armL.rotation.set(c.armL[0] + 0.6 * g * as, c.armL[1], c.armL[2]);
      J.armR.rotation.set(c.armR[0] - 0.6 * g * as, c.armR[1], c.armR[2]);
      J.foreL.rotation.set(c.foreL[0] - 0.25 * Math.max(0, -g) * as, c.foreL[1], c.foreL[2]);
      J.foreR.rotation.set(c.foreR[0] - 0.25 * Math.max(0, g) * as, c.foreR[1], c.foreR[2]);
      J.handL.rotation.set(c.handL[0], c.handL[1], c.handL[2]);
      J.handR.rotation.set(c.handR[0], c.handR[1], c.handR[2]);
      J.body.position.set(0, REST.body[1] + this.curY, this.curPz);

      if (fk) {
        const k = 1 - Math.exp(-dt * 9);
        for (const S of ['L', 'R']) {
          J['leg' + S].quaternion.slerp(_q1.setFromEuler(_e.set(c['leg' + S][0], c['leg' + S][1], c['leg' + S][2])), k);
          J['shin' + S].quaternion.slerp(_q1.setFromEuler(_e.set(c['shin' + S][0], 0, 0)), k);
          J['foot' + S].quaternion.slerp(_q1.set(0, 0, 0, 1), k);
        }
        this.drop += (0 - this.drop) * k;
        blob.position.set(0, 0.022, c.body[0] > 0 ? 0.5 : -0.5);
        return;
      }
      blob.position.set(0, 0.022, 0);

      // keep the pelvis low enough for both planted feet to reach the ground
      root.updateMatrixWorld(true);
      const Lmax = (THIGH + SHIN) * s * 0.985;
      let need = 0;
      for (let i = 0; i < 2; i++) {
        const f = this.feet[i];
        if (f.sw && f.u < 0.8) continue;
        J[i ? 'legR' : 'legL'].getWorldPosition(_v1);
        const h = Math.min(Lmax * 0.98, Math.hypot(_v1.x - f.x, _v1.z - f.z));
        need = Math.max(need, _v1.y - ((ANKLE * s + f.lift) + Math.sqrt(Lmax * Lmax - h * h)));
      }
      need = Math.min(need, 0.4 * s);
      this.drop += (need - this.drop) * (1 - Math.exp(-dt * (need > this.drop ? 40 : 12)));
      if (dt <= 1e-5 && need > this.drop) this.drop = need;
      J.body.position.y -= this.drop / s;
      root.updateMatrixWorld(true);
      this.solveLegs();
    },
    updateFeet(dt, mode, o) {
      const s = this.s, yaw = root.rotation.y, sn = Math.sin(yaw), cs = Math.cos(yaw);
      const X = root.position.x, Z = root.position.z;
      const sp = this.speed;
      const dx = sp > 1e-3 ? this.vx / sp : 0, dz = sp > 1e-3 ? this.vz / sp : 0;
      const half = Math.min(0.34 * s, sp * 0.15);
      const st = this.curSt;
      for (let i = 0; i < 2; i++) {
        const f = this.feet[i], other = this.feet[1 - i];
        const lx = st[i * 2] * s, lz = st[i * 2 + 1] * s;
        const hx = X + lx * cs + lz * sn, hz = Z - lx * sn + lz * cs; // home under the body
        const hyaw = yaw + st[4 + i];
        if (mode === 'snap') { f.x = hx; f.z = hz; f.yaw = hyaw; f.sw = false; f.lift = 0; f.pitch = 0; f.since = 1; continue; }
        if (mode === 'glue' || mode === 'hop') {
          const k = 1 - Math.exp(-dt * 26);
          f.x += (hx - f.x) * k; f.z += (hz - f.z) * k; f.yaw += angDiff(hyaw, f.yaw) * k;
          const hop = mode === 'hop' ? Math.sin(Math.PI * sat(o.hop ?? 0)) : 0;
          f.lift = hop * 0.1 * s * (i ? 0.7 : 1); f.pitch = hop * 0.35;
          f.sw = false; f.since = 0.05;
          continue;
        }
        const tx = hx + dx * half, tz = hz + dz * half; // landing spot leads the body
        if (f.sw) {
          f.u += dt / f.dur;
          const u = Math.min(1, f.u), e = ease(u);
          f.x = f.fx + (tx - f.fx) * e; f.z = f.fz + (tz - f.fz) * e;
          f.yaw = f.fyaw + angDiff(hyaw, f.fyaw) * e;
          f.lift = Math.sin(Math.PI * u) * f.h;
          f.pitch = Math.sin(Math.PI * 2 * u) * f.pa;
          if (u >= 1) { f.sw = false; f.lift = 0; f.pitch = 0; f.since = 0; this.steps++; }
        } else {
          f.since += dt;
          const ex = f.x - hx, ez = f.z - hz;
          const along = ex * dx + ez * dz;
          const lat = Math.hypot(ex - along * dx, ez - along * dz);
          const yawErr = Math.abs(angDiff(hyaw, f.yaw));
          let lift;
          // swing time grows with speed; at a run it outlasts the stance, which gives a flight phase
          const dur = o.stepDur || Math.max(0.2, Math.min(0.36, 0.16 + sp * 0.037));
          if (sp > 0.5) {
            // The feet must alternate: this one may only leave the ground once the other is down,
            // or far enough through its own swing that the two stay half a cycle apart.
            const stance = (half * 1.85) / sp;
            const uGate = Math.min(0.95, 0.5 + stance / (2 * dur));
            const free = !other.sw || other.u >= uGate;
            lift = (-along > half * 0.85 || lat > 0.16 * s || yawErr > 0.9) && free;
            if (!lift && -along > half * 1.6 && (!other.sw || other.u > 0.5)) lift = true; // never drag a leg
          } else {
            lift = (Math.hypot(ex, ez) > 0.07 * s || yawErr > 0.3) && (!other.sw || (o.stepDur && other.u > 0.5)) && f.since > 0.06;
          }
          if (lift) {
            f.sw = true; f.u = 0; f.fx = f.x; f.fz = f.z; f.fyaw = f.yaw;
            f.dur = dur;
            f.h = (0.04 + Math.min(0.11, sp * 0.02)) * s;
            f.pa = Math.min(0.6, 0.1 + sp * 0.09);
          }
        }
      }
    },
    solveLegs() {
      const s = this.s, yaw = root.rotation.y;
      J.body.getWorldQuaternion(_q4);
      for (let i = 0; i < 2; i++) {
        const S = i ? 'R' : 'L', side = i ? -1 : 1;
        const f = this.feet[i];
        const leg = J['leg' + S], shin = J['shin' + S], foot = J['foot' + S];
        const hip = leg.getWorldPosition(_v1);
        const L1 = THIGH * s, L2 = SHIN * s;
        const dir = _v2.set(f.x - hip.x, ANKLE * s + f.lift - hip.y, f.z - hip.z);
        let D = dir.length();
        dir.multiplyScalar(1 / (D || 1));
        D = Math.max(Math.abs(L1 - L2) + 0.01, Math.min((L1 + L2) * 0.999, D));
        const cosA = Math.max(-1, Math.min(1, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D)));
        const a1 = Math.acos(cosA);
        // knee points forward, between where the body and the foot face, slightly outward
        const fy = f.yaw;
        const pole = new THREE.Vector3(Math.sin(yaw) * 0.5 + Math.sin(fy) * 0.5 + Math.cos(yaw) * side * 0.14, 0.05, Math.cos(yaw) * 0.5 + Math.cos(fy) * 0.5 - Math.sin(yaw) * side * 0.14);
        const pp = pole.addScaledVector(dir, -pole.dot(dir)).normalize();
        const thighDir = new THREE.Vector3().copy(dir).multiplyScalar(Math.cos(a1)).addScaledVector(pp, Math.sin(a1));
        const knee = new THREE.Vector3().copy(hip).addScaledVector(thighDir, L1);
        const ankle = new THREE.Vector3().copy(hip).addScaledVector(dir, D);
        const shinDir = ankle.sub(knee).normalize();
        basisQuat(_q1, thighDir, pp);
        leg.quaternion.copy(_q3.copy(_q4).invert()).multiply(_q1);
        basisQuat(_q2, shinDir, pp);
        shin.quaternion.copy(_q3.copy(_q1).invert()).multiply(_q2);
        _q1.setFromAxisAngle(_YAX, fy).multiply(_q3.setFromAxisAngle(_XAX, f.pitch));
        foot.quaternion.copy(_q3.copy(_q2).invert()).multiply(_q1);
      }
    },
    swayCloth(dt, time) {
      const yaw = root.rotation.y;
      const fwd = this.vx * Math.sin(yaw) + this.vz * Math.cos(yaw);
      const side = this.vx * Math.cos(yaw) - this.vz * Math.sin(yaw);
      this.swF = (this.swF || 0) + (fwd - (this.swF || 0)) * Math.min(1, dt * 5);
      this.swS = (this.swS || 0) + (side - (this.swS || 0)) * Math.min(1, dt * 5);
      for (const c of this.sway) {
        for (let i = 0; i < c.segs.length; i++) {
          const k = i === 0 ? 1 : 0.35;
          c.segs[i].rotation.x = c.rx * (i === 0 ? 1 : 0.3) + Math.max(-0.5, Math.min(1.1, this.swF * 0.16 * c.back)) * k + Math.sin(time * c.f + i * 1.3 + c.ph) * c.amp;
          c.segs[i].rotation.z = c.rz * (i === 0 ? 1 : 0) + Math.max(-0.6, Math.min(0.6, this.swS * 0.1)) * k + Math.sin(time * c.f * 0.63 + i + c.ph) * c.amp * 0.8;
        }
      }
    },
  };
  return rig;
}

function addBlade(rig, hand, mesh, at, len, tipY = 0) {
  const holder = new THREE.Group();
  holder.position.set(at[0], at[1], at[2]);
  holder.add(mesh);
  hand.add(holder);
  const base = new THREE.Object3D();
  base.position.set(0, tipY * 0.18, len * 0.42);
  const tip = new THREE.Object3D();
  tip.position.set(0, tipY, len);
  holder.add(base, tip);
  rig.blades.push({ base, tip, holder });
  return holder;
}

function detail(tex, rx, ry) {
  const t = tex.clone();
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
}

function faceTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#a98466';
    ctx.fillRect(0, 0, w, h);
    const X = (u) => u * w, Y = (v) => (1 - v) * h;
    const blob = (u, v, ru, rv, col) => {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, col); g.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
      ctx.save(); ctx.translate(X(u), Y(v)); ctx.scale(ru * w, rv * h); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, 7); ctx.fill(); ctx.restore();
    };
    // shading: sockets, under the cheekbones, under the nose and lip, jaw stubble
    blob(0.25, 0.3, 0.2, 0.2, 'rgba(60,44,36,0.35)');
    for (const s of [-1, 1]) {
      blob(0.25 + s * 0.062, 0.55, 0.05, 0.05, 'rgba(48,30,24,0.6)');
      blob(0.25 + s * 0.1, 0.38, 0.05, 0.08, 'rgba(70,45,36,0.3)');
      blob(0.25 + s * 0.085, 0.47, 0.045, 0.04, 'rgba(205,150,120,0.22)');
    }
    blob(0.25, 0.345, 0.035, 0.022, 'rgba(50,30,24,0.5)');
    blob(0.25, 0.68, 0.11, 0.07, 'rgba(210,170,140,0.2)');
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      // brow
      ctx.strokeStyle = 'rgba(20,15,13,0.9)'; ctx.lineWidth = 3.4;
      ctx.beginPath(); ctx.moveTo(X(0.25 + s * 0.028), Y(0.592)); ctx.quadraticCurveTo(X(0.25 + s * 0.065), Y(0.615), X(0.25 + s * 0.098), Y(0.59)); ctx.stroke();
      // eye: upper lid line, dark iris, small white
      ctx.fillStyle = 'rgba(214,205,190,0.75)';
      ctx.beginPath(); ctx.ellipse(X(0.25 + s * 0.062), Y(0.548), 6.2, 2.4, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#17110e';
      ctx.beginPath(); ctx.arc(X(0.25 + s * 0.062), Y(0.548), 2.6, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(25,16,13,0.95)'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(X(0.25 + s * 0.036), Y(0.546)); ctx.quadraticCurveTo(X(0.25 + s * 0.062), Y(0.566), X(0.25 + s * 0.09), Y(0.549)); ctx.stroke();
    }
    // mouth
    ctx.strokeStyle = 'rgba(70,32,28,0.85)'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(X(0.212), Y(0.262)); ctx.quadraticCurveTo(X(0.25), Y(0.272), X(0.288), Y(0.262)); ctx.stroke();
    blob(0.25, 0.245, 0.03, 0.014, 'rgba(120,60,50,0.4)');
  });
}

// ------------------------------------------------------------------ the wayfarer (player)

export function makePlayer() {
  const D = detailMaps();
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const mat = {
    coat: S({ color: 0x33414b, roughness: 0.92, normalMap: detail(D.weave, 16, 26), normalScale: new THREE.Vector2(0.7, 0.7), side: THREE.DoubleSide }),
    pants: S({ color: 0x1a1d22, roughness: 0.95, normalMap: detail(D.weave, 14, 22), normalScale: new THREE.Vector2(0.5, 0.5) }),
    trim: S({ color: 0x8a8474, roughness: 0.9, normalMap: detail(D.weave, 8, 30), normalScale: new THREE.Vector2(0.6, 0.6), side: THREE.DoubleSide }),
    sash: S({ color: 0x6f5a3a, roughness: 0.88, normalMap: detail(D.weave, 10, 40), normalScale: new THREE.Vector2(0.9, 0.9), side: THREE.DoubleSide }),
    leather: S({ color: 0x2a1f18, roughness: 0.5, roughnessMap: detail(D.smudge, 2, 3), normalMap: detail(D.leather, 3, 5), normalScale: new THREE.Vector2(0.8, 0.8) }),
    skin: S({ color: 0xa98466, roughness: 0.62 }),
    face: S({ map: faceTexture(), roughness: 0.62 }),
    hair: S({ color: 0x0c0b0c, roughness: 0.42 }),
    scarf: S({ color: 0x5e6c70, roughness: 0.95, normalMap: detail(D.weave, 6, 14), normalScale: new THREE.Vector2(1.2, 1.2), side: THREE.DoubleSide }),
    steel: S({ color: 0xc9ced3, roughness: 0.2, metalness: 1, roughnessMap: detail(D.smudge, 1, 6), emissive: 0x0e1418, flatShading: true }),
    brass: S({ color: 0x80693a, roughness: 0.4, metalness: 1 }),
    wood: S({ color: 0x1b1310, roughness: 0.35 }),
  };
  const rig = makeRig(1);
  const { J } = rig;
  const B = {};
  for (const k of ['coat', 'pants', 'trim', 'sash', 'leather', 'skin', 'face', 'hair', 'scarf']) B[k] = new Builder();

  // coat: fitted torso, skirt to above the knee
  tubeY(B.coat, [[0.57, 0.228, 0.19, 0, -0.005], [0.72, 0.214, 0.174, 0, -0.004], [0.86, 0.196, 0.152], [0.96, 0.178, 0.13], [1.04, 0.152, 0.108], [1.1, 0.15, 0.106],
    [1.2, 0.163, 0.115], [1.32, 0.176, 0.126, 0, 0.004], [1.41, 0.176, 0.122], [1.455, 0.166, 0.112], [1.49, 0.116, 0.086, 0, -0.008], [1.52, 0.074, 0.072, 0, -0.01]], skirtW(0.58, 0.9), { seg: 20, vr: 1 });
  for (const Sd of ['L', 'R']) {
    const side = Sd === 'L' ? 1 : -1;
    // coat sleeve to the elbow, inner robe sleeve below it
    tubeY(B.coat, [[1.5, 0.046, 0.07, 0.165], [1.47, 0.064, 0.078, 0.194], [1.42, 0.064, 0.074, 0.2], [1.34, 0.06, 0.066, 0.201], [1.25, 0.058, 0.063, 0.203], [1.185, 0.062, 0.066, 0.205]], armW(Sd), { side, seg: 10 });
    tubeY(B.pants, [[1.23, 0.05, 0.054, 0.203], [1.17, 0.047, 0.05, 0.205], [1.1, 0.049, 0.051, 0.207], [1.0, 0.041, 0.043, 0.209], [0.925, 0.033, 0.034, 0.21]], armW(Sd), { side, seg: 10 });
    // leather bracer with two straps
    tubeY(B.leather, [[1.13, 0.052, 0.054, 0.207], [1.11, 0.055, 0.057, 0.207], [1.02, 0.047, 0.049, 0.209], [0.955, 0.04, 0.041, 0.21], [0.938, 0.042, 0.043, 0.21]], armW(Sd), { side, seg: 10 });
    for (const y of [1.085, 0.99]) tubeY(B.trim, [[y + 0.012, 0.05, 0.052, 0.208], [y + 0.008, 0.054, 0.056, 0.208], [y - 0.008, 0.053, 0.055, 0.208], [y - 0.012, 0.049, 0.051, 0.208]].map((r) => { const k = y < 1 ? 0.88 : 1; return [r[0], r[1] * k, r[2] * k, r[3]]; }), armW(Sd), { side, seg: 10 });
    trousers(B.pants, Sd);
    boot(B.leather, Sd, false, 1.1);
    // folded boot cuff
    tubeY(B.trim, [[0.452, 0.07, 0.077, 0.1, -0.004], [0.448, 0.075, 0.082, 0.1, -0.004], [0.415, 0.073, 0.08, 0.1, -0.006], [0.41, 0.068, 0.075, 0.1, -0.006]], legW(Sd), { side, seg: 10 });
  }
  const gripR = fist(B.skin, 'R');
  fist(B.skin, 'L');
  // neck and head
  tubeY(B.skin, [[1.47, 0.05, 0.052, 0, -0.012], [1.52, 0.047, 0.05, 0, -0.008], [1.57, 0.046, 0.05, 0, -0.003], [1.6, 0.05, 0.056, 0, 0]], spineW, { seg: 12 });
  const hk = 0.96, hy = REST.head[1];
  tubeY(B.face, headRows(hk), one('head'), { oy: hy, seg: 20, vNorm: true, cap0: true, cap1: true });
  tubeY(B.skin, [[0.092, 0.006, 0.005, 0, 0.088], [0.062, 0.011, 0.013, 0, 0.096], [0.046, 0.015, 0.018, 0, 0.097], [0.034, 0.011, 0.008, 0, 0.09]].map((r) => r.map((v) => v * hk)), one('head'), { oy: hy, seg: 8, cap0: true, cap1: true });
  for (const s of [-1, 1]) tubeY(B.skin, [[0.03, 0.004, 0.008, 0.07, -0.006], [0.05, 0.009, 0.016, 0.074, -0.01], [0.078, 0.008, 0.014, 0.075, -0.012], [0.09, 0.003, 0.006, 0.072, -0.01]], one('head'), { oy: hy, side: s, seg: 6, cap0: true, cap1: true });
  // hair: cap that sits lower at the nape than at the brow, a nape fall, and a top knot
  const hairRing = (y, rx, rz, tilt, cz) => ({ c: [0, hy + y * hk, cz * hk], u: [rx * hk, 0, 0], v: [0, tilt * hk, rz * hk], w: one('head') });
  B.hair.loft([hairRing(0.092, 0.08, 0.097, 0.05, -0.014), hairRing(0.138, 0.079, 0.096, 0.034, -0.01), hairRing(0.176, 0.07, 0.085, 0.016, -0.008), hairRing(0.2, 0.042, 0.052, 0.005, -0.008), hairRing(0.208, 0.01, 0.012, 0, -0.008)], { seg: 16, cap1: true });
  B.hair.loft([hairRing(0.07, 0.079, 0.096, 0, -0.012), hairRing(0.02, 0.07, 0.086, 0, -0.012), hairRing(-0.02, 0.052, 0.066, 0, -0.006)], { seg: 10, a0: Math.PI * 1.06, a1: Math.PI * 1.94 });
  tubeY(B.hair, [[0.198, 0.02, 0.02, 0, -0.03], [0.222, 0.03, 0.03, 0, -0.034], [0.25, 0.027, 0.027, 0, -0.038], [0.264, 0.01, 0.01, 0, -0.04]].map((r) => r.map((v) => v * hk)), one('head'), { oy: hy, seg: 8, cap1: true });
  tubeY(B.trim, [[0.2, 0.024, 0.024, 0, -0.031], [0.214, 0.027, 0.027, 0, -0.033]].map((r) => r.map((v) => v * hk)), one('head'), { oy: hy, seg: 8 });
  // crossed collar and a standing inner collar
  tubePath(B.trim, [[0.068, 1.522, -0.005], [0.058, 1.485, 0.068], [0.02, 1.4, 0.124], [-0.04, 1.27, 0.124], [-0.095, 1.14, 0.106]], 0.021, 0.008, spineW, [0, 0.2, 1]);
  tubePath(B.trim, [[-0.068, 1.522, -0.005], [-0.058, 1.485, 0.068], [-0.02, 1.41, 0.12], [0.004, 1.37, 0.128]], 0.021, 0.007, spineW, [0, 0.2, 1]);
  tubeY(B.trim, [[1.5, 0.062, 0.062, 0, -0.01], [1.552, 0.056, 0.058, 0, -0.008]], spineW, { seg: 12 });
  // waist sash with a knot
  tubeY(B.sash, [[1.03, 0.156, 0.112], [1.045, 0.166, 0.122], [1.085, 0.168, 0.123], [1.118, 0.161, 0.117], [1.128, 0.151, 0.108]], spineW, { seg: 20, vr: 3 });
  tubeY(B.sash, [[1.04, 0.012, 0.01, 0.062, 0.122], [1.055, 0.034, 0.024, 0.062, 0.128], [1.09, 0.036, 0.026, 0.062, 0.13], [1.11, 0.014, 0.012, 0.062, 0.124]], one('torso'), { seg: 8, cap0: true, cap1: true });
  // wool scarf wrapped at the neck
  tubeY(B.scarf, [[1.462, 0.112, 0.092, 0, -0.004], [1.485, 0.112, 0.098, 0, -0.004], [1.52, 0.092, 0.088, 0, -0.006], [1.548, 0.07, 0.072, 0, -0.008], [1.556, 0.058, 0.06, 0, -0.008]], spineW, { seg: 16, vr: 3 });
  // scabbard on the left hip
  tubePath(B.leather, [[0.172, 1.05, 0.12], [0.185, 0.99, -0.06], [0.2, 0.9, -0.36], [0.215, 0.81, -0.66], [0.22, 0.79, -0.72]], (i) => (i === 4 ? 0.008 : 0.024), 0.011, one('body'), [1, 0.3, 0]);

  for (const k in B) rig.addMesh(B[k], mat[k]);

  // straight double-edged sword in the right fist
  const sb = new Builder();
  tubeZ(sb, [[0.055, 0.0045, 0.024], [0.6, 0.004, 0.021], [0.9, 0.0034, 0.017], [0.99, 0.002, 0.009], [1.03, 0.0004, 0.0004]], one('body'), { seg: 4, n: 1, cap0: true });
  const swordG = new THREE.Group();
  const blade = new THREE.Mesh(sb.geometry(false), mat.steel);
  blade.castShadow = true;
  swordG.add(blade);
  const hb = new Builder();
  tubeZ(hb, [[0.03, 0.012, 0.03], [0.038, 0.014, 0.056], [0.052, 0.014, 0.058], [0.06, 0.01, 0.03]], one('body'), { seg: 10, n: 3, cap0: true, cap1: true });
  tubeZ(hb, [[-0.125, 0.006, 0.006], [-0.115, 0.018, 0.02], [-0.095, 0.018, 0.02], [-0.085, 0.01, 0.011]], one('body'), { seg: 8, cap0: true });
  const hilt = new THREE.Mesh(hb.geometry(false), mat.brass);
  hilt.castShadow = true;
  swordG.add(hilt);
  const gb = new Builder();
  tubeZ(gb, [[-0.09, 0.0115, 0.0135], [-0.03, 0.013, 0.015], [0.032, 0.012, 0.0145]], one('body'), { seg: 8 });
  swordG.add(new THREE.Mesh(gb.geometry(false), mat.leather));
  addBlade(rig, J.handR, swordG, gripR, 1.03);
  rig.steel = mat.steel;

  // swaying cloth: scarf tail, sash ends, hair ribbon
  const sw = (segs, rx, rz, back, amp, f) => rig.sway.push({ segs, rx, rz, back, amp, f, ph: rig.sway.length * 1.7 });
  sw(strip(J.torso, [0.05, 0.01, 0.132], 2, 0.06, 0.2, mat.sash, 0.8), -0.06, 0.08, 0.6, 0.05, 3.6);
  sw(strip(J.torso, [0.085, 0.01, 0.128], 2, 0.055, 0.17, mat.sash, 0.8), -0.04, -0.12, 0.6, 0.05, 3.1);
  rig.finish();
  return rig;
}

// ------------------------------------------------------------------ the boss

export function makeBoss() {
  const D = detailMaps();
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const mat = {
    coat: S({ color: 0x5c221c, roughness: 0.86, normalMap: detail(D.weave, 18, 22), normalScale: new THREE.Vector2(0.8, 0.8), side: THREE.DoubleSide }),
    robe: S({ color: 0x151517, roughness: 0.95, normalMap: detail(D.weave, 14, 22), normalScale: new THREE.Vector2(0.5, 0.5) }),
    plate: S({ color: 0x3b3f45, roughness: 0.4, metalness: 1, roughnessMap: detail(D.smudge, 2, 2), normalMap: detail(D.hammered, 3, 3), normalScale: new THREE.Vector2(0.5, 0.5), side: THREE.DoubleSide }),
    brass: S({ color: 0x7c6332, roughness: 0.36, metalness: 1, roughnessMap: detail(D.smudge, 2, 3), normalMap: detail(D.hammered, 4, 4), normalScale: new THREE.Vector2(0.35, 0.35), side: THREE.DoubleSide }),
    leather: S({ color: 0x1c1511, roughness: 0.48, roughnessMap: detail(D.smudge, 2, 3), normalMap: detail(D.leather, 3, 5), normalScale: new THREE.Vector2(0.8, 0.8) }),
    sash: S({ color: 0x4d2019, roughness: 0.9, normalMap: detail(D.weave, 8, 30), side: THREE.DoubleSide }),
  };
  const sc = 1.14;
  const rig = makeRig(sc);
  const { J } = rig;
  const B = {};
  for (const k of ['coat', 'robe', 'plate', 'brass', 'leather']) B[k] = new Builder();

  // long heavy coat
  const coatRows = [[0.33, 0.262, 0.2, 0, -0.01], [0.5, 0.246, 0.186, 0, -0.008], [0.7, 0.226, 0.166, 0, -0.004], [0.86, 0.206, 0.15], [0.96, 0.19, 0.136], [1.04, 0.168, 0.118], [1.1, 0.166, 0.117],
    [1.2, 0.18, 0.126], [1.3, 0.193, 0.133, 0, 0.004], [1.41, 0.2, 0.13], [1.455, 0.194, 0.12], [1.49, 0.126, 0.092, 0, -0.008], [1.525, 0.082, 0.08, 0, -0.01], [1.56, 0.07, 0.072, 0, -0.01]];
  tubeY(B.coat, coatRows, skirtW(0.36, 0.62), { seg: 22, vr: 1 }); // a long coat hangs from the hips more than it rides the thighs
  const coatR = (y) => {
    for (let i = 1; i < coatRows.length; i++) if (y <= coatRows[i][0]) { const a = coatRows[i - 1], b = coatRows[i]; const t = (y - a[0]) / (b[0] - a[0]); return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
    return [0.2, 0.13];
  };
  // lamellar cuirass: overlapping horizontal bands, each flaring over the next
  const bands = [];
  for (let y = 1.43; y > 1.13; y -= 0.06) {
    const a = coatR(y), b = coatR(y - 0.06);
    bands.push([y, a[0] + 0.012, a[1] + 0.014], [y - 0.06, b[0] + 0.024, b[1] + 0.027]);
  }
  tubeY(B.plate, bands, spineW, { seg: 22, vr: 2 });
  tubeY(B.brass, [[1.445, 0.208, 0.14], [1.428, 0.214, 0.146], [1.42, 0.21, 0.142]], spineW, { seg: 22 });
  // belt, buckle
  tubeY(B.leather, [[1.03, 0.176, 0.126], [1.04, 0.184, 0.134], [1.1, 0.184, 0.134], [1.11, 0.178, 0.128]], spineW, { seg: 22, vr: 3 });
  tubeZ(B.brass, [[0.128, 0.03, 0.036, 0, 1.07], [0.142, 0.038, 0.044, 0, 1.07], [0.148, 0.03, 0.036, 0, 1.07]], one('torso'), { seg: 10, n: 5, cap1: true });
  // crossed harness straps, front and back
  for (const s of [-1, 1]) {
    tubePath(B.leather, [[s * 0.15, 1.47, 0.07], [s * 0.1, 1.4, 0.146], [0, 1.28, 0.165], [-s * 0.1, 1.17, 0.156], [-s * 0.15, 1.1, 0.12]], 0.02, 0.007, spineW, [0, 0.1, 1]);
    tubePath(B.leather, [[s * 0.15, 1.47, -0.07], [s * 0.09, 1.38, -0.15], [-s * 0.06, 1.2, -0.15], [-s * 0.14, 1.1, -0.115]], 0.02, 0.007, spineW, [0, 0.1, -1]);
  }
  for (const Sd of ['L', 'R']) {
    const side = Sd === 'L' ? 1 : -1;
    tubeY(B.robe, [[1.5, 0.055, 0.08, 0.165], [1.47, 0.082, 0.092, 0.2], [1.42, 0.08, 0.088, 0.205], [1.33, 0.07, 0.076, 0.205], [1.22, 0.064, 0.068, 0.205], [1.17, 0.06, 0.064, 0.206], [1.1, 0.058, 0.06, 0.207], [0.93, 0.036, 0.037, 0.21]], armW(Sd), { side, seg: 10 });
    // brass vambrace with a flared elbow
    tubeY(B.brass, [[1.165, 0.068, 0.072, 0.206], [1.14, 0.063, 0.066, 0.206], [1.11, 0.06, 0.062, 0.207], [1.02, 0.052, 0.054, 0.209], [0.95, 0.045, 0.046, 0.21], [0.936, 0.048, 0.049, 0.21]], (y) => (y > 1.12 ? one('fore' + Sd) : armW(Sd)(y)), { side, seg: 12 });
    // three-plate pauldron on the outside of the shoulder
    const a0 = side > 0 ? -1.75 : Math.PI - 1.75, a1 = side > 0 ? 1.75 : Math.PI + 1.75;
    const pw = (wc) => [['chest', wc], ['arm' + Sd, 1 - wc]];
    tubeY(B.brass, [[1.512, 0.06, 0.08, 0.185], [1.47, 0.1, 0.108, 0.196], [1.43, 0.112, 0.118, 0.2]], pw(0.7), { side, seg: 12, a0, a1 });
    tubeY(B.plate, [[1.44, 0.098, 0.106, 0.2], [1.37, 0.114, 0.12, 0.203]], pw(0.25), { side, seg: 12, a0, a1 });
    tubeY(B.plate, [[1.38, 0.094, 0.1, 0.203], [1.31, 0.106, 0.11, 0.204]], pw(0.05), { side, seg: 12, a0, a1 });
    // hip tassets
    const tw = () => [['body', 0.55], ['leg' + Sd, 0.45]];
    const ta = side > 0 ? [[-0.55, 0.6], [0.72, 1.48]] : [[Math.PI - 0.6, Math.PI + 0.55], [Math.PI - 1.48, Math.PI - 0.72]];
    for (const [b0, b1] of ta) {
      tubeY(B.plate, [[1.035, 0.19, 0.14], [0.9, 0.214, 0.158]], tw, { seg: 6, a0: b0, a1: b1 });
      tubeY(B.plate, [[0.915, 0.208, 0.153], [0.77, 0.23, 0.172]], tw, { seg: 6, a0: b0, a1: b1 });
      tubeY(B.brass, [[0.78, 0.232, 0.174], [0.765, 0.233, 0.175]], tw, { seg: 6, a0: b0, a1: b1 });
    }
    trousers(B.robe, Sd, 1.06);
    boot(B.leather, Sd, true, 1.08);
    // greave over the shin
    tubeY(B.brass, [[0.5, 0.074, 0.088, 0.1, 0.002], [0.455, 0.072, 0.084, 0.1, -0.002], [0.33, 0.066, 0.076, 0.1, -0.01], [0.2, 0.054, 0.061, 0.1, -0.008], [0.13, 0.05, 0.056, 0.1, -0.008]], legW(Sd), { side, seg: 8, a0: 0.25, a1: Math.PI - 0.25 });
  }
  const gR = fist(B.leather, 'R', 1.08);
  const gL = fist(B.leather, 'L', 1.08);
  // wrapped head, iron mask
  const hy = REST.head[1];
  tubeY(B.robe, [[1.47, 0.056, 0.058, 0, -0.012], [1.57, 0.052, 0.056, 0, -0.004], [1.6, 0.056, 0.062, 0, 0]], spineW, { seg: 12 });
  tubeY(B.robe, headRows(1, 0.004), one('head'), { oy: hy, seg: 16, cap0: true, cap1: true });
  const maskRows = headRows(1, 0.013).slice(1, 8);
  tubeY(B.plate, maskRows, one('head'), { oy: hy, seg: 10, a0: 0.5, a1: Math.PI - 0.5 });
  tubeY(B.brass, [[0.128, 0.09, 0.109, 0, -0.004], [0.14, 0.09, 0.109, 0, -0.004]], one('head'), { oy: hy, seg: 10, a0: 0.45, a1: Math.PI - 0.45 });
  // pressure pack between the shoulder blades, two vent stacks
  tubeY(B.plate, [[1.19, 0.05, 0.03, 0, -0.185], [1.2, 0.1, 0.062, 0, -0.19], [1.44, 0.1, 0.062, 0, -0.19], [1.46, 0.07, 0.04, 0, -0.185]], one('chest'), { seg: 14, n: 4, cap0: true, cap1: true });
  for (const y of [1.24, 1.4]) tubeY(B.brass, [[y - 0.012, 0.103, 0.065, 0, -0.19], [y + 0.012, 0.103, 0.065, 0, -0.19]], one('chest'), { seg: 14, n: 4 });
  for (const s of [-1, 1]) {
    tubeY(B.plate, [[1.44, 0.024, 0.024, 0.055, -0.2], [1.6, 0.022, 0.022, 0.055, -0.21], [1.61, 0.027, 0.027, 0.055, -0.21]], one('chest'), { side: s, seg: 8 });
    tubeY(B.brass, [[1.5, 0.027, 0.027, 0.055, -0.204], [1.515, 0.027, 0.027, 0.055, -0.205]], one('chest'), { side: s, seg: 8 });
  }
  // twin scabbards crossed low on the back
  for (const s of [-1, 1]) tubePath(B.leather, [[s * 0.21, 1.13, -0.1], [s * 0.1, 1.02, -0.17], [-s * 0.12, 0.84, -0.2], [-s * 0.3, 0.7, -0.19], [-s * 0.33, 0.68, -0.185]], (i) => (i === 4 ? 0.01 : 0.03), 0.012, (y) => (y > 1 ? one('torso') : one('body')), [0, 0.2, -1]);

  for (const k in B) rig.addMesh(B[k], mat[k]);

  // glowing mask slit and pack sight-glass (colour is driven by the fight state)
  rig.eyeMat = new THREE.MeshBasicMaterial({ color: 0x8fe4ff });
  const slit = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.011, 0.02), rig.eyeMat);
  slit.position.set(0, 0.087, 0.096);
  J.head.add(slit);
  rig.packGlow = new THREE.MeshBasicMaterial({ color: 0x5ac8ff });
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.012), rig.packGlow);
  glass.position.set(0, 0.05, -0.252);
  J.chest.add(glass);
  rig.vent = new THREE.Object3D();
  rig.vent.position.set(0, 0.36, -0.21);
  J.chest.add(rig.vent);

  // wide iron rain hat
  const hatPts = [[0, 0.12], [0.03, 0.118], [0.09, 0.092], [0.22, 0.045], [0.4, 0.004], [0.432, -0.008], [0.424, -0.02], [0.4, -0.012], [0.22, 0.026], [0.09, 0.07], [0.0, 0.085]].map((p) => new THREE.Vector2(p[0], p[1]));
  const hat = new THREE.Mesh(new THREE.LatheGeometry(hatPts, 36), mat.plate);
  hat.position.set(0, 0.158, -0.004);
  hat.rotation.x = 0.07;
  hat.castShadow = true;
  J.head.add(hat);
  const rimPts = [[0.424, -0.022], [0.44, -0.012], [0.436, 0.0], [0.42, -0.006]].map((p) => new THREE.Vector2(p[0], p[1]));
  const rim = new THREE.Mesh(new THREE.LatheGeometry(rimPts, 36), mat.brass);
  hat.add(rim);
  const knob = new THREE.Mesh(new THREE.LatheGeometry([[0, 0.15], [0.016, 0.145], [0.02, 0.13], [0.012, 0.118], [0.03, 0.112]].map((p) => new THREE.Vector2(p[0], p[1])), 12), mat.brass);
  hat.add(knob);

  // twin curved sabres
  rig.edgeMat = S({ color: 0xbfc8d0, roughness: 0.22, metalness: 1, emissive: 0x2c6c90, emissiveIntensity: 1, flatShading: true });
  const LEN = 1.2, CURVE = 0.1;
  for (const [n, grip] of [['R', gR], ['L', gL]]) {
    const bb = new Builder();
    const rows = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const wdt = t < 0.75 ? 0.024 + t * 0.012 : 0.033 * (1 - ((t - 0.75) / 0.25) ** 1.6);
      rows.push([0.06 + t * (LEN - 0.06), 0.0048 * (1 - t * 0.5), Math.max(0.0005, wdt), 0, CURVE * t * t + (0.033 - wdt) * 0.6]);
    }
    tubeZ(bb, rows, one('body'), { seg: 4, n: 1, cap0: true });
    const g = new THREE.Group();
    const bl = new THREE.Mesh(bb.geometry(false), rig.edgeMat);
    bl.castShadow = true;
    g.add(bl);
    const hb = new Builder();
    tubeZ(hb, [[0.03, 0.02, 0.03], [0.04, 0.046, 0.052], [0.052, 0.046, 0.052], [0.06, 0.016, 0.03]], one('body'), { seg: 12, cap0: true, cap1: true });
    tubeZ(hb, [[-0.14, 0.008, 0.008], [-0.13, 0.02, 0.024], [-0.108, 0.02, 0.024], [-0.098, 0.012, 0.014]], one('body'), { seg: 8, cap0: true });
    const hm = new THREE.Mesh(hb.geometry(false), mat.brass);
    hm.castShadow = true;
    g.add(hm);
    const gb = new Builder();
    tubeZ(gb, [[-0.1, 0.0125, 0.0145], [-0.03, 0.0138, 0.016], [0.032, 0.013, 0.0155]], one('body'), { seg: 8 });
    g.add(new THREE.Mesh(gb.geometry(false), mat.leather));
    addBlade(rig, J['hand' + n], g, grip, LEN, CURVE);
  }
  // sash ends hanging from the belt
  const sw = (segs, rx, rz, back, amp, f) => rig.sway.push({ segs, rx, rz, back, amp, f, ph: rig.sway.length * 1.7 });
  sw(strip(J.torso, [-0.07, -0.01, 0.142], 3, 0.075, 0.2, mat.sash, 0.8), -0.05, -0.06, 0.5, 0.04, 2.6);
  sw(strip(J.torso, [-0.115, -0.01, 0.132], 3, 0.065, 0.17, mat.sash, 0.8), -0.03, 0.1, 0.5, 0.04, 2.2);
  rig.flashMats = [mat.coat, mat.plate, mat.brass, mat.robe];
  rig.finish();
  return rig;
}

// ------------------------------------------------------------------ animation

export function animatePlayer(rig, p, dt, time) {
  rig.place(p.x, p.z, p.yaw, dt);
  let pose = PP.idle;
  let rate = 16;
  const o = { mode: 'step', armSwing: 0 };
  rig.trail = false;
  if (p.st === 'dead') {
    pose = p.t < 0.35 ? mix(PP.hurt, add(PP.hurt, { y: -0.35, torso: [-0.2, 0, 0] }), p.t / 0.35) : PP.dead;
    rate = 9;
  } else if (p.st === 'hurt') {
    // recoil hard, then gather back toward the stance
    const u = sat(p.t / p.hurtDur);
    pose = u < 0.45 ? PP.hurt : mix(PP.hurt, PP.guard, (u - 0.45) / 0.55);
    rate = u < 0.45 ? 34 : 14;
    o.stepDur = 0.14;
  } else if (p.st === 'dodge') {
    const side = p.dodgeX * Math.cos(p.yaw) - p.dodgeZ * Math.sin(p.yaw); // + = toward local +x
    const fwd = p.dodgeX * Math.sin(p.yaw) + p.dodgeZ * Math.cos(p.yaw);
    const u = sat(p.t / DODGE.dur);
    pose = add(PP.dodge, { body: [fwd * 0.3, 0, -side * 0.42], torso: [0, 0, -side * 0.2] });
    if (u > 0.7) pose = mix(pose, PP.idle, (u - 0.7) / 0.3);
    rate = 26;
    if (u < 0.62) { o.mode = 'hop'; o.hop = u / 0.62; } else o.stepDur = 0.12;
  } else if (p.st === 'attack') {
    const A = ATTACKS[p.combo];
    const [a, b, c] = SWINGS[p.combo];
    const t0 = A.wind * 0.6;
    const t1 = A.wind + A.act + 0.03;
    const t2 = t1 + A.rec * 0.42;
    const tot = A.wind + A.act + A.rec;
    if (p.t < t0) { pose = a; rate = 40; } // anticipation: coil away from the cut
    else if (p.t < t1) { pose = mix(a, b, ease((p.t - t0) / (t1 - t0))); rate = 62; rig.trail = true; } // committed cut
    else if (p.t < t2) { pose = mix(b, c, easeOut((p.t - t1) / (t2 - t1))); rate = 26; rig.trail = p.t < t1 + 0.05; } // follow-through
    else { pose = mix(c, PP.idle, ease((p.t - t2) / (tot - t2))); rate = 14; } // recovery
    o.stepDur = 0.11;
  } else if (p.guard) {
    pose = add(PP.guard, { y: Math.sin(time * 2.4) * 0.006 });
    rate = 24;
    o.armSwing = 0.1;
  } else if (p.moving) {
    pose = PP.run;
    rate = 14;
    o.armSwing = 1;
  } else {
    const br = Math.sin(time * 1.9);
    pose = add(PP.idle, { y: br * 0.008, chest: [br * 0.018, 0, 0], armL: [0, 0, br * 0.012], armR: [0, 0, -br * 0.012], body: [0, 0, Math.sin(time * 0.7) * 0.012] });
    rate = 9;
    o.armSwing = 0.5;
  }
  rig.animate(pose, rate, dt, o);
  rig.swayCloth(dt, time);
}

export function animateBoss(rig, b, dt, time) {
  let pose = BP.idle;
  let rate = 12;
  const o = { mode: 'step', armSwing: 0 };
  rig.trailR = false; rig.trailL = false;
  const br = Math.sin(time * 2.2);
  const breathe = { y: br * 0.012, chest: [br * 0.025, 0, 0], armL: [0, 0, br * 0.015], armR: [0, 0, -br * 0.015] };
  const s = currentSeg(b);
  if (b.st === 'wait') {
    pose = add(BP.wait, breathe); rate = 5;
  } else if (b.st === 'intro') {
    pose = mix(BP.wait, BP.idle, ease(sat((b.t - 0.5) / 0.8))); rate = 8;
  } else if (b.st === 'dead') {
    pose = b.t < 0.9 ? mix(BP.recover, BP.kneel, ease(b.t / 0.9)) : BP.dead;
    rate = 8;
  } else if (b.st === 'phase') {
    if (b.t < 1.25) pose = add(mix(BP.recover, BP.kneel, ease(sat(b.t / 0.6))), { chest: [Math.sin(time * 38) * 0.02 * sat(b.t), 0, 0] });
    else if (b.t < 2.4) pose = add(BP.roar, { chest: [0, 0, Math.sin(time * 46) * 0.018] });
    else pose = mix(BP.roar, BP.idle, (b.t - 2.4) / 0.4);
    rate = b.t < 1.25 ? 8 : 18;
  } else if (b.st === 'idle') {
    pose = add(BP.idle, breathe);
    o.armSwing = 0.25;
    rate = 10;
  } else if (s) {
    const u = sat(b.segT / s.d);
    const next = b.move.segs[b.si + 1];
    const prev = b.move.segs[b.si - 1];
    const pre = (anim) => ({ slashR: BP.slashRa, slashL: BP.slashLa, slam: BP.delayWind, spin: BP.spinWind, reverse: BP.revWind, dash: BP.lungeWind }[anim]);
    const post = (anim) => ({ slashR: BP.slashRb, slashL: BP.slashLb, slam: BP.slam, spin: BP.spin, reverse: BP.revHit, dash: BP.dash }[anim]);
    o.stepDur = 0.13;
    if (s.k === 'wind') {
      if (s.tele === 'chain') { pose = u < 0.72 ? BP.chainWind : mix(BP.chainWind, BP.slashRa, (u - 0.72) / 0.28); rate = u < 0.72 ? 12 : 36; }
      else if (s.tele === 'delay') { pose = mix(s.again ? BP.slam : BP.idle, BP.delayWind, ease(u)); rate = s.again ? 26 : 13; o.stepDur = 0.2; }
      else if (s.tele === 'lunge') { pose = mix(BP.idle, BP.lungeWind, ease(sat(u * 1.6))); rate = 15; o.stepDur = 0.18; }
    } else if (s.k === 'hold') {
      if (s.tele === 'delayHold') { pose = add(BP.delayWind, { armR: [Math.sin(time * 60) * 0.012, 0, 0], armL: [Math.cos(time * 60) * 0.012, 0, 0], y: 0.01 }); rate = 26; }
      else if (s.tele === 'spin') { pose = BP.spinWind; rate = 16; }
      else if (s.tele === 'reverse') { pose = BP.revWind; rate = 20; }
    } else if (s.k === 'gap') {
      pose = u < 0.35 ? post(prev.anim) : mix(post(prev.anim), pre(next.anim), (u - 0.35) / 0.5);
      rate = 40;
    } else if (s.k === 'hit') {
      pose = mix(pre(s.anim), post(s.anim), ease(u));
      if (s.anim === 'spin') { pose = add(pose, { yaw: Math.PI * 2 * sat(b.segT / 0.36) }); o.mode = 'glue'; }
      rate = 70;
      if (s.anim === 'slashR' || s.anim === 'reverse') rig.trailR = true;
      else if (s.anim === 'slashL') rig.trailL = true;
      else { rig.trailR = true; rig.trailL = true; }
    } else if (s.k === 'dash') {
      pose = BP.dash; rate = 44; rig.trailR = true; rig.trailL = true;
      o.mode = 'hop'; o.hop = 0.15 + u * 0.7;
    } else if (s.k === 'rec') {
      const lastAnim = prev ? prev.anim : null;
      const tail = s.d - b.segT;
      if (b.segT < 0.22 && lastAnim) {
        // follow-through: the cut keeps sinking before the body gives up the momentum
        pose = add(post(lastAnim), { y: -0.04 * sat(b.segT / 0.22), torso: [0.08 * sat(b.segT / 0.22), 0, 0] });
        if (lastAnim === 'spin') { pose = add(pose, { yaw: Math.PI * 2 * sat((prev.d + b.segT) / 0.36) }); o.mode = 'glue'; }
        rate = 34;
        rig.trailR = b.segT < 0.12 && lastAnim !== 'slashL';
        rig.trailL = b.segT < 0.12 && lastAnim !== 'slashR' && lastAnim !== 'reverse';
      } else if (tail < 0.3) { pose = mix(BP.idle, BP.recover, tail / 0.3); rate = 11; }
      else { pose = add(BP.recover, { y: Math.sin(time * 6) * 0.02, chest: [Math.sin(time * 6) * 0.06, 0, 0], head: [Math.sin(time * 6 + 0.6) * 0.05, 0, 0] }); rate = 9; o.stepDur = 0.24; }
    }
  }
  // hit reaction: a short flinch away from the blow
  const fl = sat(b.flash / 0.16);
  if (fl > 0 && b.st !== 'dead') pose = add(pose, { torso: [-0.22 * fl, 0.12 * fl, 0], head: [-0.2 * fl, 0, 0], y: -0.03 * fl });
  for (const m of rig.flashMats) m.emissive.setRGB(0.03 * fl, 0.025 * fl, 0.02 * fl);
  rig.place(b.x, b.z, b.yaw + (pose.yaw || 0), dt);
  rig.animate(pose, rate, dt, o);
  rig.swayCloth(dt, time);
}
