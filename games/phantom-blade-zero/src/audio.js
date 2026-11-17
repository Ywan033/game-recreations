// All sound is synthesized with WebAudio: rain bed, a sparse plucked score with drums, and combat cues.
export function createAudio() {
  let ctx = null;
  let master, music, sfx, noise;
  let muted = false;
  let level = 0; // 0 lane/title, 1 phase one, 2 phase two, 3 aftermath
  let nextBeat = 0;
  let beat = 0;
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const SCALE = [146.83, 174.61, 196.0, 220.0, 261.63, 293.66, 349.23, 392.0, 440.0];
  let mel = 4;

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

  function schedule() {
    if (!ctx) return;
    const now = ctx.currentTime;
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

  const api = {
    get started() { return !!ctx; },
    get muted() { return muted; },
    start() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { ctx = new AC(); } catch { ctx = null; return; }
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp); comp.connect(ctx.destination);
      music = ctx.createGain(); music.gain.value = 0.55; music.connect(master);
      sfx = ctx.createGain(); sfx.gain.value = 0.9; sfx.connect(master);
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      // rain bed: hiss + low patter
      for (const [type, f, q, gain] of [['highpass', 2500, 0.3, 0.05], ['bandpass', 700, 0.6, 0.06], ['lowpass', 220, 0.5, 0.1]]) {
        const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
        const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
        const g = ctx.createGain(); g.gain.value = gain;
        s.connect(fl); fl.connect(g); g.connect(master); s.start(0, Math.random());
      }
      setInterval(schedule, 100);
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    setLevel(l) { level = l; },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.8;
      return muted;
    },
    play(name, o = {}) {
      if (!ctx || ctx.state !== 'running') return;
      const t = ctx.currentTime + 0.005;
      switch (name) {
        case 'swing': nz(t, 0.13, 0.22, 'bandpass', 700 + (o.n || 1) * 250, 1.2, sfx, 2600); break;
        case 'bossSwing':
          nz(t, o.heavy ? 0.28 : 0.15, o.heavy ? 0.42 : 0.3, 'bandpass', o.heavy ? 300 : 500, 1.0, sfx, o.heavy ? 1400 : 1900);
          break;
        case 'hit':
          nz(t, 0.09, 0.4, 'lowpass', 2400, 0.6, sfx, 500);
          osc('sine', 150, t, 0.16, 0.45, sfx, 60);
          break;
        case 'blocked': clang(t, 1250, 0.13, 0.22); break;
        case 'punish':
          nz(t, 0.12, 0.5, 'lowpass', 3200, 0.6, sfx, 600);
          osc('sine', 170, t, 0.22, 0.6, sfx, 55);
          osc('sine', 1318, t, 0.5, 0.14, sfx); osc('sine', 1976, t + 0.05, 0.6, 0.12, sfx);
          break;
        case 'guard': clang(t, 620, 0.2, 0.3); osc('sine', 110, t, 0.12, 0.3, sfx, 70); break;
        case 'perfect': clang(t, 1500, 0.22, 0.6); osc('sine', 3100, t, 0.9, 0.08, sfx); break;
        case 'hurt':
          nz(t, 0.14, 0.5, 'lowpass', 1500, 0.6, sfx, 300);
          osc('triangle', 120, t, 0.25, 0.5, sfx, 45);
          break;
        case 'dodge': nz(t, 0.22, 0.2, 'lowpass', 500, 0.7, sfx, 1600, 0.03); break;
        case 'dodged': osc('sine', 2200, t, 0.12, 0.07, sfx, 3300); break;
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
        case 'step':
          nz(t, 0.05, 0.06, 'bandpass', 1500 + Math.random() * 900, 1.2, sfx);
          osc('sine', 90, t, 0.06, 0.07, sfx, 60);
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
