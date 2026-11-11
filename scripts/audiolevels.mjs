// node audiolevels.mjs <repoRoot> <old|new>
// Renders each sound through the real audio graph in an OfflineAudioContext and reports peak/RMS.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(process.argv[2]); const which = process.argv[3];
const S = path.dirname(new URL(import.meta.url).pathname);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.route('http://t/**', (r) => {
  const u = new URL(r.request().url()).pathname;
  let f;
  if (u === '/index.html') return r.fulfill({ contentType: 'text/html', body: `<script type="importmap">{"imports":{"three":"/three.js"}}</script>` });
  if (u === '/three.js') f = path.join(ROOT, 'tools/vendor/three/build/three.module.js');
  else if (u === '/old/audio.js') f = path.join(S, 'audio-old.js');
  else if (u === '/old/util.js') f = path.join(ROOT, 'src/util.js');
  else f = path.join(ROOT, u);
  r.fulfill({ contentType: 'text/javascript', body: readFileSync(f) });
});
await page.goto('http://t/index.html');
const res = await page.evaluate(async (which) => {
  localStorage.clear();
  const SR = 48000;
  let secs = 3;
  AudioParam.prototype.setTargetAtTime = function (v, t) { return this.setValueAtTime(v, t); };
  window.AudioContext = function () { return new OfflineAudioContext(2, SR * secs, SR); };
  const { audio } = await import(which === 'old' ? '/old/audio.js' : '/src/audio.js');
  const base = { ...audio.vol };
  const out = {};
  const measure = async (name, fn, { music = 0, amb = 0, sfx = base.sfx, master = base.master, s = 3 } = {}) => {
    secs = s; audio.ctx = null;
    Object.assign(audio.vol, { music, ambience: amb, sfx, master });
    audio.init();
    const ctx = audio.ctx;
    for (const g of [audio.duck, audio.duckWet]) if (g) { g.gain.cancelScheduledValues(0); g.gain.setValueAtTime(1, 0); }
    if (audio.master) { audio.master.gain.cancelScheduledValues(0); }
    audio.applyVolumes();
    fn(audio);
    const buf = await ctx.startRendering();
    let peak = 0, sum = 0, n = 0, clipped = 0;
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; if (a >= 0.999) clipped++; sum += d[i] * d[i]; n++; } }
    const db = (x) => (20 * Math.log10(x || 1e-9)).toFixed(1);
    out[name] = { peak: db(peak), rms: db(Math.sqrt(sum / n)), clipped };
  };
  await measure('bang', (a) => a.bang());
  await measure('bang (all sliders 1)', (a) => a.bang(), { sfx: 1, master: 1 });
  await measure('click', (a) => a.click());
  await measure('cock', (a) => a.cock());
  await measure('card', (a) => a.card());
  await measure('sting', (a) => a.sting());
  await measure('heartbeat', (a) => a.heartbeat(1));
  await measure('uiClick', (a) => a.uiClick());
  await measure('win', (a) => a.win());
  await measure('spin', (a) => a.spin());
  await measure('music phrase', (a) => { const t = 0.05; a.pluck(45, t, 0.32); a.pluck(60, t + 0.8, 0.1); a.pluck(64, t + 0.8, 0.075); a.pluck(76, t, 0.11); a.pluck(68, t + 1.6, 0.11); }, { music: base.music, sfx: 0 });
  await measure('ambience bed', () => {}, { amb: base.ambience, sfx: 0, s: 4 });
  await measure('clink', (a) => a.clink(), { amb: base.ambience, sfx: 0 });
  return { base, out };
}, which);
console.log(which, JSON.stringify(res.base));
for (const [k, v] of Object.entries(res.out)) console.log(`${k.padEnd(22)} peak ${v.peak.padStart(6)} dBFS  rms ${v.rms.padStart(6)} dBFS  clipped samples ${v.clipped}`);
await browser.close();
