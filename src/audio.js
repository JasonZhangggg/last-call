// All sound is synthesized at runtime: no files. Three buses (sfx, music, ambience) feed a
// shared reverb send and a compressor. Music is an original plucked-string waltz built with
// Karplus-Strong synthesis and scheduled ahead of time so it never drifts.
import { store } from './util.js';

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

class Audio {
  constructor() {
    this.ctx = null;
    this.vol = store.get('volume', { master: 0.8, music: 0.5, sfx: 0.9, ambience: 0.6 });
    this.muted = store.get('muted', false);
    this.tension = 0;
  }

  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 5; comp.attack.value = 0.003;
    this.master = ctx.createGain(); this.master.connect(comp); comp.connect(ctx.destination);
    this.bus = {};
    for (const k of ['sfx', 'music', 'ambience']) { this.bus[k] = ctx.createGain(); this.bus[k].connect(this.master); }
    this.duck = ctx.createGain(); this.duck.connect(this.bus.music);
    // reverb: a generated decaying-noise impulse, one convolver for everything
    this.verb = ctx.createConvolver(); this.verb.buffer = this.impulse(1.8, 2.6);
    this.verbIn = ctx.createGain(); this.verbIn.gain.value = 0.35; this.verbIn.connect(this.verb); this.verb.connect(this.master);
    const sr = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, sr * 2, sr); const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.startAmbience();
    this.buildPlucks();
    this.startMusic();
    document.addEventListener('visibilitychange', () => { if (document.hidden) ctx.suspend(); else ctx.resume(); });
  }

  impulse(seconds, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds), b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, v = this.vol;
    this.master.gain.setTargetAtTime(this.muted ? 0 : v.master, t, 0.05);
    this.bus.sfx.gain.setTargetAtTime(v.sfx, t, 0.05);
    this.bus.music.gain.setTargetAtTime(v.music * 0.55, t, 0.05);
    this.bus.ambience.gain.setTargetAtTime(v.ambience, t, 0.05);
  }
  setVolume(key, value) { this.vol[key] = value; store.set('volume', this.vol); this.applyVolumes(); }
  setMuted(m) { this.muted = m; store.set('muted', m); this.applyVolumes(); }

  /* ---------- primitives ---------- */
  noise({ dur = 0.1, type = 'bandpass', freq = 2000, q = 1, gain = 0.3, attack = 0.003, t = 0, bus = 'sfx', verb = 0, pan = 0 }) {
    const ctx = this.ctx; if (!ctx) return; const t0 = ctx.currentTime + t;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let out = g;
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    s.connect(f).connect(g); out.connect(this.bus[bus]);
    if (verb) { const vs = ctx.createGain(); vs.gain.value = verb; out.connect(vs).connect(this.verbIn); }
    s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.05);
  }
  tone({ freq = 440, type = 'sine', dur = 0.3, gain = 0.2, t = 0, slide = 0, lp = 0, attack = 0.005, bus = 'sfx', verb = 0 }) {
    const ctx = this.ctx; if (!ctx) return; const t0 = ctx.currentTime + t;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = o;
    if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
    node.connect(g).connect(this.bus[bus]);
    if (verb) { const vs = ctx.createGain(); vs.gain.value = verb; g.connect(vs).connect(this.verbIn); }
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  /* ---------- ambience: room tone, distant murmur, occasional clinks and creaks ---------- */
  startAmbience() {
    const ctx = this.ctx, sr = ctx.sampleRate;
    const bb = ctx.createBuffer(1, sr * 4, sr), bd = bb.getChannelData(0); let last = 0;
    for (let i = 0; i < bd.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.2; }
    const room = ctx.createBufferSource(); room.buffer = bb; room.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    const rg = ctx.createGain(); rg.gain.value = 0.11;
    room.connect(lp).connect(rg).connect(this.bus.ambience); room.start();
    // murmur: band-passed noise whose level wanders like a distant crowd
    const mur = ctx.createBufferSource(); mur.buffer = this.noiseBuf; mur.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.9;
    const mg = ctx.createGain(); mg.gain.value = 0.018;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.23; const lg = ctx.createGain(); lg.gain.value = 0.012;
    lfo.connect(lg).connect(mg.gain); lfo.start();
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 1.7; const lg2 = ctx.createGain(); lg2.gain.value = 180;
    lfo2.connect(lg2).connect(bp.frequency); lfo2.start();
    mur.connect(bp).connect(mg).connect(this.bus.ambience); mur.start();
    const events = () => {
      if (!this.ctx) return;
      const r = Math.random(), pan = Math.random() * 1.6 - 0.8;
      if (r < 0.45) this.clink(pan);
      else if (r < 0.7) this.creak(pan);
      else this.laugh(pan);
      setTimeout(events, 3500 + Math.random() * 7000);
    };
    setTimeout(events, 4000);
  }
  clink(pan = 0) {
    const f = 2400 + Math.random() * 1400;
    for (const [m, g] of [[1, 0.025], [2.76, 0.012], [5.4, 0.006]]) this.tone({ freq: f * m, type: 'sine', dur: 0.5 + Math.random() * 0.4, gain: g, attack: 0.001, bus: 'ambience', verb: 0.6 });
    this.noise({ dur: 0.02, type: 'highpass', freq: 5000, gain: 0.02, bus: 'ambience', pan });
  }
  creak(pan = 0) {
    const ctx = this.ctx, t0 = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; const f0 = 70 + Math.random() * 40; o.frequency.setValueAtTime(f0, t0); o.frequency.linearRampToValueAtTime(f0 * 1.6, t0 + 0.6);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.012, t0 + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
    o.connect(bp).connect(g).connect(this.bus.ambience); o.start(t0); o.stop(t0 + 0.75);
  }
  laugh(pan = 0) {
    for (let i = 0; i < 4 + Math.floor(Math.random() * 3); i++) this.noise({ dur: 0.09, freq: 700 + Math.random() * 300, q: 4, gain: 0.012, t: i * 0.13, bus: 'ambience', verb: 0.5, pan });
  }

  /* ---------- music ---------- */
  buildPlucks() {
    // Karplus-Strong: a noise burst through a damped delay line reads as a plucked string.
    const ctx = this.ctx, sr = ctx.sampleRate;
    this.plucks = new Map();
    const make = (midi, seconds = 2.2, damp = 0.996) => {
      const len = Math.floor(sr * seconds), buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
      const period = Math.max(2, Math.round(sr / NOTE(midi)));
      const line = new Float32Array(period);
      for (let i = 0; i < period; i++) line[i] = Math.random() * 2 - 1;
      let idx = 0, prev = 0;
      for (let i = 0; i < len; i++) {
        const cur = line[idx]; const out = damp * 0.5 * (cur + prev);
        line[idx] = out; prev = cur; d[i] = cur * (i < 40 ? i / 40 : 1);
        idx = (idx + 1) % period;
      }
      return buf;
    };
    for (const m of [33, 36, 38, 40, 43, 45, 48, 50, 52, 53, 55, 56, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76]) this.plucks.set(m, make(m, m < 45 ? 3 : 2.2, m < 45 ? 0.998 : 0.995));
  }
  pluck(midi, when, gain = 0.2, pan = 0) {
    const buf = this.plucks.get(midi); if (!buf) return;
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = buf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    const g = ctx.createGain(); g.gain.value = gain;
    let out = g; if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    s.connect(lp).connect(g); out.connect(this.duck);
    const vs = ctx.createGain(); vs.gain.value = 0.4; out.connect(vs).connect(this.verbIn);
    s.start(when);
  }
  startMusic() {
    // An original slow waltz in A minor. Each bar: bass on 1, two chord tones on 2 and 3, and
    // a sparse melody that wanders over the top.
    const bars = [
      { bass: 45, chord: [57, 60, 64] }, { bass: 45, chord: [57, 60, 64] },
      { bass: 38, chord: [57, 62, 65] }, { bass: 40, chord: [56, 59, 64] },
      { bass: 45, chord: [57, 60, 64] }, { bass: 41, chord: [57, 60, 65] },
      { bass: 38, chord: [57, 62, 65] }, { bass: 40, chord: [56, 59, 62] },
    ];
    const melody = [76, null, 74, 72, null, 71, 69, null, 71, 72, 74, null, 76, null, 72, 71, null, 69, 71, null, 68, 69, null, null];
    const beat = 60 / 74;
    let next = this.ctx.currentTime + 0.5, step = 0;
    const tick = () => {
      if (!this.ctx) return;
      while (next < this.ctx.currentTime + 0.4) {
        const bar = bars[Math.floor(step / 3) % bars.length], b = step % 3;
        const human = (Math.random() - 0.5) * 0.02;
        if (b === 0) this.pluck(bar.bass, next + human, 0.34, -0.2);
        else this.pluck(bar.chord[b], next + human, 0.11, 0.25), this.pluck(bar.chord[(b + 1) % 3], next + human + 0.012, 0.08, 0.3);
        const m = melody[step % melody.length];
        if (m && Math.random() < 0.85) this.pluck(m, next + human + 0.01, 0.12, 0.05);
        next += beat; step++;
      }
      setTimeout(tick, 120);
    };
    tick();
  }
  /** 0..1: fades the music under tense moments. */
  setTension(v) {
    this.tension = v; if (!this.ctx) return;
    this.duck.gain.setTargetAtTime(1 - v * 0.85, this.ctx.currentTime, 0.4);
  }

  /* ---------- effects ---------- */
  card(pan = 0) { this.noise({ dur: 0.12, freq: 2400 + Math.random() * 900, q: 0.7, gain: 0.2, pan }); this.noise({ dur: 0.05, type: 'lowpass', freq: 500, gain: 0.12, t: 0.07, pan }); }
  deal(pan = 0, t = 0) { this.noise({ dur: 0.07, freq: 3200 + Math.random() * 800, q: 0.9, gain: 0.13, pan, t }); }
  select() { this.noise({ dur: 0.05, freq: 3800, q: 1.2, gain: 0.1 }); this.tone({ freq: 1400, type: 'triangle', dur: 0.05, gain: 0.02 }); }
  hover() { this.noise({ dur: 0.03, freq: 5200, q: 2, gain: 0.03 }); }
  uiClick() { this.tone({ freq: 660, type: 'triangle', dur: 0.08, gain: 0.04 }); }
  shuffle() { for (let i = 0; i < 10; i++) this.noise({ dur: 0.07, freq: 2600 + Math.random() * 1200, q: 0.6, gain: 0.12, t: i * 0.045 }); }
  spin(n = 12) { for (let i = 0; i < n; i++) { const t = i * 0.045 + i * i * 0.0035; this.noise({ dur: 0.025, freq: 4200, q: 3, gain: 0.16, t }); this.tone({ freq: 1900, type: 'triangle', dur: 0.02, gain: 0.03, t }); } }
  cock() { this.noise({ dur: 0.05, type: 'highpass', freq: 2500, gain: 0.35 }); this.noise({ dur: 0.06, freq: 1300, q: 5, gain: 0.25, t: 0.08 }); this.tone({ freq: 900, type: 'square', dur: 0.02, gain: 0.03, t: 0.08 }); }
  click() { this.noise({ dur: 0.035, type: 'highpass', freq: 3200, gain: 0.6, attack: 0.001 }); this.tone({ freq: 2600, type: 'square', dur: 0.025, gain: 0.06 }); this.noise({ dur: 0.07, freq: 1100, q: 6, gain: 0.3, t: 0.015, verb: 0.4 }); }
  bang() {
    this.noise({ dur: 1.6, type: 'lowpass', freq: 1600, q: 0.4, gain: 1.4, attack: 0.001, verb: 0.8 });
    this.noise({ dur: 0.22, type: 'highpass', freq: 2200, gain: 0.8, attack: 0.001 });
    this.tone({ freq: 110, type: 'sine', dur: 0.7, gain: 1.0, slide: 32, attack: 0.001 });
    this.noise({ dur: 2.4, type: 'bandpass', freq: 380, q: 0.6, gain: 0.25, t: 0.08, verb: 1 });
    if (this.ctx) { this.duck.gain.cancelScheduledValues(this.ctx.currentTime); this.duck.gain.setValueAtTime(0, this.ctx.currentTime); }
  }
  heartbeat(rate = 1) {
    for (const [t, g] of [[0, 0.5], [0.16 / rate, 0.32]]) { this.tone({ freq: 58, type: 'sine', dur: 0.18, gain: g, t, slide: 40, attack: 0.01 }); this.noise({ dur: 0.08, type: 'lowpass', freq: 120, gain: g * 0.4, t }); }
  }
  sting() { [98, 103.8, 146.8].forEach((f, i) => this.tone({ freq: f, type: 'sawtooth', dur: 1.6, gain: 0.07, lp: 700, t: i * 0.02, attack: 0.02, verb: 0.5 })); this.noise({ dur: 0.4, type: 'lowpass', freq: 300, gain: 0.4 }); this.tone({ freq: 196, type: 'triangle', dur: 0.9, gain: 0.06, slide: 185, verb: 0.6 }); }
  relief() { this.tone({ freq: 392, dur: 0.5, gain: 0.05, type: 'triangle', verb: 0.5 }); this.tone({ freq: 523, dur: 0.7, gain: 0.04, type: 'triangle', t: 0.12, verb: 0.5 }); }
  reveal() { this.tone({ freq: 220, type: 'triangle', dur: 0.4, gain: 0.08 }); this.noise({ dur: 0.18, freq: 1800, q: 0.7, gain: 0.18 }); }
  verdict(lie) {
    if (lie) [220, 207.6].forEach((f, i) => this.tone({ freq: f, type: 'sawtooth', dur: 0.7, gain: 0.05, lp: 1200, t: i * 0.12, verb: 0.4 }));
    else [392, 494].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.6, gain: 0.05, t: i * 0.1, verb: 0.4 }));
  }
  tableCard() { [523, 659, 784].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.8, gain: 0.035, t: i * 0.07, verb: 0.6 })); }
  win() { [392, 494, 587, 784, 988].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 1.1, gain: 0.07, t: i * 0.13, verb: 0.6 })); }
  lose() { [220, 196, 164.8, 110].forEach((f, i) => this.tone({ freq: f, type: 'sawtooth', dur: 1.4, gain: 0.05, lp: 800, t: i * 0.3, verb: 0.8 })); }
}

export const audio = new Audio();
