// Procedural humanoid swordfighters: layered-clothing body built in code, a sword-centric pose
// set, two-bone IK for arms (both hands follow the hilt) and legs (feet plant in world space and
// step), spring recoil, and simple cloth panels. Presentation only — the simulation is untouched.
import * as THREE from 'three/webgpu';
import { normalView, normalWorld, positionViewDirection, vec3, float, smoothstep } from 'three/tsl';
import { MOVES, C } from './sim.js';
import { MOON } from './world.js';

// Body landmarks in metres at scale 1 (about 7.5 heads tall, 1.76 m).
const D = { hipY: 0.93, hipW: 0.09, spine: 0.12, chest: 0.17, neck: 0.3, shW: 0.185, shY: 0.235, upArm: 0.285, foreArm: 0.255, hand: 0.075, thigh: 0.43, shin: 0.42, ankle: 0.075 };
const ARM_REACH = D.upArm + D.foreArm + D.hand - 0.02;
const LEG_REACH = (D.thigh + D.shin) * 0.985;

// ---------------------------------------------------------------- poses
// Frame: +z forward, +x the fighter's left, +y up.
//  hip   pelvis offset from standing            hipR  pelvis rotation [pitch, yaw, roll]
//  chest chest rotation relative to the pelvis  head  extra head rotation
//  sp    sword guard point (right hand) in the chest frame: shoulders at y +0.24, x -/+0.185
//  sd    blade direction in the fighter's frame two   1 = left hand on the hilt, 0 = left hand at lh
//  fL/fR foot placement [x, z, heel lift]       free  feet follow the pose directly (lying, airborne)
const BASE = { hip: [0, -0.03, 0], hipR: [0, 0.28, 0], chest: [0.05, -0.12, 0], head: [0, 0, 0], sp: [-0.03, -0.1, 0.3], sd: [0.08, 0.42, 0.9], two: 1, lh: [0.24, -0.2, 0.08], fL: [0.13, -0.18, 0], fR: [-0.11, 0.16, 0], yawL: 0.45, yawR: -0.05, free: 0, fp: 0, breath: 1 };
const mk = (o) => { const p = { ...BASE, ...o }; const l = Math.hypot(...p.sd); p.sd = p.sd.map((v) => v / l); return p; };
const LUNGE = { fL: [0.14, -0.32, 0], fR: [-0.1, 0.42, 0] };
const KNEEL = { fL: [0.15, -0.4, 0.07], fR: [-0.12, 0.26, 0], yawL: 0.2 };

export const POSES = {
  idle: mk({}),
  run: mk({ hip: [0, -0.08, 0.02], hipR: [0.12, 0, 0], chest: [0.2, 0, 0], sp: [-0.23, -0.2, 0.12], sd: [-0.18, -0.38, -0.9], two: 0, lh: [0.23, -0.16, 0.12], fL: [0.09, 0, 0], fR: [-0.09, 0, 0], yawL: 0.05, yawR: -0.05 }),
  guard: mk({ hip: [0, -0.09, 0], hipR: [0, 0.2, 0], chest: [0.04, 0.1, 0], sp: [-0.1, 0, 0.3], sd: [0.62, 0.72, 0.3], fL: [0.15, -0.24, 0], fR: [-0.12, 0.2, 0] }),
  deflect: mk({ hip: [0, -0.11, 0.05], hipR: [0, 0.1, 0], chest: [-0.07, 0.38, 0], sp: [-0.02, 0.13, 0.4], sd: [0.82, 0.52, 0.22], fL: [0.15, -0.26, 0], fR: [-0.12, 0.24, 0] }),
  // right-to-left diagonal cut
  windR: mk({ hip: [0, -0.04, -0.03], hipR: [0, -0.15, 0], chest: [-0.06, -0.55, 0], sp: [-0.2, 0.34, 0.08], sd: [-0.25, 0.75, -0.6] }),
  hitR: mk({ ...LUNGE, hip: [0, -0.14, 0.08], hipR: [0.05, 0.25, 0], chest: [0.22, 0.5, 0], sp: [0.06, -0.2, 0.34], sd: [0.45, -0.35, 0.82] }),
  folR: mk({ ...LUNGE, hip: [0, -0.17, 0.07], hipR: [0.06, 0.3, 0], chest: [0.28, 0.7, 0], sp: [0.16, -0.26, 0.24], sd: [0.75, -0.5, 0.42] }),
  // left-to-right diagonal cut
  windL: mk({ hip: [0, -0.04, -0.03], hipR: [0, 0.25, 0], chest: [-0.06, 0.5, 0], sp: [0.12, 0.3, 0.12], sd: [0.35, 0.75, -0.55] }),
  hitL: mk({ ...LUNGE, hip: [0, -0.14, 0.08], hipR: [0.05, -0.2, 0], chest: [0.22, -0.5, 0], sp: [-0.14, -0.2, 0.36], sd: [-0.45, -0.35, 0.82] }),
  folL: mk({ ...LUNGE, hip: [0, -0.17, 0.07], hipR: [0.06, -0.25, 0], chest: [0.28, -0.7, 0], sp: [-0.24, -0.26, 0.22], sd: [-0.75, -0.5, 0.42] }),
  // overhead cut
  windO: mk({ hip: [0, 0, -0.03], hipR: [-0.04, 0.1, 0], chest: [-0.16, -0.1, 0], sp: [-0.02, 0.5, 0.04], sd: [0, 0.5, -0.86] }),
  hitO: mk({ ...LUNGE, hip: [0, -0.16, 0.1], hipR: [0.08, 0.1, 0], chest: [0.35, -0.1, 0], sp: [-0.02, -0.16, 0.42], sd: [0, -0.25, 0.97] }),
  folO: mk({ ...LUNGE, hip: [0, -0.21, 0.1], hipR: [0.1, 0.1, 0], chest: [0.45, -0.1, 0], sp: [-0.02, -0.28, 0.36], sd: [0, -0.6, 0.8] }),
  // thrust: coil at the hip, then full extension
  windT: mk({ hip: [0, -0.2, -0.1], hipR: [0, -0.3, 0], chest: [0.2, -0.3, 0], sp: [-0.2, -0.14, 0.08], sd: [0, 0.02, 1], fL: [0.16, -0.35, 0], fR: [-0.12, 0.25, 0] }),
  hitT: mk({ hip: [0, -0.24, 0.2], hipR: [0.1, 0.2, 0], chest: [0.3, 0.35, 0], sp: [-0.06, 0.02, 0.52], sd: [0, -0.03, 1], fL: [0.14, -0.45, 0], fR: [-0.1, 0.7, 0] }),
  folT: mk({ hip: [0, -0.2, 0.14], hipR: [0.08, 0.2, 0], chest: [0.25, 0.25, 0], sp: [-0.08, -0.08, 0.44], sd: [0, -0.12, 1], fL: [0.14, -0.4, 0], fR: [-0.1, 0.55, 0] }),
  stagger: mk({ hip: [0, -0.07, -0.08], hipR: [-0.08, 0.1, 0], chest: [-0.3, 0.3, 0.1], head: [-0.2, 0, 0], sp: [-0.3, -0.2, 0.2], sd: [-0.6, 0.3, 0.7], two: 0, lh: [0.32, 0, 0.15], fL: [0.16, -0.3, 0], fR: [-0.14, 0.1, 0] }),
  kneel: mk({ ...KNEEL, hip: [0, -0.43, 0], hipR: [0.15, 0.1, 0], chest: [0.45, 0, 0], head: [0.35, 0, 0], sp: [-0.16, -0.05, 0.34], sd: [-0.1, -0.93, 0.35], two: 0, lh: [0.2, -0.3, 0.2], breath: 3.2 }),
  arched: mk({ ...KNEEL, hip: [0, -0.4, -0.05], hipR: [-0.25, 0, 0], chest: [-0.5, 0, 0], head: [-0.4, 0, 0], sp: [-0.4, 0, 0], sd: [-0.7, -0.5, 0.3], two: 0, lh: [0.42, 0.1, -0.05] }),
  pinned: mk({ hip: [0, -0.2, 0.12], hipR: [0.2, 0.15, 0], chest: [0.5, 0.3, 0], head: [-0.25, 0, 0], sp: [-0.05, -0.2, 0.48], sd: [0.1, -0.6, 0.8], fL: [0.14, -0.4, 0], fR: [-0.1, 0.6, 0] }),
  bind: mk({ ...LUNGE, hip: [0, -0.22, 0.1], hipR: [0.1, 0.2, 0], chest: [0.4, 0.3, 0], sp: [0.05, -0.25, 0.4], sd: [0.55, -0.6, 0.55] }),
  dodge: mk({ hip: [0, -0.2, 0.06], hipR: [0.1, 0, 0], chest: [0.22, 0, 0], sp: [-0.24, -0.2, 0.1], sd: [-0.2, -0.3, -0.93], two: 0, lh: [0.2, -0.1, 0.25], fL: [0.12, -0.3, 0], fR: [-0.1, 0.3, 0] }),
  roar: mk({ hip: [0, 0, 0], hipR: [-0.05, 0, 0], chest: [-0.2, 0, 0], head: [-0.25, 0, 0], sp: [-0.42, -0.05, 0.1], sd: [-0.55, -0.8, 0.2], two: 0, lh: [0.4, -0.1, 0.1], fL: [0.22, -0.05, 0], fR: [-0.2, 0.05, 0] }),
  hook: mk({ ...LUNGE, hip: [0, -0.18, 0.1], hipR: [0.06, 0.3, 0], chest: [0.3, 0.6, 0], sp: [0.12, -0.2, 0.42], sd: [0.8, -0.2, 0.55] }),
  wheel: mk({ hip: [0, -0.3, 0], hipR: [0.1, -0.2, 0], chest: [0.3, -0.5, 0], sp: [-0.3, -0.12, 0.22], sd: [-0.9, -0.1, 0.4], two: 0, lh: [0.32, 0, 0.1], fL: [0.16, -0.25, 0], fR: [-0.14, 0.2, 0] }),
  riseCut: mk({ hip: [0, 0.02, 0.05], hipR: [-0.05, 0.3, 0], chest: [-0.2, 0.3, 0], head: [-0.2, 0, 0], sp: [-0.1, 0.5, 0.2], sd: [-0.2, 0.9, 0.35], fL: [0.14, -0.3, 0], fR: [-0.1, 0.3, 0] }),
  fallen: mk({ hip: [0, -0.78, 0.25], hipR: [1.45, 0, 0], chest: [0.05, 0, 0.1], head: [-0.2, 0.6, 0], sp: [-0.4, 0.15, 0.1], sd: [-0.6, 0, 0.8], two: 0, lh: [0.38, 0.2, 0.1], fL: [0.16, -0.75, 0.06], fR: [-0.14, -0.7, 0.06], free: 1, fp: 1.3 }),
  fallenBack: mk({ hip: [0, -0.8, -0.2], hipR: [-1.45, 0, 0], chest: [-0.05, 0, 0.1], head: [0.2, 0.4, 0], sp: [-0.42, 0.05, -0.1], sd: [-0.8, 0, 0.6], two: 0, lh: [0.4, 0, -0.08], fL: [0.16, 0.8, 0.06], fR: [-0.14, 0.75, 0.06], free: 1, fp: -1.3 }),
};
// The Warden carries a long blade: low trailing guard at rest, and a slanted blade when kneeling.
const BOSS_POSES = {
  ...POSES,
  idle: mk({ hip: [0, -0.05, 0], hipR: [0, 0.35, 0], chest: [0.06, -0.2, 0], sp: [-0.14, -0.2, 0.26], sd: [-0.3, -0.5, 0.8] }),
  kneel: mk({ ...POSES.kneel, sd: [-0.15, -0.55, 0.82], sp: [-0.14, -0.08, 0.36] }),
  guard: mk({ ...POSES.guard, sp: [-0.1, -0.02, 0.32], sd: [0.6, 0.62, 0.5] }),
};
export const POSE_NAMES = Object.keys(POSES);

// ---------------------------------------------------------------- materials and geometry
function grainTex(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, 128, 128);
  let a = 12345 + kind.length * 977; const R = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  if (kind === 'cloth') {
    for (let i = 0; i < 128; i += 2) { g.globalAlpha = 0.1 + R() * 0.12; g.fillStyle = '#6a6a6a'; g.fillRect(i, 0, 1, 128); g.fillRect(0, i, 128, 1); }
    for (let i = 0; i < 900; i++) { g.globalAlpha = 0.08 + R() * 0.12; g.fillStyle = R() < 0.5 ? '#ffffff' : '#555'; g.fillRect(R() * 128, R() * 128, 1 + R() * 3, 1 + R() * 2); }
  } else if (kind === 'straw') {
    for (let i = 0; i < 700; i++) { g.globalAlpha = 0.18 + R() * 0.3; g.fillStyle = R() < 0.45 ? '#ffffff' : '#4a4436'; g.fillRect(R() * 128, R() * 128, 1, 10 + R() * 40); }
  } else {
    for (let i = 0; i < 260; i++) { g.globalAlpha = 0.06 + R() * 0.1; g.fillStyle = R() < 0.5 ? '#ffffff' : '#333'; const r = 2 + R() * 9; g.beginPath(); g.arc(R() * 128, R() * 128, r, 0, 7); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3);
  return t;
}
let TEX = null;
function matFactory() {
  if (!TEX) TEX = { cloth: grainTex('cloth'), straw: grainTex('straw'), leather: grainTex('leather') };
  const moon = vec3(MOON.dir.x, MOON.dir.y, MOON.dir.z), mc = new THREE.Color(MOON.color);
  // moon-side rim: grazing view angle on surfaces that turn toward the moon
  const rim = (k) => {
    const fres = float(1).sub(normalView.dot(positionViewDirection).clamp(0, 1)).pow(2.0);
    return vec3(mc.r, mc.g, mc.b).mul(fres).mul(smoothstep(-0.55, 0.35, normalWorld.dot(moon))).mul(k);
  };
  return (color, o = {}) => {
    const { tex, rimK = 1.25, ...rest } = o;
    const m = new THREE.MeshStandardNodeMaterial({ color, roughness: 0.92, metalness: 0, map: tex ? TEX[tex] : null, ...rest });
    if (rimK > 0) m.emissiveNode = rim(rimK);
    return m;
  };
}
// surface of revolution; pts are [radius, y] in ascending y
const lathe = (pts, seg = 12) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.002), y)), seg);
function bladeGeo(L, w, th, curve) {
  const N = 10, pos = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, z = t * L, k = t > 0.86 ? Math.max(0.02, 1 - (t - 0.86) / 0.14) : 1, y0 = curve * t * t * L;
    // spine, left flat, edge, right flat
    pos.push(0, y0 + w * 0.5 * (t > 0.86 ? 1 - (1 - k) * 0.2 : 1), z, -th / 2 * k, y0 + w * 0.15, z, 0, y0 + w * 0.5 - w * k, z, th / 2 * k, y0 + w * 0.15, z);
    if (i < N) { const a = i * 4, b = a + 4; for (let j = 0; j < 4; j++) { const j2 = (j + 1) % 4; idx.push(a + j, b + j, a + j2, a + j2, b + j, b + j2); } }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g = g.toNonIndexed(); g.computeVertexNormals();
  return g;
}
function panelGeo(w, h, flare, bow) {
  const g = new THREE.PlaneGeometry(w, h, 2, 4); g.translate(0, -h / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const u = p.getX(i) / (w / 2), v = -p.getY(i) / h; p.setX(i, p.getX(i) * (1 + flare * v)); p.setZ(i, -bow * u * u * (1 + v * 0.5) + 0.012 * Math.sin(v * 9 + u * 2)); }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- maths helpers (module-level temporaries)
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
// place obj at `from` with its -y axis pointing to `to`; `ref` fixes the twist (local +z leans to ref)
function aim(obj, from, to, ref) {
  _y.subVectors(from, to); if (_y.lengthSq() < 1e-8) _y.set(0, 1, 0); _y.normalize();
  _z.copy(ref).addScaledVector(_y, -ref.dot(_y)); if (_z.lengthSq() < 1e-6) _z.set(_y.y, -_y.x, 0); _z.normalize();
  _x.crossVectors(_y, _z);
  obj.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z)); obj.position.copy(from);
}
// two-bone IK: joint `mid` and reachable `end` for root a, target t, bone lengths l1/l2, bend hint pole
function ik2(a, t, l1, l2, pole, mid, end) {
  _a.subVectors(t, a); let d = _a.length(); if (d < 1e-5) { _a.set(0, -1, 0); d = 1e-5; }
  _a.divideScalar(d);
  const dc = Math.max(Math.abs(l1 - l2) + 0.01, Math.min(l1 + l2 - 0.004, d));
  const cosA = (l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc), proj = l1 * cosA, h = l1 * Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _b.copy(pole).addScaledVector(_a, -pole.dot(_a)); if (_b.lengthSq() < 1e-6) _b.set(0, 0, 1); _b.normalize();
  mid.copy(a).addScaledVector(_a, proj).addScaledVector(_b, h);
  end.copy(a).addScaledVector(_a, dc);
}
const sm = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const CH = ['hip', 'hipR', 'chest', 'head', 'sp', 'sd', 'lh', 'fL', 'fR'], SC = ['two', 'yawL', 'yawR', 'free', 'fp', 'breath'];

export class Figure {
  constructor(style) {
    const S = style, boss = S.kind === 'boss';
    this.kind = S.kind; this.S = S.scale;
    const M = matFactory();
    // flat double-sided cloth gets a weaker rim so panels seen edge-on do not flare white
    const robe = M(S.robe, { tex: 'cloth' }), robeD = M(S.robe, { tex: 'cloth', side: THREE.DoubleSide, rimK: 0.3 }), under = M(S.under, { tex: 'cloth' });
    const trouser = M(S.trouser, { tex: 'cloth' }), sash = M(S.sash, { tex: 'cloth', roughness: 0.8 }), sashD = M(S.sash, { tex: 'cloth', side: THREE.DoubleSide, rimK: 0.3 });
    const shoe = M(S.shoe, { tex: 'cloth', rimK: 0.4 });
    const leather = M(S.leather, { tex: 'leather', roughness: 0.6 }), wrap = M(S.wrap, { tex: 'cloth' }), skin = M(S.skin, { roughness: 0.65, rimK: 0.4 });
    const straw = M(S.straw, { tex: 'straw', roughness: 1 }), strawD = M(S.straw, { tex: 'straw', roughness: 1, side: THREE.DoubleSide }), dark = M(0x15130f, { roughness: 0.9 });
    this.root = new THREE.Group();
    const pv = this.pivot = new THREE.Group(); this.root.add(pv); pv.scale.setScalar(S.scale);
    const add = (parent, geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; parent.add(m); return m; };
    const grp = (parent, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.order = 'YXZ'; parent.add(g); return g; };
    const sph = (r) => new THREE.SphereGeometry(r, 12, 9);

    // ---- trunk
    const pelvis = this.pelvis = grp(pv, 0, D.hipY, 0), spine = this.spine = grp(pelvis, 0, D.spine, 0), chest = this.chest = grp(spine, 0, D.chest, 0), head = this.head = grp(chest, 0, D.neck, 0);
    add(pelvis, lathe([[0.02, -0.12], [0.1, -0.09], [0.15, -0.02], [0.152, 0.06], [0.135, 0.14]]), trouser, 0, 0, 0, 1, 1, 0.74);
    add(spine, lathe([[0.128, -0.06], [0.126, 0.04], [0.14, 0.14], [0.15, 0.2]]), robe, 0, 0, 0, 1, 1, 0.72);
    add(chest, lathe([[0.14, -0.04], [0.158, 0.05], [0.172, 0.15], [0.166, 0.215], [0.125, 0.265], [0.062, 0.3], [0.03, 0.31]], 14), robe, 0, 0, 0, 1, 1, 0.68);
    // under-robe showing at the neck, and the overlapping collar bands of the outer garment
    add(chest, lathe([[0.075, 0.2], [0.07, 0.29], [0.058, 0.325]], 10), under, 0, 0, 0.012, 1, 1, 0.9);
    const colGeo = new THREE.BoxGeometry(0.036, 0.3, 0.02);
    const c1 = add(chest, colGeo, under, 0.04, 0.165, 0.108); c1.rotation.set(-0.16, 0, 0.46);
    const c2 = add(chest, colGeo, M(S.collar, { tex: 'cloth' }), -0.034, 0.17, 0.116); c2.rotation.set(-0.16, 0, -0.42);
    // sash with a knot and two hanging ends
    add(pelvis, lathe([[0.146, 0.07], [0.156, 0.085], [0.156, 0.135], [0.146, 0.15]], 14), sash, 0, 0, 0, 1, 1, 0.76);
    add(pelvis, sph(0.034), sash, 0.075, 0.11, 0.115, 1.2, 0.9, 0.7);
    // neck and head
    add(head, new THREE.CylinderGeometry(0.044, 0.052, 0.1, 10), skin, 0, 0.03, 0);
    add(head, sph(0.1), skin, 0, 0.145, 0.005, 0.88, 1.12, 1);
    add(head, sph(0.062), skin, 0, 0.085, 0.03, 0.95, 0.9, 1.05); // jaw
    add(head, new THREE.ConeGeometry(0.014, 0.05, 5), skin, 0, 0.125, 0.1).rotation.x = -0.25; // nose

    // ---- cloth panels (hinged; driven in update)
    this.panels = [];
    const panel = (parent, th, rx, rz, y, w, h, flare, mat, o = {}) => {
      const hinge = grp(parent, Math.sin(th) * rx, y, Math.cos(th) * rz); hinge.rotation.y = th;
      const swing = grp(hinge);
      add(swing, panelGeo(w, h, flare, o.bow ?? 0.035), mat);
      const p = { swing, nx: Math.sin(th), nz: Math.cos(th), len: h, on: o.on || 'pelvis', k: o.k ?? 1, ph: th * 3.1 + h * 7, rest: o.rest || 0 };
      this.panels.push(p); return p;
    };
    if (boss) {
      // long robe skirt, split at the front
      for (const [th, w] of [[0.36, 0.25], [-0.36, 0.25], [1.2, 0.26], [-1.2, 0.26], [2.15, 0.26], [-2.15, 0.26], [Math.PI, 0.24]]) panel(pelvis, th, 0.15, 0.115, 0.08, w, 0.8, 0.75, robeD);
      // thatch mantle in two ragged layers over the shoulders
      for (const [pts, sz] of [[[[0.42, -0.09], [0.38, 0.03], [0.3, 0.15]], 0.8], [[[0.35, 0.03], [0.31, 0.15], [0.2, 0.265], [0.085, 0.32]], 0.82]]) {
        const g = lathe(pts, 22), p = g.attributes.position;
        for (let i = 0; i < p.count; i++) if (p.getY(i) < pts[0][1] + 0.01) p.setY(i, p.getY(i) + Math.sin(i * 12.9898) * 0.035);
        g.computeVertexNormals();
        add(chest, g, strawD, 0, 0, -0.01, 1, 1, sz);
      }
      // cloak down the back
      for (const [th, w] of [[Math.PI - 0.5, 0.2], [Math.PI + 0.5, 0.2], [Math.PI, 0.22]]) panel(chest, th, 0.15, 0.12, 0.2, w, 0.95, 0.9, M(S.cloak, { tex: 'cloth', side: THREE.DoubleSide, rimK: 0.25 }), { on: 'chest', k: 1.3 });
      // wide woven hat and a pale bird mask
      const hat = add(head, lathe([[0.31, 0], [0.22, 0.045], [0.1, 0.1], [0.045, 0.125], [0.01, 0.135]], 24), strawD, 0, 0.2, 0.01); hat.rotation.x = 0.1;
      const bone = M(S.mask, { roughness: 0.45, rimK: 0.35 });
      add(head, sph(0.086), bone, 0, 0.135, 0.04, 0.92, 1.12, 0.9);
      const beak = add(head, new THREE.ConeGeometry(0.034, 0.2, 8), bone, 0, 0.1, 0.19); beak.rotation.x = Math.PI / 2 + 0.3;
      this.eyes = add(head, new THREE.BoxGeometry(0.1, 0.012, 0.012), new THREE.MeshBasicMaterial({ color: S.eye }), 0, 0.158, 0.118);
      this.eyes.castShadow = false;
    } else {
      // short robe skirt below the sash
      for (const [th, w] of [[0.42, 0.2], [-0.42, 0.2], [1.35, 0.2], [-1.35, 0.2], [2.45, 0.2], [-2.45, 0.2]]) panel(pelvis, th, 0.15, 0.112, 0.08, w, 0.36, 0.5, robeD);
      // tied-back hair, a headband with two loose tails
      const hair = add(head, new THREE.SphereGeometry(0.105, 12, 9, 0, Math.PI * 2, 0, Math.PI * 0.5), dark, 0, 0.15, -0.006, 0.9, 1.1, 1.02); hair.rotation.x = -0.55;
      add(head, sph(0.036), dark, 0, 0.215, -0.085, 1, 1.2, 1);
      const band = add(head, lathe([[0.09, -0.012], [0.093, 0], [0.09, 0.012]], 14), sash, 0, 0.2, 0.002, 0.9, 1, 1.03); band.rotation.x = -0.3;
      for (const dx of [-0.02, 0.022]) panel(head, Math.PI + dx * 8, 0.05, 0.1, 0.175, 0.026, 0.24 + dx, 0.2, M(S.sash, { tex: 'cloth', side: THREE.DoubleSide, rimK: 0.25 }), { on: 'head', k: 2.2, bow: 0, rest: 0.25 });
      panel(head, Math.PI, 0.02, 0.1, 0.225, 0.04, 0.17, -0.5, M(0x15130f, { roughness: 0.9, side: THREE.DoubleSide }), { on: 'head', k: 1.5, bow: 0.01, rest: 0.35 });
      // scabbard at the left hip
      const sc = add(pelvis, new THREE.BoxGeometry(0.034, 0.05, 0.84), M(0x1b1512, { roughness: 0.45, tex: 'leather' }), 0.185, 0.07, -0.16); sc.rotation.set(-0.42, 0.22, 0);
    }
    // sash ends hang from the knot
    for (const dx of [0, 0.03]) panel(pelvis, 0.6 + dx * 4, 0.16, 0.125, 0.1, 0.04, boss ? 0.42 : 0.3, 0.3, sashD, { k: 1.6, bow: 0 });

    // ---- limbs (flat hierarchy under the pivot; posed by IK every frame)
    const limb = () => grp(pv);
    const armGeo = { up: lathe([[0.074, -D.upArm - 0.02], [0.07, -0.2], [0.064, -0.06], [0.05, 0.01]]), cap: sph(0.07), fore: lathe([[0.034, -D.foreArm], [0.04, -0.14], [0.047, -0.03], [0.04, 0.01]]), bracer: lathe([[0.041, -D.foreArm + 0.015], [0.05, -0.15], [0.053, -0.06]], 10) };
    const mkArm = () => {
      const up = limb(), fore = limb(), hand = limb();
      add(up, armGeo.up, robe, 0, 0, 0, 1, 1, 1); add(up, armGeo.cap, robe, 0, -0.012, 0, 0.9, 0.85, 0.9);
      add(fore, armGeo.fore, under); add(fore, armGeo.bracer, leather); add(fore, sph(0.05), robe, 0, 0, 0, 1, 1, 1);
      add(hand, new THREE.BoxGeometry(0.07, 0.07, 0.032), skin, 0, -0.035, 0);
      add(hand, sph(0.043), skin, 0, -D.hand, 0.004, 1.05, 0.9, 1.15);
      return { up, fore, hand, sh: new THREE.Vector3(), el: new THREE.Vector3(), wr: new THREE.Vector3(), grip: new THREE.Vector3() };
    };
    this.armL = mkArm(); this.armR = mkArm();
    const legGeo = { thigh: lathe([[0.088, -D.thigh], [0.1, -0.2], [0.104, -0.04], [0.08, 0.03]]), knee: sph(0.088), shinT: lathe([[0.07, -0.25], [0.086, -0.12], [0.088, 0]]), shinW: lathe([[0.04, -D.shin], [0.052, -0.33], [0.056, -0.22]], 10) };
    const mkLeg = () => {
      const thigh = limb(), shin = limb(), foot = limb();
      add(thigh, legGeo.thigh, trouser);
      add(shin, legGeo.knee, trouser, 0, 0, 0, 1, 1, 1); add(shin, legGeo.shinT, trouser); add(shin, legGeo.shinW, wrap);
      add(foot, sph(0.045), shoe, 0, -0.005, 0, 1, 1, 1.1);
      add(foot, new THREE.CapsuleGeometry(0.043, 0.14, 3, 8), shoe, 0, -0.036, 0.062, 1, 1, 0.78).rotation.x = Math.PI / 2;
      add(foot, new THREE.BoxGeometry(0.092, 0.016, 0.25), boss ? dark : straw, 0, -0.068, 0.055);
      return { thigh, shin, foot, hj: new THREE.Vector3(), kn: new THREE.Vector3(), an: new THREE.Vector3(), tgt: new THREE.Vector3(), x: 0, z: 0, yaw: 0, t: 1, T: 0.2, sx: 0, sz: 0, syaw: 0, h: 0, lift: 0 };
    };
    this.legL = mkLeg(); this.legR = mkLeg();

    // ---- sword: blade along +z, guard at the origin, edge toward -y
    const sw = this.sword = grp(pv);
    const L = S.blade;
    this.bladeMat = new THREE.MeshStandardMaterial({ color: S.bladeColor, roughness: 0.22, metalness: 0.75, emissive: S.bladeGlow, emissiveIntensity: 0.3 });
    add(sw, bladeGeo(L, S.bladeW, 0.012, S.curve), this.bladeMat, 0, 0, 0.012);
    const hl = S.hilt;
    add(sw, new THREE.CylinderGeometry(0.017, 0.019, hl, 8), M(S.grip, { tex: 'cloth', roughness: 0.7 }), 0, 0, -hl / 2, 1, 1, 1.25).rotation.x = Math.PI / 2;
    add(sw, new THREE.CylinderGeometry(0.046, 0.046, 0.012, 12), M(0x4a4338, { metalness: 0.7, roughness: 0.45 }), 0, 0, 0.004, 1, 1, 1.25).rotation.x = Math.PI / 2;
    add(sw, sph(0.022), M(0x4a4338, { metalness: 0.7, roughness: 0.45 }), 0, 0, -hl);
    this.gripR = -0.055; this.gripL = -Math.min(hl - 0.05, 0.21);
    this.tip = new THREE.Object3D(); this.tip.position.z = L; sw.add(this.tip);
    this.base = new THREE.Object3D(); this.base.position.z = 0.2; sw.add(this.base);

    // ---- animation state
    this.poses = boss ? BOSS_POSES : POSES;
    this.cur = JSON.parse(JSON.stringify(this.poses.idle));
    this.clock = Math.random() * 10; this.yOff = 0; this.init = false;
    this.px = 0; this.pz = 0; this.vx = 0; this.vz = 0; this.drop = 0;
    this.rk = { x: 0, v: 0 }; this.sk = { x: 0, v: 0 }; this.dip = { x: 0, v: 0 };
    this.sway = { x: 0, z: 0, vx: 0, vz: 0 };
    this.mc = new THREE.Matrix4(); this.qc = new THREE.Quaternion();
    this.P = new THREE.Vector3(); this.pole = new THREE.Vector3(); this.fwd = new THREE.Vector3(); this.sdir = new THREE.Vector3();

    // blade trail ribbon
    const N = this.trailN = 14;
    this.trailPos = new Float32Array(N * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    const col = new Float32Array(N * 2 * 3);
    const tc = new THREE.Color(S.trail);
    for (let i = 0; i < N; i++) for (let k = 0; k < 2; k++) { const f = 0.4 * (1 - i / (N - 1)) ** 1.6 * (k ? 0.25 : 1); col.set([tc.r * f, tc.g * f, tc.b * f], (i * 2 + k) * 3); }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const idx = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    this.trail = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    this.trail.frustumCulled = false; this.trail.visible = false;
    this.trailOn = 0; this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
  }

  // recoil impulses: back = rocked back along the facing, side = blade knocked sideways (signed)
  kick(back, side = 0) { this.rk.v += back * 9; this.sk.v += side * 9; }

  // pose: target pose, rate: blend speed (1/s), extra: {speed, yOff, spin, trail}
  update(dt, x, z, face, pose, rate, extra = {}) {
    const c = this.cur, S = this.S;
    if (dt > 0) {
      const k = 1 - Math.exp(-dt * rate), kh = 1 - Math.exp(-dt * rate * 1.35), ks = 1 - Math.exp(-dt * rate * 0.9);
      for (const key of CH) {
        const a = c[key], b = pose[key], kk = key === 'hip' || key === 'hipR' ? kh : key === 'sp' || key === 'sd' ? ks : k; // hips lead, the blade trails
        a[0] += (b[0] - a[0]) * kk; a[1] += (b[1] - a[1]) * kk; a[2] += (b[2] - a[2]) * kk;
      }
      for (const key of SC) c[key] += (pose[key] - c[key]) * k;
      // springs are sub-stepped so long frames (slow renderers) cannot make them diverge
      const n = Math.ceil(dt / 0.034), h = dt / n;
      for (let i = 0; i < n; i++) for (const s of [this.rk, this.sk, this.dip]) { s.v += (-190 * s.x - 15 * s.v) * h; s.x += s.v * h; }
      this.clock += dt;
    }
    this.yOff += ((extra.yOff || 0) - this.yOff) * (1 - Math.exp(-dt * 20));
    const yaw = face + (extra.spin || 0), cy = Math.cos(yaw), sy = Math.sin(yaw);
    this.root.position.set(x, this.yOff, z); this.root.rotation.y = yaw;

    // ---- velocity in world and fighter frames
    const jump = Math.hypot(x - this.px, z - this.pz);
    const snap = !this.init || jump > 1.2;
    if (snap) { this.vx = this.vz = 0; } else if (dt > 0) { const kv = 1 - Math.exp(-dt * 14); this.vx += ((x - this.px) / dt - this.vx) * kv; this.vz += ((z - this.pz) / dt - this.vz) * kv; }
    this.px = x; this.pz = z; this.init = true;
    const speed = Math.hypot(this.vx, this.vz), lvx = this.vx * cy - this.vz * sy, lvz = this.vx * sy + this.vz * cy;
    const loco = Math.min(1, speed / 2.5);

    // ---- feet: planted in world space, stepping when they fall too far from their stance spot
    const air = this.yOff > 0.08, free = c.free > 0.5 || air;
    const T = clamp(0.27 - speed * 0.022, 0.13, 0.27), Dst = clamp(0.55 * speed * T, 0.06, 0.5) * S;
    const legs = [this.legL, this.legR], homes = [c.fL, c.fR], yaws = [c.yawL, c.yawR];
    const lead = speed > 0.4 ? Dst / speed : 0;
    let order = [0, 1];
    const errOf = (i) => { const h = homes[i], f = legs[i]; return Math.hypot(x + (h[0] * cy + h[1] * sy) * S - f.x, z + (-h[0] * sy + h[1] * cy) * S - f.z); };
    if (errOf(1) > errOf(0)) order = [1, 0];
    for (const i of order) {
      const f = legs[i], o = legs[1 - i], h = homes[i];
      const hx = x + (h[0] * cy + h[1] * sy) * S, hz = z + (-h[0] * sy + h[1] * cy) * S, hyaw = yaw + yaws[i];
      if (snap || free) {
        const kf = snap ? 1 : 1 - Math.exp(-dt * 18);
        f.x += (hx - f.x) * kf; f.z += (hz - f.z) * kf; f.yaw += angDiff(hyaw, f.yaw) * kf; f.t = 1; f.lift = air ? 0.1 : 0;
      } else if (f.t < 1) {
        f.t = Math.min(1, f.t + dt / f.T);
        const u = sm(f.t), tx = hx + this.vx * lead, tz = hz + this.vz * lead;
        f.x = f.sx + (tx - f.sx) * u; f.z = f.sz + (tz - f.sz) * u; f.yaw = f.syaw + angDiff(hyaw, f.syaw) * u;
        f.lift = Math.sin(Math.PI * f.t) * f.h;
        if (f.t >= 1) { f.lift = 0; this.dip.v -= 0.12 + Math.min(0.5, speed * 0.07); }
      } else if (dt > 0) {
        const err = Math.hypot(hx - f.x, hz - f.z);
        if ((err > Dst || Math.abs(angDiff(hyaw, f.yaw)) > 0.6) && (o.t >= 1 || err > Dst * 2.6 + 0.2)) {
          f.t = 0; f.T = T; f.sx = f.x; f.sz = f.z; f.syaw = f.yaw; f.h = (0.035 + Math.min(0.11, err * 0.28)) * S;
        }
      }
      // ankle target in the pivot frame
      const dx = (f.x - x) / S, dz = (f.z - z) / S;
      f.tgt.set(dx * cy - dz * sy, D.ankle + f.lift / S + h[2], dx * sy + dz * cy);
    }

    // ---- trunk
    const br = Math.sin(this.clock * 1.7) * 0.011 * c.breath, rk = this.rk.x, sk = this.sk.x;
    const gait = (this.legL.tgt.z - this.legR.tgt.z - (c.fL[1] - c.fR[1])) * loco; // + when the left foot is ahead of its stance
    const leanP = clamp(lvz * 0.028, -0.14, 0.22), leanR = clamp(-lvx * 0.03, -0.16, 0.16);
    const pel = this.pelvis, spn = this.spine, chs = this.chest, hd = this.head;
    pel.position.set(c.hip[0], D.hipY + c.hip[1] + br * 0.5 + this.dip.x * 0.12, c.hip[2] - rk * 0.08 + leanP * 0.3);
    pel.rotation.set(c.hipR[0] + leanP * 0.6 - rk * 0.1, c.hipR[1] - gait * 0.32, c.hipR[2] + leanR * 0.6);
    const cx = c.chest[0] + br - rk * 0.4 + leanP * 0.7 - this.dip.x * 0.15, cyw = c.chest[1] + gait * 0.55 + sk * 0.25, cz = c.chest[2] + leanR * 0.5;
    spn.rotation.set(cx * 0.45, cyw * 0.45, cz * 0.45); chs.rotation.set(cx * 0.55, cyw * 0.55, cz * 0.55);
    // the head stays on the opponent: undo most of the trunk's twist and some of its pitch
    hd.rotation.set(c.head[0] - rk * 0.25 - clamp((c.hipR[0] + cx) * 0.55, -0.35, 0.35), c.head[1] - clamp((pel.rotation.y + cyw) * 0.85, -1, 1), c.head[2]);
    pel.updateMatrix();
    // drop the pelvis until both planted feet are within reach (knees bend under the weight)
    let drop = 0;
    for (let i = 0; i < 2; i++) {
      const f = legs[i];
      f.hj.set(i === 0 ? D.hipW : -D.hipW, -0.03, 0).applyMatrix4(pel.matrix);
      if (f.t < 1 && !free) continue;
      const hz2 = (f.tgt.x - f.hj.x) ** 2 + (f.tgt.z - f.hj.z) ** 2;
      drop = Math.max(drop, f.hj.y - (f.tgt.y + Math.sqrt(Math.max(0.03, LEG_REACH * LEG_REACH - hz2))));
    }
    drop = Math.min(0.32, drop);
    this.drop += (drop - this.drop) * (dt > 0 ? 1 - Math.exp(-dt * 20) : 0);
    if (snap) this.drop = drop;
    pel.position.y -= this.drop; pel.updateMatrix();
    spn.updateMatrix(); chs.updateMatrix();
    const mc = this.mc.multiplyMatrices(pel.matrix, spn.matrix).multiply(chs.matrix);
    const qc = this.qc.copy(pel.quaternion).multiply(spn.quaternion).multiply(chs.quaternion);
    const fwd = this.fwd.set(0, 0, 1).applyQuaternion(qc);

    // ---- legs
    for (let i = 0; i < 2; i++) {
      const f = legs[i], side = i === 0 ? 1 : -1;
      f.hj.y -= this.drop;
      const ly = f.yaw - yaw;
      this.pole.set(Math.sin(ly) + side * 0.14, 0.12, Math.cos(ly));
      if (c.free > 0.5) this.pole.set(side * 0.2, c.fp > 0 ? -1 : 1, 0.2);
      ik2(f.hj, f.tgt, D.thigh, D.shin, this.pole, f.kn, f.an);
      if (f.kn.y < 0.07 - this.yOff / S) f.kn.y = 0.07 - this.yOff / S;
      aim(f.thigh, f.hj, f.kn, this.pole); aim(f.shin, f.kn, f.an, this.pole);
      f.foot.position.copy(f.an);
      const swing = f.t < 1 ? Math.sin(Math.PI * 2 * f.t) * Math.min(0.55, f.h / S * 5) : 0;
      f.foot.rotation.set(swing + c.fp * c.free + (c.free > 0.5 ? 0 : Math.min(1.1, homes[i][2] * 14)) + (air ? 0.5 : 0), ly, 0);
    }

    // ---- sword, then both arms reach for the hilt
    const sd = this.sdir.set(c.sd[0] + sk * 0.9, c.sd[1] + rk * 0.55 + Math.abs(sk) * 0.3, c.sd[2] - rk * 0.5 - Math.abs(sk) * 0.2);
    if (sd.lengthSq() < 1e-4) sd.set(0, 0, 1); sd.normalize();
    _d.set(0, 1 - Math.abs(sd.y), -sd.y); // spine of the blade: up when level, back when raised
    _x.crossVectors(_d, sd); if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0); _x.normalize(); _y.crossVectors(sd, _x);
    const sw = this.sword; sw.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, sd));
    const P = this.P.set(c.sp[0] + sk * 0.1, c.sp[1] + rk * 0.05 + br * 0.3, c.sp[2] - rk * 0.13).applyMatrix4(mc);
    const R = this.armR, Lf = this.armL;
    R.sh.set(-D.shW, D.shY, 0).applyMatrix4(mc); Lf.sh.set(D.shW, D.shY, 0).applyMatrix4(mc);
    for (let it = 0; it < 2; it++) {
      _c.copy(P).addScaledVector(sd, this.gripR).sub(R.sh); let l = _c.length();
      if (l > ARM_REACH) P.addScaledVector(_c, -(l - ARM_REACH) / l);
      if (c.two > 0.5) { _c.copy(P).addScaledVector(sd, this.gripL).sub(Lf.sh); l = _c.length(); if (l > ARM_REACH) P.addScaledVector(_c, -(l - ARM_REACH) / l * c.two); }
    }
    sw.position.copy(P);
    R.grip.copy(P).addScaledVector(sd, this.gripR);
    const pump = (this.legR.tgt.z - this.legL.tgt.z) * 0.3 * loco;
    Lf.grip.set(c.lh[0], c.lh[1], c.lh[2] + pump).applyMatrix4(mc);
    _c.copy(P).addScaledVector(sd, this.gripL); Lf.grip.lerp(_c, c.two);
    for (const [A, side] of [[R, -1], [Lf, 1]]) {
      _c.subVectors(A.grip, A.sh); const l = _c.length() || 1;
      _d.copy(A.grip).addScaledVector(_c, -D.hand / l);
      // elbows hang down and a little out; they swing forward-out when the hands go above the shoulders
      this.pole.set(side * 0.42, -0.8, -0.22 + 0.7 * Math.max(0, _c.y / l)).applyQuaternion(qc);
      ik2(A.sh, _d, D.upArm, D.foreArm, this.pole, A.el, A.wr);
      aim(A.up, A.sh, A.el, fwd); aim(A.fore, A.el, A.wr, fwd);
      aim(A.hand, A.wr, A.grip, sd); // the hand spans wrist -> grip, knuckles along the blade
    }

    // ---- cloth: hinged panels that hang with gravity, trail behind motion and clear the legs
    if (dt > 0) {
      const s = this.sway, tx = -lvx * 0.085, tz = -lvz * 0.085;
      const n = Math.ceil(dt / 0.034), h = dt / n;
      for (let i = 0; i < n; i++) { s.vx += ((tx - s.x) * 70 - s.vx * 8) * h; s.vz += ((tz - s.z) * 70 - s.vz * 8) * h; s.x += s.vx * h; s.z += s.vz * h; }
    }
    const pitchP = pel.rotation.x, pitchC = pitchP + cx, hingeY = pel.position.y + 0.08, chestY = mc.elements[13] + 0.2;
    const tl = this.legL, tr = this.legR;
    for (const p of this.panels) {
      const flut = Math.sin(this.clock * 2.3 + p.ph) * 0.03 + Math.sin(this.clock * 5.1 + p.ph * 1.7) * 0.012;
      let phi = (this.sway.x * p.nx + this.sway.z * p.nz) * p.k + flut * p.k + p.rest;
      if (p.on === 'pelvis') {
        phi -= pitchP * p.nz;
        for (const f of [tl, tr]) {
          // how far this leg pushes outward under the panel (thigh, and whole leg for long robes)
          const side = f === tl ? 1 : -1, w = clamp(0.55 + 0.7 * p.nx * side, 0.15, 1);
          _c.subVectors(f.kn, f.hj).applyQuaternion(_q.copy(pel.quaternion).invert());
          let a = Math.atan2(_c.x * p.nx + _c.z * p.nz, -_c.y);
          if (p.len > 0.5) { _c.subVectors(f.an, f.hj).applyQuaternion(_q); a = Math.max(a, Math.atan2(_c.x * p.nx + _c.z * p.nz, -_c.y)) * 0.95; }
          phi = Math.max(phi, a * w + 0.04);
        }
        phi = Math.max(phi, Math.acos(clamp((hingeY - 0.03 + this.yOff / S) / p.len, 0, 1)));
      } else if (p.on === 'chest') {
        phi = Math.max(0.03, phi + pitchC * 0.9, Math.acos(clamp((chestY - 0.03 + this.yOff / S) / p.len, 0, 1)));
      } else phi = Math.max(-0.1, phi - (pitchC + hd.rotation.x) * 0.8);
      p.swing.rotation.x = -Math.min(phi, 1.7);
    }

    // ---- blade trail
    this.root.updateWorldMatrix(true, true);
    this.tip.getWorldPosition(this._a); this.base.getWorldPosition(this._b);
    const TP = this.trailPos, N = this.trailN;
    if (extra.trail && !this.trailOn) for (let i = 0; i < N; i++) { TP.set([this._a.x, this._a.y, this._a.z, this._b.x, this._b.y, this._b.z], i * 6); }
    this.trailOn = extra.trail ? 0.1 : Math.max(0, this.trailOn - dt);
    this.trail.visible = this.trailOn > 0;
    if (this.trail.visible && dt > 0) {
      TP.copyWithin(6, 0, (N - 1) * 6);
      TP.set([this._a.x, this._a.y, this._a.z, this._b.x, this._b.y, this._b.z], 0);
      this.trail.geometry.attributes.position.needsUpdate = true;
    }
  }
}

export function playerPose(s) {
  const p = s.player, P = POSES;
  const ex = { speed: p.speed };
  const parry = s.time - p.lastDeflectT < 0.2;
  switch (p.state) {
    case 'guard': return parry ? [P.deflect, 48, ex] : [P.guard, 20, ex];
    case 'attack': {
      const side = 'RLO'[p.combo];
      if (p.t < 0.08) return [P['wind' + side], 36, ex];
      ex.trail = p.t < 0.3;
      return p.t < 0.27 ? [P['hit' + side], 34, ex] : [P['fol' + side], 13, ex];
    }
    case 'dodge': return [P.dodge, 26, ex];
    case 'stagger': return [P.stagger, 22, ex];
    case 'broken': return [P.kneel, 12, ex];
    case 'counter': return [p.t < 0.6 ? P.bind : P.idle, p.t < 0.6 ? 30 : 10, ex];
    case 'finisher': {
      if (p.t < 0.3) return [P.hook, 22, ex];
      if (p.t < C.FINISHER_IMPACT - 0.1) { ex.spin = Math.PI * 2 * sm((p.t - 0.3) / 0.65); ex.trail = true; return [P.wheel, 18, ex]; }
      ex.trail = p.t < C.FINISHER_IMPACT + 0.25;
      return [p.t < 1.6 ? P.riseCut : P.idle, p.t < 1.6 ? 26 : 8, ex];
    }
    case 'dead': return [P.fallenBack, 6, ex];
  }
  if (parry) return [P.deflect, 48, ex];
  return p.speed > 3.2 ? [P.run, 10, ex] : [P.idle, 11, ex];
}

export function bossPose(s) {
  const b = s.boss, P = BOSS_POSES;
  const ex = { speed: b.speed };
  switch (b.state) {
    case 'attack': {
      const mv = MOVES[b.move], prev = mv.hits[b.hitIdx - 1], next = mv.hits[b.hitIdx];
      if (next && next.leap) { const u = (b.t - (next.t - 0.7)) / 0.7; if (u > 0 && u < 1) ex.yOff = Math.sin(u * Math.PI) * 1.7; }
      if (prev && b.t - prev.t < 0.2) { ex.trail = true; return [P['hit' + prev.side], 28, ex]; }
      if (next) {
        const tt = next.t - b.t;
        if (tt < 0.1) { ex.trail = true; return [P['hit' + next.side], 30, ex]; }
        return [P['wind' + next.side], next.type === 'heavy' ? 5 : next.type === 'thrust' ? 7 : 11, ex];
      }
      return [b.t - prev.t < 0.5 ? P['fol' + prev.side] : P.idle, 7, ex];
    }
    case 'block': return [P.guard, 30, ex];
    case 'pinned': return [P.pinned, 24, ex];
    case 'broken': return [P.kneel, 9, ex];
    case 'finished': return [s.player.t >= C.FINISHER_IMPACT ? P.arched : P.kneel, 18, ex];
    case 'phaseShift': return [b.t < 0.9 ? P.kneel : b.t < 2.0 ? P.roar : P.idle, 6, ex];
    case 'dying': return [b.t < 0.5 ? P.arched : P.fallen, 6, ex];
  }
  return [P.idle, 9, ex];
}
