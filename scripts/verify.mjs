// Drives the built page (dist/index.html) in headless Chromium and captures each key moment.
//   node scripts/verify.mjs                       desktop solo play-through with screenshots
//   node scripts/verify.mjs --size 390x844        phone-sized play-through
//   node scripts/verify.mjs --soak 3              N self-playing solo games (#autoplay), fails on any error
//   node scripts/verify.mjs --variant devil       play the Devil variant
//   node scripts/verify.mjs --mode dice [--variant traditional]   the dice table (soak: #autoplay-dice)
//   node scripts/verify.mjs --mode auction        The Gilded Bid (#autoplay-auction): your bid UI, a won
//                                                 card, a disgrace, the scoring and the end; --soak works too
// three.js is served from tools/vendor so the run works offline. Exits non-zero on page errors.
import { createRequire } from 'node:module';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
// pages load from a fake http origin that is served from disk: Chromium won't fetch() from file://
const HOST = 'http://last-call.local';

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
  if (u.startsWith(HOST)) return route.fulfill({ path: decodeURIComponent(new URL(u).pathname) });
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

const url = HOST + path.join(ROOT, 'dist/index.html');
process.on('unhandledRejection', async (e) => { console.error(String(e).split('\n')[0]); console.error('PROBLEMS:\n' + (problems.join('\n') || '(none recorded)')); try { console.error(JSON.stringify(await state())); } catch {} process.exit(1); });
if (args.mode === 'auction') {
  // The game plays itself (#autoplay-auction) so a slow machine never meets the turn clock. A watcher
  // inside the page freezes game time the instant a moment worth capturing appears; motion keeps
  // running, so each shot shows the scene settled. Your first turn is held and played by clicking.
  const games = args.soak ? +args.soak : 1;
  if (!args.soak) await page.addInitScript(() => { globalThis.__auctionHold = true; });
  await page.goto(url + '#autoplay-auction');
  await page.waitForFunction(() => window.__lastcall?.settings);
  if (!args.soak) await page.evaluate(() => {
    const L = window.__lastcall, seen = new Set(), bad = (c) => ['ale', 'debt', 'scandal'].includes(c?.kind);
    window.__cap = null;
    // a timer, not a frame callback: on a software renderer frames can be seconds apart
    const tick = () => {
      const D = L.D, g = D.shown;
      if (window.__cap || !g || !g.turned) return;
      const toast = document.getElementById('toast-t').textContent;
      const want = [
        ['opening', g.card && D.prompt && D.prompt.seat !== D.me && g.auction === 1],
        ['my-turn', !document.getElementById('auction-actions').hidden],
        ['disgrace', bad(g.card) && D.prompt],
        ['won', g.won.some((w) => w.some((c) => !bad(c)))],
        ['purses', g.scoring && /poorest|tie for/.test(toast)],
        ['scoring', g.scoring && /win|heat/.test(toast)],
      ].find(([k, on]) => on && !seen.has(k));
      if (want) { seen.add(want[0]); L.settings.paused = true; window.__cap = want[0]; }
    };
    setInterval(tick, 15);
  });
  const taken = new Set();
  const SHOTS = { opening: '02-opening', 'my-turn': '03-my-turn', disgrace: '04-disgrace', won: '05-won-card', purses: '06-purses', scoring: '07-scoring' };
  for (let i = 0; i < games; i++) {
    for (let tick = 0; tick < 4000; tick++) {
      const s = await page.evaluate(() => ({ cap: window.__cap, end: !document.getElementById('end').classList.contains('fade'), winner: window.__lastcall.D.result?.winner, me: window.__lastcall.D.me }));
      if (s.end) {
        console.log(`  game ${i + 1}: ${s.winner === s.me ? 'player won' : s.winner == null ? 'no winner' : 'player lost'}`);
        if (!args.soak) { await shown('end'); await page.waitForTimeout(600); await shot('99-end'); }
        break;
      }
      if (!s.cap) { await page.waitForTimeout(250); continue; }
      taken.add(s.cap);
      if (s.cap === 'my-turn') {
        await page.click('#cards-btn');
        await page.click('#auction-min-btn');
        await page.waitForTimeout(900);
        await shot(SHOTS[s.cap]);
        await page.evaluate(() => { globalThis.__auctionHold = false; });
        await page.click(await page.isEnabled('#auction-bid-btn') ? '#auction-bid-btn' : '#auction-pass-btn');
      } else {
        await page.waitForTimeout(1300);
        await shot(SHOTS[s.cap]);
      }
      await page.evaluate(() => { window.__cap = null; window.__lastcall.settings.paused = false; });
    }
    if (i < games - 1) await page.click('#again-btn');
  }
  for (const k of ['my-turn', 'won', 'purses', 'scoring']) if (!args.soak && !taken.has(k)) problems.push(`never captured ${k}`);
  if (!args.soak && !taken.has('disgrace')) console.log('  (no disgrace came up this game)');
} else if (args.soak) {
  const games = +args.soak;
  await page.goto(url + (DICE ? (args.variant === 'traditional' ? '#autoplay-dice-traditional' : '#autoplay-dice') : args.variant === 'devil' ? '#autoplay-devil' : '#autoplay'));
  for (let i = 0; i < games; i++) {
    // a slow software renderer can take many minutes per game, so fail on a stall, not on a clock
    for (let last = '', still = 0; ;) {
      const p = await page.evaluate(() => {
        const D = window.__lastcall?.D, g = D?.shown;
        return { end: !document.getElementById('end').classList.contains('fade'), mark: JSON.stringify([g?.round, (g?.plays ?? g?.bids)?.length, g?.pulls ?? g?.drinks, D?.queue.length, D?.prompt?.type]) };
      });
      if (p.end) break;
      if (p.mark !== last) { last = p.mark; still = 0; } else if (++still > 30) throw new Error(`soak stalled at ${p.mark}`);
      await page.waitForTimeout(10000);
    }
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
