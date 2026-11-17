// The arena: a trampled islet in a reed fen at night, lit by one low moon. All procedural.
import * as THREE from 'three/webgpu';
import { positionLocal, time, sin, vec3, instanceIndex, uv, mix, color, instancedBufferAttribute, smoothstep, cameraPosition } from 'three/tsl';
import { C } from './sim.js';

// The single key light. Everything that shades by the moon (sky, light, shadows, rim) reads this.
export const MOON = { dir: new THREE.Vector3(-0.32, 0.27, -1).normalize(), color: 0xcfdcf0 };

function rng(seed) { let a = seed; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

// smooth value noise and a few octaves of it
function makeNoise(seed) {
  const N = 256, tab = new Float32Array(N * N), r = rng(seed);
  for (let i = 0; i < tab.length; i++) tab[i] = r();
  const at = (x, y) => tab[(y & 255) * N + (x & 255)];
  const n = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const fbm = (x, y, oct = 4) => { let s = 0, a = 0.5, t = 0; for (let i = 0; i < oct; i++) { s += n(x, y) * a; t += a; x = x * 2.03 + 17.1; y = y * 2.03 + 9.7; a *= 0.5; } return s / t; };
  return { n, fbm };
}
const sstep = (a, b, x) => { x = Math.max(0, Math.min(1, (x - a) / (b - a))); return x * x * (3 - 2 * x); };

export function buildWorld(scene, low) {
  const R = rng(77), noise = makeNoise(31);
  const world = { update() {} };
  const moonDir = MOON.dir;

  // --- sky dome: deep night, a little haze at the horizon, brighter toward the moon
  const skyTex = canvasTex(1024, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#03060b'); gr.addColorStop(0.3, '#070d17'); gr.addColorStop(0.44, '#101a27');
    gr.addColorStop(0.495, '#1f2c3a'); gr.addColorStop(0.505, '#141d27'); gr.addColorStop(1, '#070b10');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    // sphere u runs with the azimuth; put a wide soft sheen under the moon
    const mu = ((Math.atan2(moonDir.z, -moonDir.x) / (Math.PI * 2)) % 1 + 1) % 1;
    for (const off of [-1, 0, 1]) {
      const cxp = (mu + off) * w, cyp = h * 0.43 / 0.55, gl = g.createRadialGradient(cxp, cyp, 0, cxp, cyp, w * 0.2);
      gl.addColorStop(0, 'rgba(120,145,175,0.30)'); gl.addColorStop(1, 'rgba(120,145,175,0)');
      g.save(); g.scale(1, 0.55); g.fillStyle = gl; g.fillRect(0, 0, w, h / 0.55); g.restore();
    }
    for (let i = 0; i < 420; i++) {
      const y = R() * R() * h * 0.44; g.globalAlpha = (0.15 + R() * 0.55) * (1 - y / (h * 0.47));
      g.fillStyle = R() < 0.2 ? '#e9dcc6' : '#dfe9f5'; g.fillRect(R() * w, y, 1, 1);
    }
    g.globalAlpha = 1;
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10; scene.add(sky);

  // --- moon: low, pale, with a restrained halo
  const moonTex = canvasTex(256, 256, (g) => {
    const gr = g.createRadialGradient(112, 112, 10, 128, 128, 120);
    gr.addColorStop(0, '#fbf8ee'); gr.addColorStop(0.8, '#ece8da'); gr.addColorStop(1, '#cfcdc2');
    g.fillStyle = gr; g.beginPath(); g.arc(128, 128, 120, 0, 7); g.fill();
    g.save(); g.beginPath(); g.arc(128, 128, 120, 0, 7); g.clip();
    g.globalAlpha = 0.1; g.fillStyle = '#6f7480';
    for (let i = 0; i < 30; i++) { g.beginPath(); g.ellipse(30 + R() * 200, 30 + R() * 200, 6 + R() * 30, 5 + R() * 20, R() * 3, 0, 7); g.fill(); }
    g.restore();
  });
  const moon = new THREE.Mesh(new THREE.CircleGeometry(15, 40), new THREE.MeshBasicMaterial({ map: moonTex, fog: false, transparent: true }));
  moon.position.copy(moonDir).multiplyScalar(260); moon.lookAt(0, 0, 0); moon.renderOrder = -9; scene.add(moon);
  const glowTex = canvasTex(256, 256, (g) => {
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(200,215,235,0.42)'); gr.addColorStop(0.2, 'rgba(160,185,215,0.14)'); gr.addColorStop(1, 'rgba(140,170,205,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), new THREE.MeshBasicMaterial({ map: glowTex, fog: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.position.copy(moonDir).multiplyScalar(255); glow.lookAt(0, 0, 0); glow.renderOrder = -8; scene.add(glow);

  // --- distant ridges (two silhouette rings; the far one sits in haze)
  const ridge = (rad, base, amp, col, seed) => {
    const N = 480, pos = [], idx = [], r2 = rng(seed);
    const ph = [r2() * 6, r2() * 6, r2() * 6];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const h = base + amp * (0.5 + 0.5 * Math.sin(a * 3 + ph[0])) * (0.6 + 0.4 * Math.sin(a * 7 + ph[1])) + amp * 0.16 * Math.sin(a * 23 + ph[2]) + amp * 0.07 * Math.sin(a * 51) + amp * 0.035 * Math.sin(a * 113 + ph[0]) + amp * 0.05 * (noise.fbm(a * 14 + seed, seed * 3.1, 4) - 0.5) * 2;
      pos.push(Math.sin(a) * rad, -4, Math.cos(a) * rad, Math.sin(a) * rad, Math.max(1, h), Math.cos(a) * rad);
      if (i < N) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, fog: false, side: THREE.DoubleSide }));
    m.renderOrder = -7; scene.add(m);
  };
  ridge(240, 12, 40, 0x16202b, 5);
  ridge(170, 5, 22, 0x0b1118, 9);

  // --- light: one moon (key, shadows), a dim sky dome, and a faint bounce from the opposite side
  scene.fog = new THREE.FogExp2(0x101923, 0.017);
  scene.add(new THREE.HemisphereLight(0x8196b8, 0x23261c, 1.0));
  const moonL = new THREE.DirectionalLight(MOON.color, 3.4);
  moonL.position.copy(moonDir).multiplyScalar(60);
  if (!low) {
    moonL.castShadow = true; moonL.shadow.mapSize.set(2048, 2048);
    const sc = moonL.shadow.camera; sc.left = -13; sc.right = 13; sc.top = 13; sc.bottom = -13; sc.near = 20; sc.far = 110;
    moonL.shadow.bias = -0.0012; moonL.shadow.normalBias = 0.03;
  }
  scene.add(moonL);
  const bounce = new THREE.DirectionalLight(0x8fa6cc, 0.95); bounce.position.set(-moonDir.x * 20, 13, -moonDir.z * 20); scene.add(bounce);

  // --- ground: soil, trampled grass and wet mud, with matching roughness and relief
  const G = low ? 512 : 1024;
  const hgt = new Float32Array(G * G);
  let roughCanvas, normCanvas;
  const groundTex = canvasTex(G, G, (g) => {
    const img = g.createImageData(G, G), d = img.data;
    roughCanvas = document.createElement('canvas'); roughCanvas.width = roughCanvas.height = G;
    const rg = roughCanvas.getContext('2d'), rimg = rg.createImageData(G, G), rd = rimg.data;
    const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const grass = [44, 52, 36], tramp = [84, 80, 54], soilDry = [82, 70, 56], soilWet = [38, 33, 28], mud = [20, 22, 20];
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const u = x / G, v = y / G, rr = Math.hypot(u - 0.5, v - 0.5) * 2; // 0 centre .. 1 at 15 m
      const n1 = noise.fbm(u * 7, v * 7), n2 = noise.fbm(u * 34 + 5, v * 34 + 3), n3 = noise.n(u * 190, v * 190), grain = R();
      const worn = Math.max(0, Math.min(1, (n1 - 0.47) * 4 + (0.42 - rr) * 1.6)); // bare earth: more toward the middle
      const tr = sstep(0.35, 0.6, n2 + (0.5 - rr) * 0.5); // trampled, dry grass
      const wet = sstep(0.42, 0.3, n1) * sstep(0.2, 0.5, rr) + sstep(0.72, 0.95, rr); // damp hollows and the muddy rim
      let c = mixc(grass, tramp, tr);
      c = mixc(c, mixc(soilDry, soilWet, sstep(0.4, 0.7, n2)), worn);
      c = mixc(c, mud, Math.min(1, wet) * 0.8);
      const sh = 0.78 + n3 * 0.3 + (grain - 0.5) * 0.16;
      const i = (y * G + x) * 4;
      d[i] = c[0] * sh; d[i + 1] = c[1] * sh; d[i + 2] = c[2] * sh; d[i + 3] = 255;
      const rough = 255 * Math.max(0.56, Math.min(1, 0.98 - Math.min(1, wet) * 0.36 - worn * 0.06 + (n3 - 0.5) * 0.14));
      rd[i] = rd[i + 1] = rd[i + 2] = rough; rd[i + 3] = 255;
      hgt[y * G + x] = n2 * 0.7 + n3 * 0.35 - worn * 0.25 - Math.min(1, wet) * 0.2 + grain * 0.08;
    }
    g.putImageData(img, 0, 0); rg.putImageData(rimg, 0, 0);
    // scuffs and heel scars where the duelling happens
    for (let i = 0; i < 90; i++) {
      const a = R() * 6.28, r = Math.sqrt(R()) * G * 0.3, x = G / 2 + Math.cos(a) * r, y = G / 2 + Math.sin(a) * r;
      g.save(); g.translate(x, y); g.rotate(R() * 6.28); g.globalAlpha = 0.18 + R() * 0.2; g.fillStyle = R() < 0.7 ? '#221d18' : '#6a5e4a';
      g.beginPath(); g.ellipse(0, 0, (4 + R() * 14) * G / 1024, (1.5 + R() * 3) * G / 1024, 0, 0, 7); g.fill(); g.restore();
    }
    normCanvas = document.createElement('canvas'); normCanvas.width = normCanvas.height = G;
    const ng = normCanvas.getContext('2d'), nimg = ng.createImageData(G, G), nd = nimg.data;
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const xm = (x + G - 1) % G, xp = (x + 1) % G, ym = (y + G - 1) % G, yp = (y + 1) % G;
      let nx = (hgt[y * G + xm] - hgt[y * G + xp]) * 2.2, ny = (hgt[ym * G + x] - hgt[yp * G + x]) * 2.2;
      const l = Math.hypot(nx, ny, 1), i = (y * G + x) * 4;
      nd[i] = (nx / l * 0.5 + 0.5) * 255; nd[i + 1] = (ny / l * 0.5 + 0.5) * 255; nd[i + 2] = (1 / l * 0.5 + 0.5) * 255; nd[i + 3] = 255;
    }
    ng.putImageData(nimg, 0, 0);
  });
  groundTex.anisotropy = 4;
  const roughTex = new THREE.CanvasTexture(roughCanvas), normTex = new THREE.CanvasTexture(normCanvas);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(15, 64), new THREE.MeshPhysicalMaterial({ map: groundTex, roughnessMap: roughTex, roughness: 1, specularIntensity: 0.35, normalMap: normTex, normalScale: new THREE.Vector2(0.8, 0.8) }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const water = new THREE.Mesh(new THREE.CircleGeometry(160, 48), new THREE.MeshStandardMaterial({ color: 0x05090d, roughness: 0.2, metalness: 0.55 }));
  water.rotation.x = -Math.PI / 2; water.position.y = -0.06; scene.add(water);

  // --- wind-driven vegetation. Per-instance attribute = (wave phase along the wind, sway in metres, -, -)
  const WIND = new THREE.Vector2(0.94, 0.34); // world-space wind direction (x, z)
  const stalkGeo = (kind) => {
    // uv.y = height fraction (drives the bend), uv.x = 1 on the seed plume
    const pos = [], uvs = [], idx = [];
    const tri = (pts, plume) => { const k = pos.length / 3; for (const [x, y, z = 0] of pts) { pos.push(x, y, z); uvs.push(plume ? 1 : 0, y); } for (let i = 1; i < pts.length - 1; i++) idx.push(k, k + i, k + i + 1); };
    const strip = (pts) => { const k = pos.length / 3; for (const [x, y, z = 0] of pts) { pos.push(x, y, z); uvs.push(0, y); } for (let i = 0; i + 3 < pts.length; i += 2) idx.push(k + i, k + i + 1, k + i + 2, k + i + 1, k + i + 3, k + i + 2); };
    if (kind === 'grass') {
      // a tuft: five thin blades fanning out from one root, each curving over
      for (const [lean, hh, turn] of [[0, 1, 0], [0.55, 0.8, 1.1], [-0.6, 0.72, 2.3], [0.9, 0.55, 3.6], [-1.0, 0.5, 5.0]]) {
        const seg = 3, p = [], ct = Math.cos(turn), st = Math.sin(turn);
        for (let i = 0; i <= seg; i++) {
          const t = i / seg, w = 0.16 * (1 - 0.9 * t), out = lean * t * (0.6 + t * 0.8) * 0.5, y = hh * t * (1 - Math.abs(lean) * t * 0.25);
          p.push([out * ct * 2 - w, y, out * st * 0.06], [out * ct * 2 + w, y, out * st * 0.06]);
        }
        strip(p);
      }
    } else {
      const top = kind === 'broken' ? 0.46 : 1, seg = 6, p = [];
      for (let i = 0; i <= seg; i++) { const y = (i / seg) * top, w = 0.5 * (1 - 0.55 * y); p.push([-w, y], [w, y]); }
      strip(p);
      if (kind === 'broken') {
        // the upper stalk folded over and hanging
        strip([[-0.3, 0.46], [0.3, 0.46], [4.5, 0.36], [5.0, 0.38], [9.5, 0.12], [9.8, 0.14]]);
        tri([[9.5, 0.13], [12.5, 0.02], [13.5, 0.07], [11, 0.12]], true);
      } else {
        // long drooping leaves and a one-sided plume
        for (const [y0, dir, len] of [[0.3, 1, 8], [0.47, -1, 9.5], [0.63, 1, 7], [0.74, -1, 5.5]]) {
          strip([[0, y0 - 0.012], [0, y0 + 0.012], [dir * len * 0.55, y0 + 0.085, 0.05 * dir], [dir * len * 0.55, y0 + 0.105, 0.05 * dir], [dir * len, y0 + 0.03, 0.12 * dir], [dir * len, y0 + 0.034, 0.12 * dir]]);
        }
        tri([[0, 0.82], [0.7, 0.9], [0.8, 0.98], [0.1, 1.07], [-1.3, 1.045], [-2.6, 0.985], [-1.7, 0.9]], true);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  };
  const windMat = (base, tip, plumeCol, glint, clearCam = false) => (aw) => {
    const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.85 });
    const h = uv().y, idxf = instanceIndex.toFloat();
    const gust = sin(time.mul(0.85).sub(aw.x)).mul(0.5).add(0.5); // slow waves crossing the field
    const flutter = sin(time.mul(3.1).add(idxf.mul(1.71))).mul(0.14).add(sin(time.mul(1.7).add(idxf.mul(0.37))).mul(0.2));
    const bend = h.mul(h).mul(gust.mul(0.75).add(0.25).add(flutter)).mul(aw.y);
    // (the offset is applied after the instance transform, so it is already in world units)
    const swayed = positionLocal.add(vec3(bend.mul(WIND.x), bend.mul(bend).mul(-0.3), bend.mul(WIND.y)));
    // tall stalks right around the camera lie down, so the view from the boundary is never a face full of leaves
    const keep = smoothstep(3.0, 6.0,positionLocal.xz.sub(cameraPosition.xz).length());
    m.positionNode = clearCam ? vec3(swayed.x, swayed.y.mul(keep).sub(keep.oneMinus().mul(0.4)), swayed.z) : swayed;
    const shade = sin(idxf.mul(12.9)).mul(0.16).add(0.84);
    const col = mix(mix(color(base), color(tip), h.mul(1.15).clamp(0, 1)), color(plumeCol), uv().x).mul(shade);
    m.colorNode = col;
    // plumes and upper stalks pass a little moonlight through
    m.emissiveNode = color(MOON.color).mul(col).mul(uv().x.mul(glint).add(h.mul(h).mul(glint * 0.25)));
    return m;
  };
  const d = new THREE.Object3D();
  const scatter = (count, geo, mat, place) => {
    const aw = new Float32Array(count * 4);
    const im = new THREE.InstancedMesh(geo, mat(instancedBufferAttribute(new THREE.InstancedBufferAttribute(aw, 4), 'vec4')), count);
    for (let i = 0; i < count; i++) {
      const amp = place(d, i); d.updateMatrix(); im.setMatrixAt(i, d.matrix);
      aw.set([(d.position.x * WIND.x + d.position.z * WIND.y) * 0.32, amp, 0, 0], i * 4);
    }
    im.frustumCulled = false; im.receiveShadow = false; scene.add(im); return im;
  };
  // tall reeds ring the clearing: clumps and thin patches, calm and wild stands, a ragged inner edge
  const inner = C.ARENA_R + 0.9;
  const reedSpot = (o, minR = 0) => {
    for (let tries = 0; tries < 12; tries++) {
      const a = R() * Math.PI * 2, x0 = Math.sin(a), z0 = Math.cos(a);
      const edge = inner + minR + (noise.fbm(x0 * 3 + 9, z0 * 3 + 4) - 0.5) * 2.2;
      const r = edge + Math.pow(R(), 1.6) * 32, x = x0 * r, z = z0 * r;
      const dens = noise.fbm(x * 0.09 + 40, z * 0.09 + 12);
      if (R() > 0.25 + dens * 1.3 && r - edge > 1.2) continue; // thin patches beyond the front row
      o.position.set(x, -0.05, z);
      return { a, r, x, z, edge };
    }
    const a = R() * Math.PI * 2; o.position.set(Math.sin(a) * (inner + 6), -0.05, Math.cos(a) * (inner + 6));
    return { a, r: inner + 6, x: o.position.x, z: o.position.z, edge: inner };
  };
  const reedCount = low ? 3400 : 15000;
  const reeds = scatter(reedCount,stalkGeo('reed'), windMat(0x34321f, 0x7a7252, 0x9a927a, 0.07, true), (o) => {
    const s = reedSpot(o);
    const stand = noise.fbm(s.x * 0.06 + 7, s.z * 0.06 + 21); // 0 calm/short .. 1 tall/wild
    const bent = R() < 0.09;
    o.rotation.set(bent ? (R() - 0.5) * 0.5 : (R() - 0.5) * 0.1, R() * Math.PI * 2, bent ? (R() < 0.5 ? -1 : 1) * (0.3 + R() * 0.55) : (R() - 0.5) * 0.16);
    const hgt2 = (1.9 + stand * 1.9 + R() * 0.8 + Math.min(1.0, (s.r - s.edge) * 0.07)) * (bent ? 0.85 : 1);
    o.scale.set(0.026 + R() * 0.02, hgt2, 1);
    return (0.16 + stand * 0.55 + R() * 0.12) * (bent ? 0.5 : 1);
  });
  // snapped stalks along the inner edge, and a few lying flat at the rim of the clearing
  scatter(low ? 120 : 420, stalkGeo('broken'), windMat(0x2a281a, 0x7d7555, 0xb9b295, 0.1, true), (o, i) => {
    const s = reedSpot(o);
    if (i % 5 === 0) { const rr = C.ARENA_R - 0.6 + R() * 1.6; o.position.set(Math.sin(s.a) * rr, 0.02, Math.cos(s.a) * rr); o.rotation.set(Math.PI / 2 - 0.06, R() * 6.28, 0, 'YXZ'); o.scale.set(0.03, 1.6 + R(), 1); return 0; }
    else if (s.r - s.edge > 5) { const rr = s.edge + R() * 4; o.position.set(Math.sin(s.a) * rr, -0.05, Math.cos(s.a) * rr); }
    o.rotation.set((R() - 0.5) * 0.3, R() * Math.PI * 2, (R() - 0.5) * 0.4, 'XYZ');
    o.scale.set(0.03 + R() * 0.015, 2.4 + R() * 1.4, 1);
    return 0.08;
  });
  // low grass in the clearing: short and flattened where the fighting is, longer toward the reeds
  const grass = scatter(low ? 1500 : 6500, stalkGeo('grass'), windMat(0x34381f, 0x77744c, 0x77744c, 0.1), (o) => {
    let a, r, tries = 0;
    do { a = R() * Math.PI * 2; r = Math.sqrt(R()) * (inner + 1.8); tries++; } while (tries < 6 && R() > 0.35 + noise.fbm(Math.sin(a) * r * 0.5 + 3, Math.cos(a) * r * 0.5 + 8) * 1.1 - Math.max(0, 5 - r) * 0.06);
    o.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
    const flat = r < 7 && R() < 0.3;
    o.rotation.set(0, R() * 6.28, flat ? (R() < 0.5 ? -1 : 1) * (0.9 + R() * 0.5) : (R() - 0.5) * 0.6, 'YXZ');
    const tall = sstep(5.5, C.ARENA_R, r);
    const hh = 0.07 + R() * 0.13 + tall * (0.12 + R() * 0.3);
    o.scale.set(0.09 + R() * 0.07, hh, 1);
    return flat ? 0.01 : 0.03 + hh * 0.35;
  });

  // --- boundary markers: weathered poles with faded cloth streamers (visible limit of the clearing)
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3b3229, roughness: 1 });
  const clothMat = new THREE.MeshStandardMaterial({ color: 0x70301f, roughness: 0.95, side: THREE.DoubleSide });
  const streamers = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.2, r = C.ARENA_R + 0.7;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 4.2, 6), poleMat);
    pole.position.set(Math.sin(a) * r, 2.0, Math.cos(a) * r); pole.rotation.set((R() - 0.5) * 0.25, 0, (R() - 0.5) * 0.25); pole.castShadow = true;
    scene.add(pole);
    const st = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 1.3 + R() * 0.5, 1, 5), clothMat);
    const hh = st.geometry.parameters.height; st.geometry.translate(0, -hh / 2, 0); st.position.set(pole.position.x, 4.0, pole.position.z); st.rotation.y = Math.atan2(WIND.x, WIND.y) + Math.PI / 2; st.userData.ph = R() * 6;
    scene.add(st); streamers.push(st);
  }

  // --- mist: thin sheets at two heights, kept out of the clearing
  const mistTex = canvasTex(256, 256, (g) => {
    for (let i = 0; i < 46; i++) {
      const x = 72 + R() * 112, y = 104 + R() * 48, r = 16 + R() * 26;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(170,190,210,0.085)'); gr.addColorStop(1, 'rgba(170,190,210,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    }
  });
  const mists = [], MN = low ? 6 : 12;
  for (let i = 0; i < MN; i++) {
    const lowLayer = i % 2 === 1;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(lowLayer ? 36 : 52, lowLayer ? 3.2 : 6.5), new THREE.MeshBasicMaterial({ map: mistTex, transparent: true, depthWrite: false, opacity: lowLayer ? 0.5 : 0.62, fog: false }));
    const a = (i / MN) * Math.PI * 2 + R(), r = (lowLayer ? 15 : 21) + R() * 15;
    m.position.set(Math.sin(a) * r, lowLayer ? 0.7 + R() * 0.4 : 1.8 + R() * 1.2, Math.cos(a) * r); m.userData = { a, r, sp: (R() - 0.3) * 0.02 };
    m.renderOrder = 5; scene.add(m); mists.push(m);
  }

  // --- a few fireflies over the fen
  const FN = low ? 10 : 26;
  const flies = new THREE.InstancedMesh(new THREE.SphereGeometry(0.02, 5, 4), new THREE.MeshBasicMaterial({ color: 0xb9cf96, fog: false }), FN);
  const fd = []; for (let i = 0; i < FN; i++) fd.push({ a: R() * 6.28, r: 9 + R() * 20, y: 0.5 + R() * 2.2, s: 0.2 + R() * 0.5, p: R() * 6 });
  flies.frustumCulled = false; scene.add(flies);

  // --- automatic quality tiers (main.js steps down when the measured frame rate is low).
  // Instances are placed in random order, so drawing a prefix thins the field evenly.
  const TIER_REEDS = [15000, 9000, 5200, 3800, 3000], TIER_GRASS = [6500, 4200, 2800, 2000, 1500];
  world.shadows = !low;
  world.setQuality = (tier) => {
    reeds.count = Math.min(reedCount, TIER_REEDS[tier]);
    grass.count = Math.min(grass.instanceMatrix.count, TIER_GRASS[tier]);
    mists.forEach((m, i) => { m.visible = tier < 3 || i < 6; });    if (tier >= 2 && world.shadows) {
      // stop the shadow pass: clear the casters, render one last (empty) shadow map, then freeze it
      world.shadows = false;
      scene.traverse((o) => { if (o.castShadow && o.isMesh) o.castShadow = false; });
      moonL.shadow.needsUpdate = true; moonL.shadow.autoUpdate = false;
    }
  };

  world.update = (t, camera) => {
    for (const m of mists) { const u = m.userData; u.a += u.sp * 0.016; m.position.x = Math.sin(u.a) * u.r; m.position.z = Math.cos(u.a) * u.r; m.lookAt(camera.position.x, m.position.y, camera.position.z); }
    for (let i = 0; i < FN; i++) {
      const f = fd[i], a = f.a + Math.sin(t * f.s + f.p) * 0.3;
      d.position.set(Math.sin(a) * f.r, f.y + Math.sin(t * f.s * 2 + f.p) * 0.4, Math.cos(a) * f.r);
      d.rotation.set(0, 0, 0); d.scale.setScalar(0.4 + 0.8 * Math.max(0, Math.sin(t * 1.7 * f.s + f.p * 3)));
      d.updateMatrix(); flies.setMatrixAt(i, d.matrix);
    }
    flies.instanceMatrix.needsUpdate = true;
    for (const st of streamers) {
      const p = st.geometry.attributes.position, ph = st.userData.ph;
      for (let i = 0; i < p.count; i++) { const y = -p.getY(i); p.setZ(i, Math.sin(t * 2.6 + ph + y * 3) * 0.14 * y + y * (0.3 + 0.12 * Math.sin(t * 0.85 + ph))); }
      p.needsUpdate = true;
    }
    sky.position.copy(camera.position);
  };
  return world;
}
