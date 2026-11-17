// Procedural rainy-night tavern courtyard: every mesh and texture is generated here.
import * as THREE from 'three/webgpu';
import { ARENA, mulberry32 } from './sim.js';

const rnd = mulberry32(20240);
const R = (a = 1, b = 0) => b + rnd() * (a - b);

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function speckle(ctx, w, h, n, alpha, light = true) {
  for (let i = 0; i < n; i++) {
    const v = light ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${R(alpha)})`;
    ctx.fillRect(R(w), R(h), R(3, 1), R(3, 1));
  }
}

// ------------------------------------------------------------------ textures

function flagstoneTextures() {
  const S = 1024;
  const stones = [];
  const rows = 8;
  const rh = S / rows;
  for (let r = 0; r < rows; r++) {
    let x = -R(120);
    while (x < S) {
      const w = R(230, 110);
      stones.push({ x, y: r * rh, w, h: rh, tone: R(), wet: R() });
      x += w;
    }
  }
  const puddles = [];
  for (let i = 0; i < 9; i++) puddles.push({ x: R(S), y: R(S), rx: R(110, 40), ry: R(70, 25), a: R(3) });
  const map = canvasTex(S, S, (ctx) => {
    ctx.fillStyle = '#080a0e';
    ctx.fillRect(0, 0, S, S);
    for (const s of stones) {
      const l = 30 + s.tone * 22;
      ctx.fillStyle = `rgb(${l * 0.86},${l * 0.95},${l * 1.12})`;
      const g = 4;
      ctx.beginPath();
      ctx.roundRect(s.x + g, s.y + g, s.w - g * 2, s.h - g * 2, 9);
      ctx.fill();
      // worn highlight edge
      ctx.strokeStyle = 'rgba(160,180,210,0.07)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    speckle(ctx, S, S, 5000, 0.07, true);
    speckle(ctx, S, S, 5000, 0.2, false);
    for (const p of puddles) {
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      gr.addColorStop(0, 'rgba(4,7,12,0.85)');
      gr.addColorStop(0.7, 'rgba(4,7,12,0.6)');
      gr.addColorStop(1, 'rgba(4,7,12,0)');
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.scale(p.rx, p.ry);
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, 7); ctx.fill();
      ctx.restore();
    }
  });
  const rough = canvasTex(S, S, (ctx) => {
    ctx.fillStyle = 'rgb(190,190,190)';
    ctx.fillRect(0, 0, S, S);
    for (const s of stones) {
      const v = 50 + s.wet * 55;
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.beginPath();
      ctx.roundRect(s.x + 4, s.y + 4, s.w - 8, s.h - 8, 9);
      ctx.fill();
    }
    speckle(ctx, S, S, 3000, 0.12, true);
    for (const p of puddles) {
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.scale(p.rx, p.ry);
      ctx.fillStyle = 'rgb(10,10,10)';
      ctx.beginPath(); ctx.arc(0, 0, 0.8, 0, 7); ctx.fill();
      ctx.restore();
    }
  }, false);
  return { map, rough };
}

function plasterTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#5c6470';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 4000, 0.06, true);
    speckle(ctx, w, h, 4000, 0.12, false);
    // rain streaks and damp base
    for (let i = 0; i < 40; i++) {
      const x = R(w);
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(10,14,20,0.35)');
      g.addColorStop(R(0.9, 0.3), 'rgba(10,14,20,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, R(14, 3), h);
    }
    const g = ctx.createLinearGradient(0, h * 0.6, 0, h);
    g.addColorStop(0, 'rgba(8,12,16,0)');
    g.addColorStop(1, 'rgba(8,12,16,0.7)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

function timberTexture() {
  return canvasTex(256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#2c1d14';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(${R(90, 20)},${R(50, 10)},${R(30, 5)},${R(0.25)})`;
      ctx.fillRect(R(w), 0, R(4, 1), h);
    }
    for (let x = 0; x < w; x += 64) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x, 0, 3, h);
    }
  });
}

function roofTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#161b24';
    ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) {
      const g = ctx.createLinearGradient(x, 0, x + 32, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.6)');
      g.addColorStop(0.5, 'rgba(90,110,140,0.35)');
      g.addColorStop(1, 'rgba(0,0,0,0.6)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 32, h);
    }
    for (let y = 0; y < h; y += 42) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, y, w, 4);
    }
  });
}

function windowTexture(kind) {
  return canvasTex(256, 256, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w * 0.5, h * 0.62, 10, w * 0.5, h * 0.5, w * 0.75);
    g.addColorStop(0, '#ffe2a0');
    g.addColorStop(0.5, '#f5a040');
    g.addColorStop(1, '#a84a12');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // drifting silhouettes behind paper
    ctx.fillStyle = 'rgba(90,35,8,0.35)';
    for (let i = 0; i < 3; i++) {
      const x = R(w * 0.8, w * 0.2);
      ctx.beginPath(); ctx.ellipse(x, h * 0.95, R(40, 22), R(110, 60), 0, 0, 7); ctx.fill();
    }
    ctx.strokeStyle = '#1a0f08';
    ctx.lineWidth = 7;
    if (kind === 'door') {
      for (let x = 0; x <= w; x += w / 6) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h * 0.55); ctx.stroke(); }
      for (let y = 0; y <= h * 0.55; y += h / 8) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      ctx.fillStyle = '#1c110a';
      ctx.fillRect(0, h * 0.58, w, h * 0.42);
      ctx.fillRect(w / 2 - 5, 0, 10, h);
    } else {
      // diamond lattice
      for (let i = -4; i <= 8; i++) {
        ctx.beginPath(); ctx.moveTo(i * 48, 0); ctx.lineTo(i * 48 + h, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(i * 48, 0); ctx.lineTo(i * 48 - h, h); ctx.stroke();
      }
    }
    ctx.lineWidth = 16;
    ctx.strokeRect(0, 0, w, h);
  });
}

function lanternTexture() {
  return canvasTex(128, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#d8641c');
    g.addColorStop(0.5, '#ffd27a');
    g.addColorStop(1, '#c8500f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(70,20,5,0.55)';
    ctx.lineWidth = 3;
    for (let x = 0; x <= w; x += 16) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  });
}

export function glowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.35)') {
  const t = canvasTex(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.3, mid);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function puffTexture() {
  const t = canvasTex(128, 128, (ctx, w, h) => {
    for (let i = 0; i < 26; i++) {
      const x = w / 2 + R(46, -46) * 0.8;
      const y = h / 2 + R(46, -46) * 0.8;
      const r = R(30, 12);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.16)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    // soft circular mask
    ctx.globalCompositeOperation = 'destination-in';
    const m = ctx.createRadialGradient(w / 2, h / 2, 8, w / 2, h / 2, w / 2);
    m.addColorStop(0, 'rgba(0,0,0,1)');
    m.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = m;
    ctx.fillRect(0, 0, w, h);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function signTexture(text) {
  const t = canvasTex(256, 96, (ctx, w, h) => {
    ctx.fillStyle = '#1d120b';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#8a6a2c';
    ctx.lineWidth = 6;
    ctx.strokeRect(5, 5, w - 10, h - 10);
    ctx.fillStyle = '#e8c06a';
    ctx.font = 'bold 58px "KaiTi","STKaiti","Kaiti SC","Songti SC","SimSun",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 4);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ------------------------------------------------------------------ helpers

function gearGeometry(radius, teeth, depth) {
  const sh = new THREE.Shape();
  const n = teeth * 4;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = (i % 4 < 2) ? radius : radius * 0.86;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) sh.moveTo(x, y); else sh.lineTo(x, y);
  }
  const spokes = 5;
  for (let s = 0; s < spokes; s++) {
    const a0 = (s / spokes) * Math.PI * 2 + 0.16;
    const a1 = ((s + 1) / spokes) * Math.PI * 2 - 0.16;
    const hole = new THREE.Path();
    const ri = radius * 0.28;
    const ro = radius * 0.68;
    hole.moveTo(Math.cos(a0) * ri, Math.sin(a0) * ri);
    for (let k = 0; k <= 8; k++) { const a = a0 + ((a1 - a0) * k) / 8; hole.lineTo(Math.cos(a) * ro, Math.sin(a) * ro); }
    for (let k = 8; k >= 0; k--) { const a = a0 + ((a1 - a0) * k) / 8; hole.lineTo(Math.cos(a) * ri, Math.sin(a) * ri); }
    sh.holes.push(hole);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
}

// ------------------------------------------------------------------ build

export function buildWorld(scene, quality) {
  const low = quality === 'low';
  const Y = ARENA.yard;
  const L = ARENA.lane;
  const world = { lanterns: [], gears: [], chains: [], emitters: [], flickers: [] };

  scene.background = new THREE.Color(0x060a12);
  scene.fog = new THREE.FogExp2(0x0b1220, 0.024);

  // ---- lights: cold moon + sky against warm lanterns
  const hemi = new THREE.HemisphereLight(0x5f7fae, 0x141018, 0.75);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0x86a8e0, 1.25);
  moon.position.set(-9, 20, 7);
  moon.target.position.set(0, 0, 0);
  scene.add(moon, moon.target);
  if (!low) {
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const sc = moon.shadow.camera;
    sc.left = -17; sc.right = 17; sc.top = 17; sc.bottom = -17; sc.near = 1; sc.far = 50;
    moon.shadow.bias = -0.0015;
    moon.shadow.normalBias = 0.04;
  }

  const M = (o) => new THREE.MeshStandardMaterial(o);
  const fl = flagstoneTextures();
  fl.map.repeat.set(9, 9); fl.rough.repeat.set(9, 9);
  const groundMat = M({ map: fl.map, roughnessMap: fl.rough, roughness: 1, metalness: 0.0, color: 0xc8d4ea });
  const plasterT = plasterTexture();
  const plaster = M({ map: plasterT, roughness: 0.9, color: 0xaab4c4 });
  const timberT = timberTexture();
  const timber = M({ map: timberT, roughness: 0.75, color: 0xb09a88 });
  const darkWood = M({ color: 0x1c130d, roughness: 0.8 });
  const roofT = roofTexture();
  roofT.repeat.set(10, 1);
  const roof = M({ map: roofT, roughness: 0.35, metalness: 0.1, color: 0x9fb0cc });
  const iron = M({ color: 0x20242b, roughness: 0.45, metalness: 0.85 });
  const copper = M({ color: 0x9a5a2c, roughness: 0.38, metalness: 0.9 });
  const brass = M({ color: 0xb08a3c, roughness: 0.35, metalness: 0.9 });
  const stone = M({ color: 0x3a424e, roughness: 0.8 });
  const winT = windowTexture('lattice');
  const doorT = windowTexture('door');
  winT.wrapS = winT.wrapT = doorT.wrapS = doorT.wrapT = THREE.ClampToEdgeWrapping;
  const winMat = new THREE.MeshBasicMaterial({ map: winT, color: 0xffffff, fog: false });
  const winDim = new THREE.MeshBasicMaterial({ map: winT, color: 0xb08860 });
  const doorMat = new THREE.MeshBasicMaterial({ map: doorT, color: 0xf0d8c0 });
  const lanT = lanternTexture();
  const lanMat = new THREE.MeshBasicMaterial({ map: lanT, color: 0xffffff, fog: false });
  const glowT = glowTexture();
  const warmGlow = new THREE.SpriteMaterial({ map: glowT, color: 0xff9a3c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55, fog: false });
  const floorGlowMat = new THREE.MeshBasicMaterial({ map: glowT, color: 0xff8a30, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.3, fog: false });

  const add = (mesh, cast = true, recv = true) => {
    mesh.castShadow = cast && !low; mesh.receiveShadow = recv && !low;
    scene.add(mesh);
    return mesh;
  };
  const box = (w, h, d, mat, x, y, z, parent) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    if (parent) { parent.add(m); m.castShadow = !low; m.receiveShadow = !low; } else add(m);
    return m;
  };
  const cyl = (rt, rb, h, mat, x, y, z, parent, seg = 14) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.position.set(x, y, z);
    if (parent) { parent.add(m); m.castShadow = !low; m.receiveShadow = !low; } else add(m);
    return m;
  };
  const floorGlow = (x, z, sx, sz, op = 0.3, color = 0xff8a30) => {
    const mat = floorGlowMat.clone();
    mat.opacity = op; mat.color.set(color);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.03, z);
    m.scale.set(sx, sz, 1);
    m.renderOrder = 1;
    scene.add(m);
    return m;
  };

  // ---- ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(72, 72), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 4);
  ground.receiveShadow = !low;
  scene.add(ground);

  // ---- lanterns
  let lightBudget = low ? 4 : 8;
  function lantern(x, y, z, opts = {}) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.46, 10), lanMat);
    body.position.y = -0.42;
    g.add(body);
    cyl(0.14, 0.22, 0.08, darkWood, 0, -0.16, 0, g, 10);
    cyl(0.22, 0.12, 0.08, darkWood, 0, -0.68, 0, g, 10);
    cyl(0.012, 0.012, 0.16, iron, 0, -0.06, 0, g, 4);
    cyl(0.02, 0.005, 0.28, new THREE.MeshBasicMaterial({ color: 0xa02818 }), 0, -0.86, 0, g, 4);
    const sp = new THREE.Sprite(warmGlow);
    sp.scale.setScalar(opts.glow ?? 2.6);
    sp.position.y = -0.42;
    g.add(sp);
    scene.add(g);
    let light = null;
    if (opts.light && lightBudget > 0) {
      lightBudget--;
      light = new THREE.PointLight(opts.color ?? 0xff9440, opts.intensity ?? 26, opts.range ?? 15, 1.8);
      light.position.set(x + (opts.lx ?? 0), y - 0.5, z + (opts.lz ?? 0));
      scene.add(light);
    }
    const rec = { g, light, base: opts.intensity ?? 26, ph: R(10) };
    world.lanterns.push(rec);
    return rec;
  }
  const bracket = (x, y, z, dx, dz, len = 0.5) => {
    const b = box(Math.abs(dx) * len + 0.06, 0.06, Math.abs(dz) * len + 0.06, iron, x - dx * len * 0.5, y, z - dz * len * 0.5);
    b.castShadow = false;
  };

  // ---- north: the tavern, 醉轮居
  {
    const z0 = Y.minZ; // inner face
    box(24.4, 3.7, 1.0, plaster, 0, 1.85, z0 - 0.5);
    box(24.4, 0.5, 1.1, stone, 0, 0.25, z0 - 0.47);
    for (let x = -11; x <= 11.01; x += 2.75) box(0.26, 3.7, 0.2, timber, x, 1.85, z0 + 0.06);
    box(24.4, 0.26, 0.2, timber, 0, 3.3, z0 + 0.07);
    box(24.4, 0.2, 0.2, timber, 0, 1.0, z0 + 0.07);
    // door
    const door = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.7), doorMat);
    door.position.set(0, 1.4, z0 + 0.02);
    scene.add(door);
    box(2.7, 0.24, 0.3, darkWood, 0, 2.86, z0 + 0.1);
    box(0.22, 2.8, 0.3, darkWood, -1.22, 1.4, z0 + 0.1);
    box(0.22, 2.8, 0.3, darkWood, 1.22, 1.4, z0 + 0.1);
    box(3.0, 0.16, 0.9, stone, 0, 0.08, z0 + 0.45);
    floorGlow(0, z0 + 2.2, 3.4, 5.5, 0.34);
    // windows
    for (const x of [-8.25, -5.5, 5.5, 8.25]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.4), winMat);
      w.position.set(x, 2.05, z0 + 0.02);
      scene.add(w);
      box(1.95, 0.12, 0.16, darkWood, x, 1.3, z0 + 0.1);
      floorGlow(x, z0 + 1.9, 2.4, 4.2, 0.2);
    }
    // sign
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.7), new THREE.MeshBasicMaterial({ map: signTexture('醉轮居') }));
    sign.position.set(0, 3.32, z0 + 0.2);
    scene.add(sign);
    // lower eave, cantilevered on brackets
    const eave = box(25, 0.16, 2.5, roof, 0, 3.86, z0 + 0.95);
    eave.rotation.x = 0.3;
    for (let x = -11; x <= 11.01; x += 2.75) {
      const br = box(0.14, 0.14, 1.5, darkWood, x, 3.62, z0 + 0.7);
      br.rotation.x = 0.3;
    }
    // upper storey, set back
    box(22, 2.7, 3, plaster, 0, 5.2, z0 - 2.0);
    for (let x = -9.6; x <= 9.61; x += 3.2) box(0.24, 2.7, 0.16, timber, x, 5.2, z0 - 0.46);
    for (const x of [-8, -4.8, -1.6, 1.6, 4.8, 8]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.0), x === 1.6 ? winMat : winDim);
      w.position.set(x, 5.25, z0 - 0.47);
      scene.add(w);
    }
    const r1 = box(24, 0.2, 3.2, roof, 0, 7.0, z0 - 0.9);
    r1.rotation.x = 0.42;
    const r2 = box(24, 0.2, 3.2, roof, 0, 7.0, z0 - 3.4);
    r2.rotation.x = -0.42;
    box(24.4, 0.3, 0.4, darkWood, 0, 7.72, z0 - 2.15);
    lantern(-1.75, 3.25, z0 + 0.75, { light: true, intensity: 34, lx: 1.75, lz: 0.6, range: 18 });
    lantern(1.75, 3.25, z0 + 0.75, {});
    lantern(-6.9, 3.2, z0 + 0.9, { glow: 2.0 });
    lantern(6.9, 3.2, z0 + 0.9, { glow: 2.0, light: !low, intensity: 14, range: 10 });
  }

  // ---- west: storehouse
  {
    const x0 = Y.minX;
    box(1.0, 3.4, 19.2, plaster, x0 - 0.5, 1.7, 0);
    box(1.1, 0.5, 19.2, stone, x0 - 0.47, 0.25, 0);
    for (let z = -9; z <= 9.01; z += 3) box(0.2, 3.4, 0.26, timber, x0 + 0.06, 1.7, z);
    box(0.2, 0.24, 19.2, timber, x0 + 0.07, 3.0, 0);
    const d = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.4), doorMat);
    d.rotation.y = Math.PI / 2;
    d.position.set(x0 + 0.02, 1.25, 1.5);
    scene.add(d);
    floorGlow(x0 + 1.9, 1.5, 4.4, 2.8, 0.2);
    for (const z of [-4.5, -1.5, 4.5]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.1), z === 4.5 ? winMat : winDim);
      w.rotation.y = Math.PI / 2;
      w.position.set(x0 + 0.02, 2.0, z);
      scene.add(w);
      if (z === 4.5) floorGlow(x0 + 1.7, z, 3.6, 2.2, 0.16);
    }
    const eave = box(2.4, 0.16, 20.4, roof.clone(), x0 + 0.85, 3.55, 0);
    eave.material.map = roofT.clone();
    eave.material.map.rotation = Math.PI / 2;
    eave.material.map.repeat.set(8, 1);
    eave.rotation.z = -0.3;
    const top = box(3.4, 0.2, 20.4, roof, x0 - 1.9, 4.2, 0);
    top.rotation.z = 0.25;
    lantern(x0 + 0.85, 3.0, 0.0, { light: true, intensity: 22, lx: 0.8 });
    // barrel stack (NW obstacle)
    const bm = M({ map: timberT, color: 0x8a6a50, roughness: 0.7 });
    const barrel = (x, y, z, r = 0.5, h = 1.05) => {
      const b = cyl(r * 0.88, r * 0.88, h, bm, x, y, z, null, 12);
      const mid = cyl(r, r, h * 0.45, bm, x, y, z, null, 12);
      for (const yy of [-0.32, 0.32]) cyl(r * 0.97, r * 0.97, 0.05, iron, x, y + yy * h, z, null, 12);
      return [b, mid];
    };
    barrel(-9.9, 0.53, -7.9); barrel(-8.8, 0.53, -7.9); barrel(-9.9, 0.53, -6.8); barrel(-8.85, 0.53, -6.85);
    barrel(-9.4, 1.58, -7.4);
    // rain vat (SW obstacle)
    cyl(1.0, 0.85, 1.0, bm, -9.6, 0.5, 7.5, null, 16);
    cyl(1.02, 1.02, 0.07, iron, -9.6, 0.8, 7.5, null, 16);
    cyl(0.9, 0.9, 0.02, M({ color: 0x05080d, roughness: 0.03, metalness: 0.2 }), -9.6, 0.97, 7.5, null, 16);
  }

  // ---- east: plain wall dressed with pipework, boiler in the NE corner
  {
    const x0 = Y.maxX;
    box(0.8, 4.3, 19.2, plaster, x0 + 0.4, 2.15, 0);
    box(0.9, 0.5, 19.2, stone, x0 + 0.37, 0.25, 0);
    const cap = box(1.5, 0.16, 19.6, roof, x0 + 0.4, 4.42, 0);
    cap.material = eaveMat(roofT, 8);
    // pipes
    const pipe = (y, r, z0, z1, off = 0.28) => {
      const p = cyl(r, r, z1 - z0, copper, x0 - off, y, (z0 + z1) / 2, null, 10);
      p.rotation.x = Math.PI / 2;
      for (let z = z0 + 0.6; z < z1; z += 2.3) {
        const f = cyl(r * 1.5, r * 1.5, 0.1, brass, x0 - off, y, z, null, 10);
        f.rotation.x = Math.PI / 2;
      }
    };
    pipe(1.1, 0.16, -5.5, 6.8);
    pipe(2.05, 0.11, -5.5, 4.0);
    pipe(3.0, 0.2, -6.5, 7.6);
    for (const z of [-3.2, 1.2, 5.4]) cyl(0.09, 0.09, 1.9, copper, x0 - 0.28, 2.05, z, null, 8);
    cyl(0.16, 0.16, 1.1, copper, x0 - 0.28, 0.55, 6.8, null, 8);
    // valve wheels
    for (const [y, z] of [[1.55, -1.0], [2.5, 3.0]]) {
      const w = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.035, 6, 16), iron);
      w.rotation.y = Math.PI / 2;
      w.position.set(x0 - 0.55, y, z);
      add(w);
      const s1 = box(0.03, 0.5, 0.03, iron, x0 - 0.55, y, z);
      const s2 = box(0.03, 0.03, 0.5, iron, x0 - 0.55, y, z);
      void s1; void s2;
      box(0.3, 0.05, 0.05, iron, x0 - 0.42, y, z);
    }
    // pressure gauge with a cold glow
    const gauge = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16), new THREE.MeshBasicMaterial({ color: 0x9fe8ff }));
    gauge.rotation.y = -Math.PI / 2;
    gauge.position.set(x0 - 0.5, 2.05, 1.2);
    scene.add(gauge);
    cyl(0.24, 0.24, 0.08, brass, x0 - 0.46, 2.05, 1.2).rotation.z = Math.PI / 2;
    world.emitters.push({ x: x0 - 0.5, y: 3.05, z: -3.2, vx: -0.5, vy: 0.9, rate: 2.2 });
    world.emitters.push({ x: x0 - 0.45, y: 1.2, z: 5.4, vx: -0.9, vy: 0.4, rate: 1.4 });
    lantern(x0 - 0.75, 4.25, 3.6, { light: true, intensity: 20, lx: -0.6 });
    bracket(x0 - 0.75, 4.27, 3.6, -1, 0, 0.8);

    // boiler (NE obstacle)
    const bx = 9.2, bz = -7.1;
    cyl(1.15, 1.25, 2.5, copper, bx, 1.25, bz, null, 18);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.15, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), copper);
    dome.position.set(bx, 2.5, bz);
    add(dome);
    for (const y of [0.5, 1.4, 2.3]) cyl(1.22, 1.22, 0.09, brass, bx, y, bz, null, 18);
    cyl(0.22, 0.22, 4.2, iron, bx + 0.3, 5.2, bz - 0.3, null, 10);
    cyl(0.3, 0.3, 0.2, brass, bx + 0.3, 7.3, bz - 0.3, null, 10);
    const fire = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.5), new THREE.MeshBasicMaterial({ color: 0xff6a1c, fog: false }));
    const fa = Math.atan2(-bx, -bz);
    fire.position.set(bx + Math.sin(fa) * 1.22, 0.75, bz + Math.cos(fa) * 1.22);
    fire.rotation.y = fa;
    scene.add(fire);
    const grate = box(0.8, 0.06, 0.05, iron, fire.position.x, 0.75, fire.position.z);
    grate.rotation.y = fa;
    const fl2 = new THREE.PointLight(0xff5a18, 20, 11, 1.8);
    fl2.position.set(bx + Math.sin(fa) * 1.9, 0.9, bz + Math.cos(fa) * 1.9);
    scene.add(fl2);
    world.flickers.push({ light: fl2, base: 20, mesh: fire });
    floorGlow(bx + Math.sin(fa) * 2.6, bz + Math.cos(fa) * 2.6, 3.6, 3.6, 0.3, 0xff5a18);
    world.emitters.push({ x: bx + 0.3, y: 7.5, z: bz - 0.3, vx: 0.3, vy: 1.6, rate: 3.5, big: true });
    world.emitters.push({ x: bx - 1.0, y: 2.3, z: bz + 0.8, vx: -0.5, vy: 0.8, rate: 1.2 });
    // feed pipe from boiler to wall run
    const fp = cyl(0.2, 0.2, 1.4, copper, 10.2, 3.0, -6.6, null, 10);
    fp.rotation.x = Math.PI / 2;

    // crates under a tarp (SE obstacle)
    const cm = M({ map: timberT, color: 0x7a644e, roughness: 0.85 });
    box(1.2, 1.0, 1.2, cm, 9.7, 0.5, 7.7).rotation.y = 0.2;
    box(1.0, 0.8, 1.0, cm, 9.2, 0.4, 6.9).rotation.y = -0.3;
    box(0.9, 0.8, 0.9, cm, 9.75, 1.4, 7.75).rotation.y = 0.5;
  }

  function eaveMat(tex, rep) {
    const m = roof.clone();
    m.map = tex.clone();
    m.map.rotation = Math.PI / 2;
    m.map.repeat.set(rep, 1);
    return m;
  }

  // ---- south wall, gate and the entry lane
  {
    const z0 = Y.maxZ;
    for (const s of [-1, 1]) {
      const x = s * (L.maxX + (11.8 - L.maxX) / 2);
      const w = 11.8 - L.maxX;
      box(w, 4.2, 0.8, plaster, x, 2.1, z0 + 0.4);
      box(w, 0.5, 0.9, stone, x, 0.25, z0 + 0.38);
      box(w + 0.2, 0.16, 1.5, roof, x, 4.3, z0 + 0.4);
      // lane walls
      box(0.7, 3.9, 9.4, plaster, s * (L.maxX + 0.35), 1.95, z0 + 0.8 + 4.7);
      box(1.2, 0.14, 9.4, roof, s * (L.maxX + 0.35), 3.97, z0 + 0.8 + 4.7).material = eaveMat(roofT, 5);
    }
    box(4.6, 5.2, 0.7, plaster, 0, 2.6, L.maxZ + 0.35);
    const ld = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.3), new THREE.MeshBasicMaterial({ color: 0x120c08 }));
    ld.rotation.y = Math.PI;
    ld.position.set(0, 1.15, L.maxZ - 0.01);
    scene.add(ld);
    // gate frame
    for (const s of [-1, 1]) box(0.42, 4.4, 0.6, darkWood, s * (L.maxX + 0.2), 2.2, z0 + 0.4);
    box(4.6, 0.42, 0.7, darkWood, 0, 4.2, z0 + 0.4);
    const gr = box(5.6, 0.18, 2.2, roof, 0, 4.75, z0 + 0.4);
    gr.material = roof;
    box(5.0, 0.24, 0.3, darkWood, 0, 4.95, z0 + 0.4);
    // portcullis of iron bars, dropped on chains when the duel begins
    const gate = new THREE.Group();
    for (let x = -1.4; x <= 1.41; x += 0.4) cyl(0.045, 0.045, 3.4, iron, x, 1.7, 0, gate, 6);
    for (const y of [0.5, 1.7, 2.9]) box(3.2, 0.09, 0.09, iron, 0, y, 0, gate);
    for (let x = -1.4; x <= 1.41; x += 0.4) {
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 6), iron);
      tip.rotation.x = Math.PI;
      tip.position.set(x, 0.0, 0);
      gate.add(tip);
    }
    gate.position.set(0, 3.5, z0 + 0.3);
    scene.add(gate);
    world.gate = gate;
    const sgn = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.55), new THREE.MeshBasicMaterial({ map: signTexture('雨巷') }));
    sgn.rotation.y = 0;
    sgn.position.set(0, 4.2, z0 + 0.77);
    scene.add(sgn);
    // lane lanterns
    lantern(-1.25, 3.2, 11.6, { light: true, intensity: 20, lx: 0.5, range: 12 });
    bracket(-1.25, 3.22, 11.6, -1, 0, 0.4);
    lantern(1.25, 3.2, 14.4, { light: true, intensity: 20, lx: -0.5, range: 12 });
    bracket(1.25, 3.22, 14.4, 1, 0, 0.4);
    lantern(-1.25, 3.2, 17.0, {});
    floorGlow(0, 11.6, 3, 4, 0.22); floorGlow(0, 14.4, 3, 4, 0.22); floorGlow(0, 17, 3, 3, 0.15);
    // yard-side gate lanterns
    lantern(-2.5, 4.55, z0 - 0.45, { light: true, intensity: 24, lx: 2.5, lz: -0.8 });
    lantern(2.5, 4.55, z0 - 0.45, {});
    floorGlow(0, z0 - 2, 6.5, 4, 0.2);
  }

  // ---- hanging chains (each sways as one piece)
  {
    const linkG = new THREE.TorusGeometry(0.075, 0.022, 5, 8);
    const chain = (x, y, z, n, hook = true) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      const im = new THREE.InstancedMesh(linkG, iron, n);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      for (let i = 0; i < n; i++) {
        e.set(0, i % 2 ? Math.PI / 2 : 0, 0);
        q.setFromEuler(e);
        m4.compose(new THREE.Vector3(0, -0.07 - i * 0.115, 0), q, new THREE.Vector3(1, 1.25, 1));
        im.setMatrixAt(i, m4);
      }
      g.add(im);
      if (hook) {
        const h = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 5, 10, Math.PI * 1.4), iron);
        h.position.y = -0.1 - n * 0.115 - 0.1;
        g.add(h);
      }
      scene.add(g);
      world.chains.push({ g, ph: R(10), amp: R(0.05, 0.02) });
    };
    // gantry beam on the east wall
    box(2.0, 0.16, 0.16, iron, 10.1, 4.0, -2.2);
    box(2.0, 0.16, 0.16, iron, 10.1, 4.0, -0.4);
    chain(9.4, 3.95, -2.2, 16); chain(10.2, 3.95, -2.2, 9);
    chain(9.6, 3.95, -0.4, 12); chain(10.4, 3.95, -0.4, 20, false);
    chain(-10.3, 3.2, 5.6, 13); chain(-10.3, 3.2, 6.3, 8);
    chain(-1.45, 4.0, Y.maxZ + 0.05, 5, false); chain(1.45, 4.0, Y.maxZ + 0.05, 5, false);
  }

  // ---- the gear tower beyond the wall: a slow silhouette against a cold haze
  {
    const sil = new THREE.MeshBasicMaterial({ color: 0x04070c, fog: false });
    const sil2 = new THREE.MeshBasicMaterial({ color: 0x0a111c, fog: false });
    const tower = new THREE.Group();
    tower.position.set(19, 0, -24);
    tower.rotation.y = -0.65;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.8, 22, 6), sil);
    body.position.y = 11;
    tower.add(body);
    const capT = new THREE.Mesh(new THREE.ConeGeometry(4.4, 3.2, 6), sil);
    capT.position.y = 23.6;
    tower.add(capT);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(8, 0.5, 8), sil);
    deck.position.y = 13.5;
    tower.add(deck);
    const g1 = new THREE.Mesh(gearGeometry(5.2, 14, 0.6), sil2);
    g1.position.set(0, 15.2, 3.9);
    tower.add(g1);
    const g2 = new THREE.Mesh(gearGeometry(2.7, 8, 0.6), sil);
    g2.position.set(6.7, 19.6, 3.6);
    tower.add(g2);
    const g3 = new THREE.Mesh(gearGeometry(2.0, 7, 0.5), sil);
    g3.position.set(-5.9, 11.0, 3.5);
    tower.add(g3);
    world.gears.push({ m: g1, s: 0.12 }, { m: g2, s: -0.12 * (14 / 8) }, { m: g3, s: -0.12 * 2 });
    const arm = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 0.5), sil);
    arm.position.set(-3, 21.5, 0);
    arm.rotation.z = 0.25;
    tower.add(arm);
    const haze = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, color: 0x38557e, transparent: true, opacity: 0.9, depthWrite: false, fog: false }));
    haze.scale.set(46, 40, 1);
    haze.position.set(0, 15, -6);
    haze.renderOrder = -2;
    tower.add(haze);
    const lamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, color: 0xff7a2a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
    lamp.scale.setScalar(2.4);
    lamp.position.set(0, 15.2, 4.4);
    tower.add(lamp);
    world.towerLamp = lamp;
    const tw = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.6), new THREE.MeshBasicMaterial({ color: 0xffa040, fog: false }));
    tw.position.set(0.5, 7.5, 3.3);
    tower.add(tw);
    scene.add(tower);
    world.tower = tower;
    // distant roofline silhouettes
    for (let i = 0; i < 9; i++) {
      const w = R(9, 4);
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, R(9, 5), 4), sil);
      b.position.set(-32 + i * 8 + R(2), 3, -30 - R(6));
      scene.add(b);
    }
  }

  // ---- low mist banks hugging the walls
  {
    const pt = puffTexture();
    world.mist = [];
    const n = low ? 6 : 12;
    for (let i = 0; i < n; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: pt, color: 0x90a8c8, transparent: true, opacity: 0.2, depthWrite: false }));
      const a = (i / n) * Math.PI * 2;
      const rx = 9.5 + R(2), rz = 7.5 + R(2);
      sp.position.set(Math.cos(a) * rx, R(1.4, 0.5), Math.sin(a) * rz);
      sp.scale.set(R(11, 7), R(4.5, 3), 1);
      scene.add(sp);
      world.mist.push({ sp, a, rx, rz, sp0: R(0.03, 0.012) * (R() < 0.5 ? -1 : 1), y: sp.position.y, ph: R(10) });
    }
  }

  const bolt = { t: -1, next: 14 + R(10) };
  const skyBase = new THREE.Color(0x060a12);
  const fogBase = new THREE.Color(0x0b1220);
  const skyFlash = new THREE.Color(0x4a628c);
  world.update = (dt, time, gateClosed) => {
    for (const l of world.lanterns) {
      l.g.rotation.z = Math.sin(time * 1.3 + l.ph) * 0.05;
      l.g.rotation.x = Math.cos(time * 1.1 + l.ph * 2) * 0.04;
      if (l.light) l.light.intensity = l.base * (0.9 + 0.1 * Math.sin(time * 9 + l.ph) * Math.sin(time * 3.7 + l.ph));
    }
    for (const f of world.flickers) {
      const k = 0.8 + 0.2 * Math.sin(time * 13) * Math.sin(time * 5.3) + 0.08 * Math.sin(time * 31);
      f.light.intensity = f.base * k;
    }
    for (const g of world.gears) g.m.rotation.z += g.s * dt;
    for (const c of world.chains) {
      c.g.rotation.z = Math.sin(time * 0.9 + c.ph) * c.amp;
      c.g.rotation.x = Math.cos(time * 0.7 + c.ph) * c.amp * 0.6;
    }
    for (const m of world.mist) {
      m.a += m.sp0 * dt;
      m.sp.position.set(Math.cos(m.a) * m.rx, m.y + Math.sin(time * 0.3 + m.ph) * 0.2, Math.sin(m.a) * m.rz);
    }
    world.towerLamp.material.opacity = 0.55 + 0.45 * Math.sin(time * 1.4);
    // distant sheet lightning: a brief cold flicker that throws the gear tower into silhouette
    if (time > bolt.next) {
      bolt.t = 0;
      bolt.next = time + 22 + R(30);
      if (world.onBolt) world.onBolt();
    }
    if (bolt.t >= 0) {
      bolt.t += dt;
      const b = bolt.t;
      const k = b < 0.07 ? 1 : b < 0.15 ? 0.15 : b < 0.26 ? 0.75 : Math.max(0, 1 - (b - 0.26) / 0.6) * 0.45;
      hemi.intensity = 0.75 + k * 1.6;
      scene.background.copy(skyBase).lerp(skyFlash, k * 0.7);
      scene.fog.color.copy(fogBase).lerp(skyFlash, k * 0.5);
      if (b > 0.9) { bolt.t = -1; hemi.intensity = 0.75; scene.background.copy(skyBase); scene.fog.color.copy(fogBase); }
    }
    const target = gateClosed ? 0.05 : 3.5;
    const gy = world.gate.position.y;
    world.gate.position.y = gateClosed ? Math.max(target, gy - 9 * dt) : Math.min(target, gy + 2.5 * dt);
  };
  return world;
}
