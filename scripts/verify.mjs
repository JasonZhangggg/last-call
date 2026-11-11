// Drives the built page (dist/index.html) in headless Chromium and captures each key moment.
//   node scripts/verify.mjs                       desktop solo play-through with screenshots
//   node scripts/verify.mjs --size 390x844        phone-sized play-through
//   node scripts/verify.mjs --soak 3              N self-playing solo games (#autoplay), fails on any error
//   node scripts/verify.mjs --variant devil       play the Devil variant
//   node scripts/verify.mjs --mode dice [--variant traditional]   the dice table (soak: #autoplay-dice)
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
const DICE = args.mode === 'dice';
const tag = `${W}x${H}${DICE ? `-dice${args.variant ? `-${args.variant}` : ''}` : ''}`;
const shot = async (name) => { await page.screenshot({ path: path.join(OUT, `${tag}-${name}.png`) }); console.log(`  captured ${tag}-${name}.png`); };
const state = () => page.evaluate(() => {
  const D = window.__lastcall?.D, g = D?.shown;
  const vis = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && !el.classList.contains('fade'); };
  return {
    phase: D?.phase, me: D?.me, prompt: D?.prompt ? { type: D.prompt.type, seat: D.prompt.seat } : null, alive: g?.alive,
    reveal: g?.reveal ? g.reveal.cards?.map((c) => c.rank) ?? [g.reveal.call] : null, watch: !!D?.watch, actions: vis('actions'), trigger: vis('trigger-row'),
    end: vis('end'), out: vis('out'), playEnabled: !document.getElementById('play-btn').disabled, liarEnabled: !document.getElementById('liar-btn').disabled,
    hand: (g?.hand ?? g?.dice)?.length ?? 0, queue: D?.queue.length ?? 0,
    dice: vis('dice-actions'), bidOk: vis('bid-btn') && !document.getElementById('bid-btn').disabled, diceLiar: !document.getElementById('dice-liar-btn').disabled,
    spot: vis('spot-btn') && !document.getElementById('spot-btn').disabled,
  };
});
const frameMs = () => page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => (++n < 20 ? requestAnimationFrame(f) : r((performance.now() - t0) / 20)); requestAnimationFrame(f); }));
const shown = (id) => page.waitForFunction((id) => { const el = document.getElementById(id); return !el.classList.contains('fade') && getComputedStyle(el).opacity === '1'; }, id);

const url = 'file://' + path.join(ROOT, 'dist/index.html');
process.on('unhandledRejection', async (e) => { console.error(String(e).split('\n')[0]); console.error('PROBLEMS:\n' + (problems.join('\n') || '(none recorded)')); try { console.error(JSON.stringify(await state())); } catch {} process.exit(1); });
if (args.soak) {
  const games = +args.soak;
  await page.goto(url + (DICE ? (args.variant === 'traditional' ? '#autoplay-dice-traditional' : '#autoplay-dice') : args.variant === 'devil' ? '#autoplay-devil' : '#autoplay'));
  for (let i = 0; i < games; i++) {
    await page.waitForFunction(() => { const e = document.getElementById('end'); return !e.classList.contains('fade'); });
    const s = await state();
    console.log(`  game ${i + 1}: ${s.alive[s.me] ? 'player won' : 'player lost'}`);
    if (i < games - 1) await page.click('#again-btn');
  }
} else {
  await page.goto(url);
  await page.waitForSelector('#title-menu:not([hidden])');
  await page.waitForTimeout(800);
  await shot('01-title');
  console.log(`  frame time on title: ${(await frameMs()).toFixed(1)} ms (software renderer)`);
  await page.click('#solo-btn');
  await shown('solo');
  if (DICE) await page.click('#solo-mode-seg button[data-v="dice"]');
  if (args.variant) await page.click(`#solo-variant-seg button[data-v="${args.variant}"]`);
  await shot('01b-solo');
  await page.click('#solo-start-btn');
  const seen = new Set();
  const once = async (key, fn) => { if (!seen.has(key)) { seen.add(key); await fn(); } };
  for (let tick = 0; tick < 1500; tick++) {
    const s = await state();
    if (s.end) { await page.waitForTimeout(1200); await shot('99-end'); break; }
    if (s.out) { await once('out', async () => { await shown('out'); await page.waitForTimeout(400); await shot('07-out'); }); await page.click('#watch-btn'); continue; }
    if (s.watch && s.reveal) await once('reveal', () => shot('04-reveal'));
    if (DICE && s.watch && s.reveal) await once('count', async () => { await page.waitForTimeout(2600); await shot('04c-count'); });
    if (s.watch && s.reveal?.includes('devil')) await once('devil', () => shot('04b-devil'));
    if (s.prompt?.type === 'roulette' && s.prompt.seat !== s.me && !s.watch) await once('roulette-ai', async () => { await page.waitForTimeout(1600); await shot('05-roulette-ai'); });
    if (s.trigger) {
      await once('roulette-me', async () => { await page.waitForTimeout(1200); await shot('06-roulette-me'); });
      await page.keyboard.down('Space'); await page.waitForTimeout(1000); await page.keyboard.up('Space');
      if (DICE) await once('drink-me', async () => { await page.waitForTimeout(700); await shot('06b-drinking-me'); });
      continue;
    }
    if (s.dice) {
      await page.waitForTimeout(500);
      await once('turn', () => shot('02-my-turn'));
      const now = await state();
      if (!now.dice) continue;
      const r = Math.random();
      if (now.spot && r < 0.12) await page.click('#spot-btn');
      else if (now.diceLiar && (!now.bidOk || r < 0.35)) await page.click('#dice-liar-btn');
      else {
        await page.keyboard.press(String(2 + Math.floor(Math.random() * 5)));
        if (Math.random() < 0.3) await page.keyboard.press('ArrowUp');
        await once('picked', () => shot('03-picked'));
        if ((await state()).bidOk) await page.click('#bid-btn'); else if (now.diceLiar) await page.click('#dice-liar-btn');
      }
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
      if (!(await state()).actions) continue;
      if (s.liarEnabled && (!s.playEnabled && s.hand === 0 || Math.random() < 0.35)) { await page.click('#liar-btn'); continue; }
      for (const k of ['1', '2']) await page.keyboard.press(k);
      await page.waitForTimeout(400);
      await once('selected', () => shot('03-selected'));
      if (!(await state()).playEnabled) await page.keyboard.press('1');
      const now = await state();
      if (!now.actions) continue;
      if (now.playEnabled) await page.click('#play-btn'); else if (now.liarEnabled) await page.click('#liar-btn');
      continue;
    }
    await page.waitForTimeout(350);
  }
  if (!seen.has('turn')) problems.push('never got a turn');
}
await browser.close();
if (problems.length) { console.error('PROBLEMS:\n' + problems.join('\n')); process.exit(1); }
console.log('verify: no page or console errors');
