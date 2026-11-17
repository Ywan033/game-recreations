// All sound is synthesized with WebAudio: a layered rain scene, a sparse plucked score with
// drums, and combat cues. Nothing is sampled.
//
// Signal path:
//   rain layers ─► amb ─► ambDuck (gain) ─► ambTone (low-pass) ─┐
//   music ──────────────────────────────────────────────────────┼─► master ─► compressor ─► out ─► speakers
//   sfx (steps, blades, guard, warnings, flask) ────────────────┘                          └─► optional taps
// `out` carries mute and pause, so the taps (recording / measurement) see exactly what is heard.
//
// Rain scene (see rain* below):
//   far    distant rain curtain: two decorrelated noise loops of unequal length, band-limited,
//          whose level and tone wander on a random schedule
//   stone  single near drops on wet flagstones and puddles: short bright ticks and small "plops",
//          Poisson-timed, each with its own level, pitch, length and stereo position
//   eaves  heavier drips falling from fixed points along the eave edges, each point with its own
//          slightly irregular rhythm, placed in stereo relative to the listener
//   roof   rain drumming on the timber eaves and tiles overhead: dull knocks plus a low rumble
// The listener position (player) and heading (camera) set the level, filtering and stereo
// position of each layer, so the lane, the eaves and the open yard sound different.

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (x, a, b) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Where water runs off the eaves (world x, z): north building, west building, lane sides, east wall.
const DRIPS = [
  [-7.5, -7.6], [-3.2, -7.7], [1.4, -7.6], [6.3, -7.7],
  [-9.3, -4.2], [-9.4, 0.6], [-9.3, 4.8],
  [-1.45, 9.6], [1.45, 11.2], [-1.45, 13.4], [1.45, 15.6], [-1.45, 17.2],
  [10.2, -2.5], [10.2, 3.5],
];

// Zone weights from the listener position: 1 = fully in that zone.
export function rainZones(x, z) {
  const lane = smooth(z, 7.3, 9.4);
  const eave = Math.max(smooth(-z, 6.2, 7.9), smooth(-x, 8.2, 9.8), 0.6 * smooth(x, 9.1, 10.3));
  const cover = Math.max(eave, lane * 0.85);
  return { lane, eave, cover, open: 1 - cover };
}

export function createAudio(opts = {}) {
  let ctx = null;
  let master, music, sfx, noise, out, amb, ambDuck, ambTone;
  let muted = false;
  let paused = false;
  let level = 0; // 0 lane/title, 1 phase one, 2 phase two, 3 aftermath
  let nextBeat = 0;
  let beat = 0;
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const SCALE = [146.83, 174.61, 196.0, 220.0, 261.63, 293.66, 349.23, 392.0, 440.0];
  let mel = 4;
  const OUT = 0.8;

  function env(g, t, a, peak, d) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function osc(type, f, t, dur, peak, dest, f2, attack = 0.005) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    env(g, t, attack, peak, dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + attack + 0.05);
    return o;
  }
  function nz(t, dur, peak, type, f, q, dest, f2, attack = 0.004) {
    const s = ctx.createBufferSource();
    s.buffer = noise; s.loop = true;
    const fl = ctx.createBiquadFilter();
    fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ctx.createGain();
    env(g, t, attack, peak, dur);
    s.connect(fl); fl.connect(g); g.connect(dest);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + attack + 0.05);
  }
  function clang(t, base, peak, dur) {
    for (const [m, k] of [[1, 1], [1.483, 0.7], [2.09, 0.5], [2.77, 0.35], [3.94, 0.2]]) {
      osc('sine', base * m, t, dur * (0.5 + 0.5 / m), peak * k, sfx);
    }
    nz(t, 0.05, peak * 0.9, 'highpass', 3000, 0.7, sfx);
  }
  function pluck(t, f, peak, dur = 1.1) {
    const o = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const fl = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'sawtooth'; o2.type = 'triangle';
    o.frequency.setValueAtTime(f * 1.012, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    o2.frequency.value = f * 2.001;
    fl.type = 'lowpass'; fl.Q.value = 2;
    fl.frequency.setValueAtTime(Math.min(6000, f * 9), t);
    fl.frequency.exponentialRampToValueAtTime(Math.max(200, f * 1.2), t + dur * 0.5);
    env(g, t, 0.004, peak, dur);
    o.connect(fl); o2.connect(fl); fl.connect(g); g.connect(music);
    o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
  }
  function drum(t, peak, f = 95) {
    osc('sine', f, t, 0.3, peak, music, f * 0.45);
    nz(t, 0.05, peak * 0.35, 'lowpass', 900, 0.5, music);
  }

  // ---------------------------------------------------------------- rain scene
  const rain = {
    x: 0, z: 14.5, yaw: 0, zones: rainZones(0, 14.5),
    far: null, farTone: null, farDrift: null, roofBed: null, stoneBus: null, eaveBus: null, roofBus: null,
    nextStone: 0, nextRoof: 0, nextDrift: 0, drips: [],
  };
  // a pan / gain pair for one short voice
  function voice(dest, t, pan, gain) {
    const g = ctx.createGain();
    g.gain.value = gain;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p); p.connect(dest);
    } else g.connect(dest);
    void t;
    return g;
  }
  // bright tick of a drop hitting wet stone
  function tick(t, dest, f, q, dur, peak) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const fl = ctx.createBiquadFilter();
    fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(dest);
    s.start(t, Math.random() * 1.9, dur + 0.02);
  }
  // small water "plop": a sine that chirps upward as the cavity closes
  function plop(t, dest, f, dur, peak) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * (1.5 + Math.random() * 0.9), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }
  // dull knock of a drop on timber / tile overhead
  function knock(t, dest, f, dur, peak) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const fl = ctx.createBiquadFilter();
    fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = 2.5 + Math.random() * 3;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(lp); lp.connect(g); g.connect(dest);
    s.start(t, Math.random() * 1.9, dur + 0.02);
  }
  const expo = (rate) => -Math.log(1 - Math.random() * 0.999) / rate; // Poisson spacing

  function buildRain() {
    amb = ctx.createGain(); amb.gain.value = 1;
    ambDuck = ctx.createGain(); ambDuck.gain.value = 1;
    ambTone = ctx.createBiquadFilter(); ambTone.type = 'lowpass'; ambTone.frequency.value = 12000; ambTone.Q.value = 0.5;
    amb.connect(ambDuck); ambDuck.connect(ambTone); ambTone.connect(master);

    // far curtain: two loops of different length, one per side, so nothing repeats audibly
    const mk = (secs) => {
      const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * secs), ctx.sampleRate);
      const d = b.getChannelData(0);
      let lp = 0;
      for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; lp += (w - lp) * 0.35; d[i] = lp * 1.6; }
      // fade the seam
      const n = Math.floor(ctx.sampleRate * 0.05);
      for (let i = 0; i < n; i++) { const k = i / n; d[i] = d[i] * k + d[d.length - n + i] * (1 - k); }
      return b;
    };
    rain.farTone = ctx.createBiquadFilter(); rain.farTone.type = 'lowpass'; rain.farTone.frequency.value = 2400; rain.farTone.Q.value = 0.4;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 320; hp.Q.value = 0.4;
    rain.far = ctx.createGain(); rain.far.gain.value = 0.05;
    rain.farDrift = ctx.createGain(); rain.farDrift.gain.value = 1;
    const merge = ctx.createChannelMerger(2);
    [7.3, 11.9].forEach((secs, i) => {
      const s = ctx.createBufferSource(); s.buffer = mk(secs); s.loop = true;
      s.connect(merge, 0, i); s.start(0, Math.random() * secs);
    });
    merge.connect(hp); hp.connect(rain.farTone); rain.farTone.connect(rain.farDrift); rain.farDrift.connect(rain.far); rain.far.connect(amb);

    // roof: low rumble bed under the knocks
    const rb = ctx.createBufferSource(); rb.buffer = mk(9.1); rb.loop = true;
    const rlp = ctx.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 420; rlp.Q.value = 0.7;
    rain.roofBed = ctx.createGain(); rain.roofBed.gain.value = 0.0;
    rb.connect(rlp); rlp.connect(rain.roofBed); rain.roofBed.connect(amb); rb.start();

    rain.stoneBus = ctx.createGain(); rain.stoneBus.gain.value = 0.5; rain.stoneBus.connect(amb);
    rain.eaveBus = ctx.createGain(); rain.eaveBus.gain.value = 0.5; rain.eaveBus.connect(amb);
    rain.roofBus = ctx.createGain(); rain.roofBus.gain.value = 0.2; rain.roofBus.connect(amb);
    rain.drips = DRIPS.map(([x, z]) => ({ x, z, period: 0.42 + Math.random() * 0.9, next: Math.random() * 1.2, f: 420 + Math.random() * 520 }));
    applyZones(0);
  }

  function applyZones(tc) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const zn = rain.zones;
    const set = (param, v) => { if (tc > 0) param.setTargetAtTime(v, t, tc); else param.setValueAtTime(v, t); };
    // open sky: brighter, fuller curtain and many stone drops; under cover: muffled curtain, roof and drips come up
    set(rain.far.gain, 0.028 + 0.034 * zn.open);
    set(rain.farTone.frequency, 1250 + 2300 * zn.open - 350 * zn.lane);
    set(rain.stoneBus.gain, 0.22 + 0.78 * zn.open);
    set(rain.roofBus.gain, 0.12 + 0.88 * zn.cover);
    set(rain.roofBed.gain, 0.012 + 0.07 * zn.cover);
    set(rain.eaveBus.gain, 0.45 + 0.55 * Math.max(zn.eave, zn.lane));
  }

  function scheduleRain(now, horizon) {
    const zn = rain.zones;
    // slow drift of the curtain: random targets at random intervals, so there is no cycle to hear
    if (rain.nextDrift < now) rain.nextDrift = now;
    while (rain.nextDrift < horizon + 2) {
      const dur = 2.2 + Math.random() * 3.8;
      rain.farDrift.gain.linearRampToValueAtTime(0.62 + Math.random() * 0.6, rain.nextDrift + dur);
      rain.nextDrift += dur;
    }
    // stone and puddle drops around the listener
    if (rain.nextStone < now) rain.nextStone = now + Math.random() * 0.05;
    const stoneRate = 5 + 13 * zn.open; // drops per second
    while (rain.nextStone < horizon) {
      const t = rain.nextStone;
      const near = Math.random() ** 2.2; // most drops are small or far, a few are close
      const g = voice(rain.stoneBus, t, (Math.random() * 2 - 1) * 0.9, 0.012 + near * 0.075);
      if (Math.random() < 0.26) plop(t, g, 520 + Math.random() * 1100, 0.025 + Math.random() * 0.05, 0.7);
      else tick(t, g, 1900 + Math.random() * 5200, 1.2 + Math.random() * 6, 0.006 + Math.random() * 0.03, 1);
      rain.nextStone += expo(stoneRate);
    }
    // patter on the timber and tiles overhead
    if (rain.nextRoof < now) rain.nextRoof = now + Math.random() * 0.05;
    const roofRate = 9 + 9 * zn.cover;
    while (rain.nextRoof < horizon) {
      const t = rain.nextRoof;
      const g = voice(rain.roofBus, t, (Math.random() * 2 - 1) * 0.6, 0.02 + Math.random() ** 2 * 0.085);
      knock(t, g, 170 + Math.random() * 330, 0.03 + Math.random() * 0.06, 1);
      rain.nextRoof += expo(roofRate);
    }
    // eave drips at fixed places: distance sets the level, bearing sets the stereo position
    const cs = Math.cos(rain.yaw), sn = Math.sin(rain.yaw);
    for (const d of rain.drips) {
      if (d.next < now) d.next = now + Math.random() * d.period;
      while (d.next < horizon) {
        const dx = d.x - rain.x, dz = d.z - rain.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 13) {
          // camera looks along (-sin yaw, -cos yaw); its right-hand side is (cos yaw, -sin yaw)
          const right = (dx * cs - dz * sn) / (dist + 0.6);
          const lvl = 0.16 / (1 + (dist / 2.2) ** 2);
          const g = voice(rain.eaveBus, d.next, right * 0.95, lvl);
          const f = d.f * (0.9 + Math.random() * 0.2);
          plop(d.next, g, f, 0.05 + Math.random() * 0.04, 1);
          tick(d.next, g, 1400 + Math.random() * 1200, 2, 0.012, 0.5);
          if (Math.random() < 0.35) plop(d.next + 0.07 + Math.random() * 0.05, g, f * 1.4, 0.03, 0.35); // secondary splash
        }
        d.next += d.period * (0.72 + Math.random() * 0.56);
      }
    }
  }

  // Mix priority: a cue pulls the rain down and closes its top end for a moment.
  const DUCK = {
    step: [0.8, 0.08], swing: [0.7, 0.12], heavySwing: [0.55, 0.3], hit: [0.5, 0.25], punish: [0.45, 0.4], blocked: [0.55, 0.25],
    guard: [0.45, 0.35], perfect: [0.4, 0.5], hurt: [0.45, 0.35], tele: [0.5, 0.45], bossSwing: [0.55, 0.25], dodge: [0.7, 0.2],
    jump: [0.75, 0.15], land: [0.6, 0.2], chargeStart: [0.7, 0.3], charged: [0.45, 0.4], drink: [0.5, 0.7], heal: [0.45, 0.6],
    drinkFail: [0.5, 0.35], chargeBreak: [0.6, 0.2], gate: [0.5, 0.8], boom: [0.35, 1.2], hiss: [0.6, 0.8],
  };
  let duckUntil = 0;
  function duck(name) {
    const d = DUCK[name];
    if (!d || !ambDuck) return;
    const t = ctx.currentTime;
    const end = t + d[1];
    ambDuck.gain.cancelScheduledValues(t);
    ambDuck.gain.setTargetAtTime(d[0], t, 0.012);
    ambTone.frequency.cancelScheduledValues(t);
    ambTone.frequency.setTargetAtTime(1500 + 5000 * d[0], t, 0.015);
    duckUntil = Math.max(duckUntil, end);
    ambDuck.gain.setTargetAtTime(1, duckUntil, 0.22);
    ambTone.frequency.setTargetAtTime(12000, duckUntil, 0.25);
  }

  function schedule() {
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    scheduleRain(now, now + 0.32);
    if (opts.noMusic) return;
    if (nextBeat < now) nextBeat = now + 0.05;
    while (nextBeat < now + 0.3) {
      const bpm = level === 2 ? 118 : level === 1 ? 88 : 60;
      const step = 60 / bpm / 2; // eighth notes
      const t = nextBeat;
      const b = beat % 16;
      if (level === 1) {
        if (b % 8 === 0) drum(t, 0.5);
        if (b === 6 || b === 12) drum(t, 0.28, 130);
        if (b % 4 === 0) pluck(t, SCALE[0] / 2, 0.16, 1.6);
      } else if (level === 2) {
        if (b % 4 === 0) drum(t, 0.6);
        if (b % 4 === 2) drum(t, 0.3, 140);
        if (b % 2 === 1) nz(t, 0.03, 0.09, 'highpass', 5000, 0.7, music);
        if (b % 2 === 0) pluck(t, (b % 8 === 6 ? SCALE[1] : SCALE[0]) / 2, 0.17, 0.5);
        if (b === 0 || b === 10) osc('sawtooth', 110, t, step * 3, 0.05, music, 104, 0.05);
      } else if (level === 3) {
        if (b % 8 === 0) pluck(t, SCALE[0] / 2, 0.12, 2.5);
      }
      const dens = level === 2 ? 0.62 : level === 1 ? 0.42 : 0.3;
      if (level !== 3 || b % 4 === 2) {
        if (rnd() < dens) {
          mel = Math.max(0, Math.min(SCALE.length - 1, mel + Math.floor(rnd() * 5) - 2));
          pluck(t, SCALE[mel], level === 2 ? 0.2 : 0.16, level === 0 ? 2.2 : 1.2);
          if (level === 2 && rnd() < 0.3) pluck(t + step / 2, SCALE[Math.max(0, mel - 1)], 0.12, 0.6);
        }
      }
      nextBeat += step;
      beat++;
    }
  }

  const outLevel = () => (muted || paused ? 0 : OUT);
  function setOut() {
    if (!out) return;
    const t = ctx.currentTime;
    out.gain.cancelScheduledValues(t);
    out.gain.setTargetAtTime(outLevel(), t, 0.015);
  }

  // optional taps on the heard signal (after mute / pause), used only by the recording hook
  let cap = null;
  const api = {
    get started() { return !!ctx; },
    get muted() { return muted; },
    get paused() { return paused; },
    get state() { return ctx ? ctx.state : 'none'; },
    get time() { return ctx ? ctx.currentTime : 0; },
    get sampleRate() { return ctx ? ctx.sampleRate : 0; },
    get zones() { return { ...rain.zones }; },
    start() {
      if (ctx) { if (ctx.state === 'suspended' && !paused) ctx.resume().catch(() => {}); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { ctx = new AC(); } catch { ctx = null; return; }
      master = ctx.createGain(); master.gain.value = 1;
      const comp = ctx.createDynamicsCompressor();
      out = ctx.createGain(); out.gain.value = outLevel();
      master.connect(comp); comp.connect(out); out.connect(ctx.destination);
      music = ctx.createGain(); music.gain.value = 0.55; music.connect(master);
      sfx = ctx.createGain(); sfx.gain.value = 0.9; sfx.connect(master);
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      buildRain();
      setInterval(schedule, 100);
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    setLevel(l) { level = l; },
    toggleMute() {
      muted = !muted;
      setOut();
      return muted;
    },
    // pause: fade the output, then stop the audio clock so nothing keeps sounding or queueing
    setPaused(p) {
      paused = !!p;
      if (!ctx) return;
      setOut();
      if (paused) setTimeout(() => { if (paused && ctx.state === 'running') ctx.suspend().catch(() => {}); }, 90);
      else if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    // listener: player position and camera heading
    listener(x, z, yaw) {
      rain.x = x; rain.z = z; rain.yaw = yaw;
      rain.zones = rainZones(x, z);
      if (ctx && ctx.state === 'running') applyZones(0.35);
    },
    // ---- recording hook (only used when the page is opened with the `rec` hash option)
    stream() {
      if (!ctx) return null;
      const dst = ctx.createMediaStreamDestination();
      out.connect(dst);
      return dst.stream;
    },
    captureStart(bus = 'out') {
      if (!ctx) return false;
      if (cap) api.captureStop();
      const sp = ctx.createScriptProcessor(4096, 2, 2);
      const sink = ctx.createGain(); sink.gain.value = 0;
      const src = bus === 'amb' ? ambTone : out;
      cap = { sp, sink, src, l: [], r: [] };
      sp.onaudioprocess = (e) => {
        cap.l.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        cap.r.push(new Float32Array(e.inputBuffer.getChannelData(1)));
      };
      src.connect(sp); sp.connect(sink); sink.connect(ctx.destination);
      return true;
    },
    captureStop() {
      if (!cap) return null;
      const c = cap;
      cap = null;
      try { c.src.disconnect(c.sp); c.sp.disconnect(); c.sink.disconnect(); } catch { /* already gone */ }
      c.sp.onaudioprocess = null;
      const join = (a) => { const n = a.reduce((s, x) => s + x.length, 0); const o = new Float32Array(n); let k = 0; for (const x of a) { o.set(x, k); k += x.length; } return o; };
      return { sampleRate: ctx.sampleRate, left: join(c.l), right: join(c.r) };
    },
    play(name, o = {}) {
      if (!ctx || ctx.state !== 'running') return;
      const t = ctx.currentTime + 0.005;
      duck(name === 'swing' && o.heavy ? 'heavySwing' : name);
      switch (name) {
        case 'swing':
          if (o.heavy) {
            nz(t, 0.3, 0.5, 'bandpass', 260, 1.0, sfx, 2400, 0.02);
            osc('sine', 120, t, 0.26, 0.3, sfx, 60);
          } else nz(t, 0.13, 0.22, 'bandpass', 700 + (o.n || 1) * 250, 1.2, sfx, 2600);
          break;
        case 'bossSwing':
          nz(t, o.heavy ? 0.28 : 0.15, o.heavy ? 0.42 : 0.3, 'bandpass', o.heavy ? 300 : 500, 1.0, sfx, o.heavy ? 1400 : 1900);
          break;
        case 'hit':
          nz(t, 0.09, 0.4, 'lowpass', 2400, 0.6, sfx, 500);
          osc('sine', 150, t, 0.16, 0.45, sfx, 60);
          if (o.heavy) { osc('sine', 95, t, 0.32, 0.7, sfx, 38); nz(t, 0.2, 0.4, 'lowpass', 1200, 0.6, sfx, 200); }
          break;
        case 'blocked': clang(t, o.heavy ? 820 : 1250, o.heavy ? 0.2 : 0.13, o.heavy ? 0.34 : 0.22); break;
        case 'punish':
          nz(t, 0.12, 0.5, 'lowpass', 3200, 0.6, sfx, 600);
          osc('sine', 170, t, 0.22, 0.6, sfx, 55);
          osc('sine', 1318, t, 0.5, 0.14, sfx); osc('sine', 1976, t + 0.05, 0.6, 0.12, sfx);
          if (o.heavy) { osc('sine', 90, t, 0.4, 0.7, sfx, 34); osc('sine', 2637, t + 0.1, 0.7, 0.1, sfx); }
          break;
        case 'guard': clang(t, 620, 0.2, 0.3); osc('sine', 110, t, 0.12, 0.3, sfx, 70); break;
        case 'perfect': clang(t, 1500, 0.22, 0.6); osc('sine', 3100, t, 0.9, 0.08, sfx); break;
        case 'hurt':
          nz(t, 0.14, 0.5, 'lowpass', 1500, 0.6, sfx, 300);
          osc('triangle', 120, t, 0.25, 0.5, sfx, 45);
          break;
        case 'dodge': nz(t, 0.22, 0.2, 'lowpass', 500, 0.7, sfx, 1600, 0.03); break;
        case 'dodged': osc('sine', 2200, t, 0.12, 0.07, sfx, 3300); break;
        case 'jump': // push off: cloth and a short breath
          nz(t, 0.16, 0.2, 'bandpass', 420, 0.8, sfx, 1500, 0.02);
          nz(t, 0.05, 0.16, 'bandpass', 1700, 1.2, sfx);
          break;
        case 'land': // both feet on wet stone
          osc('sine', 105, t, 0.13, 0.42, sfx, 52);
          nz(t, 0.07, 0.3, 'lowpass', 900, 0.6, sfx, 300);
          nz(t + 0.015, 0.16, 0.16, 'bandpass', 2600, 0.9, sfx, 4800);
          break;
        case 'chargeStart': // the blade is drawn back: a quiet rising strain
          osc('triangle', 196, t, 0.5, 0.07, sfx, 392, 0.05);
          nz(t, 0.5, 0.06, 'bandpass', 900, 3, sfx, 2600, 0.1);
          break;
        case 'charged': // fully charged: a clear two-note ring
          osc('sine', 1568, t, 0.5, 0.2, sfx); osc('sine', 2349, t + 0.04, 0.55, 0.15, sfx);
          osc('sine', 784, t, 0.3, 0.12, sfx);
          nz(t, 0.04, 0.16, 'highpass', 5000, 0.7, sfx);
          break;
        case 'chargeBreak': osc('triangle', 300, t, 0.16, 0.14, sfx, 110); break;
        case 'drink': { // cork, then two swallows
          osc('sine', 520, t, 0.05, 0.22, sfx, 1250);
          nz(t, 0.02, 0.14, 'bandpass', 2400, 2, sfx);
          for (const dt of [0.2, 0.4]) { osc('sine', 250, t + dt, 0.09, 0.26, sfx, 120, 0.012); osc('sine', 660, t + dt + 0.03, 0.05, 0.08, sfx, 420); }
          break;
        }
        case 'heal': // warmth: a rising fifth and octave
          osc('sine', 392, t, 0.5, 0.2, sfx, undefined, 0.02); osc('sine', 587.3, t + 0.09, 0.6, 0.17, sfx, undefined, 0.02);
          osc('sine', 784, t + 0.18, 0.8, 0.14, sfx, undefined, 0.02);
          break;
        case 'drinkFail': // cannot: two dull, falling knocks
          for (const dt of [0, 0.11]) { osc('square', 150, t + dt, 0.07, 0.11, sfx, 105); nz(t + dt, 0.04, 0.12, 'lowpass', 700, 0.7, sfx); }
          break;
        case 'tele':
          if (o.tele === 'chain') { for (const dt of [0, 0.13]) nz(t + dt, 0.09, 0.2, 'bandpass', 4200, 6, sfx, 6500); }
          else if (o.tele === 'delay') { osc('sawtooth', 150, t, o.d || 0.8, 0.09, sfx, 420, 0.1); osc('sine', 300, t, o.d || 0.8, 0.1, sfx, 840, 0.1); }
          else if (o.tele === 'delayHold') { osc('sine', 2640, t, 0.35, 0.13, sfx); osc('sine', 3960, t, 0.2, 0.06, sfx); }
          else if (o.tele === 'lunge') { osc('sawtooth', 62, t, o.d || 0.6, 0.2, sfx, 150, 0.08); nz(t, o.d || 0.6, 0.12, 'bandpass', 900, 2, sfx, 3200, 0.1); }
          else if (o.tele === 'spin') { nz(t, 0.4, 0.22, 'bandpass', 500, 3, sfx, 3000, 0.1); osc('square', 220, t, 0.4, 0.05, sfx, 660, 0.05); }
          else if (o.tele === 'reverse') { nz(t, 0.3, 0.2, 'bandpass', 2600, 4, sfx, 900, 0.05); osc('square', 520, t, 0.3, 0.04, sfx, 260, 0.03); }
          break;
        case 'gate':
          nz(t, 0.5, 0.3, 'bandpass', 1500, 3, sfx, 500, 0.02);
          osc('sine', 70, t + 0.33, 0.5, 0.7, sfx, 38); clang(t + 0.33, 310, 0.2, 0.7);
          break;
        case 'hiss': nz(t, o.d || 1.2, 0.3, 'highpass', 2600, 0.5, sfx, 5200, 0.2); break;
        case 'boom':
          osc('sine', 75, t, 1.3, 0.9, sfx, 28); nz(t, 0.9, 0.5, 'lowpass', 900, 0.5, sfx, 120);
          nz(t, 1.6, 0.3, 'highpass', 2200, 0.5, sfx, 6000, 0.05);
          break;
        case 'thunder':
          nz(t + 0.8, 2.6, 0.5, 'lowpass', 170, 0.5, sfx, 55, 0.35);
          osc('sine', 48, t + 0.8, 1.8, 0.35, sfx, 30, 0.3);
          break;
        case 'step': // sole on wet stone: a low tap and a short wet scuff
          nz(t, 0.05, 0.15, 'bandpass', 1300 + Math.random() * 900, 1.2, sfx);
          osc('sine', 92 + Math.random() * 14, t, 0.07, 0.17, sfx, 58);
          nz(t + 0.012, 0.08, 0.06, 'highpass', 3200, 0.6, sfx);
          break;
        case 'victory': [0, 2, 3, 5, 7].forEach((i, k) => pluck(t + 0.3 + k * 0.22, SCALE[i] * 2, 0.24, 2.4)); break;
        case 'defeat': [5, 3, 1, 0].forEach((i, k) => pluck(t + 0.2 + k * 0.42, SCALE[i] / 2, 0.26, 2.6)); break;
        case 'start': pluck(t, SCALE[0], 0.25, 2); pluck(t + 0.12, SCALE[3], 0.2, 2); pluck(t + 0.24, SCALE[5], 0.2, 2.4); break;
        default: break;
      }
    },
  };
  return api;
}
