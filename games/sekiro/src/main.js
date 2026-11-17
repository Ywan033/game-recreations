// Reedmoon Duel — renderer, input, camera, HUD and glue around the fixed-step simulation.
import * as THREE from 'three/webgpu';
import './style.css';
import { createSim, C, MOVES } from './sim.js';
import { buildWorld } from './world.js';
import { Figure, playerPose, bossPose } from './figure.js';
import { Fx } from './fx.js';
import { Sound } from './audio.js';

// Documented test/debug options in the URL hash: #seed=7&gain=2&hurt=3&q=low&mute=1&gl=1
const opt = new URLSearchParams(location.hash.slice(1));
const num = (k) => (opt.has(k) && isFinite(+opt.get(k)) ? +opt.get(k) : undefined);
const low = opt.get('q') === 'low';
const $ = (id) => document.getElementById(id);

const sim = createSim({ seed: num('seed'), gain: num('gain'), hurt: num('hurt') });
const sound = new Sound();
if (opt.get('mute') === '1') sound.muted = true;

async function makeRenderer() {
  let err;
  for (const forceWebGL of opt.get('gl') === '1' ? [true] : [false, true]) {
    try {
      const r = new THREE.WebGPURenderer({ antialias: !low, forceWebGL });
      await r.init();
      return r;
    } catch (e) { err = e; }
  }
  throw err;
}

const renderer = await makeRenderer();
const backend = renderer.backend && renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = !low;
$('view').appendChild(renderer.domElement);
$('backend').textContent = backend + (low ? ' · low' : '');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1820);
const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 600);
const world = buildWorld(scene, low);
const fx = new Fx(scene);

const player = new Figure({ kind: 'player', scale: 1, cloth: 0x394a55, cloth2: 0x232c33, skin: 0xd9b48f, trim: 0xe0662e, trimGlow: 0.55, blade: 0.95, bladeColor: 0xe8eef0, bladeGlow: 0xffc890, trail: 0xffd9a0 });
const boss = new Figure({ kind: 'boss', scale: 1.22, cloth: 0x2a2552, cloth2: 0x191736, skin: 0x1a1a22, trim: 0x39e0c8, trimGlow: 1.2, hat: 0xb9a878, mask: 0xf2ead8, blade: 1.3, bladeColor: 0xd0e4ea, bladeGlow: 0x60e0d0, trail: 0x8ff0e0 });
scene.add(player.root, boss.root, player.trail, boss.trail);
// soft markers under each fighter keep them readable against grass and mist
const mark = (c) => { const m = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 28), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.5, depthWrite: false, fog: false })); m.rotation.x = -Math.PI / 2; m.position.y = 0.03; scene.add(m); return m; };
const pMark = mark(0xffb070), bMark = mark(0x49e6d0);

// ---------------------------------------------------------------- input
let started = false;
const keys = new Set();
const edge = { attack: false, guardPress: false, dodge: false, finisher: false };
let mouseGuard = false;
const cam = { lock: true, yaw: Math.PI, pitch: 0.28, pos: new THREE.Vector3(7, 5, 15), look: new THREE.Vector3(0, 1.2, 0), shake: 0, fwd: new THREE.Vector3(0, 0, -1), mouseX: 0.5 };
let lastMX = null, lastMY = null;

function toggleLock() {
  cam.lock = !cam.lock;
  if (!cam.lock) { cam.yaw = Math.atan2(cam.fwd.x, cam.fwd.z); cam.pitch = 0.28; }
  $('lockTag').classList.toggle('off', !cam.lock);
  $('lockTag').textContent = cam.lock ? '◎ 凝视 Fix Gaze' : '○ 自由视角 Free Look';
}
function begin() {
  sound.init(); sound.active = true; sound.phase = 1; sound.play('start');
  sim.reset(); started = true;
  for (const k in edge) edge[k] = false;
  if (!cam.lock) toggleLock();
  cam.pos.set(7, 5, 15);
  $('title').classList.add('hidden'); $('result').classList.add('hidden'); $('hud').classList.remove('hidden');
  $('bars').classList.remove('on'); $('danger').classList.remove('on');
  setPhaseUI(1);
}
window.addEventListener('keydown', (e) => {
  if (['Space', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  const over = sim.mode === 'victory' || sim.mode === 'defeat';
  if (e.code === 'KeyM') sound.setMuted(!sound.muted);
  if (!started) { if (e.code === 'Enter') begin(); return; }
  if (over) { if ((e.code === 'KeyR' || e.code === 'Enter') && sim.modeT > 0.4) begin(); return; }
  switch (e.code) {
    case 'KeyJ': edge.attack = true; break;
    case 'KeyK': edge.guardPress = true; break;
    case 'Space': edge.dodge = true; break;
    case 'KeyF': case 'KeyE': edge.finisher = true; break;
    case 'KeyQ': case 'Tab': toggleLock(); break;
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); mouseGuard = false; });
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('mousedown', (e) => {
  if (!started || e.target.closest('button')) return;
  e.preventDefault();
  if (e.button === 0) edge.attack = true;
  else if (e.button === 2) { mouseGuard = true; edge.guardPress = true; }
  else if (e.button === 1) toggleLock();
});
window.addEventListener('mouseup', (e) => { if (e.button === 2) mouseGuard = false; });
window.addEventListener('mousemove', (e) => {
  // works with or without pointer lock: uses position deltas
  const dx = lastMX === null ? 0 : e.clientX - lastMX, dy = lastMY === null ? 0 : e.clientY - lastMY;
  lastMX = e.clientX; lastMY = e.clientY; cam.mouseX = e.clientX / window.innerWidth;
  if (!cam.lock && started) { cam.yaw -= dx * 0.005; cam.pitch = Math.max(-0.1, Math.min(0.9, cam.pitch + dy * 0.004)); }
});
$('start').addEventListener('click', begin);
$('retry').addEventListener('click', begin);
window.addEventListener('resize', () => { renderer.setSize(window.innerWidth, window.innerHeight); camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); });

function readInput() {
  const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const fx_ = cam.fwd.x, fz = cam.fwd.z;
  // camera-relative: forward (fx,fz), right (-fz, fx)
  const inp = { mx: fx_ * f - fz * r, mz: fz * f + fx_ * r, guard: mouseGuard || keys.has('KeyK'), locked: cam.lock, ...edge };
  for (const k in edge) edge[k] = false;
  return inp;
}

// ---------------------------------------------------------------- HUD
const ui = { last: {} };
function setBar(id, v) { if (ui.last[id] !== v) { ui.last[id] = v; $(id).style.transform = `scaleX(${v})`; } }
function setPhaseUI(n) {
  document.querySelectorAll('#phase .pip').forEach((p, i) => p.classList.toggle('on', i < n));
  $('phaseText').textContent = n === 1 ? '一幕 · First Tide' : '二幕 · Second Tide';
}
function callout(cn, en, cls) {
  const c = $('callout'); c.className = ''; c.innerHTML = `${cn}<small>${en}</small>`; void c.offsetWidth; c.className = 'show ' + cls;
}
function flash() { const f = $('flash'); f.className = ''; void f.offsetWidth; f.className = 'go'; }
function updateHud() {
  const p = sim.player, b = sim.boss;
  setBar('plHp', Math.round(p.hp / C.PLAYER_HP * 200) / 200); setBar('plSt', Math.round(p.stance) / 100);
  setBar('bossHp', Math.round(b.hp / C.BOSS_HP * 200) / 200); setBar('bossSt', Math.round(b.stance) / 100);
  $('bossSt').parentNode.classList.toggle('hot', b.stance > 75);
  $('plSt').parentNode.classList.toggle('hot', p.stance > 75);
  $('prompt').classList.toggle('on', sim.promptOpen && sim.mode === 'fight');
  const h = sim.nextHit();
  $('danger').classList.toggle('on', !!(h && h.type === 'thrust' && h.inT <= MOVES[b.move].hits[h.idx].cue));
  $('bars').classList.toggle('on', p.state === 'finisher' || b.state === 'phaseShift' || sim.mode === 'intro');
}
function showResult(win) {
  const r = $('result'), st = sim.stats;
  r.className = 'screen ' + (win ? 'win' : 'lose');
  $('resTitle').textContent = win ? '苇静月明' : '折于苇间';
  $('resSub').textContent = win ? 'The reeds fall still' : 'Cut down among the reeds';
  $('resStats').innerHTML = `拨锋 Glances ${st.deflects} · 最长连拨 Longest chain ${st.maxChain} · 踏锁 Bind-Steps ${st.counters} · 月轮 Moonwheels ${st.finishers}`;
  $('prompt').classList.remove('on');
}

// ---------------------------------------------------------------- events from the simulation
const timers = [];
const after = (t, fn) => timers.push({ t: sim.time + t, fn });
const tipPos = new THREE.Vector3();
function handle(e) {
  const y = 1.25;
  switch (e.type) {
    case 'swing': sound.play('swing'); break;
    case 'bossSwing': sound.play('bossSwing'); break;
    case 'dodge': sound.play('dodge'); break;
    case 'hitBoss': sound.play('hitBoss'); fx.burst(e.x, y, e.z, 10, 0x9ff0e0, 5); cam.shake = Math.max(cam.shake, 0.08); break;
    case 'bossBlock': sound.play('bossBlock'); fx.burst(e.x, y, e.z, 6, 0xb0c8d0, 4); break;
    case 'bossDeflect': callout('被拨开', 'Turned aside', 'bad'); break;
    case 'guard': sound.play('guard'); fx.burst(e.x, y, e.z, 8, 0xd0703a, 3.5, { life: 0.3 }); cam.shake = Math.max(cam.shake, 0.12); break;
    case 'deflect':
      sound.play('deflect', e.chain);
      fx.burst(e.x, y, e.z, e.heavy ? 34 : 22, 0xfff0b0, 9, { up: true }); fx.burst(e.x, y, e.z, 8, 0xffffff, 4);
      fx.ring(e.x, y, e.z, 0xfff3c4, 0.15, 1.5, 0.28, false, camera); fx.flash(e.x, y, e.z, 0xffe9b0, 30, 0.2);
      cam.shake = Math.max(cam.shake, e.heavy ? 0.2 : 0.1);
      callout(e.chain > 1 ? `拨锋 ×${e.chain}` : '拨锋', e.chain > 1 ? `Glance chain ${e.chain}` : 'Glance', 'glance');
      break;
    case 'hitPlayer': sound.play('hitPlayer'); fx.burst(e.x, y, e.z, 16, 0xff5a40, 5); cam.shake = Math.max(cam.shake, e.heavy ? 0.4 : 0.22); break;
    case 'playerBroken': sound.play('playerBroken'); callout('重心尽失', 'Your Balance gives way', 'bad'); break;
    case 'cue':
      sound.play('cue'); callout('紫焰', 'Violet flare — step in!', 'warn');
      boss.tip.getWorldPosition(tipPos);
      fx.ring(tipPos.x, tipPos.y, tipPos.z, 0xd24bff, 3.2, 0.15, 0.45, false, camera);
      after(0.14, () => { boss.tip.getWorldPosition(tipPos); fx.ring(tipPos.x, tipPos.y, tipPos.z, 0xff7ae8, 2.4, 0.1, 0.4, false, camera); });
      fx.flash(tipPos.x, tipPos.y, tipPos.z, 0xc040ff, 40, 0.6);
      break;
    case 'counter':
      sound.play('counter'); callout('踏锁', 'Bind-Step', 'bind');
      fx.ring(e.x, 0.06, e.z, 0x8fefff, 0.3, 4.2, 0.55, true); fx.ring(e.x, 0.06, e.z, 0xb070ff, 0.2, 2.6, 0.4, true);
      fx.burst(e.x, 0.2, e.z, 30, 0x9fefff, 6, { up: true, lift: 4, g: 5, life: 0.7 }); fx.flash(e.x, 0.8, e.z, 0x80e8ff, 45, 0.35);
      cam.shake = Math.max(cam.shake, 0.35);
      break;
    case 'break': sound.play('break'); callout('失衡', 'Unbalanced', 'wheel'); fx.ring(e.x, 1.2, e.z, 0xffe9a0, 0.3, 3.4, 0.6, false, camera); fx.burst(e.x, 1.3, e.z, 26, 0xffe9a0, 6); break;
    case 'finisherStart': sound.play('finisherStart'); break;
    case 'finisherHit':
      sound.play('finisherHit'); callout('月轮', 'Moonwheel', 'wheel'); flash();
      fx.sweep(e.x, 1.2, e.z, player.root.rotation.y); fx.burst(e.x, 1.3, e.z, 60, 0xffe2b0, 10, { up: true, lift: 3, life: 0.9 });
      fx.ring(e.x, 0.06, e.z, 0xffd9a0, 0.4, 6, 0.8, true); fx.flash(e.x, 1.4, e.z, 0xfff0d0, 80, 0.6);
      cam.shake = Math.max(cam.shake, 0.5);
      break;
    case 'phase2':
      sound.play('phase2'); sound.phase = 2; setPhaseUI(2);
      after(0.9, () => { callout('二幕 · 潮转', 'Second Tide — the rhythm turns', 'warn'); fx.ring(sim.boss.x, 0.06, sim.boss.z, 0x39e0c8, 0.5, 9, 0.9, true); fx.burst(sim.boss.x, 1.2, sim.boss.z, 40, 0x39e0c8, 8, { up: true }); cam.shake = 0.4; });
      break;
    case 'bossDown': fx.burst(e.x, 1.2, e.z, 40, 0x39e0c8, 4, { g: 1, life: 1.6, lift: 2 }); break;
    case 'victory': sound.play('victory'); sound.active = false; showResult(true); break;
    case 'defeat': sound.play('defeat'); sound.active = false; showResult(false); break;
  }
}

// ---------------------------------------------------------------- camera
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), lastDir = new THREE.Vector3(0, 0, 1);
function updateCamera(dt, t) {
  const p = sim.player, b = sim.boss;
  const want = v1, look = v2;
  let rate = 8;
  if (!started) {
    want.set(Math.sin(t * 0.07) * 8.5, 2.6, Math.cos(t * 0.07) * 8.5); look.set(0, 1.4, 0); rate = 2;
  } else if (p.state === 'finisher' || b.state === 'phaseShift' || b.state === 'dying') {
    const dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz) || 1;
    const ps = b.state === 'phaseShift', side = ps ? 0.35 : 1, fwd = ps ? 6 : 1.2;
    want.set(b.x + (-dz / d) * 3.6 * side + dx / d * fwd, ps ? 2.3 : 1.5, b.z + (dx / d) * 3.6 * side + dz / d * fwd);
    look.set(b.x, 1.25, b.z); rate = 5;
  } else if (cam.lock) {
    let dx = p.x - b.x, dz = p.z - b.z; const d = Math.hypot(dx, dz);
    if (d > 0.3) lastDir.set(dx / d, 0, dz / d);
    const back = 4.4 + d * 0.22;
    want.set(p.x + lastDir.x * back - lastDir.z * 1.7, 2.75 + d * 0.06, p.z + lastDir.z * back + lastDir.x * 1.7);
    look.set(p.x * 0.42 + b.x * 0.58, 1.2, p.z * 0.42 + b.z * 0.58);
    if (sim.mode === 'intro') rate = 2.2;
  } else {
    // free look: mouse deltas, arrow keys, and gentle edge-turn when the cursor rests at a screen edge
    const turn = (keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0) + (cam.mouseX < 0.03 ? 0.7 : cam.mouseX > 0.97 ? -0.7 : 0);
    cam.yaw += turn * 2.2 * dt;
    cam.pitch = Math.max(-0.1, Math.min(0.9, cam.pitch + ((keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0)) * dt));
    const cp = Math.cos(cam.pitch);
    want.set(p.x - Math.sin(cam.yaw) * cp * 5.6, 1.5 + Math.sin(cam.pitch) * 5.6, p.z - Math.cos(cam.yaw) * cp * 5.6);
    look.set(p.x, 1.35, p.z); rate = 14;
  }
  const r = Math.hypot(want.x, want.z), maxR = C.ARENA_R + 0.7;
  if (started && r > maxR) { want.x *= maxR / r; want.z *= maxR / r; want.y += (r - maxR) * 0.35; }
  cam.pos.lerp(want, 1 - Math.exp(-dt * rate));
  cam.look.lerp(look, 1 - Math.exp(-dt * (rate + 3)));
  camera.position.copy(cam.pos);
  if (cam.shake > 0.002) { camera.position.x += (Math.random() - 0.5) * cam.shake; camera.position.y += (Math.random() - 0.5) * cam.shake; cam.shake *= Math.exp(-dt * 9); }
  camera.lookAt(cam.look);
  cam.fwd.set(cam.look.x - cam.pos.x, 0, cam.look.z - cam.pos.z).normalize();
  camera.updateMatrixWorld();
}

// ---------------------------------------------------------------- frame loop
const violet = new THREE.Color(0xc040ff), amber = new THREE.Color(0xffa040), teal = new THREE.Color(0x60e0d0);
let lastT = performance.now(), acc = 0, frames = 0, fps = 0, fpsAcc = 0, fpsN = 0, wall = 0;
function frame() {
  const now = performance.now();
  const raw = (now - lastT) / 1000; lastT = now;
  const dt = Math.min(0.05, Math.max(0, raw)); // clamped frame delta
  wall += dt; fpsAcc += raw; fpsN++;
  if (fpsAcc >= 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  if (started) {
    acc += dt;
    while (acc >= C.STEP) {
      acc -= C.STEP;
      sim.step(readInput());
      for (const e of sim.events) handle(e);
      sim.events.length = 0;
      for (let i = timers.length - 1; i >= 0; i--) if (timers[i].t <= sim.time) { timers.splice(i, 1)[0].fn(); }
    }
  }
  const p = sim.player, b = sim.boss;
  const [pp, pr, pe] = playerPose(sim), [bp, br, be] = bossPose(sim);
  const still = sim.hitstop > 0 ? 0 : dt;
  player.update(still, p.x, p.z, p.face, pp, pr, pe);
  boss.update(still, b.x, b.z, b.face, bp, br, be);
  pMark.position.set(p.x, 0.03, p.z); bMark.position.set(b.x, 0.03, b.z);
  // blade tells: violet for the unguardable lunge, amber while a heavy blow is raised
  const h = sim.nextHit();
  const m = boss.bladeMat;
  if (h && h.type === 'thrust' && h.inT <= MOVES[b.move].hits[h.idx].cue) { m.emissive.copy(violet); m.emissiveIntensity = 5 + Math.sin(wall * 40) * 2; }
  else if (h && h.type === 'heavy') { m.emissive.copy(amber); m.emissiveIntensity = 1.6; }
  else { m.emissive.copy(teal); m.emissiveIntensity = 0.35; }
  bMark.material.color.set(b.state === 'broken' ? 0xfff0a0 : 0x49e6d0); bMark.scale.setScalar(b.state === 'broken' ? 1.5 + Math.sin(wall * 8) * 0.15 : 1.25);
  fx.update(dt);
  updateCamera(dt, wall);
  world.update(wall, camera);
  if (started) updateHud();
  renderer.render(scene, camera);
  frames++;
}

// ---------------------------------------------------------------- read-only state probe for tests
const ndc = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(camera); return { x: +v.x.toFixed(3), y: +v.y.toFixed(3), front: v.z < 1 }; };
Object.defineProperty(window, '__game', {
  value: Object.freeze({
    get snap() {
      const p = sim.player, b = sim.boss, h = sim.nextHit();
      return {
        mode: started ? sim.mode : 'title', time: sim.time, frames, fps, backend,
        player: { x: p.x, z: p.z, face: p.face, hp: p.hp, stance: p.stance, state: p.state },
        boss: { x: b.x, z: b.z, hp: b.hp, stance: b.stance, state: b.state, phase: b.phase, move: b.state === 'attack' ? b.move : null, movesSeen: { 1: b.movesSeen[1].slice(), 2: b.movesSeen[2].slice() } },
        dist: Math.hypot(p.x - b.x, p.z - b.z),
        nextHit: h, hitSeq: sim.hitSeq, chain: sim.chain, promptOpen: sim.promptOpen, stats: { ...sim.stats },
        camera: { lock: cam.lock, yaw: Math.atan2(cam.fwd.x, cam.fwd.z), x: cam.pos.x, y: cam.pos.y, z: cam.pos.z },
        bossScreen: ndc(b.x, 1.3, b.z), playerScreen: ndc(p.x, 1.0, p.z),
        options: { ...sim.opts, low },
      };
    },
  }),
});

updateCamera(0.016, 0);
cam.pos.set(0, 2.6, 8.5);
renderer.setAnimationLoop(frame);
