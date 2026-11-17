// The arena: a low-grass islet in a reed fen under a rising amber moon. All procedural.
import * as THREE from 'three/webgpu';
import { positionLocal, time, sin, vec3, instanceIndex, uv, mix, color } from 'three/tsl';
import { C } from './sim.js';

function rng(seed) { let a = seed; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildWorld(scene, low) {
  const R = rng(77);
  const world = { update() {} };

  // --- sky dome: dusk teal overhead, ember band at the horizon, stars
  const skyTex = canvasTex(1024, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#050b18'); gr.addColorStop(0.28, '#0b2233'); gr.addColorStop(0.42, '#1d4a54');
    gr.addColorStop(0.485, '#7a6a55'); gr.addColorStop(0.5, '#b8875a'); gr.addColorStop(0.52, '#20303a'); gr.addColorStop(1, '#0a1218');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      const y = R() * R() * h * 0.42; g.globalAlpha = 0.25 + R() * 0.7 * (1 - y / (h * 0.45));
      g.fillStyle = R() < 0.2 ? '#ffd9a8' : '#dff3ff'; g.fillRect(R() * w, y, R() < 0.1 ? 2 : 1, 1);
    }
    g.globalAlpha = 1;
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10; scene.add(sky);

  // --- moon: large, low, amber-rose, straight ahead of the opening view (-z)
  const moonDir = new THREE.Vector3(-0.22, 0.2, -1).normalize();
  const moonTex = canvasTex(256, 256, (g) => {
    const gr = g.createRadialGradient(118, 118, 10, 128, 128, 120);
    gr.addColorStop(0, '#fff3d6'); gr.addColorStop(0.75, '#ffd49a'); gr.addColorStop(1, '#e9a56b');
    g.fillStyle = gr; g.beginPath(); g.arc(128, 128, 120, 0, 7); g.fill();
    g.globalAlpha = 0.13; g.fillStyle = '#8a5a3a';
    for (let i = 0; i < 26; i++) { g.beginPath(); g.arc(40 + R() * 180, 40 + R() * 180, 6 + R() * 26, 0, 7); g.fill(); }
  });
  const moon = new THREE.Mesh(new THREE.CircleGeometry(26, 40), new THREE.MeshBasicMaterial({ map: moonTex, fog: false, transparent: true }));
  moon.position.copy(moonDir).multiplyScalar(260); moon.lookAt(0, 0, 0); moon.renderOrder = -9; scene.add(moon);
  const glowTex = canvasTex(256, 256, (g) => {
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,214,160,0.55)'); gr.addColorStop(0.25, 'rgba(255,180,120,0.2)'); gr.addColorStop(1, 'rgba(255,160,100,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(190, 190), new THREE.MeshBasicMaterial({ map: glowTex, fog: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.position.copy(moonDir).multiplyScalar(255); glow.lookAt(0, 0, 0); glow.renderOrder = -8; scene.add(glow);

  // --- distant ridges (two silhouette rings)
  const ridge = (rad, base, amp, col, seed) => {
    const N = 160, pos = [], idx = [], r2 = rng(seed);
    const ph = [r2() * 6, r2() * 6, r2() * 6];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const h = base + amp * (0.5 + 0.5 * Math.sin(a * 3 + ph[0])) * (0.6 + 0.4 * Math.sin(a * 7 + ph[1])) + amp * 0.18 * Math.sin(a * 23 + ph[2]) + amp * 0.08 * Math.sin(a * 51);
      pos.push(Math.sin(a) * rad, -4, Math.cos(a) * rad, Math.sin(a) * rad, Math.max(1, h), Math.cos(a) * rad);
      if (i < N) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, fog: false, side: THREE.DoubleSide }));
    m.renderOrder = -7; scene.add(m);
  };
  ridge(240, 14, 46, 0x1c3440, 5);
  ridge(170, 6, 26, 0x0f2029, 9);

  // --- lights
  scene.fog = new THREE.FogExp2(0x16303a, 0.021);
  scene.add(new THREE.HemisphereLight(0x6fa6b8, 0x1a2a22, 1.5));
  const moonL = new THREE.DirectionalLight(0xffd8a8, 2.6);
  moonL.position.copy(moonDir).multiplyScalar(40); moonL.position.y = 26;
  if (!low) {
    moonL.castShadow = true; moonL.shadow.mapSize.set(1024, 1024);
    const sc = moonL.shadow.camera; sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 5; sc.far = 90;
    moonL.shadow.bias = -0.002;
  }
  scene.add(moonL);
  const rim = new THREE.DirectionalLight(0x7fd0e8, 1.3); rim.position.set(8, 10, 22); scene.add(rim);

  // --- ground: islet of low grass with trodden earth, dark fen water beyond
  const groundTex = canvasTex(1024, 1024, (g, w) => {
    g.fillStyle = '#2f4a34'; g.fillRect(0, 0, w, w);
    for (let i = 0; i < 26000; i++) {
      const x = R() * w, y = R() * w, d = Math.hypot(x - w / 2, y - w / 2) / (w / 2);
      g.fillStyle = d < 0.72 ? (R() < 0.5 ? '#44663f' : '#3a5a3c') : '#24392c';
      if (R() < 0.12 && d < 0.6) g.fillStyle = '#6b6a48';
      g.globalAlpha = 0.25 + R() * 0.4; g.fillRect(x, y, 2 + R() * 5, 1 + R() * 3);
    }
    g.globalAlpha = 1;
    // worn duelling ring and a few stepping scars
    g.strokeStyle = 'rgba(150,140,100,0.22)'; g.lineWidth = 10; g.beginPath(); g.arc(w / 2, w / 2, w * 0.2, 0, 7); g.stroke();
    const gr = g.createRadialGradient(w / 2, w / 2, w * 0.3, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(10,22,22,0)'); gr.addColorStop(1, 'rgba(8,18,20,0.85)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(15, 48), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const water = new THREE.Mesh(new THREE.CircleGeometry(160, 48), new THREE.MeshStandardMaterial({ color: 0x0b1c22, roughness: 0.25, metalness: 0.7 }));
  water.rotation.x = -Math.PI / 2; water.position.y = -0.06; scene.add(water);

  // --- wind-driven vegetation (TSL vertex sway)
  const bladeGeo = (plume) => {
    // uv.y = height fraction, uv.x = 1 on the seed plume
    const pos = [], uvs = [], idx = [], seg = 5;
    for (let i = 0; i <= seg; i++) { const y = i / seg, w = 0.5 * (1 - 0.75 * y); pos.push(-w, y, 0, w, y, 0); uvs.push(0, y, 0, y); if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } }
    if (plume) { const k = pos.length / 3; pos.push(0, 0.74, 0, -0.85, 0.86, 0, 0.85, 0.9, 0, 0, 1.08, 0); uvs.push(1, 0.74, 1, 0.86, 1, 0.9, 1, 1); idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  };
  const windMat = (base, tip, plumeCol, amp) => {
    const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.9 });
    const h = uv().y, ph = instanceIndex.toFloat().mul(0.731);
    const gust = sin(time.mul(0.45).add(ph.mul(0.02))).mul(0.5).add(0.6);
    const sway = sin(time.mul(1.5).add(ph)).mul(0.5).add(sin(time.mul(3.3).add(ph.mul(1.9))).mul(0.16)).add(0.45).mul(gust).mul(amp);
    const bend = h.mul(h).mul(sway);
    m.positionNode = positionLocal.add(vec3(bend, bend.mul(-0.25), bend.mul(0.3)));
    const shade = sin(ph.mul(12.9)).mul(0.14).add(0.86);
    m.colorNode = mix(mix(color(base), color(tip), h), color(plumeCol), uv().x).mul(shade);
    return m;
  };
  const d = new THREE.Object3D();
  const scatter = (count, geo, mat, place) => {
    const im = new THREE.InstancedMesh(geo, mat, count);
    for (let i = 0; i < count; i++) { place(d, i); d.updateMatrix(); im.setMatrixAt(i, d.matrix); }
    im.frustumCulled = false; im.receiveShadow = false; scene.add(im); return im;
  };
  // tall reeds ring the clearing (boundary just outside the playable radius)
  const inner = C.ARENA_R + 0.9;
  scatter(low ? 2600 : 9000, bladeGeo(true), windMat(0x2e4a30, 0xa9a56a, 0xe8d7a6, 0.34), (o) => {
    const a = R() * Math.PI * 2, r = inner + Math.pow(R(), 1.7) * 30;
    o.position.set(Math.sin(a) * r, -0.05, Math.cos(a) * r);
    o.rotation.set(0, a + Math.PI + (R() - 0.5) * 1.2, (R() - 0.5) * 0.12);
    const hgt = 2.3 + R() * 1.5 + Math.min(1.2, (r - inner) * 0.08);
    o.scale.set(0.085 + R() * 0.05, hgt, 1);
  });
  // low grass in the clearing
  scatter(low ? 1500 : 5000, bladeGeo(false), windMat(0x2b4a2e, 0x7c9a5a, 0x7c9a5a, 0.6), (o) => {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * (inner + 1.5);
    o.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
    o.rotation.set(0, R() * 6.28, (R() - 0.5) * 0.5);
    o.scale.set(0.05 + R() * 0.03, 0.14 + R() * 0.22 + (r > C.ARENA_R - 1.5 ? 0.3 : 0), 1);
  });

  // --- boundary markers: leaning poles with cloth streamers (visible limit of the clearing)
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x4a3d2e, roughness: 1 });
  const clothMat = new THREE.MeshStandardMaterial({ color: 0xc8562f, roughness: 0.9, side: THREE.DoubleSide, emissive: 0x40140a });
  const streamers = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.2, r = C.ARENA_R + 0.7;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 4.2, 6), poleMat);
    pole.position.set(Math.sin(a) * r, 2.0, Math.cos(a) * r); pole.rotation.set((R() - 0.5) * 0.25, 0, (R() - 0.5) * 0.25); pole.castShadow = true;
    scene.add(pole);
    const st = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 1.5, 1, 4), clothMat);
    st.geometry.translate(0, -0.75, 0); st.position.set(pole.position.x, 4.0, pole.position.z); st.userData.ph = R() * 6;
    scene.add(st); streamers.push(st);
  }

  // --- drifting mist sheets
  const mistTex = canvasTex(256, 256, (g) => {
    for (let i = 0; i < 46; i++) {
      const x = 72 + R() * 112, y = 104 + R() * 48, r = 16 + R() * 26;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(190,225,230,0.10)'); gr.addColorStop(1, 'rgba(190,225,230,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    }
  });
  const mists = [];
  for (let i = 0; i < (low ? 5 : 9); i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(50, 7), new THREE.MeshBasicMaterial({ map: mistTex, transparent: true, depthWrite: false, opacity: 0.75, fog: false }));
    const a = (i / 9) * Math.PI * 2 + R(), r = 19 + R() * 16;
    m.position.set(Math.sin(a) * r, 1.3 + R() * 1.0, Math.cos(a) * r); m.userData = { a, r, sp: (R() - 0.3) * 0.02 };
    m.renderOrder = 5; scene.add(m); mists.push(m);
  }

  // --- fireflies
  const FN = low ? 24 : 60;
  const flies = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 5, 4), new THREE.MeshBasicMaterial({ color: 0xd8ff9a, fog: false }), FN);
  const fd = []; for (let i = 0; i < FN; i++) fd.push({ a: R() * 6.28, r: 5 + R() * 22, y: 0.5 + R() * 2.6, s: 0.2 + R() * 0.5, p: R() * 6 });
  flies.frustumCulled = false; scene.add(flies);

  world.update = (t, camera) => {
    for (const m of mists) { const u = m.userData; u.a += u.sp * 0.016; m.position.x = Math.sin(u.a) * u.r; m.position.z = Math.cos(u.a) * u.r; m.lookAt(camera.position.x, m.position.y, camera.position.z); }
    for (let i = 0; i < FN; i++) {
      const f = fd[i], a = f.a + Math.sin(t * f.s + f.p) * 0.3;
      d.position.set(Math.sin(a) * f.r, f.y + Math.sin(t * f.s * 2 + f.p) * 0.4, Math.cos(a) * f.r);
      d.rotation.set(0, 0, 0); d.scale.setScalar(0.5 + 0.9 * Math.max(0, Math.sin(t * 1.7 * f.s + f.p * 3)));
      d.updateMatrix(); flies.setMatrixAt(i, d.matrix);
    }
    flies.instanceMatrix.needsUpdate = true;
    for (const st of streamers) {
      const p = st.geometry.attributes.position, ph = st.userData.ph;
      for (let i = 0; i < p.count; i++) { const y = -p.getY(i); p.setZ(i, Math.sin(t * 3 + ph + y * 3) * 0.16 * y + y * 0.35); }
      p.needsUpdate = true;
    }
    sky.position.copy(camera.position);
  };
  return world;
}
