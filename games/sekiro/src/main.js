// Reedmoon Duel — renderer, input, camera, HUD and glue around the fixed-step simulation.
import * as THREE from 'three/webgpu';
import './style.css';
import { createSim, C, MOVES, CHARGE } from './sim.js';
import { buildWorld } from './world.js';
import { Figure, playerPose, bossPose, POSE_NAMES } from './figure.js';
import { Fx } from './fx.js';
import { Sound } from './audio.js';

// Documented test/debug options in the URL hash: #seed=7&gain=2&hurt=3&q=low&mute=1&gl=1&auto=0
// plus two evidence-only options: #rec=1 (recording hook, see below) and #legacyclamp=1 (old frame clamp, for timing A/B).
const opt = new URLSearchParams(location.hash.slice(1));
const num = (k) => (opt.has(k) && isFinite(+opt.get(k)) ? +opt.get(k) : undefined);
const low = opt.get('q') === 'low';
const legacyClamp = opt.get('legacyclamp') === '1';
const legacyCam = opt.get('legacycam') === '1'; // evidence-only: the lock-on camera as it was before the duel pass
const $ = (id) => document.getElementById(id);

const sim = createSim({ seed: num('seed'), gain: num('gain'), hurt: num('hurt') });
const sound = new Sound();
if (opt.get('mute') === '1') sound.muted = true;

// A software rasteriser (no hardware GPU) is recognised up front so it never pays for MSAA; the
// frame-rate governor below then picks the tier from measured frame times.
async function softwareGPU() {
  const soft = /swiftshader|llvmpipe|softpipe|software|basic render/i;
  try {
    if (navigator.gpu && opt.get('gl') !== '1') {
      const ad = await navigator.gpu.requestAdapter(), info = (ad && ad.info) || {};
      if (ad && (ad.isFallbackAdapter || info.isFallbackAdapter || soft.test([info.vendor, info.architecture, info.device, info.description].join(' ')))) return true;
    }
  } catch (e) { /* fall through to the WebGL probe */ }
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    const lose = gl && gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    return soft.test(name);
  } catch (e) { return false; }
}
const software = await softwareGPU();

async function makeRenderer() {
  let err;
  for (const forceWebGL of opt.get('gl') === '1' ? [true] : [false, true]) {
    try {
      const r = new THREE.WebGPURenderer({ antialias: !low && !software, forceWebGL });
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
renderer.toneMappingExposure = 1.5;
renderer.shadowMap.enabled = !low;
$('view').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070b10);
const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 600);
const world = buildWorld(scene, low);
const fx = new Fx(scene);

// Muted, layered clothing: slate robe over a pale under-robe for the Reedcutter; dark robe, thatch
// mantle and hat, bone mask for the Warden.
const PLAYER_STYLE = { kind: 'player', scale: 1, robe: 0x4a4d50, under: 0xa39d8e, collar: 0x2c3034, trouser: 0x2a2b2c, sash: 0x7a4630, leather: 0x4a3626, wrap: 0x6f6b5e, shoe: 0x3a372f, skin: 0xb89070, straw: 0x6e6242, blade: 0.82, bladeW: 0.034, curve: 0.02, hilt: 0.27, grip: 0x2a2622, bladeColor: 0xdfe6ea, bladeGlow: 0x9fb4c8, trail: 0xdfe8f2 };
const BOSS_STYLE = { kind: 'boss', scale: 1.15, robe: 0x302e38, under: 0x626066, collar: 0x16151c, trouser: 0x1c1b21, sash: 0x345750, leather: 0x4a4034, wrap: 0x3e3c38, shoe: 0x242321, skin: 0x9a846c, straw: 0x6f6545, cloak: 0x232228, mask: 0xa9a391, eye: 0x3f8f84, blade: 1.22, bladeW: 0.04, curve: 0.045, hilt: 0.36, grip: 0x1c2a2a, bladeColor: 0xd6e2e8, bladeGlow: 0x8fa8c0, trail: 0xd4e6ee };
const player = new Figure(PLAYER_STYLE);
const boss = new Figure(BOSS_STYLE);
scene.add(player.root, boss.root, player.trail, boss.trail);
// footsteps come from the feet actually landing (figure.js), so they follow the visible gait
player.onStep = (sp) => { if (started && !paused && sim.mode !== 'intro' && sim.player.y <= 0) sound.play('step', Math.min(1, 0.4 + sp / 7)); };
boss.onStep = (sp) => { if (started && !paused && sim.mode === 'fight') sound.play('step', Math.min(0.6, 0.25 + sp / 10)); };

// Recording hook, present only with #rec=1 (used by tests/record-clip.mjs for the evidence clip and
// the audio measurements). It reads the picture and the master output; it cannot change game state.
if (opt.get('rec') === '1') {
  let mr = null, chunks = [];
  window.__rec = {
    startVideo(bits = 1300000) {
      const st = renderer.domElement.captureStream(30), a = sound.tapStream();
      if (a) for (const t of a.getAudioTracks()) st.addTrack(t);
      const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
      chunks = []; mr = new MediaRecorder(st, { mimeType: type, videoBitsPerSecond: bits, audioBitsPerSecond: 96000 });
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mr.start(500);
      return { type, audioTracks: st.getAudioTracks().length, videoTracks: st.getVideoTracks().length };
    },
    stopVideo: () => new Promise((res) => {
      mr.onstop = () => { const blob = window.__rec.blob = new Blob(chunks, { type: 'video/webm' }), fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); };
      mr.stop();
    }),
    startPcm: (bus) => sound.startPcm(bus),
    stopPcm: (wav, bus) => sound.stopPcm(wav, bus),
    // one blade sound rendered alone (offline), as base64 Float32 mono at 48 kHz — for tests/measure-audio.mjs
    render: async (name, a) => { const d = new Uint8Array((await Sound.render(name, a)).buffer); let s = ''; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000)); return btoa(s); },
  };
}
// faint ground rings: barely there in normal play, bright only while the Warden is Unbalanced
const mark = (c, o) => { const m = new THREE.Mesh(new THREE.RingGeometry(0.52, 0.6, 32), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, fog: false })); m.rotation.x = -Math.PI / 2; m.position.y = 0.03; scene.add(m); return m; };
const pMark = mark(0xcfd8e4, 0.1), bMark = mark(0x8fd8cc, 0.14);
// soft contact shadows under the feet, used when the shadow-map pass is switched off
const blobTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.62)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const blob = (s) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.scale.set(1.5 * s, 2.3 * s, 1); m.position.y = 0.02; m.visible = false; scene.add(m); return m; };
const pBlob = blob(1), bBlob = blob(1.2);

// ---------------------------------------------------------------- automatic quality scaling
// Tier 0 is the full picture. When the measured frame rate is low the governor steps down:
// fewer reed and grass instances, no shadow-map pass (contact blobs instead), lower render scale.
// It only ever steps down, so the picture does not flicker between levels.
const dpr = low ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
const TIER_SCALE = [dpr, Math.min(dpr, 1), Math.min(dpr, 1), 0.75, 0.55];
const quality = { tier: -1, auto: opt.get('auto') !== '0', acc: 0, n: 0, skip: 4, log: [] };
function setTier(t) {
  t = Math.max(0, Math.min(TIER_SCALE.length - 1, t));
  if (t === quality.tier) return;
  quality.tier = t;
  renderer.setPixelRatio(TIER_SCALE[t]);
  world.setQuality(t);
  pBlob.visible = bBlob.visible = !world.shadows && !gallery;
  $('backend').textContent = backend + (low ? ' · low' : '') + (t ? ' · Q' + t : '');
}
function governQuality(raw) {
  if (!quality.auto || quality.tier >= TIER_SCALE.length - 1 || document.hidden) return;
  if (quality.skip > 0) { quality.skip--; return; } // first frames after a change include compile hitches
  if (raw > 1.5) return; // a stall (tab switch, debugger), not a frame time
  quality.acc += raw; quality.n++;
  if ((quality.n >= 8 && quality.acc >= 0.6) || (quality.n >= 3 && quality.acc >= 1.2)) {
    const f = quality.n / quality.acc;
    quality.log.push(+f.toFixed(1)); if (quality.log.length > 12) quality.log.shift();
    if (f < 27) setTier(quality.tier + (f < 6 ? 3 : f < 14 ? 2 : 1));
    quality.acc = 0; quality.n = 0; quality.skip = 2;
  }
}

// Dev option #gallery=player|boss[&gy=<yaw>]: every pose side by side, for checking silhouettes.
const gallery = opt.get('gallery');
let galFigs = null;
if (gallery) {
  const gy = num('gy') ?? 0.7;
  const page = num('gp') ?? 0;
  galFigs = POSE_NAMES.slice(page * 10, page * 10 + 10).map((n, i) => { const f = new Figure(gallery === 'boss' ? BOSS_STYLE : PLAYER_STYLE); scene.add(f.root); return { f, n, x: (i - 4.5) * 1.3, z: 0, gy }; });
  player.root.visible = boss.root.visible = pMark.visible = bMark.visible = false;
  $('title').classList.add('hidden');
}

// ---------------------------------------------------------------- input
// Final key scheme: Left Shift = Step / Bind-Step, Space = jump, J / left mouse = cut (tap) or
// Reaping Cut (hold, release when charged), R = Dew Gourd (flask) during the fight, K / right mouse =
// guard, F / E = Moonwheel, Q / Tab / middle mouse = Fix Gaze, P / Esc = pause, M = mute, Enter = begin / retry.
let started = false, paused = false;
const keys = new Set();
const edge = { attack: false, guardPress: false, dodge: false, finisher: false, jump: false, drink: false };
let mouseGuard = false, mouseAtk = false;
function clearInput() { keys.clear(); mouseGuard = mouseAtk = false; for (const k in edge) edge[k] = false; }
function setPaused(v) {
  if (v === paused || !started || sim.mode === 'victory' || sim.mode === 'defeat') return;
  paused = v;
  clearInput(); sim.clearActions(); // no charge, jump or half-drunk flask survives a pause
  $('pause').classList.toggle('hidden', !v);
  sound.setPaused(v);
}
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
  sim.reset(); started = true; paused = false; $('pause').classList.add('hidden'); sound.setPaused(false);
  clearInput(); ui.flask = -1;
  if (!cam.lock) toggleLock();
  $('title').classList.add('hidden'); $('result').classList.add('hidden'); $('hud').classList.remove('hidden');
  $('bars').classList.remove('on'); $('danger').classList.remove('on');
  setPhaseUI(1);
}
window.addEventListener('keydown', (e) => {
  if (['Space', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  if (e.repeat) return; // every action below is edge-triggered: holding a key never repeats it
  const over = sim.mode === 'victory' || sim.mode === 'defeat';
  if (e.code === 'KeyM') { sound.setMuted(!sound.muted); $('muteTag').classList.toggle('hidden', !sound.muted); }
  if (!started) { if (e.code === 'Enter') begin(); return; }
  // result screen: Enter (or the button) only. R is the flask key and does nothing here.
  if (over) { if (e.code === 'Enter' && sim.modeT > 0.4) begin(); return; }
  if (e.code === 'KeyP' || e.code === 'Escape') { setPaused(!paused); return; }
  if (paused) return;
  keys.add(e.code);
  switch (e.code) {
    case 'KeyJ': edge.attack = true; break;
    case 'KeyK': edge.guardPress = true; break;
    case 'ShiftLeft': edge.dodge = true; break;
    case 'Space': edge.jump = true; break;
    case 'KeyR': edge.drink = true; break;
    case 'KeyF': case 'KeyE': edge.finisher = true; break;
    case 'KeyQ': case 'Tab': toggleLock(); break;
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { clearInput(); if (started) sim.clearActions(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && started && sim.mode === 'fight') setPaused(true); });
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('mousedown', (e) => {
  if (!started || paused || e.target.closest('button')) return;
  e.preventDefault();
  if (e.button === 0) { edge.attack = true; mouseAtk = true; }
  else if (e.button === 2) { mouseGuard = true; edge.guardPress = true; }
  else if (e.button === 1) toggleLock();
});
window.addEventListener('mouseup', (e) => { if (e.button === 2) mouseGuard = false; if (e.button === 0) mouseAtk = false; });
window.addEventListener('mousemove', (e) => {
  // works with or without pointer lock: uses position deltas
  const dx = lastMX === null ? 0 : e.clientX - lastMX, dy = lastMY === null ? 0 : e.clientY - lastMY;
  lastMX = e.clientX; lastMY = e.clientY; cam.mouseX = e.clientX / window.innerWidth;
  if (!cam.lock && started) { cam.yaw -= dx * 0.005; cam.pitch = Math.max(-0.1, Math.min(0.9, cam.pitch + dy * 0.004)); }
});
$('start').addEventListener('click', begin);
$('retry').addEventListener('click', begin);
$('resume').addEventListener('click', () => setPaused(false));
window.addEventListener('resize', () => { renderer.setSize(window.innerWidth, window.innerHeight); camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); });

function readInput() {
  const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const fx_ = cam.fwd.x, fz = cam.fwd.z;
  // camera-relative: forward (fx,fz), right (-fz, fx)
  const inp = { mx: fx_ * f - fz * r, mz: fz * f + fx_ * r, guard: mouseGuard || keys.has('KeyK'), attackHeld: mouseAtk || keys.has('KeyJ'), locked: cam.lock, ...edge };
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
  if (ui.flask !== p.flask) {
    ui.flask = p.flask;
    document.querySelectorAll('#flask .gd').forEach((g, i) => g.classList.toggle('on', i < p.flask));
    $('flaskN').textContent = '×' + p.flask;
  }
  // charge meter under the Balance bar: fills over the wind-up, gold once the Reaping Cut is ready
  const ch = p.state === 'charge' ? Math.min(1, (p.t - CHARGE.COMMIT) / (CHARGE.FULL - CHARGE.COMMIT)) : 0;
  setBar('chargeFill', Math.round(ch * 50) / 50);
  $('charge').classList.toggle('on', p.state === 'charge'); $('charge').classList.toggle('full', p.state === 'charge' && p.chargeFull);
}
function flaskDeny() { const f = $('flask'); f.classList.remove('deny'); void f.offsetWidth; f.classList.add('deny'); }
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
    case 'hitBoss':
      sound.play(e.heavy ? 'heavyHit' : 'hitBoss'); fx.burst(e.x, y, e.z, e.heavy ? 26 : 10, 0x9ff0e0, e.heavy ? 8 : 5); cam.shake = Math.max(cam.shake, e.heavy ? 0.28 : 0.08); boss.kick(e.heavy ? 1.1 : 0.55, 0.2);
      if (e.heavy) { callout('刈斩', 'Reaping Cut', 'reap'); fx.ring(e.x, y, e.z, 0xbfe8ff, 0.2, 2.2, 0.35, false, camera); }
      break;
    case 'bossBlock':
      sound.play(e.heavy ? 'heavyBlock' : 'bossBlock'); fx.burst(e.x, y, e.z, e.heavy ? 18 : 6, 0xb0c8d0, e.heavy ? 7 : 4); boss.kick(e.heavy ? 0.9 : 0.3, 0.3); player.kick(0.25, -0.5);
      if (e.heavy) { callout('破架', 'Guard beaten down', 'reap'); cam.shake = Math.max(cam.shake, 0.2); }
      break;
    case 'jump': sound.play('jump'); break;
    case 'land': sound.play('land'); fx.burst(sim.player.x, 0.1, sim.player.z, 8, 0x6f7a5a, 2.2, { life: 0.35 }); player.dip.v -= 0.9; break;
    case 'chargeStart': sound.play('chargeStart'); break;
    case 'chargeFull': // visible + audible "ready": pale-blue flare on the blade and a two-note chime
      sound.play('chargeFull');
      player.tip.getWorldPosition(tipPos);
      fx.ring(tipPos.x, tipPos.y, tipPos.z, 0xbfe8ff, 0.1, 1.3, 0.35, false, camera); fx.flash(tipPos.x, tipPos.y, tipPos.z, 0xa8dcff, 26, 0.3);
      break;
    case 'heavySwing': sound.play('heavySwing'); break;
    case 'chargeBreak': sound.stopCharge(); callout('蓄势被破', 'Charge broken', 'bad'); break;
    case 'drinkStart': sound.play('drinkStart'); break;
    case 'heal':
      sound.play('heal'); callout('甘露', `Dew Gourd  +${Math.round(e.amount)}`, 'heal');
      fx.burst(sim.player.x, 1.3, sim.player.z, 18, 0x9be8b4, 2.4, { up: true, lift: 2.5, g: -1, life: 0.9 }); fx.ring(sim.player.x, 0.06, sim.player.z, 0x8fe0a8, 0.3, 1.6, 0.6, true);
      break;
    case 'drinkBreak': callout('饮药被断', 'Drink interrupted — nothing spent', 'bad'); break;
    case 'drinkFail': sound.play('deny'); flaskDeny(); callout(e.empty ? '葫芦已空' : '气血已满', e.empty ? 'The gourd is empty' : 'Already at full health', 'deny'); break;
    case 'bossDeflect': callout('被拨开', 'Turned aside', 'bad'); player.kick(0.7, -1); break;
    case 'guard': sound.play('guard', e.heavy); fx.burst(e.x, y, e.z, 8, 0xd0703a, 3.5, { life: 0.3 }); cam.shake = Math.max(cam.shake, 0.12); player.kick(0.95, 0.3); boss.kick(0.2); break;
    case 'deflect':
      sound.play('deflect', e.chain);
      // sharp beat: the Reedcutter's blade snaps out and rebounds, the Warden's is thrown wide
      player.kick(e.heavy ? 0.65 : 0.4); boss.kick(e.heavy ? 1.1 : 0.75, (e.chain % 2 ? 1 : -1) * 1.15);
      fx.burst(e.x, y, e.z, e.heavy ? 34 : 22, 0xfff0b0, 9, { up: true }); fx.burst(e.x, y, e.z, 8, 0xffffff, 4);
      fx.ring(e.x, y, e.z, 0xfff3c4, 0.15, 1.5, 0.28, false, camera); fx.flash(e.x, y, e.z, 0xffe9b0, 30, 0.2);
      cam.shake = Math.max(cam.shake, e.heavy ? 0.2 : 0.1);
      callout(e.chain > 1 ? `拨锋 ×${e.chain}` : '拨锋', e.chain > 1 ? `Glance chain ${e.chain}` : 'Glance', 'glance');
      break;
    case 'hitPlayer': sound.play('hitPlayer', e.heavy); fx.burst(e.x, y, e.z, 16, 0xff5a40, 5); cam.shake = Math.max(cam.shake, e.heavy ? 0.4 : 0.22); player.kick(e.heavy ? 1.3 : 0.8, 0.4); break;
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
      cam.shake = Math.max(cam.shake, 0.35); boss.kick(0.6);
      break;
    case 'break': boss.kick(1.1, 0.5); sound.play('break'); callout('失衡', 'Unbalanced', 'wheel'); fx.ring(e.x, 1.2, e.z, 0xffe9a0, 0.3, 3.4, 0.6, false, camera); fx.burst(e.x, 1.3, e.z, 26, 0xffe9a0, 6); break;
    case 'finisherStart': sound.play('finisherStart'); break;
    case 'finisherHit':
      sound.play('finisherHit'); callout('月轮', 'Moonwheel', 'wheel'); flash();
      fx.sweep(e.x, 1.2, e.z, player.root.rotation.y); fx.burst(e.x, 1.3, e.z, 60, 0xffe2b0, 10, { up: true, lift: 3, life: 0.9 });
      fx.ring(e.x, 0.06, e.z, 0xffd9a0, 0.4, 6, 0.8, true); fx.flash(e.x, 1.4, e.z, 0xfff0d0, 80, 0.6);
      cam.shake = Math.max(cam.shake, 0.5); boss.kick(1.3);
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
const lk = { on: false, t: 0, ang: 0, ax: 0, az: 0, side: 1.9, back: 4.2, h: 2, comp: 0 }, v3 = new THREE.Vector3();
function updateCamera(dt, t) {
  const p = sim.player, b = sim.boss;
  const want = v1, look = v2;
  let rate = 8;
  if (galFigs) {
    want.set(0, 1.9, 8.2); look.set(0, 0.95, 0); rate = 50;
  } else if (!started) {
    // composed title view: both fighters and the moon sit in the left half, clear of the text panel
    const sway = Math.sin(t * 0.11) * 0.3;
    want.set(3.6 + sway, 1.55, 9.6); look.set(1.5 + sway * 0.6, 1.3, -0.2); rate = 2;
  } else if (p.state === 'finisher' || b.state === 'phaseShift' || b.state === 'dying') {
    const dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz) || 1;
    const ps = b.state === 'phaseShift', side = ps ? 0.35 : 1, fwd = ps ? 6 : 1.2;
    want.set(b.x + (-dz / d) * 3.6 * side + dx / d * fwd, ps ? 2.3 : 1.5, b.z + (dx / d) * 3.6 * side + dz / d * fwd);
    look.set(b.x, 1.25, b.z); rate = 5;
  } else if (cam.lock && !legacyCam) {
    // Lock-on camera, composed in the duel's own frame instead of chasing a world-space point:
    // a smoothed bearing (Warden -> Reedcutter), a lightly smoothed anchor on the Reedcutter, and
    // smoothed back / side / height offsets. Circling therefore no longer drags the lens onto the
    // line between the two fighters (the old world-space chase lagged ~1 m sideways while strafing
    // and put the Reedcutter in front of the Warden). The side never flips; every offset is eased.
    const dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz);
    const tgt = d > 0.3 ? Math.atan2(dx, dz) : lk.ang, e = (r) => 1 - Math.exp(-dt * r);
    if (!lk.on) { lk.on = true; lk.t = 0; lk.ang = tgt; lk.ax = p.x; lk.az = p.z; }
    lk.t += dt;
    // (turn rate capped at 6 rad/s: when the Warden leaps or lunges past, the lens swings round instead of whipping)
    lk.ang += Math.max(-6 * dt, Math.min(6 * dt, Math.atan2(Math.sin(tgt - lk.ang), Math.cos(tgt - lk.ang)) * e(16)));
    // what is left of the bearing error swings the lens toward the sight line when the Reedcutter circles to the lens side; counter it below
    const swing = Math.min(0.5, Math.max(0, -Math.atan2(Math.sin(tgt - lk.ang), Math.cos(tgt - lk.ang))));
    lk.ax += (p.x - lk.ax) * e(11); lk.az += (p.z - lk.az) * e(11);
    const near = 1 - Math.max(0, Math.min(1, (d - 1.2) / 2.2));
    lk.side += (1.8 + Math.min(0.3, d * 0.05) + near * 0.45 - lk.side) * e(5);
    lk.back += (3.0 + d * 0.22 - lk.back) * e(5);
    lk.h += (1.7 + d * 0.06 + near * 0.5 - lk.h) * e(5);
    const sx = Math.sin(lk.ang), sz = Math.cos(lk.ang);
    // the anchor trails a moving Reedcutter; when that trail eats into the shoulder offset, widen it by the same amount
    const lag = Math.max(0, (p.x - lk.ax) * -sz + (p.z - lk.az) * sx);
    lk.comp += (lag * 0.9 + lk.back * Math.tan(swing) * 0.9 - lk.comp) * e(24); // eased, so a lunge past the Reedcutter cannot kick the lens sideways
    const side = lk.side + lk.comp;
    want.set(lk.ax + sx * lk.back - sz * side, lk.h + p.y * 0.45, lk.az + sz * lk.back + sx * side);
    look.set(p.x * 0.42 + b.x * 0.58, 1.1 + p.y * 0.4, p.z * 0.42 + b.z * 0.58);
    // entering lock-on (from the intro, free look or a finisher view) eases in; after that the lens holds its composed spot
    rate = sim.mode === 'intro' ? 2.2 : 5 + 30 * Math.min(1, lk.t / 0.9) ** 2;
    if (sim.mode === 'intro') lk.t = 0;
  } else if (cam.lock) {
    // previous lock-on camera, kept only behind #legacycam=1 so tests/measure-occlusion.mjs can
    // measure the old behaviour against the new one on the same build
    let dx = p.x - b.x, dz = p.z - b.z; const d = Math.hypot(dx, dz);
    if (d > 0.3) lastDir.set(dx / d, 0, dz / d);
    // closer and lower than before so the Warden's feet, blade and wind-up read clearly; the
    // shoulder offset keeps the Reedcutter off the line between the lens and the Warden
    // (at sword's length the lens also rises and swings wider, so the Warden shows past the Reedcutter's shoulder)
    const near = 1 - Math.max(0, Math.min(1, (d - 1.2) / 2.2));
    const back = 3.15 + d * 0.2, side = 1.55 + Math.min(0.3, d * 0.04) + near * 0.55;
    want.set(p.x + lastDir.x * back - lastDir.z * side, 1.95 + d * 0.07 + near * 0.5 + p.y * 0.45, p.z + lastDir.z * back + lastDir.x * side);
    look.set(p.x * 0.4 + b.x * 0.6, 1.02 + p.y * 0.4, p.z * 0.4 + b.z * 0.6);
    if (sim.mode === 'intro') rate = 2.2;
  } else {
    // free look: mouse deltas, arrow keys, and gentle edge-turn when the cursor rests at a screen edge
    const turn = (keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0) + (cam.mouseX < 0.03 ? 0.7 : cam.mouseX > 0.97 ? -0.7 : 0);
    cam.yaw += turn * 2.2 * dt;
    cam.pitch = Math.max(-0.1, Math.min(0.9, cam.pitch + ((keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0)) * dt));
    const cp = Math.cos(cam.pitch);
    want.set(p.x - Math.sin(cam.yaw) * cp * 4.9, 1.45 + Math.sin(cam.pitch) * 4.9 + p.y * 0.45, p.z - Math.cos(cam.yaw) * cp * 4.9);
    look.set(p.x, 1.3 + p.y * 0.5, p.z); rate = 14;
  }
  if (!(started && cam.lock && !legacyCam && !galFigs && !(p.state === 'finisher' || b.state === 'phaseShift' || b.state === 'dying'))) lk.on = false;
  // the camera may back a few metres into the reed belt (stalks around it lie down, see world.js)
  const r = Math.hypot(want.x, want.z), maxR = C.ARENA_R + 3.4;
  if (started && r > maxR) { want.x *= maxR / r; want.z *= maxR / r; want.y += (r - maxR) * 0.12; }
  v3.copy(cam.pos);
  cam.pos.lerp(want, 1 - Math.exp(-dt * rate));
  // locked on in the fight, the lens never travels faster than 26 m/s (a Bind-Step relocation or a lunge past is followed, not
  // jumped to). Circling at 2 m already needs about 14 m/s, so a lower cap lets the Reedcutter drift in front of the Warden.
  if (lk.on && sim.mode === 'fight' && dt > 0) { const st = cam.pos.distanceTo(v3), mx = 26 * dt; if (st > mx) cam.pos.lerpVectors(v3, cam.pos, mx / st); }
  cam.look.lerp(look, 1 - Math.exp(-dt * (rate + 3)));
  camera.position.copy(cam.pos);
  if (cam.shake > 0.002) { camera.position.x += (Math.random() - 0.5) * cam.shake; camera.position.y += (Math.random() - 0.5) * cam.shake; cam.shake *= Math.exp(-dt * 9); }
  camera.lookAt(cam.look);
  cam.fwd.set(cam.look.x - cam.pos.x, 0, cam.look.z - cam.pos.z).normalize();
  camera.updateMatrixWorld();
}

// ---------------------------------------------------------------- frame loop
const violet = new THREE.Color(0xc040ff), amber = new THREE.Color(0xffa040), teal = new THREE.Color(BOSS_STYLE.bladeGlow);
let lastT = performance.now(), acc = 0, steps = 0, frames = 0, fps = 0, fpsAcc = 0, fpsN = 0, wall = 0;
function frame() {
  const now = performance.now();
  const raw = (now - lastT) / 1000; lastT = now;
  // Frame-rate independence: the simulation runs as many fixed 60 Hz steps as the elapsed wall
  // time needs, so the duel keeps real-time durations at 10–20 fps. The frame delta is clamped to
  // 250 ms (at most 15 catch-up steps), so a long stall such as a tab switch is dropped, not replayed.
  // (#legacyclamp=1 restores the previous 50 ms in-fight clamp, only so tests/measure-timing.mjs can
  // measure the old slow-motion behaviour against the new one on the same build.)
  const dt = Math.min(legacyClamp && started && sim.mode === 'fight' ? 0.05 : 0.25, Math.max(0, raw));
  governQuality(raw);
  wall += dt; fpsAcc += raw; fpsN++;
  if (fpsAcc >= 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  if (started && !paused) {
    acc += dt;
    while (acc >= C.STEP) {
      acc -= C.STEP; steps++;
      sim.step(readInput());
      for (const e of sim.events) handle(e);
      sim.events.length = 0;
      for (let i = timers.length - 1; i >= 0; i--) if (timers[i].t <= sim.time) { timers.splice(i, 1)[0].fn(); }
    }
  }
  const p = sim.player, b = sim.boss;
  const [pp, pr, pe] = playerPose(sim), [bp, br, be] = bossPose(sim);
  const still = sim.hitstop > 0 || paused ? 0 : dt;
  pe.yOff = p.y;
  player.update(still, p.x, p.z, p.face, pp, pr, pe);
  // the Reedcutter's blade gathers a pale-blue light while a Reaping Cut is charged
  const pm = player.bladeMat, chg = p.state === 'charge' ? Math.min(1, p.t / CHARGE.FULL) : 0;
  pm.emissiveIntensity = p.state === 'charge' ? (p.chargeFull ? 3.2 + Math.sin(wall * 30) * 0.9 : 0.3 + chg * 1.4) : p.state === 'heavy' && p.t < 0.3 ? 2.6 : 0.3;
  if (p.state !== 'charge') sound.stopCharge();
  // ambience follows the same wind that bends the reeds, heard from where the Reedcutter stands
  sound.setWind(world.gustAt(p.x, p.z, wall), started && sim.mode === 'fight');
  boss.update(still, b.x, b.z, b.face, bp, br, be);
  if (galFigs) for (const g of galFigs) g.f.update(dt, g.x, g.z, g.gy, g.f.poses[g.n], 10);
  pMark.position.set(p.x, 0.03, p.z); bMark.position.set(b.x, 0.03, b.z);
  if (pBlob.visible) { pBlob.position.set(p.x, 0.02, p.z); pBlob.rotation.z = p.face; bBlob.position.set(b.x, 0.021, b.z); bBlob.rotation.z = b.face; }
  // blade tells: violet for the unguardable lunge, amber while a heavy blow is raised
  const h = sim.nextHit();
  const m = boss.bladeMat;
  if (h && h.type === 'thrust' && h.inT <= MOVES[b.move].hits[h.idx].cue) { m.emissive.copy(violet); m.emissiveIntensity = 4.5 + Math.sin(wall * 40) * 1.8; }
  else if (h && h.type === 'heavy') { m.emissive.copy(amber); m.emissiveIntensity = 1.1; }
  else { m.emissive.copy(teal); m.emissiveIntensity = 0.3; }
  const broken = b.state === 'broken';
  bMark.material.color.set(broken ? 0xfff0a0 : 0x8fd8cc); bMark.material.opacity = broken ? 0.55 : 0.14; bMark.scale.setScalar(broken ? 1.5 + Math.sin(wall * 8) * 0.15 : 1.25);
  fx.update(paused ? 0 : dt);
  updateCamera(dt, wall);
  world.update(wall, camera);
  if (started) updateHud();
  renderer.render(scene, camera);
  frames++;
}

// ---------------------------------------------------------------- read-only state probe for tests
const ndc = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(camera); return { x: +v.x.toFixed(3), y: +v.y.toFixed(3), front: v.z < 1 }; };
// Framing measurement (read-only): where both fighters' chests, the Warden's hands and both blade
// tips fall on screen, and how much of the Warden's upper body is hidden behind the Reedcutter.
// The upper body is sampled as a 3 x 4 grid (0.48 m wide, 1.2-1.95 m high, facing the lens); a
// sample is "covered" when the sight line from the lens to it passes within 0.27 m of the
// Reedcutter's body axis (feet to head) in front of it, and "off" when it is outside the picture.
const fa = new THREE.Vector3(), fb = new THREE.Vector3(), fc = new THREE.Vector3(), fd = new THREE.Vector3(), fe = new THREE.Vector3();
function segDist(p1, q1, p2, q2) {
  const d1 = fc.subVectors(q1, p1), d2 = fd.subVectors(q2, p2), r = fe.subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r), c = d1.dot(r), b = d1.dot(d2), den = a * e - b * b;
  let s = den > 1e-9 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0, t = (b * s + f) / e;
  if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); } else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
  return { dist: Math.hypot(r.x + d1.x * s - d2.x * t, r.y + d1.y * s - d2.y * t, r.z + d1.z * s - d2.z * t), s };
}
function framing() {
  const p = sim.player, b = sim.boss, cp = camera.position, me = camera.matrixWorld.elements;
  const rl = Math.hypot(me[0], me[2]) || 1, rx = me[0] / rl, rz = me[2] / rl;
  const pt = (v) => { const q = v.clone().project(camera); return { x: +q.x.toFixed(3), y: +q.y.toFixed(3), on: q.z < 1 && Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1 }; };
  const w = (o) => o.getWorldPosition(new THREE.Vector3());
  let cover = 0, off = 0;
  const foot = new THREE.Vector3(p.x, p.y + 0.12, p.z), top = new THREE.Vector3(p.x, p.y + 1.72, p.z);
  for (const y of [1.2, 1.45, 1.7, 1.95]) for (const c of [-0.24, 0, 0.24]) {
    fa.set(b.x + rx * c, y, b.z + rz * c);
    fb.copy(fa).project(camera);
    if (!(fb.z < 1 && Math.abs(fb.x) <= 1 && Math.abs(fb.y) <= 1)) { off++; continue; }
    const r = segDist(cp, fa, foot, top);
    if (r.dist < 0.27 && r.s < 0.98) cover++;
  }
  return { cover: +(cover / 12).toFixed(3), off: +(off / 12).toFixed(3), playerChest: pt(new THREE.Vector3(p.x, p.y + 1.3, p.z)), bossChest: pt(new THREE.Vector3(b.x, 1.5, b.z)),
    playerTip: pt(w(player.tip)), bossTip: pt(w(boss.tip)), bossHand: pt(w(boss.armR.hand)), camDist: +Math.hypot(cp.x - p.x, cp.z - p.z).toFixed(2), legacyCam };
}
Object.defineProperty(window, '__game', {
  value: Object.freeze({
    get snap() {
      const p = sim.player, b = sim.boss, h = sim.nextHit();
      return {
        mode: started ? sim.mode : 'title', time: sim.time, frames, fps, backend, paused, steps, now: performance.now(),
        player: { x: p.x, z: p.z, y: p.y, face: p.face, hp: p.hp, stance: p.stance, state: p.state, t: p.t, flask: p.flask, chargeFull: p.chargeFull, combo: p.combo },
        audio: sound.info(),
        boss: { x: b.x, z: b.z, hp: b.hp, stance: b.stance, state: b.state, phase: b.phase, move: b.state === 'attack' ? b.move : null, movesSeen: { 1: b.movesSeen[1].slice(), 2: b.movesSeen[2].slice() } },
        dist: Math.hypot(p.x - b.x, p.z - b.z),
        nextHit: h, hitSeq: sim.hitSeq, chain: sim.chain, promptOpen: sim.promptOpen, stats: { ...sim.stats },
        camera: { lock: cam.lock, yaw: Math.atan2(cam.fwd.x, cam.fwd.z), x: cam.pos.x, y: cam.pos.y, z: cam.pos.z },
        bossScreen: ndc(b.x, 1.3, b.z), playerScreen: ndc(p.x, 1.0, p.z), framing: framing(),
        options: { ...sim.opts, low },
        quality: { tier: quality.tier, scale: TIER_SCALE[quality.tier], software, shadows: world.shadows, log: quality.log.slice() },
      };
    },
  }),
});

setTier(software && !low ? 2 : 0);
updateCamera(0.016, 0);
cam.pos.set(3.6, 1.55, 9.6); cam.look.set(1.5, 1.3, -0.2);
if (galFigs) { cam.pos.set(0, 1.9, 8.2); cam.look.set(0, 0.95, 0); }
renderer.setAnimationLoop(frame);
