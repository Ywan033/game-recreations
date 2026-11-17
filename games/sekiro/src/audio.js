// All sound is synthesised with WebAudio at runtime: wind, marsh insects, a sparse plucked motif, combat cues.
export class Sound {
  constructor() { this.ctx = null; this.muted = false; this.phase = 1; this.active = false; }
  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const c = this.ctx = new AC();
      this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.7;
      const comp = c.createDynamicsCompressor(); this.master.connect(comp); comp.connect(c.destination);
      // shared noise buffer
      const nb = this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), ch = nb.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      // wind bed
      const src = c.createBufferSource(); src.buffer = nb; src.loop = true;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.6;
      const g = c.createGain(); g.gain.value = 0.11;
      const lfo = c.createOscillator(); lfo.frequency.value = 0.13; const lg = c.createGain(); lg.gain.value = 240; lfo.connect(lg); lg.connect(bp.frequency);
      const lfo2 = c.createOscillator(); lfo2.frequency.value = 0.07; const lg2 = c.createGain(); lg2.gain.value = 0.06; lfo2.connect(lg2); lg2.connect(g.gain);
      src.connect(bp); bp.connect(g); g.connect(this.master); src.start(); lfo.start(); lfo2.start();
      // simple echo for plucks and bells
      const dl = c.createDelay(1); dl.delayTime.value = 0.31; const fb = c.createGain(); fb.gain.value = 0.32; const wet = c.createGain(); wet.gain.value = 0.35;
      dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(this.master); this.echo = dl;
      this.step = 0; this.nextNote = c.currentTime + 0.5;
      this.timer = setInterval(() => this.schedule(), 120);
    } catch (e) { this.ctx = null; }
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.7; }
  env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  tone(freq, t, dur, peak, type = 'sine', dest, glideTo) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    this.env(g, t, 0.004, peak, dur); o.connect(g); g.connect(dest || this.master); o.start(t); o.stop(t + dur + 0.05);
    return g;
  }
  noise(t, dur, peak, type, freq, q = 1, glideTo) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; s.loop = true; f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (glideTo) f.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    this.env(g, t, 0.003, peak, dur); s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  // generative background: pentatonic plucks; phase two adds a low drum pulse and tighter pace
  schedule() {
    const c = this.ctx; if (!c || !this.active) return;
    const scale = [146.83, 174.61, 196, 220, 261.63, 293.66, 349.23, 392];
    while (this.nextNote < c.currentTime + 0.4) {
      const t = this.nextNote, p2 = this.phase === 2, beat = p2 ? 0.3 : 0.46;
      const i = this.step++;
      const pat = [0, 3, -1, 4, 2, -1, 5, -1, 1, 4, -1, 3, 6, -1, 2, -1];
      const n = pat[(i * (p2 ? 3 : 1)) % 16];
      if (n >= 0 && (i % 16 < 12 || p2)) {
        const g = this.tone(scale[(n + (Math.floor(i / 16) % 2)) % 8] * (p2 ? 1 : 1), t, 0.9, 0.06, 'triangle');
        g.connect(this.echo);
        this.tone(scale[n % 8] * 2.01, t, 0.25, 0.015, 'sine');
      }
      if (i % 8 === 0) this.tone(p2 ? 65.4 : 73.4, t, 2.6, 0.07, 'sine');
      if (p2 && (i % 4 === 0 || i % 16 === 14)) { this.tone(95, t, 0.22, 0.3, 'sine', null, 42); this.noise(t, 0.05, 0.08, 'lowpass', 500); }
      if (!p2 && i % 16 === 8) this.tone(88, t, 0.3, 0.14, 'sine', null, 45);
      // insects
      if (i % 5 === 2) for (let k = 0; k < 3; k++) this.tone(4300 + (i % 3) * 250, t + k * 0.07, 0.04, 0.008, 'sine');
      this.nextNote += beat;
    }
  }
  play(name, a) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + 0.005;
    switch (name) {
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
}
