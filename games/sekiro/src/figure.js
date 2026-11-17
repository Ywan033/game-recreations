// Procedural articulated swordfighters and their pose-driven animation.
import * as THREE from 'three/webgpu';
import { MOVES, C } from './sim.js';

const Z = { hy: 0, hips: [0, 0, 0], torso: [0, 0, 0], head: [0, 0, 0], sL: [0, 0, 0], eL: [0, 0, 0], sR: [0, 0, 0], eR: [0, 0, 0], lL: [0, 0, 0], kL: [0, 0, 0], lR: [0, 0, 0], kR: [0, 0, 0], sw: [0, 0, 0] };
const LEGS = { lL: [-0.3, 0, 0.08], kL: [0.4, 0, 0], lR: [0.28, 0, -0.08], kR: [0.35, 0, 0], hy: -0.05 };
const mk = (o) => ({ ...Z, ...LEGS, ...o });
const DEEP = { lL: [-0.75, 0, 0.1], kL: [0.9, 0, 0], lR: [0.55, 0, -0.1], kR: [0.6, 0, 0], hy: -0.22 };

export const POSES = {
  idle: mk({ torso: [0.08, -0.3, 0], sR: [-0.9, 0, -0.2], eR: [-0.9, 0, 0], sw: [0.6, 0, 0], sL: [-0.3, 0, 0.25], eL: [-0.7, 0, 0] }),
  windR: mk({ torso: [-0.05, -0.8, 0], sR: [-2.4, 0, -0.5], eR: [-0.6, 0, 0], sw: [0.3, 0, 0], sL: [-0.8, 0, 0.3], eL: [-0.6, 0, 0] }),
  hitR: mk({ ...DEEP, torso: [0.25, 0.7, 0], sR: [-1.1, 0, 0.9], eR: [-0.2, 0, 0], sw: [1.25, 0, 0], sL: [0.4, 0, 0.5], eL: [-0.4, 0, 0] }),
  windL: mk({ torso: [0, 0.8, 0], sR: [-1.4, 0, 1.3], eR: [-1.4, 0, 0], sw: [0.4, 0, 0], sL: [-0.2, 0, 0.5], eL: [-0.5, 0, 0] }),
  hitL: mk({ ...DEEP, torso: [0.2, -0.7, 0], sR: [-1.2, 0, -0.8], eR: [-0.15, 0, 0], sw: [1.25, 0, 0], sL: [-0.6, 0, 0.6], eL: [-0.8, 0, 0] }),
  windO: mk({ torso: [-0.3, 0, 0], sR: [-2.95, 0, 0], eR: [-0.5, 0, 0], sw: [0.15, 0, 0], sL: [-2.6, 0, -0.2], eL: [-0.7, 0, 0], hy: 0.04 }),
  hitO: mk({ ...DEEP, torso: [0.55, 0, 0], sR: [-0.9, 0, 0.1], eR: [-0.1, 0, 0], sw: [1.55, 0, 0], sL: [-0.6, 0, -0.1], eL: [-0.4, 0, 0], hy: -0.3 }),
  windT: mk({ ...DEEP, torso: [0.2, -1.0, 0], sR: [0.55, 0, -0.3], eR: [-1.65, 0, 0], sw: [1.1, 0, 0], sL: [-1.4, 0, -0.5], eL: [-0.2, 0, 0], hy: -0.3 }),
  hitT: mk({ ...DEEP, torso: [0.4, 0.55, 0], sR: [-1.5, 0, 0.1], eR: [0, 0, 0], sw: [1.5, 0, 0], sL: [0.7, 0, 0.4], eL: [-0.2, 0, 0], hy: -0.32 }),
  guard: mk({ torso: [0.08, 0.15, 0], sR: [-1.35, 0, 0.55], eR: [-1.2, 0, 0], sw: [0.95, 0, 1.2], sL: [-1.2, 0, -0.5], eL: [-1.3, 0, 0] }),
  deflect: mk({ torso: [-0.12, 0.45, 0], sR: [-1.9, 0, 0.75], eR: [-0.8, 0, 0], sw: [0.5, 0, 1.0], sL: [-0.6, 0, 0.6], eL: [-0.9, 0, 0] }),
  stagger: mk({ torso: [-0.45, 0.35, 0.2], head: [-0.3, 0, 0], sR: [-0.3, 0, -0.9], eR: [-0.5, 0, 0], sw: [0.9, 0, 0], sL: [-0.2, 0, 1.0], eL: [-0.4, 0, 0] }),
  kneel: mk({ hy: -0.48, torso: [0.6, 0, 0], head: [0.45, 0, 0], sR: [0.1, 0, -0.45], eR: [-0.5, 0, 0], sw: [1.9, 0, 0], sL: [-0.2, 0, 0.5], eL: [-0.3, 0, 0], lL: [-1.35, 0, 0.1], kL: [1.5, 0, 0], lR: [0.25, 0, -0.1], kR: [1.45, 0, 0] }),
  arched: mk({ hy: -0.4, torso: [-0.7, 0, 0], head: [-0.5, 0, 0], sR: [0.3, 0, -1.0], eR: [-0.3, 0, 0], sw: [1.2, 0, 0], sL: [0.3, 0, 1.0], eL: [-0.3, 0, 0], lL: [-1.2, 0, 0.1], kL: [1.5, 0, 0], lR: [0.2, 0, -0.1], kR: [1.4, 0, 0] }),
  pinned: mk({ ...DEEP, torso: [0.7, 0.4, 0], head: [0.2, 0, 0], sR: [-0.75, 0, 0.1], eR: [0, 0, 0], sw: [2.05, 0, 0], sL: [-0.2, 0, 0.6], eL: [-0.5, 0, 0], hy: -0.35 }),
  bind: mk({ ...DEEP, torso: [0.45, 0.5, 0], sR: [-0.75, 0, 0.45], eR: [-0.2, 0, 0], sw: [2.1, 0, 0.3], sL: [-0.9, 0, 0.7], eL: [-0.6, 0, 0], lL: [-1.0, 0, 0.1], kL: [0.5, 0, 0] }),
  dodge: mk({ hy: -0.3, torso: [0.6, 0, 0], sR: [0.3, 0, -0.4], eR: [-0.9, 0, 0], sw: [1.0, 0, 0], sL: [0.4, 0, 0.4], eL: [-0.6, 0, 0], lL: [-0.9, 0, 0], kL: [1.1, 0, 0], lR: [0.6, 0, 0], kR: [0.9, 0, 0] }),
  roar: mk({ torso: [-0.35, 0, 0], head: [-0.4, 0, 0], sR: [-2.6, 0, -0.9], eR: [-0.2, 0, 0], sw: [0.2, 0, 0], sL: [-0.4, 0, 1.3], eL: [-0.3, 0, 0], hy: 0.02 }),
  hook: mk({ ...DEEP, torso: [0.3, 0.9, 0], sR: [-1.0, 0, 1.2], eR: [-0.9, 0, 0], sw: [1.6, 0, 0], sL: [-0.9, 0, 0.3], eL: [-0.8, 0, 0] }),
  wheel: mk({ hy: -0.38, torso: [0.5, -0.9, 0], sR: [-0.4, 0, -1.2], eR: [-0.3, 0, 0], sw: [1.3, 0, 0], sL: [-0.3, 0, 1.1], eL: [-0.3, 0, 0], lL: [-1.0, 0, 0.2], kL: [1.3, 0, 0], lR: [0.5, 0, -0.2], kR: [1.0, 0, 0] }),
  riseCut: mk({ hy: 0.06, torso: [-0.3, 0.5, 0], head: [-0.3, 0, 0], sR: [-2.9, 0, 0.3], eR: [-0.1, 0, 0], sw: [0.1, 0, 0], sL: [0.5, 0, 0.6], eL: [-0.3, 0, 0], lL: [-0.2, 0, 0.1], kL: [0.1, 0, 0], lR: [0.3, 0, -0.1], kR: [0.1, 0, 0] }),
  fallen: mk({ hy: -0.82, hips: [1.45, 0, 0], torso: [0.1, 0, 0.2], head: [0.2, 0.6, 0], sR: [-2.4, 0, -0.6], eR: [-0.3, 0, 0], sw: [1.2, 0, 0], sL: [-2.2, 0, 0.7], eL: [-0.4, 0, 0], lL: [0.1, 0, 0.2], kL: [0.2, 0, 0], lR: [0.1, 0, -0.2], kR: [0.4, 0, 0] }),
  fallenBack: mk({ hy: -0.8, hips: [-1.45, 0, 0], torso: [0, 0, 0.1], head: [0.3, 0, 0], sR: [0.3, 0, -1.1], eR: [-0.2, 0, 0], sw: [0.5, 0, 0], sL: [0.3, 0, 1.1], eL: [-0.2, 0, 0], lL: [-0.2, 0, 0.2], kL: [0.5, 0, 0], lR: [0, 0, -0.2], kR: [0.2, 0, 0] }),
};

function limb(len, r, mat) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len - r), 4, 8), mat);
  m.position.y = -len / 2; m.castShadow = true;
  g.add(m);
  const end = new THREE.Group(); end.position.y = -len; g.add(end);
  return { g, end };
}

export class Figure {
  constructor(style) {
    const S = style;
    const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...o });
    const cloth = M(S.cloth), cloth2 = M(S.cloth2), skin = M(S.skin), trim = M(S.trim, { emissive: S.trim, emissiveIntensity: S.trimGlow });
    this.root = new THREE.Group();
    this.pivot = new THREE.Group(); this.root.add(this.pivot);
    this.pivot.scale.setScalar(S.scale);
    const j = this.j = {};
    j.hips = new THREE.Group(); j.hips.position.y = 0.95; this.pivot.add(j.hips);
    const add = (parent, mesh, x, y, z, shadow = true) => { mesh.position.set(x, y, z); mesh.castShadow = shadow; parent.add(mesh); return mesh; };
    add(j.hips, new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), cloth2), 0, 0, 0).scale.set(1.15, 0.8, 0.9);
    // sash
    add(j.hips, new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 6, 14), trim), 0, 0.1, 0).rotation.x = Math.PI / 2;
    j.torso = new THREE.Group(); j.torso.position.y = 0.1; j.hips.add(j.torso);
    add(j.torso, new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.3, 4, 10), cloth), 0, 0.28, 0).scale.set(1.2, 1, 0.8);
    j.head = new THREE.Group(); j.head.position.y = 0.62; j.torso.add(j.head);
    add(j.head, new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), skin), 0, 0.1, 0);
    if (S.kind === 'boss') {
      // wide woven brim + long pale beak mask
      const hat = add(j.head, new THREE.Mesh(new THREE.ConeGeometry(0.52, 0.16, 18, 1), M(S.hat, { roughness: 1 })), 0, 0.24, 0);
      hat.rotation.x = -0.12;
      const beak = add(j.head, new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.42, 8), M(S.mask, { roughness: 0.4 })), 0, 0.08, 0.28);
      beak.rotation.x = Math.PI / 2 + 0.25;
      add(j.head, new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), M(S.mask, { roughness: 0.4 })), 0, 0.1, 0.08).scale.set(1.05, 1.1, 0.9);
      this.eyes = add(j.head, new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.022, 0.02), new THREE.MeshBasicMaterial({ color: S.trim })), 0, 0.125, 0.168, false);
      // long robe
      const robe = add(j.hips, new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.95, 12, 1, true), cloth2), 0, -0.4, 0);
      robe.material.side = THREE.DoubleSide;
      // shoulder mantle of reed thatch
      add(j.torso, new THREE.Mesh(new THREE.ConeGeometry(0.44, 0.3, 12, 1, true), M(S.hat, { roughness: 1, side: THREE.DoubleSide })), 0, 0.45, 0);
    } else {
      // hood + trailing scarf
      const hood = add(j.head, new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), cloth2), 0, 0.11, -0.02);
      hood.rotation.x = -0.35;
      this.scarf = [];
      let par = j.torso, py = 0.52, pz = -0.16;
      for (let i = 0; i < 4; i++) {
        const g = new THREE.Group(); g.position.set(0, py, pz); par.add(g);
        add(g, new THREE.Mesh(new THREE.BoxGeometry(0.16 - i * 0.02, 0.02, 0.24), trim), 0, 0, -0.12);
        this.scarf.push(g); par = g; py = 0; pz = -0.24;
      }
      add(j.torso, new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.05, 6, 12), trim), 0, 0.52, 0).rotation.x = Math.PI / 2;
      const skirt = add(j.hips, new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.45, 10, 1, true), cloth2), 0, -0.15, 0);
      skirt.material.side = THREE.DoubleSide;
    }
    const arm = (side) => {
      const up = limb(0.3, 0.065, cloth), lo = limb(0.3, 0.055, skin);
      up.g.position.set(0.27 * side, 0.46, 0); j.torso.add(up.g); up.end.add(lo.g);
      return [up.g, lo.g, lo.end];
    };
    [j.sL, j.eL, this.handL] = arm(1);
    [j.sR, j.eR, this.handR] = arm(-1);
    const leg = (side) => {
      const up = limb(0.45, 0.085, cloth2), lo = limb(0.45, 0.07, cloth);
      up.g.position.set(0.11 * side, -0.05, 0); j.hips.add(up.g); up.end.add(lo.g);
      add(lo.end, new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.24), cloth2), 0, 0.02, 0.06);
      return [up.g, lo.g];
    };
    [j.lL, j.kL] = leg(1);
    [j.lR, j.kR] = leg(-1);
    // sword: blade along +z of the hand
    j.sw = new THREE.Group(); this.handR.add(j.sw);
    const L = S.blade;
    this.bladeMat = new THREE.MeshStandardMaterial({ color: S.bladeColor, roughness: 0.25, metalness: 0.7, emissive: S.bladeGlow, emissiveIntensity: 0.35 });
    const blade = add(j.sw, new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.07, L), this.bladeMat), 0, 0, L / 2 + 0.1);
    if (S.kind === 'player') blade.geometry.translate(0, 0, 0); // short straight cutter
    add(j.sw, new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.3, 6), M(S.trim)), 0, 0, -0.02).rotation.x = Math.PI / 2;
    add(j.sw, new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.025), M(0x8a7a55, { metalness: 0.6, roughness: 0.4 })), 0, 0, 0.1);
    this.tip = new THREE.Object3D(); this.tip.position.z = L + 0.1; j.sw.add(this.tip);
    this.base = new THREE.Object3D(); this.base.position.z = 0.25; j.sw.add(this.base);

    this.cur = JSON.parse(JSON.stringify(POSES.idle));
    this.walk = 0; this.spin = 0; this.yOff = 0;
    // blade trail ribbon
    const N = this.trailN = 14;
    this.trailPos = new Float32Array(N * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    const col = new Float32Array(N * 2 * 3);
    const tc = new THREE.Color(S.trail);
    for (let i = 0; i < N; i++) for (let k = 0; k < 2; k++) { const f = 0.55 * (1 - i / (N - 1)) ** 1.5; col.set([tc.r * f, tc.g * f, tc.b * f], (i * 2 + k) * 3); }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const idx = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    this.trail = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    this.trail.frustumCulled = false; this.trail.visible = false;
    this.trailOn = 0; this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
  }

  // pose: target pose, rate: blend speed (1/s), extra: {speed, yOff, spin}
  update(dt, x, z, face, pose, rate, extra = {}) {
    const c = this.cur, k = 1 - Math.exp(-dt * rate);
    for (const key in Z) {
      if (key === 'hy') { c.hy += (pose.hy - c.hy) * k; continue; }
      const a = c[key], b = pose[key];
      a[0] += (b[0] - a[0]) * k; a[1] += (b[1] - a[1]) * k; a[2] += (b[2] - a[2]) * k;
    }
    const sp = extra.speed || 0;
    this.walk += dt * (4 + sp * 2.2);
    const amt = Math.min(1, sp / 3), sw = Math.sin(this.walk) * 0.65 * amt, cw = Math.cos(this.walk);
    const j = this.j;
    for (const key in Z) if (key !== 'hy') j[key].rotation.set(c[key][0], c[key][1], c[key][2]);
    j.lL.rotation.x += sw; j.lR.rotation.x -= sw;
    j.kL.rotation.x += Math.max(0, cw) * 0.7 * amt; j.kR.rotation.x += Math.max(0, -cw) * 0.7 * amt;
    const breathe = Math.sin(this.walk * 0.35) * 0.012;
    j.hips.position.y = 0.95 + c.hy + breathe + Math.abs(Math.sin(this.walk)) * 0.04 * amt;
    j.torso.rotation.x += amt * 0.12;
    this.yOff += ((extra.yOff || 0) - this.yOff) * (1 - Math.exp(-dt * 20));
    this.root.position.set(x, this.yOff, z);
    this.root.rotation.y = face + (extra.spin || 0);
    if (this.scarf) {
      const w = Math.sin(this.walk * 0.9) * 0.18;
      this.scarf.forEach((g, i) => { g.rotation.x = -0.25 - amt * 0.25 + w * (0.4 + i * 0.3) + (i === 0 ? 0.9 : 0); g.rotation.y = Math.sin(this.walk * 0.6 + i) * 0.2; });
    }
    // trail
    this.root.updateWorldMatrix(true, true);
    this.tip.getWorldPosition(this._a); this.base.getWorldPosition(this._b);
    const P = this.trailPos, N = this.trailN;
    if (extra.trail && !this.trailOn) for (let i = 0; i < N; i++) { P.set([this._a.x, this._a.y, this._a.z, this._b.x, this._b.y, this._b.z], i * 6); }
    this.trailOn = extra.trail ? 0.1 : Math.max(0, this.trailOn - dt);
    this.trail.visible = this.trailOn > 0;
    if (this.trail.visible) {
      P.copyWithin(6, 0, (N - 1) * 6);
      P.set([this._a.x, this._a.y, this._a.z, this._b.x, this._b.y, this._b.z], 0);
      this.trail.geometry.attributes.position.needsUpdate = true;
    }
  }
}

const sm = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

export function playerPose(s) {
  const p = s.player;
  const ex = { speed: p.speed };
  switch (p.state) {
    case 'guard': return [s.time - p.lastDeflectT < 0.22 ? POSES.deflect : POSES.guard, 30, ex];
    case 'attack': {
      const side = 'RLO'[p.combo];
      if (p.t < 0.08) return [POSES['wind' + side], 34, ex];
      ex.trail = p.t < 0.3;
      return [POSES['hit' + side], 30, ex];
    }
    case 'dodge': return [POSES.dodge, 26, ex];
    case 'stagger': return [POSES.stagger, 24, ex];
    case 'broken': return [POSES.kneel, 14, ex];
    case 'counter': return [p.t < 0.55 ? POSES.bind : POSES.idle, 28, ex];
    case 'finisher': {
      if (p.t < 0.3) return [POSES.hook, 22, ex];
      if (p.t < C.FINISHER_IMPACT - 0.1) { ex.spin = Math.PI * 2 * sm((p.t - 0.3) / 0.65); ex.trail = true; return [POSES.wheel, 20, ex]; }
      ex.trail = p.t < C.FINISHER_IMPACT + 0.25;
      return [p.t < 1.6 ? POSES.riseCut : POSES.idle, 26, ex];
    }
    case 'dead': return [POSES.fallenBack, 7, ex];
  }
  return [s.time - p.lastDeflectT < 0.22 ? POSES.deflect : POSES.idle, 14, ex];
}

export function bossPose(s) {
  const b = s.boss;
  const ex = { speed: b.speed };
  switch (b.state) {
    case 'attack': {
      const mv = MOVES[b.move], prev = mv.hits[b.hitIdx - 1], next = mv.hits[b.hitIdx];
      if (next && next.leap) { const u = (b.t - (next.t - 0.7)) / 0.7; if (u > 0 && u < 1) ex.yOff = Math.sin(u * Math.PI) * 1.7; }
      if (prev && b.t - prev.t < 0.2) { ex.trail = true; return [POSES['hit' + prev.side], 26, ex]; }
      if (next) {
        const tt = next.t - b.t;
        if (tt < 0.1) { ex.trail = true; return [POSES['hit' + next.side], 26, ex]; }
        return [POSES['wind' + next.side], next.type === 'heavy' ? 5 : next.type === 'thrust' ? 7 : 11, ex];
      }
      return [b.t - prev.t < 0.45 ? POSES['hit' + prev.side] : POSES.idle, 8, ex];
    }
    case 'block': return [POSES.guard, 30, ex];
    case 'pinned': return [POSES.pinned, 24, ex];
    case 'broken': return [POSES.kneel, 10, ex];
    case 'finished': return [s.player.t >= C.FINISHER_IMPACT ? POSES.arched : POSES.kneel, 18, ex];
    case 'phaseShift': return [b.t < 0.9 ? POSES.kneel : b.t < 2.0 ? POSES.roar : POSES.idle, 7, ex];
    case 'dying': return [b.t < 0.5 ? POSES.arched : POSES.fallen, 6, ex];
  }
  return [POSES.idle, 10, ex];
}
