// node capture.mjs <repoRoot> <outDir> [menus|hud|end|all]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const what = process.argv[4] || 'all';
mkdirSync(OUT, { recursive: true });
const SIZES = [[1920, 1080], [1280, 720], [960, 540], [844, 390], [390, 844]];
const url = 'file://' + path.join(ROOT, 'dist/index.html');

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const problems = [];
async function open(w, h, hash = '') {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 900 && h < 900 && Math.min(w, h) < 500, isMobile: Math.min(w, h) < 500 });
  page.setDefaultTimeout(400000);
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|fonts\.g/.test(m.text())) problems.push(`console: ${m.text()}`); });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.includes('/build/three.module.js')) return route.fulfill({ path: path.join(ROOT, 'tools/vendor/three/build/three.module.js'), contentType: 'text/javascript' });
    if (u.includes('/examples/jsm/')) return route.fulfill({ path: path.join(ROOT, 'tools/vendor/three/examples/jsm', u.split('/examples/jsm/')[1]), contentType: 'text/javascript' });
    if (u.startsWith('file:')) return route.continue();
    return route.abort();
  });
  await page.goto(url + hash);
  return page;
}
const shown = (page, id) => page.waitForFunction((id) => getComputedStyle(document.getElementById(id)).opacity === '1', id);
const vis = (page, id) => page.evaluate((id) => { const el = document.getElementById(id); return !!el && !el.hidden && !el.classList.contains('fade'); }, id);
const shot = async (page, name) => { const s = page.viewportSize(); const f = `${s.width}x${s.height}-${name}.png`; await page.screenshot({ path: path.join(OUT, f) }); console.log('  ' + f); };

if (what === 'all' || what === 'menus') {
  for (const [w, h] of [[1280, 720], [390, 844], [844, 390]]) {
    const page = await open(w, h);
    await page.screenshot({ path: path.join(OUT, `${w}x${h}-00-loading.png`) });
    await page.waitForSelector('#title-menu:not([hidden])');
    await page.waitForTimeout(900);
    await shot(page, '01-title');
    await page.keyboard.press('Tab'); await page.waitForTimeout(200);
    await shot(page, '01b-title-focus');
    await page.click('#settings-btn'); await shown(page, 'settings'); await page.waitForTimeout(300); await shot(page, '02-settings');
    await page.keyboard.press('Escape'); await page.waitForTimeout(900);
    await page.click('#rules-btn'); await shown(page, 'rules'); await page.waitForTimeout(300); await shot(page, '03-rules');
    await page.keyboard.press('Escape'); await page.waitForTimeout(900);
    await page.click('#start-btn');
    await page.waitForFunction(() => document.body.classList.contains('in-game'));
    await page.waitForTimeout(2500);
    await page.keyboard.press('Escape'); await shown(page, 'pause'); await page.waitForTimeout(300); await shot(page, '04-pause');
    await page.click('#pause-settings-btn'); await shown(page, 'settings'); await page.waitForTimeout(300); await shot(page, '05-pause-settings');
    await page.close();
  }
}
if (what === 'hud') {
  const [w, h] = (process.argv[5] || '960x540').split('x').map(Number);
  const page = await open(w, h);
  await page.waitForSelector('#title-menu:not([hidden])');
  await page.click('#start-btn');
  const got = {};
  const once = async (k, fn) => { if (!got[k]) { got[k] = true; await fn(); } };
  for (let i = 0; i < 900 && Object.keys(got).length < 5; i++) {
    const st = await page.evaluate(() => { const g = window.__lastcall?.D?.game; return { phase: g?.phase, pending: g?.pending?.seat ?? null, thinking: !!document.querySelector('.tag .status .dots'), bubble: !!document.querySelector('.bubble.show'), claim: !!document.getElementById('claim').textContent }; });
    if (st.thinking && st.claim) await once('think', async () => { console.log('  state', await page.evaluate(() => ({ phase: window.__lastcall.D.game.phase, turn: window.__lastcall.D.game.turn, me: document.getElementById('me-card').className, tags: [...document.querySelectorAll('.tag')].map((t) => t.className) }))); await shot(page, '10-ai-thinking'); });
    if (st.bubble) await once('bubble', () => shot(page, '12-bubble'));
    if (st.phase === 'roulette' && st.pending !== 0) await once('gun', async () => { await page.waitForTimeout(1200); await shot(page, '13-roulette-ai'); });
    if (await vis(page, 'trigger-row')) { await once('trig', async () => { await page.waitForTimeout(800); await shot(page, '14-trigger'); }); await page.keyboard.down('Space'); await page.waitForTimeout(1000); await page.keyboard.up('Space'); continue; }
    if (await vis(page, 'actions')) {
      await page.keyboard.press('1'); await page.keyboard.press('2'); await page.waitForTimeout(400);
      await once('me', () => shot(page, '11-my-turn'));
      const liar = await page.evaluate(() => !document.getElementById('liar-btn').disabled);
      if (liar && Math.random() < 0.5) await page.click('#liar-btn'); else await page.click('#play-btn');
    }
    await page.waitForTimeout(200);
  }
  await page.close();
}
if (what === 'all' || what === 'end') {
  const page = await open(480, 270, '#autoplay');
  await page.evaluate(() => localStorage.setItem('lastcall.stats', JSON.stringify({ played: 6, wins: 2, streak: 0, best: 2 })));
  await page.waitForFunction(() => !document.getElementById('end').classList.contains('fade'));
  await shown(page, 'end'); await page.waitForTimeout(1500);
  for (const [w, h] of SIZES) { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(1500); await shot(page, '20-end'); }
  await page.close();
}
await browser.close();
if (problems.length) { console.error('PROBLEMS:\n' + problems.join('\n')); process.exit(1); }
console.log('capture ok');
