// Frame-by-frame strips of the key moments of a solo game, on a virtual clock: performance.now
// advances a fixed step per animation frame, so the director's pauses, the turn clock and every
// flight keep their real proportions however slow the software renderer is.
//   node scripts/filmstrip.mjs [--mode deck|devil|dice|auction] [--size 480x270] [--fps 30] [--every 3]
//                              [--secs 2.4] [--moments round,played,challenge] [--seed 7] [--page dist/index.html]
// Each moment is a mode handler (deck: round played challenge roulette shot; dice: round bid challenge
// roulette drink; auction: reveal raise pass taken scoring). Its first run is filmed from the call
// for --secs, every --every frames, into artifacts/strip-<mode>-<moment>.png (a contact sheet,
// frame time in each label). The probe plays your seat with the mode's own auto() move.
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
// pages load from a fake http origin that is served from disk: Chromium won't fetch() from file://
const HOST = 'http://last-call.local';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1] ?? true]] : a), []));
const [W, H] = String(args.size || '480x270').split('x').map(Number);
const MODE = args.mode || 'deck', FPS = +(args.fps || 30), EVERY = +(args.every || 3), SECS = +(args.secs || 2.4), SEED = +(args.seed || 7);
const DEFAULT = { deck: 'round,played,challenge,roulette,shot', devil: 'challenge,roulette,shot', dice: 'round,challenge,roulette,drink', auction: 'reveal,raise,pass,taken' };
const MOMENTS = String(args.moments || DEFAULT[MODE]).split(',');
const ROOT = path.resolve('.'), OUT = path.resolve('artifacts'), TMP = path.join(OUT, `strip-${MODE}-frames`);
const PAGE = path.resolve(args.page || 'dist/index.html');
if (!existsSync(PAGE)) throw new Error(`${PAGE} is missing; run \`npm run build\` first`);
mkdirSync(OUT, { recursive: true }); rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.setDefaultTimeout(240000);
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('/build/three.module.js')) return route.fulfill({ path: path.join(ROOT, 'tools/vendor/three/build/three.module.js'), contentType: 'text/javascript' });
  if (u.includes('/examples/jsm/')) return route.fulfill({ path: path.join(ROOT, 'tools/vendor/three/examples/jsm', u.split('/examples/jsm/')[1]), contentType: 'text/javascript' });
  if (u.startsWith(HOST)) return route.fulfill({ path: decodeURIComponent(new URL(u).pathname) });
  return route.abort();
});
await page.addInitScript(({ seed, step }) => {
  let a = seed >>> 0;
  Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  try { localStorage.setItem('lastcall.coach', JSON.stringify({ lead: 1, liar: 1, dice: 1, 'liar-dice': 1, auction: 1, disgrace: 1 })); localStorage.setItem('lastcall.quality', '"low"'); } catch {}
  // virtual clock: frozen while a frame is being photographed
  const real = performance.now.bind(performance);
  // between moments the clock runs 100 ms a frame and nothing is drawn, so the game gets there fast
  let v = real(), held = false;
  performance.now = () => v;
  window.__strip = { hold: (on) => { held = on; }, get held() { return held; }, frame: 0, get t() { return v; } };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf(() => { if (!held) { v += window.__strip.film ? step : 100; window.__strip.frame++; window.__strip.tick?.(); } cb(v); });
}, { seed: SEED, step: 1000 / FPS });

await page.goto(HOST + PAGE);
await page.waitForSelector('#title-menu:not([hidden])');
await page.evaluate(({ moments, secs, every, fps }) => {
  const L = window.__lastcall, S = window.__strip;
  L.hooks.probe = { hz: 50, maxDt: 0.25, draw: () => { const d = S.needDraw; S.needDraw = false; return d; }, sample() {}, frame() {} };
  const seen = new Set();
  S.film = null; S.queue = [];
  for (const m of Object.values(L.MODES)) for (const k of Object.keys(m.on)) {
    const fn = m.on[k];
    m.on[k] = function (...a) {
      if (moments.includes(k) && !seen.has(k) && !S.film) { seen.add(k); S.film = { name: k, left: Math.round(secs * fps), n: 0 }; }
      return fn.apply(this, a);
    };
  }
  S.tick = () => {
    const f = S.film;
    if (f) {
      if (f.n % every === 0) { S.queue.push({ name: f.name, n: f.n, ms: Math.round((f.n * 1000) / fps) }); S.hold(true); S.needDraw = true; }
      f.n++; if (--f.left <= 0) S.film = null;
    }
    // your seat's move, once the director has staged the prompt
    const D = L.D, T = L.T;
    if (D.prompt?.seat === D.me && !D.busy && !D.queue.length) {
      S.actAt ??= S.t + 500;
      if (S.t > S.actAt) {
        S.actAt = null;
        const act = D.mode.auto(T, { type: D.prompt.type, seat: D.prompt.seat, options: D.prompt.options });
        if (act) { D.mode.clearPrompt?.(T); T.send(act); }
      }
    } else S.actAt = null;
  };
  S.done = () => moments.every((m) => seen.has(m)) && !S.film;
}, { moments: MOMENTS, secs: SECS, every: EVERY, fps: FPS });

await page.click('#solo-btn');
if (MODE !== 'deck' && MODE !== 'devil') await page.click(`#solo-mode-seg button[data-v="${MODE}"]`);
if (MODE === 'devil' || args.variant) await page.click(`#solo-variant-seg button[data-v="${args.variant || 'devil'}"]`);
await page.click('#solo-start-btn');

const shots = {};
const t0 = Date.now();
for (;;) {
  const s = await page.evaluate(() => ({ q: window.__strip.queue.splice(0), done: window.__strip.done(), end: !document.getElementById('end').classList.contains('fade') }));
  for (const f of s.q) {
    const file = path.join(TMP, `${f.name}-${String(f.n).padStart(4, '0')}.png`);
    await page.screenshot({ path: file });
    (shots[f.name] ||= []).push([file, f.ms]);
  }
  if (s.q.length) await page.evaluate(() => window.__strip.hold(false));
  if (s.done || s.end || Date.now() - t0 > +(args.minutes || 20) * 60000) break;
  await page.waitForTimeout(20);
}
await browser.close();

for (const [name, list] of Object.entries(shots)) {
  const out = path.join(OUT, `strip-${MODE}-${name}.png`);
  execFileSync('montage', [...list.flatMap(([f, ms]) => ['-label', `${ms} ms`, f]), '-tile', '4x', '-geometry', '+2+2', '-pointsize', '11', out]);
  console.log(`  ${out} (${list.length} frames)`);
}
const missing = MOMENTS.filter((m) => !shots[m]);
if (missing.length) console.log(`  not reached: ${missing.join(', ')}`);
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
