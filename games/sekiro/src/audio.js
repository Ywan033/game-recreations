// All sound is synthesised with WebAudio at runtime; nothing is sampled or loaded.
//
// Buses:  sfx (blade, body, cues, flask, footsteps) ─┐
//         mus (sparse plucked motif, phase-two drum) ─┼─> master ─> compressor ─> output
//         amb (open-fen night ambience) ─> duck gain ─> low-pass ─> level ─┘
//
// Ambience layers (the old constant wind hiss is gone):
//   1. a thin, distant drizzle curtain at very low level whose level, colour and pan drift slowly;
//   2. wind through the reeds — a low body plus a leafy hiss — driven every frame by the same gust
//      value that bends the reeds on screen (world.gustAt), so the swell is heard as it is seen;
//   3. single drops on grass blades, on mud and into standing water, scheduled as a random
//      (Poisson) stream with varied level, spacing, timbre and position — no loop to hear;
//   4. a few marsh insects at irregular intervals.
// Combat cues duck and band-limit the ambience bus so they stay on top.
const AMB_LEVEL = 2.0; // measured: ambience alone sits ~10 dB under the fight mix (see compare/controls/audio-measure.json)
const DUCK = { deflect: 0.5, cue: 1.0, hitPlayer: 0.5, guard: 0.3, hitBoss: 0.3, heavyHit: 0.5, heavyBlock: 0.4, counter: 0.7, break: 0.8, finisherHit: 1.4, phase2: 1.6, chargeFull: 0.4, drinkStart: 0.7, heal: 0.8, deny: 0.4 };

export class Sound {
  constructor() { this.ctx = null; this.muted = false; this.paused = false; this.phase = 1; this.active = false; this.wind = 0; this.dropCount = 0; this.charge = null; this.pcm = null; }
  init() {
    if (this.ctx) { if (!this.paused) this.ctx.resume?.(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const c = this.ctx = new AC();
      this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.7;
      const comp = this.comp = c.createDynamicsCompressor(); this.master.connect(comp); comp.connect(c.destination);
      this.meter = c.createAnalyser(); this.meter.fftSize = 2048; comp.connect(this.meter); this.meterBuf = new Float32Array(2048);
      this.sfx = c.createGain(); this.sfx.connect(this.master);
      this.mus = c.createGain(); this.mus.connect(this.master);
      // ambience bus: duck gain -> low-pass (band-limit under cues) -> level
      this.amb = c.createGain(); this.ambLP = c.createBiquadFilter(); this.ambLP.type = 'lowpass'; this.ambLP.frequency.value = 12000; this.ambLP.Q.value = 0.5;
      this.ambOut = c.createGain(); this.ambOut.gain.value = AMB_LEVEL;
      this.amb.connect(this.ambLP); this.ambLP.connect(this.ambOut); this.ambOut.connect(this.master);
      this.ambBase = 1;
      // noise sources: one short buffer for one-shots, two long decorrelated stereo beds
      const mkNoise = (secs, chans, colour) => {
        const b = c.createBuffer(chans, Math.floor(c.sampleRate * secs), c.sampleRate);
        for (let k = 0; k < chans; k++) {
          const ch = b.getChannelData(k); let last = 0;
          for (let i = 0; i < ch.length; i++) { const w = Math.random() * 2 - 1; last = colour ? last * colour + w * (1 - colour) : w; ch[i] = colour ? last * 3 : w; }
        }
        return b;
      };
      this.noiseBuf = mkNoise(2, 1, 0);
      const loop = (buf, rate = 1) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(0, Math.random() * buf.duration); return s; };
      const filt = (type, f, q = 0.7) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
      const gain = (v) => { const g = c.createGain(); g.gain.value = v; return g; };
      const chain = (...n) => { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; };
      // 1. distant drizzle curtain
      this.rainHP = filt('highpass', 1700, 0.5); this.rainLP = filt('lowpass', 5200, 0.5); this.rainG = gain(0.016); this.rainPan = c.createStereoPanner();
      chain(loop(mkNoise(7.3, 2, 0)), this.rainHP, this.rainLP, this.rainG, this.rainPan, this.amb);
      // 2. wind: low body + reed hiss, both set from setWind()
      const windSrc = mkNoise(5.9, 2, 0.6);
      this.windBP = filt('bandpass', 340, 0.6); this.windG = gain(0.02);
      chain(loop(windSrc, 0.8), this.windBP, this.windG, this.amb);
      this.reedBP = filt('bandpass', 2600, 0.8); this.reedG = gain(0.003);
      chain(loop(mkNoise(4.7, 2, 0), 1), filt('highpass', 1300, 0.5), this.reedBP, this.reedG, this.amb);
      // echo for plucks and bells
      const dl = c.createDelay(1); dl.delayTime.value = 0.31; const fb = gain(0.32), wet = gain(0.35);
      dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(this.master); this.echo = dl;
      this.step = 0; this.nextNote = c.currentTime + 0.5;
      this.nextDrop = c.currentTime + 0.3; this.dropRate = 2.2; this.dropTarget = 2.2; this.nextDrift = 0; this.nextBug = c.currentTime + 2;
      this.lastWindT = -1;
      this.timer = setInterval(() => this.schedule(), 120);
    } catch (e) { this.ctx = null; }
  }
  setMuted(m) { this.muted = m; if (this.master) { this.master.gain.cancelScheduledValues(0); this.master.gain.value = m ? 0 : 0.7; } }
  setPaused(p) { this.paused = p; if (!this.ctx) return; if (p) { this.stopCharge(); this.ctx.suspend?.(); } else this.ctx.resume?.(); }
  // read-only numbers for the state probe and the tests
  info() {
    const c = this.ctx; if (!c) return { state: 'none', muted: this.muted, paused: this.paused };
    this.meter.getFloatTimeDomainData(this.meterBuf);
    let pk = 0, sq = 0; for (const v of this.meterBuf) { pk = Math.max(pk, Math.abs(v)); sq += v * v; }
    return { state: c.state, time: c.currentTime, rate: c.sampleRate, muted: this.muted, paused: this.paused, masterGain: this.master.gain.value, wind: this.wind, drops: this.dropCount, dropRate: this.dropRate, peak: pk, rms: Math.sqrt(sq / this.meterBuf.length) };
  }
  // gust 0..1 from the reed field; called every frame, applied at most ~25 times a second
  setWind(g, fighting) {
    const c = this.ctx; this.wind = g; if (!c || c.state !== 'running') return;
    const t = c.currentTime; if (t - this.lastWindT < 0.04) return; this.lastWindT = t;
    const flut = 0.8 + Math.random() * 0.4; // leaves never hiss evenly
    this.windG.gain.setTargetAtTime(0.012 + 0.075 * g, t, 0.18);
    this.windBP.frequency.setTargetAtTime(260 + 380 * g, t, 0.25);
    this.reedG.gain.setTargetAtTime((0.002 + 0.05 * g * g) * flut, t, 0.09);
    this.reedBP.frequency.setTargetAtTime(2200 + 1700 * g, t, 0.2);
    const base = fighting ? 0.8 : 1; // the field steps back a little once blades are drawn
    if (base !== this.ambBase) { this.ambBase = base; if (!(this.duckUntil > t)) this.amb.gain.setTargetAtTime(base, t, 0.6); }
  }
  duck(hold) {
    const c = this.ctx, t = c.currentTime; if (this.duckUntil > t + hold) return;
    this.duckUntil = t + hold;
    for (const [p, lo, hi] of [[this.amb.gain, this.ambBase * 0.35, this.ambBase], [this.ambLP.frequency, 1800, 12000]]) {
      p.cancelScheduledValues(t); p.setTargetAtTime(lo, t, 0.02); p.setTargetAtTime(hi, t + hold, 0.3);
    }
  }
  env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  tone(freq, t, dur, peak, type = 'sine', dest, glideTo) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    this.env(g, t, 0.004, peak, dur); o.connect(g); g.connect(dest || this.sfx); o.start(t); o.stop(t + dur + 0.05);
    return g;
  }
  noise(t, dur, peak, type, freq, q = 1, glideTo, dest) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; s.loop = true; f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (glideTo) f.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    this.env(g, t, 0.003, peak, dur); s.connect(f); f.connect(g); g.connect(dest || this.sfx); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  // one raindrop: where it falls (pan, distance) and what it hits are random
  drop(t) {
    const c = this.ctx, R = Math.random, far = R(), lvl = (0.2 + 0.8 * R() * R()) * (1 - 0.72 * far), r = R();
    const pn = c.createStereoPanner(); pn.pan.value = (R() * 2 - 1) * 0.9; pn.connect(this.amb);
    this.dropCount++;
    if (r < 0.55) this.noise(t, 0.008 + 0.02 * R(), 0.07 * lvl, 'bandpass', (3000 + 4200 * R()) * (1 - 0.3 * far), 1.5 + 4 * R(), 0, pn); // grass blade / reed leaf
    else if (r < 0.9) { // mud
      this.noise(t, 0.03 + 0.03 * R(), 0.11 * lvl, 'lowpass', 420 + 700 * R(), 0.8, 0, pn);
      const f = 150 + 150 * R(); this.tone(f, t, 0.05, 0.06 * lvl, 'sine', pn, f * 0.6);
    } else { const f = 650 + 650 * R(); this.tone(f, t, 0.05, 0.045 * lvl, 'sine', pn, f * 1.9); } // standing water
  }
  schedule() {
    const c = this.ctx; if (!c || c.state !== 'running') return;
    const now = c.currentTime, R = Math.random;
    // ---- ambience (always on once audio is unlocked)
    if (now >= this.nextDrift) { // slow, irregular drift of the drizzle: density, level, colour, position
      this.nextDrift = now + 4 + R() * 6;
      this.dropTarget = 0.9 + R() * R() * 4.2;
      this.rainG.gain.setTargetAtTime(0.009 + R() * 0.016, now, 3);
      this.rainLP.frequency.setTargetAtTime(3800 + R() * 2600, now, 3);
      this.rainPan.pan.setTargetAtTime((R() - 0.5) * 0.7, now, 4);
    }
    this.dropRate += (this.dropTarget - this.dropRate) * 0.03;
    while (this.nextDrop < now + 0.35) { this.drop(Math.max(this.nextDrop, now + 0.01)); this.nextDrop += -Math.log(1 - R()) / this.dropRate; }
    if (now >= this.nextBug) { // a marsh insect somewhere off in the reeds
      this.nextBug = now + 2.5 + R() * 9;
      const pn = c.createStereoPanner(); pn.pan.value = R() * 2 - 1; pn.connect(this.amb);
      const f = 4000 + R() * 1100, n = 2 + ((R() * 4) | 0), gap = 0.055 + R() * 0.03;
      for (let k = 0; k < n; k++) this.tone(f, now + 0.05 + k * gap, 0.035, 0.007 + R() * 0.004, 'sine', pn);
    }
    // ---- generative music: pentatonic plucks; phase two adds a low drum pulse and tighter pace
    if (!this.active) { this.nextNote = Math.max(this.nextNote, now + 0.2); return; }
    const scale = [146.83, 174.61, 196, 220, 261.63, 293.66, 349.23, 392];
    while (this.nextNote < now + 0.4) {
      const t = this.nextNote, p2 = this.phase === 2, beat = p2 ? 0.3 : 0.46;
      const i = this.step++;
      const pat = [0, 3, -1, 4, 2, -1, 5, -1, 1, 4, -1, 3, 6, -1, 2, -1];
      const n = pat[(i * (p2 ? 3 : 1)) % 16];
      if (n >= 0 && (i % 16 < 12 || p2)) {
        const g = this.tone(scale[(n + (Math.floor(i / 16) % 2)) % 8], t, 0.9, 0.06, 'triangle', this.mus);
        g.connect(this.echo);
        this.tone(scale[n % 8] * 2.01, t, 0.25, 0.015, 'sine', this.mus);
      }
      if (i % 8 === 0) this.tone(p2 ? 65.4 : 73.4, t, 2.6, 0.07, 'sine', this.mus);
      if (p2 && (i % 4 === 0 || i % 16 === 14)) { this.tone(95, t, 0.22, 0.3, 'sine', this.mus, 42); this.noise(t, 0.05, 0.08, 'lowpass', 500, 1, 0, this.mus); }
      if (!p2 && i % 16 === 8) this.tone(88, t, 0.3, 0.14, 'sine', this.mus, 45);
      this.nextNote += beat;
    }
  }
  // the charge hum is a held sound: it rises while the cut is wound up and is cut off on release / interruption
  stopCharge() {
    const h = this.charge; if (!h) return; this.charge = null;
    const t = this.ctx.currentTime;
    h.g.gain.cancelScheduledValues(t); h.g.gain.setTargetAtTime(0.0001, t, 0.03);
    for (const n of h.src) n.stop(t + 0.2);
  }
  play(name, a) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + 0.005;
    if (DUCK[name]) this.duck(DUCK[name]);
    switch (name) {
      case 'step': { // soft tread on wet ground with a brush of grass
        const k = a || 0.6;
        this.noise(t, 0.07, 0.2 * k, 'lowpass', 300 + Math.random() * 240, 0.9); this.noise(t + 0.01, 0.05, 0.05 * k, 'bandpass', 2200 + Math.random() * 1400, 0.8);
        this.tone(70 + Math.random() * 25, t, 0.06, 0.12 * k, 'sine', null, 45); break;
      }
      case 'jump': this.noise(t, 0.2, 0.12, 'bandpass', 420, 1, 1700); this.noise(t, 0.05, 0.16, 'lowpass', 380); break;
      case 'land': this.tone(88, t, 0.16, 0.45, 'sine', null, 44); this.noise(t, 0.11, 0.3, 'lowpass', 520); this.noise(t + 0.02, 0.12, 0.07, 'bandpass', 2600, 0.7); break;
      case 'chargeStart': {
        this.stopCharge();
        const o = c.createOscillator(), n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), g2 = c.createGain();
        o.type = 'triangle'; o.frequency.setValueAtTime(98, t); o.frequency.exponentialRampToValueAtTime(196, t + 0.55); o.frequency.setTargetAtTime(207, t + 0.55, 0.4);
        n.buffer = this.noiseBuf; n.loop = true; f.type = 'bandpass'; f.Q.value = 5; f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(2600, t + 0.55);
        g2.gain.value = 0.5; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.11, t + 0.5);
        o.connect(g); n.connect(f); f.connect(g2); g2.connect(g); g.connect(this.sfx); o.start(t); n.start(t);
        this.charge = { g, src: [o, n] }; break;
      }
      case 'chargeFull': this.tone(987.77, t, 0.4, 0.16, 'triangle').connect(this.echo); this.tone(1479.98, t + 0.07, 0.45, 0.11, 'triangle').connect(this.echo); this.noise(t, 0.05, 0.08, 'highpass', 6000); break;
      case 'heavySwing': this.noise(t, 0.3, 0.26, 'bandpass', 300, 1, 2300); this.tone(140, t, 0.22, 0.1, 'sawtooth', null, 70); break;
      case 'heavyHit': this.noise(t, 0.18, 0.42, 'bandpass', 1400, 0.7); this.tone(130, t, 0.22, 0.34, 'square', null, 55); this.tone(62, t, 0.32, 0.42, 'sine'); break;
      case 'heavyBlock': this.tone(520, t, 0.16, 0.18, 'square'); this.tone(392, t, 0.3, 0.12, 'triangle').connect(this.echo); this.noise(t, 0.12, 0.26, 'highpass', 2200); this.tone(90, t, 0.2, 0.3, 'sine', null, 50); break;
      case 'drinkStart': // cork, then three swallows
        this.tone(520, t, 0.035, 0.2, 'sine', null, 930); this.noise(t, 0.02, 0.1, 'bandpass', 1800, 2);
        for (let k = 0; k < 3; k++) { const u = t + 0.2 + k * 0.15; this.tone(196, u, 0.09, 0.17, 'sine', null, 118); this.tone(640, u + 0.02, 0.05, 0.05, 'sine', null, 380); }
        break;
      case 'heal': [392, 493.88, 587.33, 783.99].forEach((f, i) => this.tone(f, t + i * 0.07, 0.7, 0.09, 'sine').connect(this.echo)); this.noise(t, 0.4, 0.03, 'highpass', 6000); break;
      case 'deny': this.tone(196, t, 0.07, 0.15, 'square'); this.tone(174.61, t + 0.11, 0.09, 0.15, 'square'); this.noise(t, 0.05, 0.16, 'lowpass', 300); break;
      case 'swing': this.noise(t, 0.16, 0.12, 'bandpass', 900, 1.2, 2600); break;
      case 'bossSwing': this.noise(t, 0.22, 0.16, 'bandpass', 500, 1, 1800); break;
      case 'hitBoss': this.noise(t, 0.12, 0.3, 'bandpass', 1800, 0.8); this.tone(180, t, 0.12, 0.25, 'square', null, 80); break;
      case 'bossBlock': this.tone(620, t, 0.12, 0.14, 'square'); this.noise(t, 0.08, 0.18, 'highpass', 2500); break;
      case 'guard': this.tone(240, t, 0.16, 0.3, 'square', null, 150); this.noise(t, 0.14, 0.3, 'bandpass', 1300, 0.7); break;
      case 'deflect': { // bright bell, pitch climbs with the chain
        const f = 1568 * Math.pow(1.122, Math.min(5, (a || 1) - 1));
        for (const [m, p] of [[1, 0.3], [2.76, 0.16], [5.4, 0.08]]) this.tone(f * m, t, 0.5, p, 'sine').connect(this.echo);
        this.noise(t, 0.04, 0.25, 'highpass', 5000); break;
      }
      case 'hitPlayer': this.tone(110, t, 0.3, 0.5, 'sawtooth', null, 50); this.noise(t, 0.2, 0.35, 'lowpass', 900); break;
      case 'cue': // warning: two falling reed-pipe wails over a rising hiss
        for (const k of [0, 0.16]) { this.tone(1244, t + k, 0.14, 0.2, 'sawtooth', null, 830); this.tone(1865, t + k, 0.14, 0.1, 'square', null, 1244); }
        this.noise(t, 0.5, 0.1, 'bandpass', 800, 3, 5000); break;
      case 'counter': // stomp + blade scraped down into the earth
        this.tone(70, t, 0.4, 0.8, 'sine', null, 32); this.noise(t, 0.06, 0.5, 'lowpass', 400);
        this.noise(t + 0.05, 0.45, 0.3, 'bandpass', 5200, 6, 900); this.tone(392, t + 0.08, 0.5, 0.12, 'triangle').connect(this.echo); break;
      case 'break': this.tone(196, t, 1.2, 0.3, 'triangle').connect(this.echo); this.tone(98, t, 1.0, 0.4, 'sine'); this.noise(t, 0.5, 0.3, 'bandpass', 2400, 0.5, 300); break;
      case 'finisherStart': this.noise(t, 0.9, 0.2, 'bandpass', 300, 2, 3600); this.tone(110, t, 0.9, 0.2, 'sawtooth', null, 440); break;
      case 'finisherHit': // gong and rising shimmer
        for (const [m, p] of [[1, 0.6], [1.48, 0.3], [2.41, 0.2], [3.9, 0.1]]) this.tone(82.4 * m, t, 2.4, p, 'sine').connect(this.echo);
        for (let k = 0; k < 6; k++) this.tone(1320 * Math.pow(1.19, k), t + 0.1 + k * 0.07, 0.6, 0.05, 'sine').connect(this.echo);
        this.noise(t, 0.3, 0.5, 'highpass', 1800); break;
      case 'phase2': this.tone(55, t, 2.2, 0.6, 'sawtooth', null, 110); this.noise(t + 0.9, 1.0, 0.35, 'bandpass', 200, 0.7, 1800); break;
      case 'dodge': this.noise(t, 0.2, 0.1, 'lowpass', 700, 1, 200); break;
      case 'playerBroken': this.tone(160, t, 0.5, 0.4, 'square', null, 60); break;
      case 'victory': [293.66, 392, 440, 587.33].forEach((f, i) => this.tone(f, t + i * 0.22, 1.6, 0.14, 'triangle').connect(this.echo)); break;
      case 'defeat': [220, 196, 174.61, 146.83].forEach((f, i) => this.tone(f, t + i * 0.3, 1.6, 0.14, 'triangle').connect(this.echo)); break;
      case 'start': this.tone(146.83, t, 1.4, 0.2, 'triangle').connect(this.echo); this.tone(220, t + 0.15, 1.4, 0.15, 'triangle').connect(this.echo); break;
    }
  }

  // ---------------------------------------------------------------- recording hooks (used only with #rec=1)
  // audio track of the final output for MediaRecorder
  tapStream() { if (!this.ctx) return null; if (!this.tap) { this.tap = this.ctx.createMediaStreamDestination(); this.comp.connect(this.tap); } return this.tap.stream; }
  // raw PCM capture: 'mix' = final output after the compressor; 'amb' = the ambience bus alone,
  // scaled by the master gain (0.7) so its numbers are comparable with the mix
  startPcm(bus = 'mix') {
    const c = this.ctx; if (!c) return false;
    const sp = c.createScriptProcessor(4096, 2, 2), sink = c.createGain(); sink.gain.value = 0;
    const k = bus === 'amb' ? 0.7 : 1, rec = this.pcm = { sp, sink, src: bus === 'amb' ? this.ambOut : this.comp, L: [], R: [], n: 0, peak: 0, sq: 0, clipped: 0, k, bus, win: [] };
    sp.onaudioprocess = (e) => {
      const l = e.inputBuffer.getChannelData(0), r = e.inputBuffer.getChannelData(1), L = new Float32Array(l.length), Rr = new Float32Array(r.length);
      let wsq = 0;
      for (let i = 0; i < l.length; i++) {
        const a = l[i] * k, b = r[i] * k; L[i] = a; Rr[i] = b;
        const m = Math.max(Math.abs(a), Math.abs(b)); if (m > rec.peak) rec.peak = m; if (m >= 0.999) rec.clipped++;
        rec.sq += a * a + b * b; wsq += a * a + b * b;
      }
      rec.win.push(Math.sqrt(wsq / (2 * l.length))); rec.n += l.length; rec.L.push(L); rec.R.push(Rr);
    };
    rec.src.connect(sp); sp.connect(sink); sink.connect(c.destination);
    return true;
  }
  // returns measured numbers and (optionally) a 16-bit stereo WAV at half the context rate, base64
  stopPcm(wantWav = false) {
    const rec = this.pcm; if (!rec) return null; this.pcm = null;
    rec.src.disconnect(rec.sp); rec.sp.disconnect(); rec.sp.onaudioprocess = null;
    const rate = this.ctx.sampleRate, db = (v) => (v > 0 ? +(20 * Math.log10(v)).toFixed(1) : -Infinity);
    const win = rec.win.slice().sort((a, b) => a - b), q = (f) => win.length ? win[Math.min(win.length - 1, Math.floor(f * win.length))] : 0;
    const out = { bus: rec.bus, seconds: +(rec.n / rate).toFixed(2), rate, samples: rec.n, peak: +rec.peak.toFixed(4), peakDb: db(rec.peak), rms: +Math.sqrt(rec.sq / (2 * rec.n || 1)).toFixed(5), rmsDb: db(Math.sqrt(rec.sq / (2 * rec.n || 1))), clipped: rec.clipped,
      windowMs: Math.round(4096 / rate * 1000), winRmsDb: { min: db(q(0)), p10: db(q(0.1)), p50: db(q(0.5)), p90: db(q(0.9)), max: db(q(0.999)) } };
    if (wantWav) {
      const n = Math.floor(rec.n / 2), buf = new ArrayBuffer(44 + n * 4), v = new DataView(buf), str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      str(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
      v.setUint32(24, rate / 2, true); v.setUint32(28, rate / 2 * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 4, true);
      let o = 44, ci = 0, off = 0;
      for (let i = 0; i < n; i++) { // 2:1 decimation by averaging neighbouring samples
        for (const ch of [rec.L, rec.R]) { const c0 = ch[ci]; const s = (c0[off] + c0[off + 1]) / 2; v.setInt16(o, Math.max(-1, Math.min(1, s)) * 32767, true); o += 2; }
        off += 2; if (off >= rec.L[ci].length) { off = 0; ci++; }
      }
      const u8 = new Uint8Array(buf); let bin = ''; for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      out.wav = btoa(bin);
    }
    return out;
  }
}
