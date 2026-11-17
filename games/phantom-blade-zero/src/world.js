// Procedural rainy-night tavern courtyard: every mesh and texture is generated here.
import * as THREE from 'three/webgpu';
import { ARENA, mulberry32 } from './sim.js';
import { canvasTex, normalFromHeight, speckle, blotches, detailMaps } from './tex.js';

const rnd = mulberry32(20240);
const R = (a = 1, b = 0) => b + rnd() * (a - b);

// ------------------------------------------------------------------ textures

// Wet flagstones: colour, roughness and a normal map drawn from the same stone layout, so the
// joints are dark and recessed, each slab has its own tilt and wear, and puddles lie flat and glossy.
function flagstoneTextures() {
  const S = 1024;
  const stones = [];
  const rows = 10;
  const rh = S / rows;
  for (let r = 0; r < rows; r++) {
    let x = -R(120);
    while (x < S) {
      const w = R(200, 96);
      stones.push({ x, y: r * rh, w, h: rh, tone: R(), wet: R(), tilt: R(6.3), amt: R(26, 4) });
      x += w;
    }
  }
  // stones that start left of the tile also appear at the right edge, so the texture tiles
  for (const s of stones.slice()) if (s.x < 0) stones.push({ ...s, x: s.x + S });
  const puddles = [];
  // each puddle is a small cluster of overlapping pools, so the outline is irregular
  for (let i = 0; i < 12; i++) {
    const x = R(S), y = R(S);
    for (let k = 0; k < 4; k++) puddles.push({ x: x + R(60, -60), y: y + R(40, -40), rx: R(52, 16), ry: R(30, 10), a: R(3) });
  }
  const eachPuddle = (ctx, fn) => {
    for (const p of puddles) for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      if (p.x + ox < -130 || p.x + ox > S + 130 || p.y + oy < -130 || p.y + oy > S + 130) continue;
      ctx.save();
      ctx.translate(p.x + ox, p.y + oy); ctx.rotate(p.a); ctx.scale(p.rx, p.ry);
      fn();
      ctx.restore();
    }
  };
  const slab = (ctx, s, inset, rad) => { ctx.beginPath(); ctx.roundRect(s.x + inset, s.y + inset, s.w - inset * 2, s.h - inset * 2, rad); ctx.fill(); };
  const map = canvasTex(S, S, (ctx) => {
    ctx.fillStyle = '#060708';
    ctx.fillRect(0, 0, S, S);
    for (const s of stones) {
      const l = 44 + s.tone * 30;
      const warm = (s.wet - 0.5) * 5;
      ctx.fillStyle = `rgb(${l * 0.97 + warm},${l * 0.98},${l * 1.03 - warm})`;
      slab(ctx, s, 3, 7);
    }
    blotches(ctx, S, S, 160, 20, 90, 0.07, true);
    blotches(ctx, S, S, 220, 14, 70, 0.16, false);
    speckle(ctx, S, S, 9000, 0.1, true, 2);
    speckle(ctx, S, S, 12000, 0.3, false, 2);
    // hairline cracks
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
    for (let i = 0; i < 46; i++) {
      let x = R(S), y = R(S);
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += R(26, -26); y += R(22, -22); ctx.lineTo(x, y); }
      ctx.stroke();
    }
    // re-darken the joints over the mottling
    ctx.strokeStyle = 'rgba(3,4,5,0.85)'; ctx.lineWidth = 5;
    for (const s of stones) { ctx.beginPath(); ctx.roundRect(s.x, s.y, s.w, s.h, 6); ctx.stroke(); }
    eachPuddle(ctx, () => {
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      gr.addColorStop(0, 'rgba(6,8,11,0.3)'); gr.addColorStop(0.7, 'rgba(6,8,11,0.22)'); gr.addColorStop(1, 'rgba(6,8,11,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, 7); ctx.fill();
    });
  });
  const rough = canvasTex(S, S, (ctx) => {
    ctx.fillStyle = 'rgb(150,150,150)'; // joints: gritty
    ctx.fillRect(0, 0, S, S);
    for (const s of stones) {
      const v = 62 + s.wet * 58; // wet slabs: 0.24 – 0.47
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      slab(ctx, s, 4, 7);
    }
    blotches(ctx, S, S, 140, 16, 70, 0.14, true);
    blotches(ctx, S, S, 140, 16, 70, 0.2, false);
    speckle(ctx, S, S, 6000, 0.14, true, 2);
    eachPuddle(ctx, () => {
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      gr.addColorStop(0, 'rgba(34,34,34,1)'); gr.addColorStop(0.7, 'rgba(34,34,34,0.9)'); gr.addColorStop(1, 'rgba(34,34,34,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, 7); ctx.fill();
    });
  }, false);
  const normal = normalFromHeight(S, S, (ctx) => {
    ctx.fillStyle = 'rgb(40,40,40)';
    ctx.fillRect(0, 0, S, S);
    for (const s of stones) {
      // each slab is a shallow tilted plane with rounded shoulders
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      const dx = Math.cos(s.tilt) * s.w * 0.5, dy = Math.sin(s.tilt) * s.h * 0.5;
      for (const [inset, add] of [[2, -60], [4, -28], [6, -10], [8, 0]]) {
        const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
        const b = 170 + add;
        g.addColorStop(0, `rgb(${b - s.amt},${b - s.amt},${b - s.amt})`);
        g.addColorStop(1, `rgb(${b + s.amt},${b + s.amt},${b + s.amt})`);
        ctx.fillStyle = g;
        slab(ctx, s, inset, 8);
      }
    }
    blotches(ctx, S, S, 300, 6, 30, 0.1, true);
    blotches(ctx, S, S, 400, 4, 22, 0.14, false);
    speckle(ctx, S, S, 14000, 0.16, false, 2);
    eachPuddle(ctx, () => { // standing water fills to a level surface
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      gr.addColorStop(0, 'rgba(150,150,150,1)'); gr.addColorStop(0.82, 'rgba(150,150,150,1)'); gr.addColorStop(1, 'rgba(150,150,150,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, 7); ctx.fill();
    });
  }, 3.2);
  return { map, rough, normal };
}

function plasterTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#565a60';
    ctx.fillRect(0, 0, w, h);
    blotches(ctx, w, h, 60, 20, 90, 0.07, true);
    blotches(ctx, w, h, 80, 20, 90, 0.12, false);
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

function grainStreaks(ctx, w, h, n, light, dark) {
  for (let i = 0; i < n; i++) {
    const x = R(w), ww = R(3, 0.6);
    ctx.fillStyle = R() < 0.5 ? light(R()) : dark(R());
    ctx.fillRect(x, 0, ww, h);
    if (x + ww > w) ctx.fillRect(x - w, 0, ww, h);
  }
}
function timberTexture() {
  return canvasTex(256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#2b2019';
    ctx.fillRect(0, 0, w, h);
    grainStreaks(ctx, w, h, 150, (a) => `rgba(96,72,52,${a * 0.22})`, (a) => `rgba(8,5,3,${a * 0.4})`);
    for (let i = 0; i < 5; i++) { // knots
      const x = R(w), y = R(h);
      for (let r = 12; r > 2; r -= 3) { ctx.strokeStyle = `rgba(10,6,4,${0.2 + R(0.2)})`; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.ellipse(x, y, r * 0.6, r * 1.5, 0, 0, 7); ctx.stroke(); }
    }
    for (let x = 0; x < w; x += 64) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x, 0, 3, h);
    }
  });
}
function timberNormal() {
  return normalFromHeight(256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    grainStreaks(ctx, w, h, 220, (a) => `rgba(255,255,255,${a * 0.3})`, (a) => `rgba(0,0,0,${a * 0.45})`);
    for (let x = 0; x < w; x += 64) { ctx.fillStyle = 'rgba(0,0,0,0.9)'; ctx.fillRect(x, 0, 4, h); }
  }, 2.4);
}

function roofTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#14171c';
    ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) {
      const g = ctx.createLinearGradient(x, 0, x + 32, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.65)');
      g.addColorStop(0.5, 'rgba(70,78,90,0.3)');
      g.addColorStop(1, 'rgba(0,0,0,0.65)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 32, h);
    }
    for (let y = 0; y < h; y += 42) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, y, w, 4);
    }
    speckle(ctx, w, h, 900, 0.2, false);
  });
}
function roofNormal() {
  return normalFromHeight(256, 256, (ctx, w, h) => {
    for (let x = 0; x < w; x += 32) { // half-round tiles
      const g = ctx.createLinearGradient(x, 0, x + 32, 0);
      g.addColorStop(0, '#202020'); g.addColorStop(0.5, '#e0e0e0'); g.addColorStop(1, '#202020');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 32, h);
    }
    for (let y = 0; y < h; y += 42) {
      const g = ctx.createLinearGradient(0, y, 0, y + 10);
      g.addColorStop(0, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, y, w, 10);
    }
  }, 3);
}
function plasterNormal() {
  return normalFromHeight(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    blotches(ctx, w, h, 200, 5, 26, 0.16, true);
    blotches(ctx, w, h, 200, 5, 26, 0.16, false);
    speckle(ctx, w, h, 3000, 0.2, false, 2);
  }, 1.6);
}

function windowTexture(kind) {
  return canvasTex(256, 256, (ctx, w, h) => {
    // lamplit paper: pale and uneven, brightest low down where the lamp sits
    const g = ctx.createRadialGradient(w * 0.5, h * 0.66, 10, w * 0.5, h * 0.5, w * 0.8);
    g.addColorStop(0, '#f6dba6');
    g.addColorStop(0.5, '#cf9a58');
    g.addColorStop(1, '#6e4420');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    blotches(ctx, w, h, 30, 10, 50, 0.07, false);
    // drifting silhouettes behind paper
    ctx.fillStyle = 'rgba(70,35,14,0.35)';
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
    g.addColorStop(0, '#8e4a20');
    g.addColorStop(0.55, '#f3d49a');
    g.addColorStop(1, '#a35a24');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    blotches(ctx, w, h, 14, 8, 30, 0.08, false);
    ctx.strokeStyle = 'rgba(40,16,6,0.6)';
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

  scene.background = new THREE.Color(0x05080e);
  scene.fog = new THREE.FogExp2(0x0a101a, 0.03);

  // ---- lights: a dim, cool sky and moon hold the shadows; the lanterns do the real lighting
  const HEMI = 0.2;
  const hemi = new THREE.HemisphereLight(0x51688c, 0x0c0b0d, HEMI);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0x7f9cd0, 0.5);
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
  // Three material families that must read differently: wet stone (glossy, reflective, bumpy),
  // timber and plaster (matte, grainy), metal (fully metallic, tight highlights).
  const D = detailMaps();
  const rep = (t, x, y) => { const c = t.clone(); c.repeat.set(x, y); c.needsUpdate = true; return c; };
  const V2 = (v) => new THREE.Vector2(v, v);
  for (const t of [fl.map, fl.rough, fl.normal]) t.repeat.set(9, 9);
  const groundMat = M({ map: fl.map, roughnessMap: fl.rough, normalMap: fl.normal, normalScale: V2(1.1), roughness: 1, metalness: 0, color: 0xb9bec8 });
  const plasterT = plasterTexture();
  const plasterN = plasterNormal();
  plasterN.repeat.set(3, 3);
  const plaster = M({ map: plasterT, normalMap: plasterN, normalScale: V2(0.7), roughness: 0.96, color: 0x9a9da3 });
  const timberT = timberTexture();
  const timberN = timberNormal();
  const timber = M({ map: timberT, normalMap: timberN, normalScale: V2(0.9), roughness: 0.88, color: 0xa39486 });
  const darkWood = M({ map: timberT, normalMap: timberN, normalScale: V2(0.8), color: 0x5a4a40, roughness: 0.84 });
  const roofT = roofTexture();
  roofT.repeat.set(10, 1);
  const roofN = roofNormal();
  roofN.repeat.set(10, 1);
  const roof = M({ map: roofT, normalMap: roofN, normalScale: V2(1.2), roughness: 0.34, metalness: 0, color: 0x8f98a8 });
  const iron = M({ color: 0x2b2e33, roughness: 0.5, metalness: 1, roughnessMap: rep(D.smudge, 2, 2), normalMap: rep(D.hammered, 2, 2), normalScale: V2(0.4) });
  const copper = M({ color: 0x8a5a3c, roughness: 0.36, metalness: 1, roughnessMap: rep(D.smudge, 3, 1), normalMap: rep(D.hammered, 3, 1), normalScale: V2(0.3) });
  const brass = M({ color: 0x8a7038, roughness: 0.38, metalness: 1, roughnessMap: rep(D.smudge, 2, 1) });
  const stone = M({ color: 0x43464b, roughness: 0.8, normalMap: rep(D.leather, 6, 1), normalScale: V2(1.2) });
  const winT = windowTexture('lattice');
  const doorT = windowTexture('door');
  winT.wrapS = winT.wrapT = doorT.wrapS = doorT.wrapT = THREE.ClampToEdgeWrapping;
  // emissive surfaces are given real (above-white) brightness so they tone-map like light
  // sources and show up in the reflection capture
  const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
  const winMat = new THREE.MeshBasicMaterial({ map: winT, color: hdr(0xffe6c4, 1.5) });
  const winDim = new THREE.MeshBasicMaterial({ map: winT, color: hdr(0xc8a888, 0.5) });
  const doorMat = new THREE.MeshBasicMaterial({ map: doorT, color: hdr(0xffe2c0, 1.25) });
  const lanT = lanternTexture();
  const lanMat = new THREE.MeshBasicMaterial({ map: lanT, color: hdr(0xffe4c0, 2.6), fog: false });
  const glowT = glowTexture();
  const warmGlow = new THREE.SpriteMaterial({ map: glowT, color: 0xff9c48, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.26, fog: false });
  const floorGlowMat = new THREE.MeshBasicMaterial({ map: glowT, color: 0xff8a30, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.3, fog: false });
  // things the camera can get close to (lanterns, chains, the gate) fade out near the lens
  const faders = [];
  const fadeMat = (m) => { const c = m.clone(); c.transparent = true; c.userData.base = c.opacity; return c; };

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
    mat.opacity = op * 0.3; mat.color.set(color); // only a hint: the real pools of light come from the lanterns
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
    const mats = [fadeMat(lanMat), fadeMat(darkWood), fadeMat(iron), fadeMat(new THREE.MeshStandardMaterial({ color: 0x5a1c14, roughness: 0.9 })), fadeMat(warmGlow)];
    // paper drum that bulges slightly in the middle
    const prof = [[0.12, 0.23], [0.17, 0.2], [0.2, 0.1], [0.205, 0], [0.2, -0.1], [0.17, -0.2], [0.12, -0.23]].map((p) => new THREE.Vector2(p[0], p[1]));
    const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 14), mats[0]);
    body.position.y = -0.42;
    g.add(body);
    cyl(0.1, 0.15, 0.06, mats[1], 0, -0.17, 0, g, 12);
    cyl(0.15, 0.09, 0.06, mats[1], 0, -0.67, 0, g, 12);
    cyl(0.012, 0.012, 0.16, mats[2], 0, -0.06, 0, g, 4);
    cyl(0.018, 0.004, 0.26, mats[3], 0, -0.84, 0, g, 5);
    const sp = new THREE.Sprite(mats[4]);
    sp.scale.setScalar((opts.glow ?? 2.6) * 0.7);
    sp.position.y = -0.42;
    g.add(sp);
    scene.add(g);
    faders.push({ x, z, y0: y - 0.98, y1: y, mats, a: 1 });
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
    const gauge = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16), new THREE.MeshBasicMaterial({ color: 0x5f8f96 }));
    gauge.rotation.y = -Math.PI / 2;
    gauge.position.set(x0 - 0.512, 2.05, 1.2);
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
    const gateIron = fadeMat(iron);
    world.gateFade = { mat: gateIron, z: z0 + 0.3, a: 1 };
    for (let x = -1.4; x <= 1.41; x += 0.4) cyl(0.045, 0.045, 3.4, gateIron, x, 1.7, 0, gate, 6);
    for (const y of [0.5, 1.7, 2.9]) box(3.2, 0.09, 0.09, gateIron, 0, y, 0, gate);
    for (let x = -1.4; x <= 1.41; x += 0.4) {
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 6), gateIron);
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
    lantern(-1.25, 3.2, 11.6, { light: true, intensity: 12, lx: 0.6, range: 12 });
    bracket(-1.25, 3.22, 11.6, -1, 0, 0.4);
    lantern(1.25, 3.2, 14.4, { light: true, intensity: 12, lx: -0.6, range: 12 });
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
      const cm = fadeMat(iron);
      faders.push({ x, z, y0: y - n * 0.115 - 0.3, y1: y, mats: [cm], a: 1 });
      const im = new THREE.InstancedMesh(linkG, cm, n);
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
        const h = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 5, 10, Math.PI * 1.4), cm);
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
  const skyBase = new THREE.Color(0x05080e);
  const fogBase = new THREE.Color(0x0a101a);
  const skyFlash = new THREE.Color(0x4a628c);
  const setFade = (f, a) => {
    if (Math.abs(a - f.a) < 0.004) return;
    f.a = a;
    for (const m of f.mats) m.opacity = m.userData.base * a;
  };
  world.update = (dt, time, gateClosed, camPos) => {
    if (camPos) {
      // fade anything hanging within arm's reach of the lens instead of letting the camera pass through it
      for (const f of faders) {
        const dy = camPos.y > f.y1 ? camPos.y - f.y1 : camPos.y < f.y0 ? f.y0 - camPos.y : 0;
        const d = Math.hypot(camPos.x - f.x, camPos.z - f.z, dy);
        const k = Math.max(0, Math.min(1, (d - 0.8) / 1.4));
        setFade(f, k * k * (3 - 2 * k));
      }
      const gf = world.gateFade;
      const gd = Math.abs(camPos.x) < 2.2 ? Math.abs(camPos.z - gf.z) : 9;
      const gk = Math.max(0, Math.min(1, (gd - 0.25) / 0.9));
      if (Math.abs(gk - gf.a) > 0.004) { gf.a = gk; gf.mat.opacity = gk; }
    }
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
      hemi.intensity = HEMI + k * 1.4;
      scene.background.copy(skyBase).lerp(skyFlash, k * 0.7);
      scene.fog.color.copy(fogBase).lerp(skyFlash, k * 0.5);
      if (b > 0.9) { bolt.t = -1; hemi.intensity = HEMI; scene.background.copy(skyBase); scene.fog.color.copy(fogBase); }
    }
    const target = gateClosed ? 0.05 : 3.5;
    const gy = world.gate.position.y;
    world.gate.position.y = gateClosed ? Math.max(target, gy - 9 * dt) : Math.min(target, gy + 2.5 * dt);
  };
  return world;
}
