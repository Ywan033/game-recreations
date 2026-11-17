// Combat effects: spark bursts, expanding/collapsing rings, light flashes, the Moonwheel crescent.
import * as THREE from 'three/webgpu';

export class Fx {
  constructor(scene) {
    const N = this.N = 260;
    this.sparks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.03, 0.22), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }), N);
    this.sparks.frustumCulled = false;
    this.sp = [];
    const col = new THREE.Color(0);
    for (let i = 0; i < N; i++) { this.sp.push({ life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), c: new THREE.Color(), g: 9 }); this.sparks.setColorAt(i, col); }
    this.next = 0; scene.add(this.sparks);
    this.d = new THREE.Object3D(); this.tmp = new THREE.Vector3();
    // rings
    this.rings = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, fog: false, depthTest: false }));
      m.visible = false; m.renderOrder = 20; scene.add(m);
      this.rings.push({ m, life: 0, max: 1, r0: 1, r1: 1, flat: false });
    }
    this.light = new THREE.PointLight(0xffffff, 0, 14, 1.6); scene.add(this.light);
    this.lightLife = 0; this.lightMax = 1; this.lightPow = 0;
    // crescent sweep for the finisher
    const cg = new THREE.RingGeometry(1.5, 2.3, 40, 1, -0.4, Math.PI * 1.25);
    const cp = cg.attributes.position;
    for (let i = 0; i < cp.count; i++) { const a = Math.atan2(cp.getY(i), cp.getX(i)); const r = Math.hypot(cp.getX(i), cp.getY(i)); const k = Math.sin(Math.max(0, Math.min(1, (a + 0.4) / (Math.PI * 1.25))) * Math.PI); const rr = 2.3 - (2.3 - r) * k; cp.setXY(i, Math.cos(a) * rr, Math.sin(a) * rr); }
    this.crescent = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: 0xfff1d0, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    this.crescent.visible = false; this.crescent.renderOrder = 21; scene.add(this.crescent);
    this.cLife = 0;
  }
  burst(x, y, z, n, color, speed, opts = {}) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const s = this.sp[this.next]; this.next = (this.next + 1) % this.N;
      s.p.set(x, y, z);
      const a = Math.random() * Math.PI * 2, e = (Math.random() - (opts.up ? 0.1 : 0.4)) * Math.PI * 0.8, v = speed * (0.35 + Math.random() * 0.65);
      s.v.set(Math.cos(a) * Math.cos(e) * v, Math.sin(e) * v + (opts.lift || 0), Math.sin(a) * Math.cos(e) * v);
      s.max = s.life = (opts.life || 0.45) * (0.5 + Math.random() * 0.5); s.c.copy(c); s.g = opts.g ?? 9;
    }
  }
  ring(x, y, z, color, r0, r1, life, flat, camera) {
    const r = this.rings.find((q) => q.life <= 0) || this.rings[0];
    r.life = r.max = life; r.r0 = r0; r.r1 = r1; r.flat = flat;
    r.m.material.color.set(color); r.m.position.set(x, y, z); r.m.visible = true;
    if (flat) r.m.rotation.set(-Math.PI / 2, 0, 0); else r.m.quaternion.copy(camera.quaternion);
    return r;
  }
  flash(x, y, z, color, power, life) {
    this.light.color.set(color); this.light.position.set(x, y, z);
    this.lightLife = this.lightMax = life; this.lightPow = power;
  }
  sweep(x, y, z, yaw) {
    this.crescent.position.set(x, y, z); this.crescent.rotation.set(0, yaw, 0.5); this.cLife = 0.6; this.crescent.visible = true;
  }
  update(dt) {
    const d = this.d, black = this._black || (this._black = new THREE.Color(0));
    for (let i = 0; i < this.N; i++) {
      const s = this.sp[i];
      if (s.life <= 0) { if (s.live) { s.live = false; d.scale.setScalar(0); d.updateMatrix(); this.sparks.setMatrixAt(i, d.matrix); } continue; }
      s.live = true; s.life -= dt; s.v.y -= s.g * dt; s.p.addScaledVector(s.v, dt);
      if (s.p.y < 0.02) { s.p.y = 0.02; s.v.y *= -0.35; s.v.x *= 0.6; s.v.z *= 0.6; }
      d.position.copy(s.p); d.lookAt(this.tmp.copy(s.p).add(s.v));
      const f = Math.max(0, s.life / s.max); d.scale.set(1, 1, 0.5 + f * 1.5); d.updateMatrix();
      this.sparks.setMatrixAt(i, d.matrix);
      this.sparks.setColorAt(i, black.copy(s.c).multiplyScalar(f));
    }
    this.sparks.instanceMatrix.needsUpdate = true;
    if (this.sparks.instanceColor) this.sparks.instanceColor.needsUpdate = true;
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt; const u = 1 - Math.max(0, r.life / r.max);
      r.m.scale.setScalar(r.r0 + (r.r1 - r.r0) * (1 - (1 - u) ** 2)); r.m.material.opacity = 1 - u * u;
      if (r.life <= 0) r.m.visible = false;
    }
    if (this.lightLife > 0) { this.lightLife -= dt; this.light.intensity = this.lightPow * Math.max(0, this.lightLife / this.lightMax); } else this.light.intensity = 0;
    if (this.cLife > 0) {
      this.cLife -= dt; const u = 1 - this.cLife / 0.6;
      this.crescent.scale.setScalar(0.6 + u * 1.1); this.crescent.material.opacity = 1 - u; this.crescent.rotation.y += dt * 5;
      if (this.cLife <= 0) this.crescent.visible = false;
    }
  }
}
