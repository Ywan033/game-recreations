// Weather and combat effects: rain, splashes, steam, weapon trails, telegraph decals, sparks.
import * as THREE from 'three/webgpu';
import { glowTexture, puffTexture } from './world.js';
import { mulberry32, ARENA } from './sim.js';

const rnd = mulberry32(99);
const R = (a = 1, b = 0) => b + rnd() * (a - b);
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class Trail {
  constructor(scene, color, n = 22, life = 0.24) {
    this.n = n; this.life = life;
    this.color = new THREE.Color(color);
    this.pts = [];
    this.seg = 0; this.wasActive = false;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3);
    this.col = new Float32Array(n * 2 * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }
  update(dt, blade, active) {
    for (const p of this.pts) p.l -= dt / this.life;
    while (this.pts.length && this.pts[this.pts.length - 1].l <= 0) this.pts.pop();
    if (active) {
      if (!this.wasActive) this.seg++;
      blade.base.getWorldPosition(_v1);
      blade.tip.getWorldPosition(_v2);
      _v1.lerp(_v2, 0.4); // only the outer part of the blade leaves a streak
      this.pts.unshift({ b: _v1.toArray(), t: _v2.toArray(), l: 1, s: this.seg });
      if (this.pts.length > this.n) this.pts.pop();
    }
    this.wasActive = active;
    const { pos, col, color } = this;
    for (let i = 0; i < this.n; i++) {
      const p = this.pts[Math.min(i, this.pts.length - 1)];
      const o = i * 6;
      if (!p) { pos.fill(0, o, o + 6); col.fill(0, o, o + 6); continue; }
      pos[o] = p.b[0]; pos[o + 1] = p.b[1]; pos[o + 2] = p.b[2];
      pos[o + 3] = p.t[0]; pos[o + 4] = p.t[1]; pos[o + 5] = p.t[2];
      const nxt = this.pts[i + 1];
      const prev = this.pts[i - 1];
      const edge = (nxt && nxt.s !== p.s) || (prev && prev.s !== p.s && i > 0 && false);
      // a thin arc of light: brightest at the edge and when fresh, gone toward the hilt
      let a = i < this.pts.length ? p.l * p.l * p.l : 0;
      if (edge) a = 0;
      col[o] = 0; col[o + 1] = 0; col[o + 2] = 0;
      // (vertex colours are linear light: 0.08 already reads as a clear pale streak at night)
      col[o + 3] = color.r * a * 0.08 + a * 0.012; col[o + 4] = color.g * a * 0.08 + a * 0.012; col[o + 5] = color.b * a * 0.08 + a * 0.012;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

export function buildFx(scene, quality, world) {
  const low = quality === 'low';
  const fx = {};
  const glowT = glowTexture();
  const puffT = puffTexture();
  const emitters = world.emitters;

  // ---- rain: camera-facing streak quads in three depth layers.
  // Near streaks are long, thin and faint (motion blur); the far layer is so fine it reads as haze.
  // Each streak picks up warm light when it falls past a lantern.
  const LAYERS = low
    ? [{ n: 100, r0: 1.6, r1: 8, len: 1.0, w: 0.012, a: 0.13 }, { n: 300, r0: 8, r1: 20, len: 0.6, w: 0.015, a: 0.17 }, { n: 220, r0: 20, r1: 42, len: 0.7, w: 0.04, a: 0.06 }]
    : [{ n: 260, r0: 1.6, r1: 8, len: 1.0, w: 0.012, a: 0.13 }, { n: 900, r0: 8, r1: 20, len: 0.6, w: 0.015, a: 0.17 }, { n: 800, r0: 20, r1: 42, len: 0.7, w: 0.04, a: 0.06 }];
  const N = LAYERS.reduce((s, l) => s + l.n, 0);
  const TOP = 13;
  const drops = new Float32Array(N * 6); // angle, radius, y, speed, length scale, layer
  {
    let i = 0;
    LAYERS.forEach((L, li) => {
      for (let k = 0; k < L.n; k++, i++) {
        drops[i * 6] = R(Math.PI * 2); drops[i * 6 + 1] = Math.sqrt(R(L.r1 * L.r1, L.r0 * L.r0)); drops[i * 6 + 2] = R(TOP);
        drops[i * 6 + 3] = R(24, 17); drops[i * 6 + 4] = R(1.3, 0.7); drops[i * 6 + 5] = li;
      }
    });
  }
  const rpos = new Float32Array(N * 12);
  const rcol = new Float32Array(N * 12);
  const ruv = new Float32Array(N * 8);
  const ridx = [];
  for (let i = 0; i < N; i++) {
    ruv.set([0, 0, 1, 0, 0, 1, 1, 1], i * 8);
    const a = i * 4;
    ridx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const rgeo = new THREE.BufferGeometry();
  rgeo.setAttribute('position', new THREE.BufferAttribute(rpos, 3));
  rgeo.setAttribute('color', new THREE.BufferAttribute(rcol, 3));
  rgeo.setAttribute('uv', new THREE.BufferAttribute(ruv, 2));
  rgeo.setIndex(ridx);
  const streakT = (() => {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 64;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(16, 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 16; x++) {
      const u = 1 - Math.abs((x + 0.5) / 8 - 1), v = (y + 0.5) / 64;
      const a = Math.min(1, u * 1.6) ** 1.5 * Math.sin(Math.PI * v) ** 0.8 * (0.35 + 0.65 * v); // soft edges, brighter leading end
      const o = (y * 16 + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255 * a; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const rain = new THREE.Mesh(rgeo, new THREE.MeshBasicMaterial({ map: streakT, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  rain.frustumCulled = false;
  rain.renderOrder = 4;
  scene.add(rain);
  const wind = { x: 1.6, z: 0.7 };
  const lamps = world.lanterns.map((l) => ({ x: l.g.position.x, y: l.g.position.y - 0.45, z: l.g.position.z, k: l.light ? 1 : 0.55 }));

  // ---- splashes on the flagstones: small, dim rings of varied size, densest near the camera
  const splashes = [];
  const ringG = new THREE.RingGeometry(0.72, 1, 12);
  for (let i = 0; i < (low ? 20 : 70); i++) {
    const m = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: 0x8fa6c4, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 1;
    scene.add(m);
    splashes.push({ m, t: R(), d: R(0.5, 0.3), s: 0.1, a: 0.1 });
  }

  // ---- steam puffs
  const puffs = [];
  for (let i = 0; i < (low ? 24 : 60); i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffT, color: 0xc4d0de, transparent: true, opacity: 0, depthWrite: false }));
    sp.visible = false;
    scene.add(sp);
    puffs.push({ sp, t: 0, d: 1, vx: 0, vy: 0, vz: 0, s0: 1, s1: 2, a: 0.4 });
  }
  let puffI = 0;
  fx.steam = (x, y, z, vx, vy, vz, size = 0.6, life = 1.8, alpha = 0.32, color = 0xc4d0de) => {
    const p = puffs[puffI++ % puffs.length];
    p.sp.position.set(x, y, z);
    p.vx = vx; p.vy = vy; p.vz = vz; p.t = 0; p.d = life; p.s0 = size; p.s1 = size * 3.2; p.a = alpha;
    p.sp.material.color.set(color);
    p.sp.material.rotation = R(6);
    p.sp.visible = true;
  };
  const emitAcc = emitters.map(() => R());

  // ---- sparks
  const sparks = [];
  for (let i = 0; i < (low ? 30 : 70); i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    sp.visible = false;
    scene.add(sp);
    sparks.push({ sp, t: 0, d: 0.4, v: new THREE.Vector3(), s: 0.1 });
  }
  let sparkI = 0;
  fx.sparks = (pos, color, n, speed = 6, size = 0.14) => {
    for (let i = 0; i < n; i++) {
      const s = sparks[sparkI++ % sparks.length];
      s.sp.position.copy(pos);
      s.v.set(R(2, -1), R(1.6, -0.3), R(2, -1)).normalize().multiplyScalar(speed * R(1, 0.4));
      s.t = 0; s.d = R(0.4, 0.16); s.s = size * R(0.55, 0.22); // small hot flecks, not glowing balls
      s.sp.material.color.set(color);
      s.sp.visible = true;
    }
  };

  // ---- hit flash light + burst sprite
  const flash = new THREE.PointLight(0xffffff, 0, 9, 1.6);
  scene.add(flash);
  const burst = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0 }));
  burst.renderOrder = 6;
  scene.add(burst);
  let flashT = 0, flashD = 0.2, flashI = 0, burstS = 1;
  fx.flash = (pos, color, intensity = 40, size = 2.2, dur = 0.2) => {
    flash.position.copy(pos); flash.color.set(color);
    burst.position.copy(pos); burst.material.color.set(color);
    flashT = dur; flashD = dur; flashI = intensity * 0.35; burstS = size; // a glint of struck steel, not a floodlight
  };

  // ---- shockwave ring (phase change)
  const shock = new THREE.Mesh(new THREE.RingGeometry(0.965, 1, 64), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  shock.rotation.x = -Math.PI / 2;
  shock.position.y = 0.08;
  shock.renderOrder = 3;
  shock.visible = false;
  burst.visible = false;
  scene.add(shock);
  let shockT = -1;
  fx.shock = (x, z) => { shock.position.x = x; shock.position.z = z; shockT = 0; };

  // ---- telegraph decals that follow the boss
  const deco = new THREE.Group();
  scene.add(deco);
  const dmat = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const flat = (geo, color) => {
    const m = new THREE.Mesh(geo, dmat(color));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.05;
    m.renderOrder = 3;
    deco.add(m);
    return m;
  };
  const wedge = (reach, arc, color) => flat(new THREE.CircleGeometry(reach, 28, -Math.PI / 2 - arc, arc * 2), color);
  fx.dChain = wedge(3.0, 1.05, 0x58c8ff);
  fx.dDelay = wedge(3.7, 0.7, 0xff4a22);
  fx.dRev = wedge(3.1, 1.7, 0xffb030);
  fx.dSpin = flat(new THREE.RingGeometry(0.9, 3.4, 44), 0xffa02a);
  const lg = new THREE.PlaneGeometry(1.3, 1);
  lg.translate(0, -0.5, 0);
  fx.dLunge = flat(lg, 0x58c8ff);
  fx.dPunish = flat(new THREE.RingGeometry(0.95, 1.12, 40), 0xffd24a);
  fx.dPunish2 = flat(new THREE.RingGeometry(1.25, 1.31, 40), 0xffd24a);
  fx.deco = deco;

  // ---- blade glints (boss telegraph) and lock-on marker
  fx.glints = [0, 1].map(() => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false, opacity: 0 }));
    sp.renderOrder = 7;
    scene.add(sp);
    return sp;
  });
  fx.guardGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, color: 0x7fe8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0 }));
  scene.add(fx.guardGlow);

  fx.update = (dt, time, cam) => {
    // rain
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    for (let i = 0; i < N; i++) {
      const o = i * 6;
      const L = LAYERS[drops[o + 5]];
      const sp = drops[o + 3];
      drops[o + 2] -= sp * dt;
      if (drops[o + 2] < 0) { drops[o + 2] += TOP; drops[o] = R(Math.PI * 2); drops[o + 1] = Math.sqrt(R(L.r1 * L.r1, L.r0 * L.r0)); }
      const rx = Math.cos(drops[o]) * drops[o + 1], rz = Math.sin(drops[o]) * drops[o + 1];
      const x = cx + rx, y = drops[o + 2], z = cz + rz;
      const len = L.len * drops[o + 4];
      // billboard across the view direction
      const inv = (L.w * 0.5) / (Math.hypot(rx, rz) || 1);
      const px = -rz * inv, pz = rx * inv;
      const tx = x - wind.x * len * 0.06, tz = z - wind.z * len * 0.06;
      const q = i * 12;
      rpos[q] = x - px; rpos[q + 1] = y; rpos[q + 2] = z - pz;
      rpos[q + 3] = x + px; rpos[q + 4] = y; rpos[q + 5] = z + pz;
      rpos[q + 6] = tx - px; rpos[q + 7] = y + len; rpos[q + 8] = tz - pz;
      rpos[q + 9] = tx + px; rpos[q + 10] = y + len; rpos[q + 11] = tz + pz;
      // cool sky light, plus warm light from any lantern the streak is passing
      let warm = 0;
      if (drops[o + 5] < 2) {
        for (let k = 0; k < lamps.length; k++) {
          const l = lamps[k];
          const d2 = (x - l.x) * (x - l.x) + (y + len * 0.5 - l.y) * (y + len * 0.5 - l.y) + (z - l.z) * (z - l.z);
          if (d2 < 30) warm += l.k / (1 + d2 * 0.9);
        }
      }
      // streaks right at the lens fade out so they never mask the fight
      const nearFade = Math.min(1, Math.max(0, (Math.hypot(rx, y - cy, rz) - 1.2) / 2.5));
      const a = L.a * nearFade;
      const r = a * (0.5 + warm * 2.6), g = a * (0.6 + warm * 1.5), b = a * (0.78 + warm * 0.55);
      for (let v = 0; v < 4; v++) { rcol[q + v * 3] = r; rcol[q + v * 3 + 1] = g; rcol[q + v * 3 + 2] = b; }
    }
    rgeo.attributes.position.needsUpdate = true;
    rgeo.attributes.color.needsUpdate = true;
    // splashes
    for (const s of splashes) {
      s.t += dt / s.d;
      if (s.t >= 1) {
        const near = R() < 0.6;
        const a = R(Math.PI * 2), rr = near ? R(7, 1) : R(18, 6);
        let x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
        x = Math.max(ARENA.yard.minX, Math.min(ARENA.yard.maxX, x));
        z = Math.max(ARENA.yard.minZ, Math.min(ARENA.lane.maxZ, z));
        if (z > ARENA.yard.maxZ) x = Math.max(ARENA.lane.minX, Math.min(ARENA.lane.maxX, x));
        s.t = 0; s.d = R(0.42, 0.2);
        s.s = near ? R(0.09, 0.035) : R(0.16, 0.07);
        s.a = near ? R(0.16, 0.07) : R(0.11, 0.05);
        s.m.position.set(x, 0.03, z);
      }
      s.m.scale.setScalar(s.s * (0.3 + s.t * 1.4));
      s.m.material.opacity = s.a * (1 - s.t) * (1 - s.t);
    }
    // steam emitters
    emitters.forEach((e, i) => {
      emitAcc[i] += dt * e.rate * (low ? 0.5 : 1);
      while (emitAcc[i] >= 1) {
        emitAcc[i] -= 1;
        fx.steam(e.x, e.y, e.z, e.vx + R(0.3, -0.3), e.vy, R(0.3, -0.3), e.big ? 1.1 : 0.45, e.big ? 3.2 : 1.7, e.big ? 0.22 : 0.3);
      }
    });
    for (const p of puffs) {
      if (!p.sp.visible) continue;
      p.t += dt / p.d;
      if (p.t >= 1) { p.sp.visible = false; continue; }
      p.sp.position.x += (p.vx + wind.x * 0.25 * p.t) * dt; p.sp.position.y += p.vy * dt; p.sp.position.z += (p.vz + wind.z * 0.25 * p.t) * dt;
      p.vx *= 1 - dt * 0.8; p.vz *= 1 - dt * 0.8; p.vy *= 1 - dt * 0.4;
      const s = p.s0 + (p.s1 - p.s0) * Math.sqrt(p.t);
      p.sp.scale.set(s, s, 1);
      p.sp.material.opacity = p.a * Math.min(1, p.t * 8) * (1 - p.t);
    }
    for (const s of sparks) {
      if (!s.sp.visible) continue;
      s.t += dt;
      if (s.t >= s.d) { s.sp.visible = false; continue; }
      s.v.y -= 14 * dt;
      s.sp.position.addScaledVector(s.v, dt);
      if (s.sp.position.y < 0.03) { s.sp.position.y = 0.03; s.v.y *= -0.4; }
      const k = 1 - s.t / s.d;
      s.sp.scale.setScalar(s.s * (0.4 + k));
      s.sp.material.opacity = k;
    }
    if (flashT > 0) {
      flashT -= dt;
      const k = Math.max(0, flashT / flashD);
      flash.intensity = flashI * k;
      burst.visible = k > 0.01;
      burst.material.opacity = k * 0.5;
      burst.scale.setScalar(burstS * 0.55 * (1.4 - k * 0.6));
    } else { flash.intensity = 0; burst.material.opacity = 0; burst.visible = false; }
    if (shockT >= 0) {
      shockT += dt / 0.7;
      if (shockT >= 1) { shockT = -1; shock.material.opacity = 0; shock.visible = false; }
      else { shock.visible = true; shock.scale.setScalar(0.5 + shockT * 9); shock.material.opacity = (1 - shockT) * (1 - shockT) * 0.3; }
    }
  };
  return fx;
}
