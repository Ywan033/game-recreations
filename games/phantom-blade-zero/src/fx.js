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
      let a = i < this.pts.length ? p.l * p.l : 0;
      if (edge) a = 0;
      col[o] = color.r * a * 0.08; col[o + 1] = color.g * a * 0.08; col[o + 2] = color.b * a * 0.08;
      col[o + 3] = color.r * a * 0.8 + a * 0.2; col[o + 4] = color.g * a * 0.8 + a * 0.2; col[o + 5] = color.b * a * 0.8 + a * 0.2;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

export function buildFx(scene, quality, emitters) {
  const low = quality === 'low';
  const fx = {};
  const glowT = glowTexture();
  const puffT = puffTexture();

  // ---- rain streaks around the camera
  const N = low ? 500 : 1500;
  const BOX = { x: 30, y: 13, z: 30 };
  const drops = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    drops[i * 4] = R(BOX.x) - BOX.x / 2; drops[i * 4 + 1] = R(BOX.y); drops[i * 4 + 2] = R(BOX.z) - BOX.z / 2; drops[i * 4 + 3] = R(26, 17);
  }
  const rpos = new Float32Array(N * 6);
  const rgeo = new THREE.BufferGeometry();
  rgeo.setAttribute('position', new THREE.BufferAttribute(rpos, 3));
  const rain = new THREE.LineSegments(rgeo, new THREE.LineBasicMaterial({ color: 0xa8c0e0, transparent: true, opacity: 0.3, depthWrite: false }));
  rain.frustumCulled = false;
  scene.add(rain);
  const wind = { x: 1.6, z: 0.7 };

  // ---- splash rings on the flagstones
  const splashes = [];
  const ringG = new THREE.RingGeometry(0.75, 1, 14);
  for (let i = 0; i < (low ? 14 : 40); i++) {
    const m = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: 0x9fc0e8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 1;
    scene.add(m);
    splashes.push({ m, t: R(), d: R(0.5, 0.3), s: 0.2 });
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
      s.t = 0; s.d = R(0.45, 0.2); s.s = size * R(1.3, 0.6);
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
    flashT = dur; flashD = dur; flashI = intensity; burstS = size;
  };

  // ---- shockwave ring (phase change)
  const shock = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 64), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
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
    const cx = cam.position.x, cz = cam.position.z;
    for (let i = 0; i < N; i++) {
      const o = i * 4;
      const sp = drops[o + 3];
      drops[o + 1] -= sp * dt;
      drops[o] += wind.x * dt; drops[o + 2] += wind.z * dt;
      if (drops[o + 1] < 0) { drops[o + 1] += BOX.y; drops[o] = R(BOX.x) - BOX.x / 2; drops[o + 2] = R(BOX.z) - BOX.z / 2; }
      const x = cx + drops[o], y = drops[o + 1], z = cz + drops[o + 2];
      const q = i * 6;
      const len = sp * 0.026;
      rpos[q] = x; rpos[q + 1] = y; rpos[q + 2] = z;
      rpos[q + 3] = x - wind.x * len * 0.06; rpos[q + 4] = y + len; rpos[q + 5] = z - wind.z * len * 0.06;
    }
    rgeo.attributes.position.needsUpdate = true;
    // splashes
    for (const s of splashes) {
      s.t += dt / s.d;
      if (s.t >= 1) {
        s.t = 0; s.d = R(0.5, 0.25); s.s = R(0.34, 0.14);
        s.m.position.set(R(ARENA.yard.maxX * 2) - ARENA.yard.maxX, 0.035, R(27) - 9);
        if (s.m.position.z > 9 && Math.abs(s.m.position.x) > 1.5) s.m.position.x *= 0.12;
      }
      s.m.scale.setScalar(s.s * (0.25 + s.t));
      s.m.material.opacity = 0.34 * (1 - s.t);
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
      burst.material.opacity = k * 0.8;
      burst.scale.setScalar(burstS * (1.4 - k * 0.6));
    } else { flash.intensity = 0; burst.material.opacity = 0; burst.visible = false; }
    if (shockT >= 0) {
      shockT += dt / 0.7;
      if (shockT >= 1) { shockT = -1; shock.material.opacity = 0; shock.visible = false; }
      else { shock.visible = true; shock.scale.setScalar(0.5 + shockT * 9); shock.material.opacity = (1 - shockT) * 0.9; }
    }
  };
  return fx;
}
