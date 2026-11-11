// Finds characters that shake when they shouldn't: samples every opponent's head, gaze, upper body
// and both hands at 240 Hz in a self-playing game and flags high-frequency oscillation (repeated
// velocity reversals whose swing exceeds 1 mm) while the tremble envelope is off.
//   node scripts/shake-probe.mjs [--mode cards|devil|dice|auction] [--minutes 3] [--seed 7] [--hz 240] [--amp 1 (mm)] [--rebuild] [--label run]
// --rebuild forces the hidden-tab catch-up rebuild while a character holds the revolver or glass.
// Needs `npm run build` first. Writes artifacts/shake-<mode>-<label>.json.
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1] ?? true]] : a), []));
const HZ = +(args.hz || 240), AMP_MM = +(args.amp || 1);
const MODE = args.mode || 'cards', LABEL = args.label || 'run', SEED = +(args.seed || 7), MINUTES = +(args.minutes || 3);
const HASH = { cards: '#autoplay', dice: '#autoplay-dice', auction: '#autoplay-auction', devil: '#autoplay-devil' }[MODE];
const ROOT = path.resolve('.'), OUT = path.resolve('artifacts'), PAGE = path.resolve('dist/index.html');
mkdirSync(OUT, { recursive: true });
if (!existsSync(PAGE)) throw new Error('run `npm run build` first');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(240000);
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('/build/three.module.js')) return route.fulfill({ path: path.join(ROOT, 'tools/vendor/three/build/three.module.js'), contentType: 'text/javascript' });
  if (u.includes('/examples/jsm/')) return route.fulfill({ path: path.join(ROOT, 'tools/vendor/three/examples/jsm', u.split('/examples/jsm/')[1]), contentType: 'text/javascript' });
  if (u.startsWith('file:')) return route.continue();
  return route.abort();
});
await page.addInitScript((seed) => {
  let a = seed >>> 0;
  Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  try { localStorage.setItem('lastcall.coach', JSON.stringify({ lead: 1, liar: 1 })); localStorage.setItem('lastcall.quality', '"low"'); } catch {}
}, SEED);
await page.goto('file://' + PAGE + HASH);
await page.waitForFunction(() => window.__lastcall?.D?.viewChars?.[3]);

await page.evaluate(({ hz, amp, rebuild }) => {
  const L = window.__lastcall, D = L.D, chars = D.viewChars;
  const AMP = amp, WINDOW = 0.6, MIN_REV = 5;
  const R = { t: 0, episodes: [], maxAmpQuiet: {}, revQuiet: {}, samples: 0, stuckTremble: [] };
  const stuck = [null, null, null, null];
  R.openStuck = stuck;
  const holding = (ch) => ch.grip.children.length > 0 || ch.env.reach > 0.05;
  let rebuilds = 0, lastRebuild = -99;
  R.rebuilds = [];
  const cupShaking = (s) => (L.diceTable?.cups?.[s]?.shake || 0) > 0.01;
  const trembleAt = [0, -9, -9, -9];
  window.__shake = R;
  const tracks = [];
  // each part's origin, and a point 17 cm off it along the part's local diagonal so turns show too
  const TIP = [0.1, 0.1, 0.1];
  for (let s = 1; s < 4; s++) {
    const ch = chars[s];
    const parts = { head: () => ch.head, upper: () => ch.upper, rHand: () => ch.arm.hand, lHand: () => ch.leftArm.hand, fanCard: () => L.cards.hands[s]?.[0]?.mesh };
    for (const [part, get] of Object.entries(parts)) for (const off of [null, TIP]) {
      tracks.push({ s, part: off ? part + 'Tip' : part, get, obj: null, off, p: null, v: [0, 0, 0], ext: [null, null, null], revs: [[], [], []], open: null });
    }
  }
  const ctx = (ch) => ({
    actor: D.actor, prompt: D.prompt?.type, watch: !!D.watch,
    env: Object.fromEntries(Object.entries(ch.env).filter(([, v]) => v > 0.01).map(([k, v]) => [k, +v.toFixed(2)])),
    target: Object.fromEntries(Object.entries(ch.target).filter(([, v]) => v).map(([k, v]) => [k, v])),
    yaw: +ch.yaw.toFixed(3), pitch: +ch.pitch.toFixed(3),
  });
  const P = [0, 0, 0];
  L.hooks.probe = {
    hz, maxDt: 0.5,
    draw: (() => { let since = 0; return (dt) => { since += dt; if (since < 2) return false; since = 0; return true; }; })(),
    sample(dt) {
      R.t += dt; R.samples++;
      for (let s = 1; s < 4; s++) {
        const ch = chars[s];
        if (ch.env.tremble >= 0.05 || cupShaking(s)) trembleAt[s] = R.t;
        // tremble on with nothing in the right hand for over a second is a stuck envelope
        if (ch.env.tremble > 0.05 && !holding(ch)) { if (!stuck[s]) stuck[s] = { s, t0: +R.t.toFixed(2), ctx: ctx(ch) }; stuck[s].t1 = +R.t.toFixed(2); }
        else if (stuck[s]) { if (stuck[s].t1 - stuck[s].t0 > 1) R.stuckTremble.push(stuck[s]); stuck[s] = null; }
        // a hosted table catches up after a hidden tab by rebuilding from a snapshot: do that mid-ordeal
        if (rebuild && ch.target.tremble && ch.grip.children.length && rebuilds < 3 && R.t - lastRebuild > 25) {
          rebuilds++; lastRebuild = R.t; R.rebuilds.push({ s, t: +R.t.toFixed(2), ctx: ctx(ch) });
          for (let i = 0; i < 6; i++) D.queue.push({ msg: { type: 'noop' }, at: performance.now() });
          document.dispatchEvent(new Event('visibilitychange'));
        }
      }
      for (const tr of tracks) {
        const ch = chars[tr.s];
        const o = tr.get();
        if (o !== tr.obj) { tr.obj = o; tr.p = null; tr.ext = [null, null, null]; tr.revs = [[], [], []]; }
        if (!o) continue;
        o.updateWorldMatrix(true, false);
        const e = o.matrixWorld.elements, f = tr.off || [0, 0, 0];
        for (let k = 0; k < 3; k++) P[k] = e[12 + k] + e[k] * f[0] + e[4 + k] * f[1] + e[8 + k] * f[2];
        if (tr.p) {
          let hot = 0, amp = 0;
          for (let k = 0; k < 3; k++) {
            const v = (P[k] - tr.p[k]) / dt;
            if (tr.ext[k] == null) tr.ext[k] = P[k];
            if (v * tr.v[k] < 0) {
              const swing = Math.abs(tr.p[k] - tr.ext[k]);
              tr.ext[k] = tr.p[k];
              if (swing > AMP) tr.revs[k].push([R.t, swing]);
            }
            if (v !== 0) tr.v[k] = v;
            const rv = tr.revs[k]; while (rv.length && rv[0][0] < R.t - WINDOW) rv.shift();
            if (rv.length >= MIN_REV) { hot = Math.max(hot, rv.length); amp = Math.max(amp, ...rv.map((r) => r[1])); }
          }
          const quiet = R.t - trembleAt[tr.s] > WINDOW;
          const key = `s${tr.s}.${tr.part}`;
          if (hot && quiet) {
            R.maxAmpQuiet[key] = Math.max(R.maxAmpQuiet[key] || 0, amp);
            R.revQuiet[key] = (R.revQuiet[key] || 0) + 1;
            if (!tr.open) { tr.open = { key, t0: +R.t.toFixed(3), t1: 0, maxAmp: 0, maxRev: 0, start: ctx(ch), lookTarget: ch.lookTarget.toArray().map((x) => +x.toFixed(3)) }; R.episodes.push(tr.open); }
            tr.open.t1 = +R.t.toFixed(3); tr.open.maxAmp = Math.max(tr.open.maxAmp, +amp.toFixed(4)); tr.open.maxRev = Math.max(tr.open.maxRev, hot);
          } else if (tr.open && R.t - tr.open.t1 > 0.3) { tr.open.end = ctx(ch); tr.open = null; }
        }
        tr.p = P.slice();
      }
    },
    frame() {},
  };
}, { hz: HZ, amp: AMP_MM / 1000, rebuild: !!args.rebuild });

const t0 = Date.now();
let last = '';
while (Date.now() - t0 < MINUTES * 60000) {
  const s = await page.evaluate(() => ({ t: window.__shake.t.toFixed(0), ep: window.__shake.episodes.length, ph: window.__lastcall.D.prompt?.type, end: !document.getElementById('end')?.hidden && !document.getElementById('end')?.classList.contains('fade') }));
  const line = `sim ${s.t}s episodes ${s.ep} ${s.ph}`;
  if (line !== last) { console.error(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${line}`); last = line; }
  await page.waitForTimeout(5000);
}
const R = await page.evaluate(() => { const R = window.__shake; for (const o of R.openStuck) if (o && o.t1 - o.t0 > 1) R.stuckTremble.push({ ...o, open: true }); return R; });
await browser.close();
const byKey = {};
for (const e of R.episodes) { const k = e.key; byKey[k] = byKey[k] || { episodes: 0, seconds: 0, maxAmpMm: 0 }; byKey[k].episodes++; byKey[k].seconds += e.t1 - e.t0; byKey[k].maxAmpMm = Math.max(byKey[k].maxAmpMm, e.maxAmp * 1000); }
for (const v of Object.values(byKey)) { v.seconds = +v.seconds.toFixed(2); v.maxAmpMm = +v.maxAmpMm.toFixed(2); }
const summary = { mode: MODE, label: LABEL, seed: SEED, simulatedSeconds: +R.t.toFixed(1), samples: R.samples, quietShake: byKey, totalEpisodes: R.episodes.length, stuckTremble: R.stuckTremble, rebuilds: R.rebuilds, episodes: R.episodes.slice(0, 300), problems };
writeFileSync(path.join(OUT, `shake-${MODE}-${LABEL}.json`), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ mode: MODE, label: LABEL, simulatedSeconds: summary.simulatedSeconds, totalEpisodes: summary.totalEpisodes, stuckTremble: R.stuckTremble, rebuilds: R.rebuilds, quietShake: byKey, problems }, null, 2));
