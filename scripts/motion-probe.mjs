// Samples every moving thing at 240 Hz (the frame loop sub-steps its simulation while a probe is
// attached) across a deal, a human play, a Liar call and a roulette, and counts velocity
// discontinuities: one 1/240 s step whose velocity change is bigger than smooth acceleration allows.
//   node scripts/motion-probe.mjs [--size 640x360] [--label before] [--seed 7] [--page dist/index.html]
// Writes artifacts/motion-probe-<label>.json. Needs `npm run build` first. While attached, the page
// draws only twice a second so the software renderer can't starve the simulation; frame times here
// are therefore not render times.
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1] ?? true]] : a), []));
const [W, H] = String(args.size || '640x360').split('x').map(Number);
const LABEL = args.label || 'run', SEED = +(args.seed || 7);
const ROOT = path.resolve('.'), OUT = path.resolve('artifacts');
mkdirSync(OUT, { recursive: true });
const PAGE = path.resolve(args.page || 'dist/index.html');
if (!existsSync(PAGE)) throw new Error(`${PAGE} is missing; run \`npm run build\` first`);

// Per-step velocity change that counts as a discontinuity, at a 1/240 s step.
// 0.6 m/s per step is 144 m/s^2, several times what any eased flight here needs.
const HZ = 240;
const THRESH = { card: 0.6, gun: 0.6, camRot: 0.35, camPos: 0.3, head: 0.5 };

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.setDefaultTimeout(240000);
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|fonts\.g/.test(m.text())) problems.push(`console: ${m.text()}`); });
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

await page.goto('file://' + PAGE);
await page.waitForSelector('#title-menu:not([hidden])');

await page.evaluate(({ HZ, THRESH }) => {
  const L = window.__lastcall, D = L.D;
  const R = { spikes: {}, maxDv: {}, worst: [], frames: [], tagLag: [], hoverChanges: {}, programs0: L.renderer.info.programs.length, textures0: L.renderer.info.memory.textures, t: 0 };
  window.__probe = R;
  const seg = () => window.__probeSeg || (D.game ? (D.game.phase === 'between' ? 'deal' : D.game.phase === 'turn' ? (D.watch ? 'reveal' : 'play') : D.game.phase) : 'title');
  const tracks = new Map();
  const track = (key, cat, read) => tracks.set(key, { cat, read, p: null, v: null, n: 0 });
  const posOf = (o) => (out) => { o.updateWorldMatrix(true, false); const e = o.matrixWorld.elements; out[0] = e[12]; out[1] = e[13]; out[2] = e[14]; };
  // angular velocity from consecutive world rotation matrices (skew part of R_now * R_prev^T)
  const rotOf = (o) => { const prev = new Float64Array(9); let has = false; return (out, dt) => {
    o.updateWorldMatrix(true, false); const e = o.matrixWorld.elements;
    const c = [0, 1, 2, 4, 5, 6, 8, 9, 10].map((i) => e[i]);
    for (const k of [0, 3, 6]) { const l = Math.hypot(c[k], c[k + 1], c[k + 2]); c[k] /= l; c[k + 1] /= l; c[k + 2] /= l; }
    if (!has) { out[0] = out[1] = out[2] = 0; prev.set(c); has = true; return 'v'; }
    const m = (r, k) => c[r] * prev[k] + c[r + 3] * prev[k + 3] + c[r + 6] * prev[k + 6];
    out[0] = (m(2, 1) - m(1, 2)) / (2 * dt); out[1] = (m(0, 2) - m(2, 0)) / (2 * dt); out[2] = (m(1, 0) - m(0, 1)) / (2 * dt);
    prev.set(c); return 'v';
  }; };
  for (const v of L.views.values()) track(`card${v.id}`, 'card', posOf(v.mesh));
  track('gun', 'gun', posOf(L.gun.obj));
  track('muzzle', 'gun', posOf(L.gun.flash));
  track('camPos', 'camPos', posOf(L.camera));
  track('camRot', 'camRot', rotOf(L.camera));
  for (let s = 1; s < 4; s++) track(`head${s}`, 'head', rotOf(L.characters[s].head));
  const tmp = [0, 0, 0];
  let lastHover = null;
  let sinceDraw = 0;
  L.hooks.probe = {
    hz: HZ,
    draw(dt) { sinceDraw += dt; if (sinceDraw < 0.5) return false; sinceDraw = 0; return true; },
    sample(dt) {
      R.t += dt;
      const sg = seg();
      for (const [key, tr] of tracks) {
        const kind = tr.read(tmp, dt);
        let v;
        if (kind === 'v') v = tmp.slice();
        else { if (tr.p) v = [(tmp[0] - tr.p[0]) / dt, (tmp[1] - tr.p[1]) / dt, (tmp[2] - tr.p[2]) / dt]; tr.p = tmp.slice(); }
        if (!v) continue;
        if (tr.v && tr.n > 2) {
          const dv = Math.hypot(v[0] - tr.v[0], v[1] - tr.v[1], v[2] - tr.v[2]);
          const k = `${tr.cat}`;
          R.maxDv[k] = Math.max(R.maxDv[k] || 0, dv);
          if (dv > THRESH[tr.cat]) {
            R.spikes[k] = R.spikes[k] || {}; R.spikes[k][sg] = (R.spikes[k][sg] || 0) + 1;
            R.worst.push({ t: +R.t.toFixed(3), key, seg: sg, dv: +dv.toFixed(2), speed: +Math.hypot(...v).toFixed(2) });
            if (R.worst.length > 4000) R.worst.splice(0, 2000);
          }
        }
        tr.v = v; tr.n++;
      }
      const h = L.handUI.hover;
      if (h !== lastHover) { R.hoverChanges[sg] = (R.hoverChanges[sg] || 0) + 1; lastHover = h; }
    },
    frame() {
      R.frames.push(performance.now());
      if (!document.body.classList.contains('in-game') || innerWidth < 600) return;
      const cam = L.camera, P = cam.projectionMatrix.elements, V = cam.matrixWorldInverse.elements;
      for (let s = 1; s < 4; s++) {
        const el = document.querySelectorAll('#tags .tag')[s - 1];
        const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(el?.style.transform || ''); if (!m) continue;
        const ch = L.characters[s], hd = ch.head; hd.updateWorldMatrix(true, false);
        const e = hd.matrixWorld.elements, a = ch.tagAnchor, w = a ? [a.x, a.y, a.z, 1] : [e[12], e[13] + 0.27, e[14], 1];
        const ve = [0, 1, 2, 3].map((r) => V[r] * w[0] + V[r + 4] * w[1] + V[r + 8] * w[2] + V[r + 12] * w[3]);
        const ce = [0, 1, 3].map((r) => P[r] * ve[0] + P[r + 4] * ve[1] + P[r + 8] * ve[2] + P[r + 12] * ve[3]);
        const x = Math.min(innerWidth - 90, Math.max(90, (ce[0] / ce[2] * 0.5 + 0.5) * innerWidth));
        const y = Math.min(innerHeight - 230, Math.max(150, (-ce[1] / ce[2] * 0.5 + 0.5) * innerHeight));
        R.tagLag.push(Math.hypot(x - +m[1], y - +m[2]));
      }
    },
  };
}, { HZ, THRESH });

const state = () => page.evaluate(() => {
  const D = window.__lastcall.D, g = D.game;
  const vis = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && !el.classList.contains('fade'); };
  return { phase: g?.phase, round: g?.round, pending: g?.pending?.seat ?? null, alive: g?.players.map((p) => p.alive), actions: vis('actions'), trigger: vis('trigger-row'), end: vis('end'), liarEnabled: !document.getElementById('liar-btn').disabled, playEnabled: !document.getElementById('play-btn').disabled };
});
const setSeg = (s) => page.evaluate((s) => { window.__probeSeg = s; }, s);
const glide = async (x, y, ms = 350) => { await page.mouse.move(x, y, { steps: Math.max(2, Math.round(ms / 16)) }); };

await page.mouse.move(W / 2, H / 2);
await page.click('#start-btn');
const t0 = Date.now();
let looked = false, sawRoulette = false, liarCalled = false;
let lastLog = '';
while (Date.now() - t0 < 900000) {
  const s = await state();
  const tagline = `${s.phase} r${s.round} pending=${s.pending}`;
  if (tagline !== lastLog) { console.error(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${tagline}`); lastLog = tagline; }
  if (s.end) break;
  if (s.phase === 'roulette') sawRoulette = true;
  if (sawRoulette && s.phase === 'turn' && s.round >= 2) break;
  if (s.trigger) { await page.keyboard.down('Space'); await page.waitForTimeout(1000); await page.keyboard.up('Space'); continue; }
  if (s.actions) {
    if (!looked) {
      looked = true;
      await setSeg('look');
      await glide(W * 0.02, H * 0.45, 500); await page.waitForTimeout(1300);
      await glide(W * 0.98, H * 0.4, 700); await page.waitForTimeout(1300);
      await glide(W * 0.5, H * 0.5, 400); await page.waitForTimeout(600);
      await setSeg('hover-sweep');
      for (let x = W * 0.3; x <= W * 0.7; x += 6) { await page.mouse.move(x, H * 0.86); await page.waitForTimeout(30); }
      for (let y = H * 0.99; y >= H * 0.55; y -= 3) { await page.mouse.move(W * 0.5, y); await page.waitForTimeout(30); }
      await glide(W * 0.5, H * 0.5, 300);
      await setSeg(null);
    }
    if (s.liarEnabled && !liarCalled) { liarCalled = true; await page.click('#liar-btn'); }
    else {
      await page.keyboard.press('1'); await page.waitForTimeout(150);
      if ((await state()).playEnabled) await page.click('#play-btn'); else if (s.liarEnabled) await page.click('#liar-btn');
    }
    await page.waitForTimeout(500);
    continue;
  }
  await page.waitForTimeout(150);
}

const R = await page.evaluate(() => {
  const R = window.__probe, L = window.__lastcall;
  R.programs1 = L.renderer.info.programs.length; R.textures1 = L.renderer.info.memory.textures;
  return R;
});
await browser.close();

const iv = R.frames.slice(1).map((f, i) => f - R.frames[i]).sort((a, b) => a - b);
const med = iv[Math.floor(iv.length / 2)] || 0;
const lag = R.tagLag.slice().sort((a, b) => a - b);
const worstBy = {};
for (const w of R.worst) { const k = `${w.key.replace(/\d+$/, '')}@${w.seg}`; if (!worstBy[k] || worstBy[k].dv < w.dv) worstBy[k] = w; }
const summary = {
  label: LABEL, seed: SEED, size: `${W}x${H}`, simulatedSeconds: +R.t.toFixed(1),
  thresholds: THRESH,
  spikes: R.spikes,
  totalSpikes: Object.fromEntries(Object.entries(R.spikes).map(([k, v]) => [k, Object.values(v).reduce((a, b) => a + b, 0)])),
  maxDv: Object.fromEntries(Object.entries(R.maxDv).map(([k, v]) => [k, +v.toFixed(2)])),
  worstPerKind: Object.values(worstBy).sort((a, b) => b.dv - a.dv).slice(0, 14),
  hoverChanges: R.hoverChanges,
  tagLagPx: { median: +(lag[Math.floor(lag.length / 2)] || 0).toFixed(1), p95: +(lag[Math.floor(lag.length * 0.95)] || 0).toFixed(1), max: +(lag[lag.length - 1] || 0).toFixed(1) },
  frameMs: { median: +med.toFixed(1), p99: +(iv[Math.floor(iv.length * 0.99)] || 0).toFixed(1), max: +(iv[iv.length - 1] || 0).toFixed(1), over3xMedian: iv.filter((x) => x > 3 * med).length, frames: iv.length },
  shaderProgramsAddedAfterBoot: R.programs1 - R.programs0, texturesAddedAfterBoot: R.textures1 - R.textures0,
  sawRoulette, problems,
};
writeFileSync(path.join(OUT, `motion-probe-${LABEL}.json`), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (problems.length) process.exit(1);
