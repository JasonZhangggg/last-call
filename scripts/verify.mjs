// Drives the built page (dist/index.html) in headless Chromium and captures each key moment.
//   node scripts/verify.mjs                       desktop play-through with screenshots
//   node scripts/verify.mjs --size 390x844        phone-sized play-through
//   node scripts/verify.mjs --soak 3              N self-playing games, fails on any error
// three.js is served from tools/vendor so the run works offline. Exits non-zero on page errors.
import { createRequire } from 'node:module';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1] ?? true]] : a), []));
const [W, H] = String(args.size || '960x540').split('x').map(Number);
const OUT = path.resolve(args.out || 'artifacts');
const ROOT = path.resolve('.');
mkdirSync(OUT, { recursive: true });
if (!existsSync('dist/index.html')) throw new Error('run `npm run build` first');

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: W < 600, isMobile: W < 600 });
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
const tag = `${W}x${H}`;
const shot = async (name) => { await page.screenshot({ path: path.join(OUT, `${tag}-${name}.png`) }); console.log(`  captured ${tag}-${name}.png`); };
const state = () => page.evaluate(() => {
  const D = window.__lastcall?.D, g = D?.game;
  const vis = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && !el.classList.contains('fade'); };
  return { phase: g?.phase, turn: g?.turn, pending: g?.pending?.seat ?? null, alive: g?.players.map((p) => p.alive), watch: !!D?.watch, actions: vis('actions'), trigger: vis('trigger-row'), end: vis('end'), playEnabled: !document.getElementById('play-btn').disabled, liarEnabled: !document.getElementById('liar-btn').disabled, hand: g?.players[0].hand.length ?? 0 };
});
const frameMs = () => page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => (++n < 20 ? requestAnimationFrame(f) : r((performance.now() - t0) / 20)); requestAnimationFrame(f); }));

const url = 'file://' + path.join(ROOT, 'dist/index.html');
process.on('unhandledRejection', async (e) => { console.error(String(e).split('\n')[0]); console.error('PROBLEMS:\n' + (problems.join('\n') || '(none recorded)')); try { console.error(JSON.stringify(await state())); } catch {} process.exit(1); });
if (args.soak) {
  const games = +args.soak;
  await page.goto(url + '#autoplay');
  for (let i = 0; i < games; i++) {
    await page.waitForFunction(() => { const e = document.getElementById('end'); return !e.classList.contains('fade'); });
    const s = await state();
    console.log(`  game ${i + 1}: ${s.alive[0] ? 'player won' : 'player lost'}`);
    if (i < games - 1) await page.click('#again-btn');
  }
} else {
  await page.goto(url);
  await page.waitForSelector('#title-menu:not([hidden])');
  await page.waitForTimeout(800);
  await shot('01-title');
  console.log(`  frame time on title: ${(await frameMs()).toFixed(1)} ms (software renderer)`);
  await page.click('#start-btn');
  const seen = new Set();
  const once = async (key, fn) => { if (!seen.has(key)) { seen.add(key); await fn(); } };
  for (let tick = 0; tick < 900; tick++) {
    const s = await state();
    if (s.end) { await page.waitForTimeout(1200); await shot('99-end'); break; }
    if (s.watch && s.phase === 'roulette') await once('reveal', () => shot('04-reveal'));
    if (s.phase === 'roulette' && s.pending !== 0 && !s.watch) await once('roulette-ai', async () => { await page.waitForTimeout(1600); await shot('05-roulette-ai'); });
    if (s.trigger) {
      await once('roulette-me', async () => { await page.waitForTimeout(1200); await shot('06-roulette-me'); });
      await page.keyboard.down('Space'); await page.waitForTimeout(1000); await page.keyboard.up('Space');
      continue;
    }
    if (s.actions) {
      await page.waitForTimeout(700);
      await once('turn', async () => {
        await shot('02-my-turn');
        if (W >= 600) {
          await page.mouse.move(W * 0.02, H * 0.45); await page.waitForTimeout(1400); await shot('03a-look-left');
          await page.mouse.move(W * 0.98, H * 0.4); await page.waitForTimeout(1400); await shot('03b-look-right');
          await page.mouse.move(W / 2, H / 2); await page.waitForTimeout(900);
        }
      });
      if (s.liarEnabled && Math.random() < 0.35) { await page.click('#liar-btn'); continue; }
      for (const k of ['1', '2']) await page.keyboard.press(k);
      await page.waitForTimeout(400);
      await once('selected', () => shot('03-selected'));
      if (!(await state()).playEnabled) await page.keyboard.press('1');
      if ((await state()).playEnabled) await page.click('#play-btn'); else await page.click('#liar-btn');
      continue;
    }
    await page.waitForTimeout(350);
  }
}
await browser.close();
if (problems.length) { console.error('PROBLEMS:\n' + problems.join('\n')); process.exit(1); }
console.log('verify: no page or console errors');
