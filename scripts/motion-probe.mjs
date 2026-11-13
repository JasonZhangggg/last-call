// Samples every moving thing at 240 Hz (the frame loop sub-steps its simulation while a probe is
// attached) across a deal, a human play, a Liar call and roulettes, and counts velocity
// discontinuities: one 1/240 s step whose velocity change is bigger than smooth acceleration allows.
//   node scripts/motion-probe.mjs [--size 800x450] [--label before] [--seed 7] [--roulettes 1] [--minutes 15] [--page dist/index.html]
//   node scripts/motion-probe.mjs --mode dice|auction|devil [--variant traditional] [--sim 150]
//     another table: the probe plays your seat with the mode's own auto() move at real pace and
//     stops after --sim simulated seconds or at the game's end.
// It also counts clips: a card's corner, a die, a cup or the revolver below the table top over the table.
// Writes artifacts/motion-probe-<label>.json. Needs `npm run build` first. While attached, the page
// draws every two seconds and its frame loop accepts long frames (sub-stepped at 240 Hz), so the
// simulation keeps pace with the game's real-time pacing on a slow software renderer. Frame
// times here are therefore not render times.
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
// pages load from a fake http origin that is served from disk: Chromium won't fetch() from file://
const HOST = 'http://last-call.local';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1] ?? true]] : a), []));
const [W, H] = String(args.size || '800x450').split('x').map(Number);
const MODE = args.mode || 'deck', SIM = +(args.sim || 150);
const LABEL = args.label || 'run', SEED = +(args.seed || 7), ROULETTES = +(args.roulettes || 1);
const ROOT = path.resolve('.'), OUT = path.resolve('artifacts');
mkdirSync(OUT, { recursive: true });
const PAGE = path.resolve(args.page || 'dist/index.html');
if (!existsSync(PAGE)) throw new Error(`${PAGE} is missing; run \`npm run build\` first`);

// Per-step velocity change that counts as a discontinuity, at a 1/240 s step.
// 0.6 m/s per step is 144 m/s^2, several times what any eased flight here needs.
const HZ = 240;
const THRESH = { card: 0.6, gun: 0.6, hand: 0.6, camRot: 0.35, camPos: 0.3, head: 0.5, die: 0.6, cup: 0.6, glass: 0.6, note: 0.6 };

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
  if (u.startsWith(HOST)) return route.fulfill({ path: decodeURIComponent(new URL(u).pathname) });
  return route.abort();
});
await page.addInitScript((seed) => {
  let a = seed >>> 0;
  Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  try { localStorage.setItem('lastcall.coach', JSON.stringify({ lead: 1, liar: 1 })); localStorage.setItem('lastcall.quality', '"low"'); } catch {}
}, SEED);

await page.goto(HOST + PAGE);
await page.waitForSelector('#title-menu:not([hidden])');

await page.evaluate((m) => { window.__probeMode = m; }, MODE === 'devil' ? 'deck' : MODE);
await page.evaluate(({ HZ, THRESH }) => {
  const L = window.__lastcall, D = L.D;
  const R = { clips: {}, clipBy: {}, pops: {}, popLog: [], spikes: {}, maxDv: {}, worst: [], hoverLog: [], frames: [], tagLag: [], hoverChanges: {}, roulettes: 0, programs0: L.renderer.info.programs.length, textures0: L.renderer.info.memory.textures, t: 0 };
  window.__probe = R;
  const chars = D.viewChars, seats = [1, 2, 3], scene = L.gun.obj.parent;
  // the revolver's whole staging (slide, reach, pickup, raise, shot, set down) counts as roulette
  const gunBusy = () => L.gun.mover.flying || L.gun.obj.parent !== scene || L.arm?.root.visible || seats.some((s) => chars[s].env.reach > 0.01 || chars[s].env.aim > 0.01);
  let busy = false;
  const seg = () => window.__probeSeg || (D.shown ? (D.prompt?.type === 'roulette' || gunBusy() ? 'roulette' : D.watch ? (D.shown.reveal ? 'reveal' : 'deal') : 'play') : 'title');
  const tracks = new Map();
  // `shown` says whether the thing is drawn: hidden samples reset its history, so a move nobody
  // sees is not a discontinuity, but appearing or vanishing while moving fast is a pop
  const track = (key, cat, read, shown = () => true, clip = null) => tracks.set(key, { cat, read, shown, clip, p: null, v: null, n: 0, was: null });
  const drawn = (o) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
  const TR = 1.04, _c = [0, 0, 0];
  // lowest point of a card-shaped box (half extents hw, hh) under its world matrix
  const cardLow = (o, hw, hh) => () => { const e = o.matrixWorld.elements; let low = Infinity, at = 0;
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const y = e[13] + e[1] * a * hw + e[5] * b * hh, r = Math.hypot(e[12] + e[0] * a * hw + e[4] * b * hh, e[14] + e[2] * a * hw + e[6] * b * hh); if (r < TR && y < low) { low = y; at = r; } }
    return low; };
  const centreLow = (o, under) => () => { const e = o.matrixWorld.elements; return Math.hypot(e[12], e[14]) < TR ? e[13] - under : Infinity; };
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
  const MODE = window.__probeMode;
  if (MODE === 'deck') {
    for (const b of L.cards.bodies) track(`card${b.slot}`, 'card', posOf(b.mesh), () => drawn(b.mesh), cardLow(b.mesh, 0.055, 0.077));
    track('gun', 'gun', posOf(L.gun.obj), () => drawn(L.gun.obj), centreLow(L.gun.obj, 0.012));
    track('muzzle', 'gun', posOf(L.gun.flash), () => drawn(L.gun.obj));
  }
  if (MODE === 'dice') {
    const DT = L.diceTable;
    DT.cups.forEach((c, v) => track(`cup${v}`, 'cup', posOf(c.obj), () => DT.group.visible && !c.hidden, centreLow(c.obj, -0.002)));
    DT.dice.forEach((list, v) => list.forEach((d, i) => track(`die${v}.${i}`, 'die', posOf(d.obj), () => DT.group.visible && d.shown, centreLow(d.obj, 0.0155))));
    track('glass', 'glass', posOf(DT.held), () => drawn(DT.held));
  }
  if (MODE === 'auction') {
    const P = L.MODES.auction.table;
    for (const b of P.bodies) track(`note${b.i}`, 'note', posOf(b.proxy), () => !b.hidden && P.mesh.visible, cardLow(b.proxy, 0.055, 0.077));
  }
  if (L.arm) track('arm', 'gun', posOf(L.arm.root), () => drawn(L.arm.root));
  track('camPos', 'camPos', posOf(L.camera));
  track('camRot', 'camRot', rotOf(L.camera));
  for (let s = 1; s < 4; s++) track(`head${s}`, 'head', rotOf(chars[s].head));
  for (let s = 1; s < 4; s++) track(`hand${s}`, 'hand', posOf(chars[s].arm.hand));
  const tmp = [0, 0, 0];
  let lastHover = null;
  let sinceDraw = 0;
  L.hooks.probe = {
    hz: HZ,
    maxDt: 0.5,
    draw(dt) { sinceDraw += dt; if (sinceDraw < 2) return false; sinceDraw = 0; return true; },
    sample(dt) {
      R.t += dt;
      const b = gunBusy(); if (b && !busy) R.roulettes++; busy = b;
      const sg = seg();
      for (const [key, tr] of tracks) {
        const on = tr.shown();
        if (!on) { if (tr.was && tr.v && Math.hypot(...tr.v) > 0.25) { R.pops[tr.cat] = (R.pops[tr.cat] || 0) + 1; R.popLog.push({ t: +R.t.toFixed(3), key, seg: sg, vanishAt: +Math.hypot(...tr.v).toFixed(2) }); } tr.was = false; tr.p = tr.v = null; tr.n = 0; continue; }
        tr.was = true;
        const kind = tr.read(tmp, dt);
        if (tr.clip) { const low = tr.clip(); if (low < -0.003) { R.clips[tr.cat] = R.clips[tr.cat] || {}; R.clips[tr.cat][sg] = (R.clips[tr.cat][sg] || 0) + 1; const c = (R.clipBy[key] ||= { n: 0, from: +R.t.toFixed(3), to: 0, depth: 0, seg: sg }); c.n++; c.to = +R.t.toFixed(3); c.depth = Math.min(c.depth, +low.toFixed(4)); } }
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
      const h = L.handUI?.hover ?? null;
      if (h !== lastHover) { R.hoverChanges[sg] = (R.hoverChanges[sg] || 0) + 1; R.hoverLog.push([+R.t.toFixed(3), sg, h]); lastHover = h; }
    },
    frame() {
      R.frames.push(performance.now());
      if (!document.body.classList.contains('in-game') || innerWidth < 600) return;
      const cam = L.camera, P = cam.projectionMatrix.elements, V = cam.matrixWorldInverse.elements;
      for (let s = 1; s < 4; s++) {
        const el = document.querySelectorAll('#tags .tag')[s - 1];
        const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(el?.style.transform || ''); if (!m) continue;
        const ch = chars[s], hd = ch.head; hd.updateWorldMatrix(true, false);
        const e = hd.matrixWorld.elements, a = ch.tagAnchor, w = a ? [a.x, a.y, a.z, 1] : [e[12], e[13] + 0.27, e[14], 1];
        const ve = [0, 1, 2, 3].map((r) => V[r] * w[0] + V[r + 4] * w[1] + V[r + 8] * w[2] + V[r + 12] * w[3]);
        const ce = [0, 1, 3].map((r) => P[r] * ve[0] + P[r + 4] * ve[1] + P[r + 8] * ve[2] + P[r + 12] * ve[3]);
        const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
        const x = clamp((ce[0] / ce[2] * 0.5 + 0.5) * innerWidth, 90, innerWidth - 90);
        const y = clamp((-ce[1] / ce[2] * 0.5 + 0.5) * innerHeight, 150, innerHeight - 230);
        R.tagLag.push(Math.hypot(x - +m[1], y - +m[2]));
      }
    },
  };
}, { HZ, THRESH });

const state = () => page.evaluate(() => {
  const D = window.__lastcall.D, g = D.shown, p = D.prompt;
  const vis = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && !el.classList.contains('fade'); };
  return { phase: p?.type ?? (g ? 'between' : undefined), round: g?.round, pending: p?.type === 'roulette' ? p.seat : null, alive: g?.alive, actions: vis('actions'), trigger: vis('trigger-row'), end: vis('end'), liarEnabled: !document.getElementById('liar-btn').disabled, playEnabled: !document.getElementById('play-btn').disabled };
});
const setSeg = (s) => page.evaluate((s) => { window.__probeSeg = s; }, s);
const glide = async (x, y, ms = 350) => { await page.mouse.move(x, y, { steps: Math.max(2, Math.round(ms / 16)) }); };

await page.mouse.move(W / 2, H / 2);
await page.click('#solo-btn');
if (MODE !== 'deck' && MODE !== 'devil') await page.click(`#solo-mode-seg button[data-v="${MODE}"]`);
if (args.variant || MODE === 'devil') await page.click(`#solo-variant-seg button[data-v="${args.variant || 'devil'}"]`);
await page.click('#solo-start-btn');
const t0 = Date.now();
let lastLog = '';
if (MODE === 'dice' || MODE === 'auction') {
  for (let still = 0; ;) {
    const s = await page.evaluate(() => {
      const L = window.__lastcall, D = L.D, T = L.T;
      if (!document.getElementById('end').classList.contains('fade')) return { end: true, t: window.__probe.t };
      if (D.prompt?.seat === D.me && !D.busy && !D.queue.length) {
        if (window.__probeActAt == null) window.__probeActAt = performance.now() + 500;
        else if (performance.now() > window.__probeActAt) {
          window.__probeActAt = null;
          const act = D.mode.auto(T, { type: D.prompt.type, seat: D.prompt.seat, options: D.prompt.options });
          if (act) { D.mode.clearPrompt?.(T); T.send(act); }
        }
      }
      return { t: window.__probe.t, round: D.shown?.round, prompt: D.prompt && `${D.prompt.type}@${D.prompt.seat}` };
    }).catch((e) => ({ err: String(e) }));
    if (s.err) { problems.push(s.err); break; }
    if (s.end || s.t > SIM) break;
    const tagline = `r${s.round} ${s.prompt}`;
    if (tagline !== lastLog) { console.error(`  [${((Date.now() - t0) / 1000).toFixed(0)}s sim ${s.t.toFixed(0)}s] ${tagline}`); lastLog = tagline; still = 0; }
    else if (++still > 900) { problems.push('stalled'); break; }
    if (Date.now() - t0 > +(args.minutes || 15) * 60000) break;
    await page.waitForTimeout(100);
  }
}
const loop = MODE === 'deck' || MODE === 'devil';
let looked = false, sawRoulette = false, liarCalled = false;
let lastChange = Date.now();
while (loop && Date.now() - t0 < +(args.minutes || 15) * 60000) {
  const s = await state();
  const tagline = `${s.phase} r${s.round} pending=${s.pending}`;
  if (tagline !== lastLog) { console.error(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${tagline}`); lastLog = tagline; lastChange = Date.now(); }
  else if (Date.now() - lastChange > 90000) {
    lastChange = Date.now();
    console.error('  stalled:', JSON.stringify(await page.evaluate(() => {
      const L = window.__lastcall, D = L.D, g = L.gun, R = window.__probe;
      return { simT: +R.t.toFixed(1), frames: R.frames.length, hz: L.hooks.probe?.hz, prompt: D.prompt && { type: D.prompt.type, seat: D.prompt.seat }, queue: D.queue?.length, phase: D.phase, gunFlying: g.mover.flying, gunParent: g.obj.parent?.type, armFlying: L.arm?.mover.flying, env: [1, 2, 3].map((s) => D.viewChars[s].env), overlay: document.querySelector('.overlay:not(.fade)')?.id };
    })), problems.slice(0, 2).join(' | ').slice(0, 600));
  }
  if (s.end) break;
  if (s.phase === 'roulette') sawRoulette = true;
  if (looked && sawRoulette && s.phase === 'turn' && s.round >= 2 && (await page.evaluate(() => window.__probe.roulettes)) >= ROULETTES) break;
  if (s.trigger) {
    // hold until the pull registers: on a slow software renderer one frame can outlast a fixed hold
    await page.keyboard.down('Space');
    await page.waitForFunction(() => document.getElementById('trigger-row').hidden, null, { timeout: 30000 }).catch(() => {});
    await page.keyboard.up('Space');
    continue;
  }
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
  label: LABEL, mode: MODE, seed: SEED, size: `${W}x${H}`, simulatedSeconds: +R.t.toFixed(1),
  thresholds: THRESH,
  spikes: R.spikes,
  clips: R.clips, clipsByKey: Object.entries(R.clipBy).sort((a, b) => b[1].n - a[1].n).slice(0, 30), pops: R.pops, popLog: R.popLog.slice(0, 60),
  totalSpikes: Object.fromEntries(Object.entries(R.spikes).map(([k, v]) => [k, Object.values(v).reduce((a, b) => a + b, 0)])),
  maxDv: Object.fromEntries(Object.entries(R.maxDv).map(([k, v]) => [k, +v.toFixed(2)])),
  worstPerKind: Object.values(worstBy).sort((a, b) => b.dv - a.dv).slice(0, 14),
  hoverChanges: R.hoverChanges,
  hoverLog: R.hoverLog.slice(0, 200),
  spikeLog: R.worst.slice(0, 400),
  tagLagPx: { median: +(lag[Math.floor(lag.length / 2)] || 0).toFixed(1), p95: +(lag[Math.floor(lag.length * 0.95)] || 0).toFixed(1), max: +(lag[lag.length - 1] || 0).toFixed(1) },
  frameMs: { median: +med.toFixed(1), p99: +(iv[Math.floor(iv.length * 0.99)] || 0).toFixed(1), max: +(iv[iv.length - 1] || 0).toFixed(1), over3xMedian: iv.filter((x) => x > 3 * med).length, frames: iv.length },
  shaderProgramsAddedAfterBoot: R.programs1 - R.programs0, texturesAddedAfterBoot: R.textures1 - R.textures0,
  sawRoulette, gunStagings: R.roulettes, problems,
};
writeFileSync(path.join(OUT, `motion-probe-${LABEL}.json`), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (problems.length) process.exit(1);
