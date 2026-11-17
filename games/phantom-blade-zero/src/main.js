// 雨巷双刃 / Rainlane Blades — entry point: renderer, input, camera, HUD, effects wiring.
import * as THREE from 'three/webgpu';
import {
  DT, ARENA, OBSTACLES, createGame, startFight, retry, step, drainEvents, currentSeg, hitIn, angDiff,
} from './sim.js';
import { buildWorld } from './world.js';
import { makePlayer, makeBoss, animatePlayer, animateBoss } from './fighter.js';
import { buildFx, Trail } from './fx.js';
import { createAudio } from './audio.js';

const $ = (id) => document.getElementById(id);

// Documented test/debug options in the URL hash, e.g. play.html#seed=7&bhp=0.3&php=0.5&q=low&gl&mute
function parseHash() {
  const o = {};
  for (const kv of location.hash.replace(/^#/, '').split('&')) {
    if (!kv) continue;
    const [k, v] = kv.split('=');
    o[k] = v === undefined ? true : v;
  }
  const num = (v, d, lo, hi) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  return {
    seed: o.seed !== undefined ? (parseInt(o.seed, 10) || 1) : ((Date.now() ^ (Math.random() * 1e9)) >>> 0),
    bossHpScale: num(o.bhp, 1, 0.02, 20),
    playerHpScale: num(o.php, 1, 0.02, 20),
    quality: o.q === 'low' ? 'low' : 'high',
    forceGL: !!o.gl,
    mute: !!o.mute,
  };
}

async function makeRenderer(forceGL) {
  const attempt = async (gl) => {
    const r = new THREE.WebGPURenderer({ antialias: true, forceWebGL: gl });
    await r.init();
    return r;
  };
  // Prefer WebGPU only on a real hardware adapter; a missing or software (fallback) adapter goes
  // straight to the WebGL 2 backend, which is far more dependable there.
  let gl = forceGL;
  if (!gl) {
    try {
      const a = navigator.gpu ? await navigator.gpu.requestAdapter() : null;
      const arch = a && a.info ? String(a.info.architecture || '') : '';
      if (!a || a.isFallbackAdapter || (a.info && a.info.isFallbackAdapter) || arch === 'swiftshader') gl = true;
    } catch {
      gl = true;
    }
  }
  let r;
  try {
    r = await attempt(gl);
  } catch (e) {
    if (gl) throw e;
    r = await attempt(true);
  }
  return r;
}

function showError(msg) {
  const e = $('err');
  e.textContent = msg;
  e.classList.remove('hidden');
}

async function boot() {
  const opts = parseHash();
  let renderer;
  try {
    renderer = await makeRenderer(opts.forceGL);
  } catch (e) {
    showError('无法初始化 WebGPU 或 WebGL 2 渲染器。This browser could not start WebGPU or WebGL 2. (' + (e && e.message ? e.message : e) + ')');
    return;
  }
  const backend = renderer.backend && renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2';
  const low = opts.quality === 'low';
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1 : 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.shadowMap.enabled = !low;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  $('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.12, 160);
  const world = buildWorld(scene, opts.quality);
  // Capture the empty yard once into a small cube map: wet stone and metal reflect the real
  // lanterns and windows, and the dim result doubles as the ambient light.
  try {
    const envRT = new THREE.CubeRenderTarget(low ? 64 : 128, { type: THREE.HalfFloatType });
    const envCam = new THREE.CubeCamera(0.2, 90, envRT);
    envCam.position.set(0, 1.1, 0.5);
    scene.add(envCam);
    // the capture sees a faintly moonlit overcast instead of the black backdrop, so puddles
    // mirror a dim sky rather than turning into black holes
    const sky = scene.background.clone();
    scene.background.set(0x1b2636);
    envCam.update(renderer, scene);
    scene.background.copy(sky);
    scene.remove(envCam);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.85;
  } catch (e) {
    console.warn('environment capture skipped: ' + (e && e.message ? e.message : e));
  }
  const fx = buildFx(scene, opts.quality, world);
  const audio = createAudio();
  if (opts.mute) audio.toggleMute();

  const g = createGame({ seed: opts.seed, bossHpScale: opts.bossHpScale, playerHpScale: opts.playerHpScale });
  const pr = makePlayer();
  const br = makeBoss();
  scene.add(pr.root, br.root);
  const pTrail = new Trail(scene, 0xa8dfee, 20, 0.2);
  const bTrails = [new Trail(scene, 0x66b8ff, 24, 0.26), new Trail(scene, 0x66b8ff, 24, 0.26)];
  const bossLight = new THREE.PointLight(0x66b8ff, 0, 6, 1.8);
  scene.add(bossLight);
  // a dim, cold moonlit kicker from behind the duel so silhouettes separate from the dark walls
  const rim = new THREE.PointLight(0x8fb0e8, 14, 16, 1.5);
  scene.add(rim);

  // ------------------------------------------------------------ input
  const keys = new Set();
  const edge = { attack: false, dodge: false };
  const mouse = { guard: false, lastX: null, lastY: null };
  const LOCK_REST = 0.3; // resting lock-on view sits slightly off the shoulder so the foe is never hidden behind the player
  const cam = { yaw: 0, pitch: 0.3, off: LOCK_REST, lock: true, base: 0, t: 1, lastMouse: -10, shake: 0, inBounds: true, dist: 5.8, avoid: 0, avoidS: 0, avoidTarget: 0, te: 1 };
  let paused = false;
  let wall = 0;

  const MOVE = { KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
  function begin() {
    audio.start();
    if (g.mode === 'title') {
      startFight(g);
      $('title').classList.add('hidden');
      $('hud').classList.remove('hidden');
    }
  }
  function doRetry() {
    if (g.mode === 'victory' || g.mode === 'defeat') {
      retry(g);
      $('result').classList.add('hidden');
      resetView();
    }
  }
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    audio.start();
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { if (g.mode === 'title') begin(); else doRetry(); return; }
    if (e.code === 'KeyR') { doRetry(); return; }
    if (e.code === 'KeyM') { audio.toggleMute(); return; }
    if (g.mode !== 'fight') return;
    if (e.code === 'KeyP') { paused = !paused; $('paused').classList.toggle('hidden', !paused); return; }
    if (e.code === 'KeyJ') edge.attack = true;
    if (e.code === 'Space' || e.code === 'KeyL') edge.dodge = true;
    if (e.code === 'KeyF' || e.code === 'Tab') { cam.lock = !cam.lock; cam.off = LOCK_REST; }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); mouse.guard = false; });
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('mousedown', (e) => {
    audio.start();
    if (e.target && e.target.closest && e.target.closest('button')) return;
    if (g.mode !== 'fight' || paused) return;
    if (e.button === 0) {
      edge.attack = true;
      const el = renderer.domElement;
      if (document.pointerLockElement !== el && el.requestPointerLock) {
        try { const p = el.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* optional */ }
      }
    } else if (e.button === 2) mouse.guard = true;
    else if (e.button === 1) { cam.lock = !cam.lock; cam.off = LOCK_REST; e.preventDefault(); }
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 2) mouse.guard = false; });
  window.addEventListener('mousemove', (e) => {
    let dx = e.movementX;
    let dy = e.movementY;
    if (document.pointerLockElement !== renderer.domElement) {
      // works without pointer lock: use deltas of the cursor position
      if (mouse.lastX !== null) { dx = e.clientX - mouse.lastX; dy = e.clientY - mouse.lastY; } else { dx = 0; dy = 0; }
      mouse.lastX = e.clientX; mouse.lastY = e.clientY;
    }
    if (!dx && !dy) return;
    if (g.mode !== 'fight' || paused) return;
    dx = Math.max(-120, Math.min(120, dx)); dy = Math.max(-120, Math.min(120, dy));
    lookInput(dx * 0.0045, dy * 0.003);
  });
  $('startbtn').addEventListener('click', (e) => { e.currentTarget.blur(); begin(); });
  $('retrybtn').addEventListener('click', (e) => { e.currentTarget.blur(); doRetry(); });
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  function lockActive() { return cam.lock && g.engaged && g.boss.st !== 'dead' && g.mode === 'fight'; }
  function lookInput(dyaw, dpitch) {
    if (lockActive()) cam.off = Math.max(-1.35, Math.min(1.35, cam.off - dyaw));
    else cam.yaw -= dyaw;
    cam.pitch = Math.max(-0.02, Math.min(0.72, cam.pitch + dpitch));
    cam.lastMouse = wall;
  }
  function resetView() {
    cam.yaw = 0; cam.off = LOCK_REST; cam.pitch = 0.3; cam.t = 1; cam.te = 1; cam.lock = true; cam.avoid = 0; cam.avoidS = 0; cam.avoidTarget = 0;
    lastHp = { p: -1, b: -1 };
  }

  // ------------------------------------------------------------ camera
  const pivot = new THREE.Vector3();
  const want = new THREE.Vector3();
  const focus = new THREE.Vector3();
  const curFocus = new THREE.Vector3(0, 1.3, 0);
  const tmp = new THREE.Vector3();
  function camInside(x, z, laneOk) {
    const Y = ARENA.yard;
    let ok = x > Y.minX + 0.4 && x < Y.maxX - 0.4 && z > Y.minZ + 0.4 && z < Y.maxZ - 0.4;
    if (!ok && laneOk) {
      const L = ARENA.lane;
      ok = x > L.minX + 0.3 && x < L.maxX - 0.3 && z > L.minZ && z < L.maxZ - 0.35;
    }
    if (ok) for (const o of OBSTACLES) if ((x - o.x) ** 2 + (z - o.z) ** 2 < (o.r + 0.15) ** 2) return false;
    return ok;
  }
  // Free distance from (px, pz) along the unit heading (dx, dz) before the camera would leave the
  // walkable space (yard, plus the lane while it is open) or touch a prop. Exact, so it varies
  // continuously as the player or the view moves.
  const CM = 0.47; // camera margin from the walls
  function rectExit(px, pz, dx, dz, x0, x1, z0, z1) {
    if (px < x0 - 1e-6 || px > x1 + 1e-6 || pz < z0 - 1e-6 || pz > z1 + 1e-6) return -1;
    let t = 1e9;
    if (dx > 1e-6) t = Math.min(t, (x1 - px) / dx); else if (dx < -1e-6) t = Math.min(t, (x0 - px) / dx);
    if (dz > 1e-6) t = Math.min(t, (z1 - pz) / dz); else if (dz < -1e-6) t = Math.min(t, (z0 - pz) / dz);
    return Math.max(0, t);
  }
  // Wider margins where things hang off the walls, so the camera stays clear of them:
  // west chains, east pipework and gantry chains, north eave lanterns.
  const yardRect = () => [ARENA.yard.minX + 1.1, ARENA.yard.maxX - 1.9, ARENA.yard.minZ + 1.25, ARENA.yard.maxZ - CM];
  // distance to the yard's camera bounds along a heading (used while the camera glides in after the gate drops)
  function yardRoom(px, pz, dx, dz) {
    const yr = yardRect();
    px = Math.max(yr[0], Math.min(yr[1], px)); pz = Math.max(yr[2], Math.min(yr[3], pz));
    return rectExit(px, pz, dx, dz, yr[0], yr[1], yr[2], yr[3]);
  }
  // free distance along a heading before a prop is in the way
  function propRoom(px, pz, dx, dz, maxD) {
    let d = maxD;
    for (const o of OBSTACLES) {
      const r = o.r + 0.5;
      const ox = px - o.x, oz = pz - o.z;
      const b = ox * dx + oz * dz;
      const c = ox * ox + oz * oz - r * r;
      if (c <= 0) continue; // (the player never stands inside a prop's margin for long)
      const disc = b * b - c;
      if (disc > 0 && b < 0) d = Math.min(d, -b - Math.sqrt(disc));
    }
    return Math.max(0, Math.min(maxD, d));
  }
  // Slide a camera position back inside along the walls. Projection is continuous, so the camera
  // glides along a wall instead of jumping; out receives the result.
  function confineCamera(vx, vz, piv, laneOk, out) {
    const L = ARENA.lane;
    const yr = yardRect();
    const ax = Math.max(yr[0], Math.min(yr[1], vx)), az = Math.max(yr[2], Math.min(yr[3], vz));
    let x = ax, z = az;
    if (laneOk) {
      const bx = Math.max(L.minX + 0.36, Math.min(L.maxX - 0.36, vx)), bz = Math.max(L.minZ, Math.min(L.maxZ - 0.42, vz));
      if ((bx - vx) ** 2 + (bz - vz) ** 2 < (ax - vx) ** 2 + (az - vz) ** 2) { x = bx; z = bz; }
    }
    for (const o of OBSTACLES) {
      const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz), r = o.r + 0.44;
      if (d < r && d > 1e-4) { x = o.x + (dx / d) * r; z = o.z + (dz / d) * r; }
    }
    for (let i = 0; i < 24 && !camInside(x, z, laneOk); i++) { x += (piv.x - x) * 0.15; z += (piv.z - z) * 0.15; }
    out.x = x; out.z = z;
  }
  const slide = { x: 0, z: 0 };
  function updateCamera(dt) {
    const p = g.player;
    const b = g.boss;
    if (g.mode === 'title') {
      const a = wall * 0.07;
      camera.position.set(Math.sin(a) * 5.5, 2.3 + Math.sin(a * 1.7) * 0.25, 7.6);
      curFocus.set(Math.sin(a) * 0.8, 1.7, -3);
      camera.lookAt(curFocus);
      cam.inBounds = true;
      return;
    }
    const locked = lockActive();
    const dPB = Math.hypot(p.x - b.x, p.z - b.z);
    const ending = p.st === 'dead' || b.st === 'dead' || g.mode !== 'fight';
    if (ending) {
      // slow orbit around the fallen fighter
      cam.yaw += dt * 0.22;
    } else if (locked) {
      if (dPB > 0.95) cam.base = Math.atan2(p.x - b.x, p.z - b.z);
      if (wall - cam.lastMouse > 1.4) cam.off += (LOCK_REST - cam.off) * (1 - Math.exp(-dt * 1.6));
      cam.yaw += angDiff(cam.base + cam.off, cam.yaw) * (1 - Math.exp(-dt * 6));
    }
    const kq = (keys.has('KeyQ') ? 1 : 0) - (keys.has('KeyE') ? 1 : 0);
    if (kq && g.mode === 'fight') lookInput(-kq * dt * 2.2, 0);

    const subj = ending ? (p.st === 'dead' ? p : b) : p;
    const other = subj === p ? b : p;
    if (ending) pivot.set(subj.x * 0.7 + other.x * 0.3, 1.2, subj.z * 0.7 + other.z * 0.3);
    else pivot.set(p.x, 1.5, p.z);
    const pitch = ending ? 0.42 : cam.pitch;
    const dist = ending ? 5.2 : cam.dist;
    const cp = Math.cos(pitch);
    want.set(pivot.x + Math.sin(cam.yaw) * dist * cp, pivot.y + 0.45 + dist * Math.sin(pitch), pivot.z + Math.cos(cam.yaw) * dist * cp);
    // Keep the camera inside the walls. March from the player toward the wanted spot, but first swing
    // the camera sideways around the player to find room, so the duel stays framed near walls and corners.
    // (Movement keys keep their heading; only the viewpoint swings.)
    // Once the gate has dropped the camera belongs in the yard; if it is still out in the lane it
    // glides in rather than snapping (laneOk only keeps it legal while it is on its way).
    const laneRoom = !g.gateClosed;
    const laneOk = laneRoom || camera.position.z > ARENA.yard.maxZ - CM + 0.01;
    const hd = dist * cp; // wanted horizontal distance
    // How far from the player the camera ends up on a heading: props stop it, walls make it slide.
    const room = (yaw) => {
      const dx = Math.sin(yaw), dz = Math.cos(yaw);
      const d = propRoom(pivot.x, pivot.z, dx, dz, hd);
      confineCamera(pivot.x + dx * d, pivot.z + dz * d, pivot, laneRoom, slide);
      return Math.min(1, Math.hypot(slide.x - pivot.x, slide.z - pivot.z) / hd);
    };
    let bestO = cam.avoidTarget;
    if (!ending) {
      // Look for the heading with the most room. The score is continuous, and the current choice
      // is only dropped for a clearly better one, so the view does not hunt between headings.
      const score = (o) => room(cam.yaw + o) - Math.abs(o) * 0.15;
      // a free camera normally never flips to face the player; only a dead-end corner lets it
      let lim = locked ? Math.PI : 1.7;
      if (!locked && Math.abs(bestO) > lim && room(cam.yaw + bestO) > 0.3) lim = Math.PI;
      if (Math.abs(bestO) > lim) bestO = 0;
      let bestScore = score(bestO) + 0.07;
      const scan = () => {
        for (let o = -lim; o <= lim + 1e-6; o += lim / 16) {
          const sc = score(o);
          if (sc > bestScore) { bestScore = sc; bestO = o; }
        }
      };
      scan();
      if (!locked && lim < 3 && room(cam.yaw + bestO) < 0.28) { lim = Math.PI; scan(); }
    } else bestO = 0;
    cam.avoidTarget = bestO;
    // two-stage smoothing: the swing eases in and out instead of starting with a jerk
    cam.avoidS += (bestO - cam.avoidS) * (1 - Math.exp(-dt * 4.5));
    cam.avoid += (cam.avoidS - cam.avoid) * (1 - Math.exp(-dt * 6));
    const yawEff = cam.yaw + cam.avoid;
    want.set(pivot.x + Math.sin(yawEff) * hd, want.y, pivot.z + Math.cos(yawEff) * hd);
    // pull in quickly but smoothly when a prop (or the dropped gate) is in the way, ease back out slowly
    const hx = Math.sin(yawEff), hz = Math.cos(yawEff);
    let tMax = propRoom(pivot.x, pivot.z, hx, hz, hd) / hd;
    const gliding = laneOk && !laneRoom;
    if (gliding) tMax = Math.min(tMax, yardRoom(pivot.x, pivot.z, hx, hz) / hd);
    cam.t += (tMax - cam.t) * (1 - Math.exp(-dt * (tMax < cam.t ? (gliding ? 4 : 16) : 3)));
    // walls: slide along them
    confineCamera(pivot.x + hx * hd * cam.t, pivot.z + hz * hd * cam.t, pivot, laneOk, slide);
    // te is how much of the wanted distance the camera really has; as it closes in, the camera
    // rises a little, eased with the same smoothed value so there is no jump
    const teNow = Math.min(1, Math.hypot(slide.x - pivot.x, slide.z - pivot.z) / hd);
    cam.te += (teNow - cam.te) * (1 - Math.exp(-dt * 9));
    const t = cam.te;
    camera.position.set(slide.x, pivot.y + (want.y - pivot.y) * t + (1 - t) * (1 - t) * 0.85, slide.z);
    // stay below the wall tops, and under the eaves near the north and west buildings
    const Y = ARENA.yard;
    const nearRoof = Math.min(camera.position.z - Y.minZ, camera.position.x - Y.minX);
    const cap = 3.15 + Math.max(0, Math.min(1, (nearRoof - 2.2) / 1.5)) * 0.3;
    if (camera.position.y > cap) camera.position.y = cap;
    cam.inBounds = camInside(camera.position.x, camera.position.z, laneOk);

    if (ending) {
      focus.set(pivot.x, 0.8, pivot.z);
    } else if (locked) {
      const k = Math.min(0.5, 3.4 / Math.max(dPB, 0.01));
      focus.set(p.x + (b.x - p.x) * k, 1.25, p.z + (b.z - p.z) * k);
    } else {
      focus.set(p.x - Math.sin(yawEff) * 2, 1.25, p.z - Math.cos(yawEff) * 2);
    }
    curFocus.lerp(focus, 1 - Math.exp(-dt * 10));
    if (cam.shake > 0) {
      cam.shake = Math.max(0, cam.shake - dt * 2.4);
      const s = cam.shake * cam.shake * 0.5;
      camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s;
    }
    camera.lookAt(curFocus);
    tmp.set(p.x, 1.5, p.z);
    pr.root.visible = ending || camera.position.distanceTo(tmp) > 0.85;
  }

  // ------------------------------------------------------------ HUD helpers
  const floaters = $('floaters');
  function project(x, y, z) {
    tmp.set(x, y, z).project(camera);
    return { x: (tmp.x * 0.5 + 0.5) * window.innerWidth, y: (-tmp.y * 0.5 + 0.5) * window.innerHeight, z: tmp.z, nx: tmp.x, ny: tmp.y };
  }
  function floater(text, cls, x, y, z) {
    const s = project(x, y, z);
    if (s.z > 1) return;
    const d = document.createElement('div');
    d.className = 'fl ' + cls;
    d.textContent = text;
    d.style.left = (s.x + (Math.random() - 0.5) * 50) + 'px';
    d.style.top = s.y + 'px';
    floaters.appendChild(d);
    setTimeout(() => d.remove(), 900);
  }
  function banner(big, sub, hot) {
    const b = $('banner');
    b.classList.remove('show');
    b.classList.toggle('hot', !!hot);
    b.querySelector('.big').textContent = big;
    b.querySelector('.sub').textContent = sub;
    void b.offsetWidth;
    b.classList.add('show');
  }
  let lastHp = { p: -1, b: -1 };
  let hurtFlash = 0;
  function updateHud() {
    const p = g.player;
    const b = g.boss;
    if (p.hp !== lastHp.p) {
      const w = (100 * p.hp / p.maxHp) + '%';
      for (const el of $('playerbar').querySelectorAll('.fill,.lag')) el.style.width = w;
      lastHp.p = p.hp;
    }
    if (b.hp !== lastHp.b) {
      const w = (100 * b.hp / b.maxHp) + '%';
      for (const el of $('bossbar').querySelectorAll('.fill,.lag')) el.style.width = w;
      lastHp.b = b.hp;
    }
    $('bossbox').classList.toggle('on', g.engaged);
    const two = b.phase === 2;
    const ph = $('phase');
    ph.classList.toggle('two', two);
    ph.children[1].classList.toggle('on', two);
    $('phaselabel').textContent = two ? '第二式 · 炉心沸' : '第一式 · 冷刃';
    $('punishcue').classList.toggle('on', g.mode === 'fight' && b.st === 'recover');
    const pm = $('prompt');
    pm.textContent = g.mode === 'fight' && !g.engaged ? '沿窄巷前行，步入院中　·　Walk down the lane into the yard (W)' : '';
    const st = [];
    if (g.mode === 'fight') {
      st.push(cam.lock ? '◆ 锁定 LOCK' : '◇ 自由视角 FREE');
      if (p.guard) st.push('格挡 GUARD');
      if (audio.muted) st.push('静音 MUTED');
    }
    $('status').textContent = st.join('　');
    const lm = $('lockmark');
    if (lockActive()) {
      const s = project(b.x, 1.75, b.z);
      lm.classList.toggle('hidden', s.z > 1);
      lm.style.left = s.x + 'px'; lm.style.top = s.y + 'px';
    } else lm.classList.add('hidden');
    hurtFlash = Math.max(0, hurtFlash - 0.03);
    $('hurtflash').style.opacity = Math.max(hurtFlash, p.hp / p.maxHp < 0.3 && p.hp > 0 ? 0.25 + 0.1 * Math.sin(wall * 5) : 0);
  }
  function showResult(win) {
    const r = $('result');
    r.classList.remove('hidden', 'victory', 'defeat');
    r.classList.add(win ? 'victory' : 'defeat');
    $('resulttitle').textContent = win ? '雨歇刃收' : '灯灭巷深';
    $('resultsub').textContent = win ? 'VICTORY' : 'DEFEAT';
    const s = g.stats;
    $('resultstats').innerHTML = `用时 Time ${g.time.toFixed(1)}s　·　破绽 Punishes ${s.punishHits}　·　格挡 Guards ${s.guarded + s.perfect}<br>` +
      `闪避 Dodges ${s.dodged}　·　受击 Hits taken ${s.hurt}　·　造成伤害 Damage ${s.damageDealt}`;
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    mouse.lastX = null;
  }

  // ------------------------------------------------------------ events → audio / fx
  let freeze = 0;
  const hitPos = new THREE.Vector3();
  function handle(e) {
    const p = g.player;
    const b = g.boss;
    switch (e.type) {
      case 'start': audio.play('start'); audio.setLevel(0); break;
      case 'retry': audio.play('start'); audio.setLevel(0); break;
      case 'engage':
        audio.play('gate'); audio.setLevel(1); cam.shake = 0.5;
        banner('莫三更', 'MO SANGENG · TWIN CROWS OF THE IRON EAVES');
        break;
      case 'swing': audio.play('swing', { n: e.n }); break;
      case 'clank': audio.play('blocked'); break;
      case 'bossHurt': {
        hitPos.set(b.x + (p.x - b.x) * 0.3, 1.35, b.z + (p.z - b.z) * 0.3);
        if (e.punish) {
          audio.play('punish');
          fx.sparks(hitPos, 0xffc84a, 12, 7, 0.2);
          fx.flash(hitPos, 0xffc040, 60, 3.2, 0.25);
          floater('破绽 ' + e.dmg, 'punish', b.x, 2.5, b.z);
          freeze = Math.max(freeze, 0.07); cam.shake = Math.max(cam.shake, 0.35);
        } else if (e.blocked) {
          audio.play('blocked');
          fx.sparks(hitPos, 0xbfe4ff, 5, 5, 0.1);
          fx.flash(hitPos, 0xa8d8ff, 14, 1.2, 0.12);
          floater('拨开 ' + e.dmg, 'dull', b.x, 2.3, b.z);
        } else {
          audio.play('hit');
          fx.sparks(hitPos, 0xff9a6a, 7, 5, 0.13);
          fx.flash(hitPos, 0xffc8a0, 26, 1.8, 0.15);
          floater(String(e.dmg), 'dmg', b.x, 2.3, b.z);
        }
        break;
      }
      case 'playerHurt': {
        hitPos.set(p.x + (b.x - p.x) * 0.25, 1.3, p.z + (b.z - p.z) * 0.25);
        if (e.perfect) {
          audio.play('perfect'); fx.sparks(hitPos, 0xcff6ff, 14, 8, 0.18); fx.flash(hitPos, 0x8fe8ff, 60, 3, 0.25);
          floater('弹开!', 'perfect', p.x, 2.2, p.z); freeze = Math.max(freeze, 0.06);
        } else if (e.guarded) {
          audio.play('guard'); fx.sparks(hitPos, 0xffe0a0, 9, 6, 0.14); fx.flash(hitPos, 0xffd9a0, 30, 2, 0.15);
          floater('格挡 -' + e.dmg, 'guard', p.x, 2.2, p.z); cam.shake = Math.max(cam.shake, e.heavy ? 0.5 : 0.25);
        } else {
          audio.play('hurt'); fx.sparks(hitPos, 0xff4a2a, 9, 5, 0.15); fx.flash(hitPos, 0xff5030, 30, 2.2, 0.18);
          floater('-' + e.dmg, 'hurt', p.x, 2.2, p.z); hurtFlash = 1; cam.shake = Math.max(cam.shake, 0.6); freeze = Math.max(freeze, 0.05);
        }
        break;
      }
      case 'dodge': audio.play('dodge'); break;
      case 'dodged': audio.play('dodged'); floater('闪过', 'dodge', p.x, 2.2, p.z); break;
      case 'tele': audio.play('tele', e); break;
      case 'bossSwing': audio.play('bossSwing', e); if (e.heavy) cam.shake = Math.max(cam.shake, 0.3); break;
      case 'phaseStart':
        audio.play('hiss', { d: 1.3 }); audio.setLevel(3);
        break;
      case 'burst':
        audio.play('boom'); fx.shock(b.x, b.z); cam.shake = 1;
        hitPos.set(b.x, 1.5, b.z); fx.flash(hitPos, 0xff6a20, 120, 6, 0.5); fx.sparks(hitPos, 0xff8a30, 26, 10, 0.2);
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          fx.steam(b.x + Math.cos(a) * 0.5, 1.2, b.z + Math.sin(a) * 0.5, Math.cos(a) * 3.2, 0.9, Math.sin(a) * 3.2, 0.9, 1.6, 0.4, 0xffd0a8);
        }
        banner('第二式 · 炉心沸', 'PHASE TWO — THE FURNACE HEART BOILS', true);
        break;
      case 'phaseTwo': audio.setLevel(2); break;
      case 'followUp': break;
      case 'bossDead':
        audio.setLevel(3); audio.play('hiss', { d: 2 }); freeze = 0.14; slow = 1.3; cam.shake = 0.8;
        break;
      case 'playerDead': audio.setLevel(3); slow = 0.9; break;
      case 'victory': audio.play('victory'); showResult(true); break;
      case 'defeat': audio.play('defeat'); showResult(false); break;
      default: break;
    }
  }

  // ------------------------------------------------------------ per-frame visuals
  const deco = { dChain: 0, dDelay: 0, dRev: 0, dSpin: 0, dLunge: 0, dPunish: 0 };
  const cold = new THREE.Color(0x66b8ff);
  const hot = new THREE.Color(0xff6a1c);
  const cTmp = new THREE.Color();
  const white = new THREE.Color(0xffffff);
  let heat = 0;
  let lastStep = 0;
  world.onBolt = () => audio.play('thunder');
  let ventAcc = 0;
  let ghostAcc = 0;
  function updateVisuals(dt, time) {
    const p = g.player;
    const b = g.boss;
    animatePlayer(pr, p, dt, time);
    animateBoss(br, b, dt, time);
    pr.root.updateMatrixWorld(true);
    br.root.updateMatrixWorld(true);
    // footsteps on the wet stone: one sound and a small spray each time a foot lands
    if (pr.steps !== lastStep) {
      lastStep = pr.steps;
      if (p.moving && g.mode === 'fight') {
        audio.play('step');
        fx.steam(p.x, 0.08, p.z, 0, 0.35, 0, 0.14, 0.28, 0.1, 0x9fb0c4);
      }
    }

    pTrail.update(dt, pr.blades[0], !!pr.trail);
    bTrails[0].update(dt, br.blades[0], !!br.trailR);
    bTrails[1].update(dt, br.blades[1], !!br.trailL);

    // phase colouring: cold steel → furnace heat
    const wantHeat = b.phase === 2 ? 1 : b.st === 'phase' ? Math.min(1, b.t / 2.4) : 0;
    heat += (wantHeat - heat) * Math.min(1, dt * 4);
    cTmp.copy(cold).lerp(hot, heat);
    bTrails[0].color.copy(cTmp); bTrails[1].color.copy(cTmp);
    br.edgeMat.emissive.copy(cTmp).multiplyScalar(0.1 + heat * 1.1);
    br.eyeMat.color.copy(cTmp).lerp(white, 0.25).multiplyScalar(1.6);
    br.packGlow.color.copy(cTmp).multiplyScalar(1.2 + heat * 1.5);
    bossLight.color.copy(cTmp);
    br.vent.getWorldPosition(bossLight.position);
    bossLight.position.y -= 0.25;
    bossLight.intensity = (g.engaged && b.st !== 'dead' ? 1.2 + heat * 9 : 0) * (0.9 + 0.1 * Math.sin(time * 17));
    rim.position.set((p.x + b.x) / 2 - 2.5, 5.5, (p.z + b.z) / 2 + 2.5);

    // boss vents steam when hot, and hisses hard during the transition
    const ventRate = b.st === 'phase' ? 26 : b.st === 'dead' ? 6 : heat > 0.5 ? 7 : b.st === 'recover' ? 4 : 0;
    ventAcc += ventRate * dt;
    if (ventAcc >= 1) {
      ventAcc = 0;
      br.vent.getWorldPosition(tmp);
      fx.steam(tmp.x, tmp.y, tmp.z, (Math.random() - 0.5) * 1.2, 1.6 + Math.random(), (Math.random() - 0.5) * 1.2, 0.35, 0.9, 0.34, heat > 0.5 ? 0xffd8b8 : 0xc4d0de);
    }
    if (p.st === 'dodge') {
      ghostAcc += dt;
      if (ghostAcc > 0.045) { ghostAcc = 0; fx.steam(p.x, 1.0, p.z, 0, 0.2, 0, 0.7, 0.35, 0.22, 0x9fe4ff); }
    }

    // telegraph decals
    const want = { dChain: 0, dDelay: 0, dRev: 0, dSpin: 0, dLunge: 0, dPunish: 0 };
    const s = currentSeg(b);
    const glint = { s: 0, a: 0, c: 0xffffff };
    if (s && (b.st === 'attack' || b.st === 'recover')) {
      const u = Math.min(1, b.segT / s.d);
      const name = b.move.name;
      const pulse = 0.75 + 0.25 * Math.sin(time * 30);
      if (s.k === 'rec') want.dPunish = 0.55 + 0.3 * Math.sin(time * 12);
      else if (s.k === 'wind' && s.tele === 'chain') {
        want.dChain = 0.08 + 0.2 * u;
        const f = Math.max(0, 1 - Math.abs(u - 0.2) * 7) + Math.max(0, 1 - Math.abs(u - 0.55) * 7);
        glint.s = 0.6 + f * 1.6; glint.a = 0.25 + f; glint.c = 0xbfeaff;
      } else if (name === 'chain' && (s.k === 'hit' || s.k === 'gap') && !s.follow) { want.dChain = 0.32; }
      else if (s.tele === 'delay') { want.dDelay = 0.06 + 0.2 * u; glint.s = 0.7 + u * 2.6; glint.a = 0.45 + 0.5 * u; glint.c = 0xff5a22; }
      else if (s.tele === 'delayHold') { want.dDelay = 0.3 * pulse; glint.s = 1.2 + 0.5 * pulse; glint.a = pulse; glint.c = 0xfff0c0; }
      else if (s.anim === 'slam') { want.dDelay = 0.8; }
      else if (s.tele === 'lunge') {
        want.dLunge = 0.12 + 0.3 * u; glint.s = 1.1 + 0.4 * pulse; glint.a = 0.5 + 0.4 * u; glint.c = 0x8fd8ff;
        fx.dLunge.scale.y = Math.max(1, Math.min(10.5, Math.hypot(p.x - b.x, p.z - b.z) - 1.2));
      } else if (s.k === 'dash') { want.dLunge = 0.5; }
      else if (s.tele === 'spin') { want.dSpin = 0.15 + 0.35 * u; glint.s = 1.4 + pulse; glint.a = 0.8; glint.c = 0xffa030; }
      else if (s.anim === 'spin') { want.dSpin = 0.7; }
      else if (s.tele === 'reverse') { want.dRev = 0.15 + 0.3 * u; glint.s = 1.2 + pulse * 0.6; glint.a = 0.8; glint.c = 0xffc040; }
      else if (s.anim === 'reverse') { want.dRev = 0.6; }
    }
    fx.deco.position.set(b.x, 0, b.z);
    fx.deco.rotation.y = b.yaw;
    for (const k in want) {
      const w = k === 'dPunish' ? want[k] * 0.5 : want[k] * 0.15; // floor telegraphs stay readable but sit under the lighting
      deco[k] += (w - deco[k]) * Math.min(1, dt * 18);
      fx[k].material.opacity = deco[k];
      fx[k].visible = deco[k] > 0.01;
    }
    fx.dPunish2.visible = fx.dPunish.visible;
    fx.dPunish2.material.opacity = deco.dPunish * 0.6;
    fx.dPunish2.scale.setScalar(1 + ((time * 1.4) % 1) * 0.5);
    for (let i = 0; i < 2; i++) {
      const sp = fx.glints[i];
      br.blades[i].tip.getWorldPosition(sp.position);
      const a = glint.a > 0 ? Math.min(0.55, glint.a * 0.55) : heat * 0.22;
      sp.material.opacity += (a - sp.material.opacity) * Math.min(1, dt * 25);
      sp.material.color.set(glint.a > 0 ? glint.c : 0xff7a2a);
      sp.scale.setScalar((glint.a > 0 ? Math.min(0.9, glint.s * 0.4) : 0.3));
      sp.visible = sp.material.opacity > 0.02;
    }
    // guard glow on the player's blade
    const gg = fx.guardGlow;
    pr.blades[0].tip.getWorldPosition(gg.position);
    pr.blades[0].base.getWorldPosition(tmp);
    gg.position.lerp(tmp, 0.5);
    const ga = p.guard ? (p.guardT < 0.2 ? 0.22 : 0.03) : 0;
    gg.material.opacity += (ga - gg.material.opacity) * Math.min(1, dt * 20);
    gg.scale.setScalar(p.guard && p.guardT < 0.2 ? 0.55 : 0.4);
    gg.visible = gg.material.opacity > 0.02;
  }

  // ------------------------------------------------------------ main loop
  let last = performance.now();
  let acc = 0;
  let slow = 0;
  let frames = 0;
  let fps = 0;
  let fpsAcc = 0, fpsN = 0;
  let visTime = 0;
  function simInput() {
    let ix = 0, iz = 0;
    for (const k of keys) { const m = MOVE[k]; if (m) { ix += m[0]; iz += m[1]; } }
    ix = Math.max(-1, Math.min(1, ix)); iz = Math.max(-1, Math.min(1, iz));
    // camera-relative movement; while locked on, W always heads for the foe and A/D circle it
    const basis = lockActive() ? cam.yaw - cam.off : cam.yaw;
    const fxv = -Math.sin(basis), fzv = -Math.cos(basis);
    const inp = {
      mx: fxv * iz + -fzv * ix,
      mz: fzv * iz + fxv * ix,
      attack: edge.attack, dodge: edge.dodge,
      guard: mouse.guard || keys.has('KeyK'),
      lock: cam.lock,
    };
    edge.attack = false; edge.dodge = false;
    return inp;
  }
  function frame(now) {
    const real = Math.min(0.1, Math.max(0, (now - last) / 1000)); // clamped frame delta
    last = now;
    wall += real;
    frames++;
    fpsAcc += real; fpsN++;
    if (fpsAcc >= 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
    let scale = 1;
    if (slow > 0) { slow -= real; scale = 0.35; }
    if (freeze > 0) { freeze -= real; scale = 0; }
    if (paused) scale = 0;
    acc += real * scale;
    let n = 0;
    while (acc >= DT && n < 8) { // fixed simulation timestep
      step(g, simInput());
      for (const e of drainEvents(g)) handle(e);
      acc -= DT; n++;
    }
    if (acc > DT * 8) acc = 0;
    const vdt = real * scale;
    visTime += vdt;
    updateVisuals(Math.max(vdt, g.mode === 'fight' ? 0 : real), visTime);
    updateCamera(real);
    world.update(real, wall, g.gateClosed, camera.position);
    fx.update(real, wall, camera);
    updateHud();
    renderer.render(scene, camera);
  }

  // ------------------------------------------------------------ read-only state probe for tests
  const ndc = (x, y, z) => { tmp.set(x, y, z).project(camera); return [+tmp.x.toFixed(3), +tmp.y.toFixed(3), +tmp.z.toFixed(4)]; };
  window.__game = Object.freeze({
    snapshot() {
      const p = g.player;
      const b = g.boss;
      const s = currentSeg(b);
      return {
        mode: g.mode, time: g.time, engaged: g.engaged, gateClosed: g.gateClosed, fights: g.fights,
        backend, frames, fps: +fps.toFixed(1), paused, quality: opts.quality,
        player: { x: p.x, z: p.z, yaw: p.yaw, hp: p.hp, maxHp: p.maxHp, st: p.st, combo: p.combo, guard: p.guard, inv: p.inv, dodgeCd: p.dodgeCd },
        boss: {
          x: b.x, z: b.z, yaw: b.yaw, hp: b.hp, maxHp: b.maxHp, phase: b.phase, st: b.st,
          move: b.move ? b.move.name : null, seg: s ? s.k : null, tele: s ? s.tele || null : null, hitIn: hitIn(b),
        },
        stats: { ...g.stats },
        cam: {
          x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw: cam.yaw, pitch: cam.pitch, lock: cam.lock,
          inBounds: cam.inBounds, t: cam.te, avoid: cam.avoid, playerNdc: ndc(p.x, 1.1, p.z), bossNdc: ndc(b.x, 1.3, b.z),
        },
        arena: ARENA.yard,
      };
    },
    events(sinceT = -1) { return g.log.filter((e) => e.t > sinceT).map((e) => ({ ...e })); },
  });

  updateVisuals(0.016, 0);
  renderer.setAnimationLoop(frame);
}

boot().catch((e) => {
  showError('启动失败 / Failed to start: ' + (e && e.message ? e.message : e));
  throw e;
});
