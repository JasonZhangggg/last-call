// All sound is synthesized at runtime: no files. Three buses (sfx, music, ambience) each have a
// dry fader and a matching reverb send, so a slider controls its whole sound including the tail.
// Everything sums into a gentle glue compressor and then a brick-wall limiter, so nothing clips.
// Music is an original plucked-string waltz built with Karplus-Strong synthesis and scheduled
// ahead of time so it never drifts.
import { store, clamp } from './util.js';

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
// Sliders are linear 0..1; a squared taper makes each step sound like a similar change in loudness.
const taper = (v) => v * v;
const BUS_TRIM = { sfx: 1, music: 0.5, ambience: 0.55 };

class Audio {
  constructor() {
    this.ctx = null;
    this.vol = { master: 0.8, music: 0.5, sfx: 0.85, ambience: 0.5, ...store.get('volume', {}) };
    this.muted = store.get('muted', false);
    this.tension = 0;
  }

  init() {
    if (this.ctx) { if (this.ctx.state !== 'running' && !document.hidden) this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16; glue.knee.value = 10; glue.ratio.value = 2; glue.attack.value = 0.01; glue.release.value = 0.25;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -4; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = 0.001; limit.release.value = 0.12;
    this.master = ctx.createGain(); this.master.gain.value = 0;
    // makeup gain: the squared slider taper sits about 4 dB under the old linear mix at the defaults
    const makeup = ctx.createGain(); makeup.gain.value = 1.6;
    this.master.connect(makeup).connect(glue).connect(limit).connect(ctx.destination);
    // reverb: a generated decaying-noise impulse, one convolver shared by every bus
    this.verb = ctx.createConvolver(); this.verb.buffer = this.impulse(1.8, 2.6);
    this.verbIn = ctx.createGain(); this.verbIn.gain.value = 0.32;
    const verbTone = ctx.createBiquadFilter(); verbTone.type = 'lowpass'; verbTone.frequency.value = 5200;
    this.verbIn.connect(verbTone).connect(this.verb).connect(this.master);
    this.bus = {}; this.send = {};
    for (const k of ['sfx', 'music', 'ambience']) {
      this.bus[k] = ctx.createGain(); this.bus[k].connect(this.master);
      this.send[k] = ctx.createGain(); this.send[k].connect(this.verbIn);
    }
    // Music runs through a duck stage (dry and wet) so tense moments can pull it down together.
    this.duck = ctx.createGain(); this.duck.connect(this.bus.music);
    this.duckWet = ctx.createGain(); this.duckWet.connect(this.send.music);
    for (const g of [this.duck, this.duckWet]) { g.gain.setValueAtTime(0, ctx.currentTime); g.gain.setTargetAtTime(1, ctx.currentTime + 0.3, 1.2); }
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
    this.master.gain.setTargetAtTime(this.muted ? 0 : taper(v.master), t, 0.05);
    for (const k of ['sfx', 'music', 'ambience']) {
      const g = taper(v[k]) * BUS_TRIM[k];
      this.bus[k].gain.setTargetAtTime(g, t, 0.05);
      this.send[k].gain.setTargetAtTime(g, t, 0.05);
    }
  }
  setVolume(key, value) { this.vol[key] = clamp(+value || 0, 0, 1); store.set('volume', this.vol); this.applyVolumes(); }
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
    if (verb) { const vs = ctx.createGain(); vs.gain.value = verb; out.connect(vs).connect(this.send[bus]); }
    s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.05);
  }
  tone({ freq = 440, type = 'sine', dur = 0.3, gain = 0.2, t = 0, slide = 0, lp = 0, attack = 0.005, bus = 'sfx', verb = 0, pan = 0 }) {
    const ctx = this.ctx; if (!ctx) return; const t0 = ctx.currentTime + t;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = o;
    if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
    node.connect(g);
    let out = g;
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    out.connect(this.bus[bus]);
    if (verb) { const vs = ctx.createGain(); vs.gain.value = verb; out.connect(vs).connect(this.send[bus]); }
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  /* ---------- ambience: room tone, distant murmur, occasional clinks and creaks ---------- */
  startAmbience() {
    const ctx = this.ctx, sr = ctx.sampleRate;
    const bb = ctx.createBuffer(1, sr * 4, sr), bd = bb.getChannelData(0); let last = 0;
    for (let i = 0; i < bd.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.2; }
    // crossfade the loop seam so the room tone never ticks when it wraps
    const fade = Math.floor(sr * 0.05);
    for (let i = 0; i < fade; i++) { const a = i / fade; bd[i] = bd[i] * a + bd[bd.length - fade + i] * (1 - a); }
    const room = ctx.createBufferSource(); room.buffer = bb; room.loop = true; room.loopEnd = (bb.length - fade) / sr;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 340;
    const rg = ctx.createGain(); rg.gain.value = 0.1;
    room.connect(lp).connect(rg).connect(this.bus.ambience); room.start();
    // murmur: band-passed noise whose level wanders like a distant crowd
    const mur = ctx.createBufferSource(); mur.buffer = this.noiseBuf; mur.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 480; bp.Q.value = 1.1;
    const soft = ctx.createBiquadFilter(); soft.type = 'lowpass'; soft.frequency.value = 1400;
    const mg = ctx.createGain(); mg.gain.value = 0.016;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.23; const lg = ctx.createGain(); lg.gain.value = 0.009;
    lfo.connect(lg).connect(mg.gain); lfo.start();
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 1.3; const lg2 = ctx.createGain(); lg2.gain.value = 110;
    lfo2.connect(lg2).connect(bp.frequency); lfo2.start();
    mur.connect(bp).connect(soft).connect(mg).connect(this.bus.ambience); mur.start();
    const events = () => {
      if (!this.ctx) return;
      const r = Math.random(), pan = Math.random() * 1.6 - 0.8;
      if (r < 0.45) this.clink(pan);
      else if (r < 0.7) this.creak(pan);
      else this.laugh(pan);
      setTimeout(events, 4000 + Math.random() * 8000);
    };
    setTimeout(events, 4000);
  }
  clink(pan = 0) {
    const f = 2200 + Math.random() * 1200;
    for (const [m, g] of [[1, 0.022], [2.76, 0.009], [5.4, 0.004]]) {
      if (f * m < 12000) this.tone({ freq: f * m, type: 'sine', dur: 0.45 + Math.random() * 0.35, gain: g, attack: 0.001, bus: 'ambience', verb: 0.6, pan });
    }
    this.noise({ dur: 0.02, freq: 4500, q: 0.8, gain: 0.015, bus: 'ambience', pan });
  }
  creak(pan = 0) {
    const ctx = this.ctx; if (!ctx) return; const t0 = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; const f0 = 70 + Math.random() * 40; o.frequency.setValueAtTime(f0, t0); o.frequency.linearRampToValueAtTime(f0 * 1.6, t0 + 0.6);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.01, t0 + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
    let out = o.connect(bp).connect(g);
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; out = out.connect(p); }
    out.connect(this.bus.ambience); o.start(t0); o.stop(t0 + 0.75);
  }
  laugh(pan = 0) {
    for (let i = 0; i < 4 + Math.floor(Math.random() * 3); i++) this.noise({ dur: 0.09, freq: 650 + Math.random() * 250, q: 4, gain: 0.01, t: i * 0.13, bus: 'ambience', verb: 0.5, pan });
  }

  /* ---------- music ---------- */
  buildPlucks() {
    // Karplus-Strong: a noise burst through a damped delay line reads as a plucked string.
    // The burst is smoothed first, which gives a warmer, gut-string attack instead of a hiss.
    const ctx = this.ctx, sr = ctx.sampleRate;
    this.plucks = new Map();
    const make = (midi, seconds, damp) => {
      const len = Math.floor(sr * seconds), buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
      const period = Math.max(2, Math.round(sr / NOTE(midi)));
      const line = new Float32Array(period);
      for (let i = 0; i < period; i++) line[i] = Math.random() * 2 - 1;
      for (let pass = 0; pass < 2; pass++) for (let i = 1; i < period; i++) line[i] = 0.5 * (line[i] + line[i - 1]);
      let mean = 0; for (let i = 0; i < period; i++) mean += line[i] / period;
      for (let i = 0; i < period; i++) line[i] -= mean;
      let idx = 0, prev = 0, peak = 0;
      for (let i = 0; i < len; i++) {
        const cur = line[idx]; const out = damp * 0.5 * (cur + prev);
        line[idx] = out; prev = cur; d[i] = cur * (i < 40 ? i / 40 : 1);
        peak = Math.max(peak, Math.abs(d[i]));
        idx = (idx + 1) % period;
      }
      const tail = Math.floor(sr * 0.08);
      for (let i = 0; i < len; i++) d[i] = (d[i] / (peak || 1)) * (i > len - tail ? (len - i) / tail : 1);
      return buf;
    };
    for (const m of [33, 36, 38, 40, 41, 43, 45, 48, 50, 52, 53, 55, 56, 57, 59, 60, 62, 64, 65, 67, 68, 69, 71, 72, 74, 76]) this.plucks.set(m, make(m, m < 45 ? 3 : 2.2, m < 45 ? 0.998 : 0.995));
  }
  pluck(midi, when, gain = 0.2, pan = 0) {
    const buf = this.plucks.get(midi); if (!buf) return;
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = buf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = midi < 50 ? 1200 : 2300;
    const g = ctx.createGain(); g.gain.value = gain;
    let out = g; if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    s.connect(lp).connect(g); out.connect(this.duck);
    const vs = ctx.createGain(); vs.gain.value = 0.45; out.connect(vs).connect(this.duckWet);
    s.start(when);
  }
  startMusic() {
    // An original slow waltz in A minor. Each bar: bass on 1, two chord tones on 2 and 3, and a
    // sparse melody over the top. Two melodies alternate (A A B A) so the loop doesn't nag.
    const bars = [
      { bass: 45, chord: [57, 60, 64] }, { bass: 45, chord: [57, 60, 64] },
      { bass: 38, chord: [57, 62, 65] }, { bass: 40, chord: [56, 59, 64] },
      { bass: 45, chord: [57, 60, 64] }, { bass: 41, chord: [57, 60, 65] },
      { bass: 38, chord: [57, 62, 65] }, { bass: 40, chord: [56, 59, 62] },
    ];
    const A = [76, null, 74, 72, null, 71, 69, null, 71, 72, 74, null, 76, null, 72, 71, null, 69, 71, null, 68, 69, null, null];
    const B = [69, null, 72, 71, 69, null, 65, null, 69, 68, null, 64, 64, 69, 72, 72, null, 69, 74, 72, 69, 68, null, null];
    const form = [A, A, B, A];
    const beat = 60 / 72;
    let next = this.ctx.currentTime + 0.6, step = 0;
    const tick = () => {
      if (!this.ctx) return;
      while (next < this.ctx.currentTime + 0.4) {
        const bar = bars[Math.floor(step / 3) % bars.length], b = step % 3;
        const human = (Math.random() - 0.5) * 0.02, vel = 0.9 + Math.random() * 0.2;
        if (b === 0) this.pluck(bar.bass, next + human, 0.3 * vel, -0.2);
        else this.pluck(bar.chord[b], next + human, 0.085 * vel, 0.25), this.pluck(bar.chord[(b + 1) % 3], next + human + 0.014, 0.065 * vel, 0.3);
        const tune = form[Math.floor(step / 24) % form.length];
        const m = tune[step % 24];
        if (m && Math.random() < 0.88) this.pluck(m, next + human + 0.01, 0.1 * vel, 0.05);
        next += beat; step++;
      }
      setTimeout(tick, 120);
    };
    tick();
  }
  /** 0..1: fades the music under tense moments. */
  setTension(v) {
    this.tension = v; if (!this.ctx) return;
    const t = this.ctx.currentTime, g = 1 - v * 0.85;
    this.duck.gain.cancelScheduledValues(t); this.duckWet.gain.cancelScheduledValues(t);
    this.duck.gain.setTargetAtTime(g, t, 0.4); this.duckWet.gain.setTargetAtTime(g, t, 0.4);
  }

  /* ---------- effects ---------- */
  card(pan = 0) { this.noise({ dur: 0.12, freq: 2300 + Math.random() * 800, q: 0.7, gain: 0.18, pan }); this.noise({ dur: 0.06, type: 'lowpass', freq: 500, gain: 0.14, t: 0.07, pan }); }
  deal(pan = 0, t = 0) { this.noise({ dur: 0.07, freq: 3000 + Math.random() * 700, q: 0.9, gain: 0.11, pan, t }); }
  select() { this.noise({ dur: 0.05, freq: 3400, q: 1.2, gain: 0.08 }); this.tone({ freq: 1320, type: 'triangle', dur: 0.06, gain: 0.018 }); }
  hover() { this.noise({ dur: 0.03, freq: 4200, q: 2, gain: 0.025 }); }
  uiClick() { this.tone({ freq: 660, type: 'triangle', dur: 0.08, gain: 0.035 }); this.tone({ freq: 990, type: 'sine', dur: 0.05, gain: 0.012, t: 0.005 }); }
  shuffle() { for (let i = 0; i < 10; i++) this.noise({ dur: 0.07, freq: 2400 + Math.random() * 1100, q: 0.6, gain: 0.1, t: i * 0.045 }); }
  spin(n = 12) { for (let i = 0; i < n; i++) { const t = i * 0.045 + i * i * 0.0035; this.noise({ dur: 0.025, freq: 3600, q: 3, gain: 0.1, t }); this.tone({ freq: 1700, type: 'triangle', dur: 0.02, gain: 0.018, t }); } }
  cock() { this.noise({ dur: 0.05, freq: 2800, q: 0.9, gain: 0.26 }); this.noise({ dur: 0.07, freq: 1300, q: 5, gain: 0.2, t: 0.08, verb: 0.15 }); this.tone({ freq: 900, type: 'triangle', dur: 0.03, gain: 0.03, t: 0.08 }); }
  click() { this.noise({ dur: 0.035, type: 'highpass', freq: 2600, gain: 0.6, attack: 0.001 }); this.tone({ freq: 2400, type: 'triangle', dur: 0.03, gain: 0.05 }); this.noise({ dur: 0.09, freq: 1100, q: 6, gain: 0.32, t: 0.012, verb: 0.35 }); }
  bang() {
    // crack, body, sub thump and a room tail: loud and physical, but the limiter keeps it from clipping
    this.noise({ dur: 0.12, type: 'highpass', freq: 1800, gain: 1, attack: 0.0005 });
    this.noise({ dur: 0.55, type: 'lowpass', freq: 1100, q: 0.5, gain: 1.4, attack: 0.001, verb: 0.6 });
    this.tone({ freq: 95, type: 'sine', dur: 0.4, gain: 1.1, slide: 38, attack: 0.002 });
    this.noise({ dur: 2, type: 'bandpass', freq: 320, q: 0.6, gain: 0.16, t: 0.06, verb: 1 });
    if (this.ctx) {
      const t = this.ctx.currentTime;
      for (const g of [this.duck, this.duckWet]) { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, 0.02); }
    }
  }
  heartbeat(rate = 1) {
    for (const [t, g] of [[0, 0.28], [0.16 / rate, 0.18]]) {
      this.tone({ freq: 58, type: 'sine', dur: 0.18, gain: g, t, slide: 40, attack: 0.01 });
      // an octave up so the beat still reads on laptop and phone speakers
      this.tone({ freq: 116, type: 'sine', dur: 0.12, gain: g * 0.25, t, slide: 80, attack: 0.008 });
      this.noise({ dur: 0.08, type: 'lowpass', freq: 120, gain: g * 0.35, t });
    }
  }
  sting() { [98, 103.8, 146.8].forEach((f, i) => this.tone({ freq: f, type: 'sawtooth', dur: 1.6, gain: 0.042, lp: 650, t: i * 0.02, attack: 0.02, verb: 0.5 })); this.noise({ dur: 0.4, type: 'lowpass', freq: 300, gain: 0.25 }); this.tone({ freq: 196, type: 'triangle', dur: 0.9, gain: 0.035, slide: 185, verb: 0.6 }); }
  relief() { this.tone({ freq: 392, dur: 0.5, gain: 0.05, type: 'triangle', verb: 0.5 }); this.tone({ freq: 523, dur: 0.7, gain: 0.04, type: 'triangle', t: 0.12, verb: 0.5 }); }
  reveal() { this.tone({ freq: 220, type: 'triangle', dur: 0.4, gain: 0.07 }); this.noise({ dur: 0.18, freq: 1700, q: 0.7, gain: 0.16 }); }
  verdict(lie) {
    if (lie) [220, 207.6].forEach((f, i) => this.tone({ freq: f, type: 'sawtooth', dur: 0.7, gain: 0.045, lp: 1100, t: i * 0.12, verb: 0.4 }));
    else [392, 494].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.6, gain: 0.05, t: i * 0.1, verb: 0.4 }));
  }
  tableCard() { [523, 659, 784].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.8, gain: 0.032, t: i * 0.07, verb: 0.6 })); }
  win() { [392, 494, 587, 784, 988].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 1.1, gain: 0.04, t: i * 0.13, verb: 0.6 })); }
  lose() { [220, 196, 164.8, 110].forEach((f, i) => this.tone({ freq: f, type: 'sawtooth', dur: 1.4, gain: 0.032, lp: 800, t: i * 0.3, verb: 0.8 })); }
}

export const audio = new Audio();

/* ---------- dice table sounds ---------- */
// Dice in a leather cup, the cup on felt, and the poison tray's glasses. Kept apart from the
// class body so the card table's sounds stay as they were.
Object.assign(Audio.prototype, {
  /** Dice rattling inside a shaken cup for `dur` seconds: muffled bone clicks with a leather thump. */
  rattle(pan = 0, dur = 1, gain = 1) {
    let t = 0;
    while (t < dur) {
      const k = gain * (0.6 + Math.random() * 0.4);
      this.noise({ dur: 0.022, freq: 2200 + Math.random() * 1800, q: 2.5, gain: 0.07 * k, t, pan });
      if (Math.random() < 0.35) this.noise({ dur: 0.05, type: 'lowpass', freq: 380, gain: 0.08 * k, t, pan });
      t += 0.028 + Math.random() * 0.05;
    }
  },
  /** The cup slammed down: a felt-muffled thud and the dice settling under it. */
  slam(pan = 0) {
    this.tone({ freq: 110, type: 'sine', dur: 0.2, gain: 0.32, slide: 52, attack: 0.002, pan });
    this.noise({ dur: 0.12, type: 'lowpass', freq: 520, gain: 0.34, attack: 0.001, verb: 0.2, pan });
    for (let i = 0; i < 4; i++) this.noise({ dur: 0.018, freq: 2600 + Math.random() * 900, q: 3, gain: 0.04, t: 0.03 + i * 0.035, pan });
  },
  cupLift(pan = 0) { this.noise({ dur: 0.16, freq: 900, q: 0.8, gain: 0.05, attack: 0.03, pan }); },
  cupDown(pan = 0) { this.noise({ dur: 0.07, type: 'lowpass', freq: 420, gain: 0.14, pan }); },
  /** A knuckle on the table with a bid. */
  bidKnock(pan = 0) { this.noise({ dur: 0.06, type: 'lowpass', freq: 300, gain: 0.2, pan }); this.tone({ freq: 160, type: 'sine', dur: 0.08, gain: 0.08, slide: 120, pan }); },
  /** One die counted: a bright tick that climbs toward the bid. */
  diceTick(i = 0, of = 6) {
    const f = 660 * Math.pow(2, Math.min(i, of) / Math.max(6, of));
    this.tone({ freq: f, type: 'triangle', dur: 0.14, gain: 0.05, verb: 0.3 });
    this.noise({ dur: 0.02, freq: 3200, q: 2, gain: 0.05 });
  },
  glassPick(pan = 0) { this.tone({ freq: 3100, type: 'sine', dur: 0.22, gain: 0.03, attack: 0.001, verb: 0.4, pan }); this.tone({ freq: 5200, type: 'sine', dur: 0.12, gain: 0.012, attack: 0.001, pan }); },
  glassDown(pan = 0, t = 0) { this.tone({ freq: 2500, type: 'sine', dur: 0.18, gain: 0.03, attack: 0.001, t, verb: 0.3, pan }); this.noise({ dur: 0.04, type: 'lowpass', freq: 700, gain: 0.1, t, pan }); },
  /** Two swallows. */
  gulp(pan = 0) {
    for (const t of [0.3, 0.66]) {
      this.tone({ freq: 210, type: 'sine', dur: 0.13, gain: 0.12, slide: 120, t, attack: 0.01, pan });
      this.noise({ dur: 0.09, freq: 420, q: 3, gain: 0.07, t, pan });
    }
  },
  /** The poisoned glass: a choke, a sour falling drone and a dull slump. */
  poison(pan = 0) {
    for (let i = 0; i < 3; i++) this.noise({ dur: 0.12, freq: 700 + Math.random() * 300, q: 2.5, gain: 0.1, t: i * 0.16, pan });
    [146.8, 155.6].forEach((f, i) => this.tone({ freq: f, type: 'sawtooth', dur: 1.8, gain: 0.04, lp: 700, slide: f * 0.6, t: 0.1 + i * 0.03, verb: 0.6 }));
    this.noise({ dur: 0.3, type: 'lowpass', freq: 240, gain: 0.3, t: 0.9, verb: 0.4, pan });
  },
});
