// Pauses a self-playing game and screenshots it: in dice, during glass reaches (yours and the
// characters'); with a third argument `cards`, at the table's rest and while a character aims the revolver.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = path.resolve(process.argv[2] || 'artifacts/glass'), N = +(process.argv[3] || 8), CARDS = process.argv[4] === 'cards';
mkdirSync(OUT, { recursive: true });
const ROOT = path.resolve('.');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('/build/three.module.js')) return route.fulfill({ path: path.join(ROOT, 'tools/vendor/three/build/three.module.js'), contentType: 'text/javascript' });
  if (u.includes('/examples/jsm/')) return route.fulfill({ path: path.join(ROOT, 'tools/vendor/three/examples/jsm', u.split('/examples/jsm/')[1]), contentType: 'text/javascript' });
  return u.startsWith('file:') ? route.continue() : route.abort();
});
page.setDefaultTimeout(900000);
await page.goto('file://' + path.join(ROOT, `dist/index.html#autoplay${CARDS ? '' : '-dice'}`));
await page.waitForFunction(() => Object.keys(window.__lastcall?.D?.characters ?? {}).length);
await page.evaluate((CARDS) => {
  const L = window.__lastcall; let last = '', n = 0;
  setInterval(() => {
    if (L.settings.paused) return;
    const mine = L.arm.root.visible && L.arm.grasp === 'glass';
    const V = L.camera.position.constructor, h = new V(), d = new V();
    const near = (c) => c.arm.hand.getWorldPosition(h).y > c.head.getWorldPosition(d).y - 0.3;
    const ch = Object.values(L.D.characters).find((c) => c.group.visible && c.grasp === 'glass' && (c.env.reach > 0.5 || near(c)));
    // a character holding the glass: every few rendered frames, to catch the lift and the sip
    const held = L.diceTable.held, holder = held?.visible && Object.values(L.D.characters).find((c) => c.grip.children.includes(held) || c.arm.hand.children.some((k) => k.children.includes(held)));
    if (holder) {
      const y = holder.arm.hand.getWorldPosition(h).y;
      if (y !== window.__hy) { window.__hy = y; window.__hf = (window.__hf || 0) + 1; }
      if (window.__hf % 4 === 1) { L.settings.paused = true; window.__cap = `${String(++n).padStart(2, '0')}-ch-hold`; window.__hf++; return; }
    } else window.__hf = 0;
    const sip = ch && near(ch);
    const aim = Object.values(L.D.characters).find((c) => c.group.visible && c.env.aim > 0.95 && c.grip.children.includes(L.gun.obj));
    const key = CARDS ? (aim ? 'aim' : L.D.shown?.round ? 'table' : '') : mine ? `me-${L.arm.mover.flying ? 'move' : 'still'}` : ch ? `ch-${sip ? 'sip' : ch.env.reach > 0.95 ? 'at' : 'going'}` : '';
    if (key && key !== last) { L.settings.paused = true; window.__cap = `${String(++n).padStart(2, '0')}-${key}`; }
    last = key;
  }, 40);
}, CARDS);
for (let k = 0; k < N; k++) {
  const name = await page.waitForFunction(() => window.__cap, null, { polling: 250 }).then((h) => h.jsonValue());
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('captured', name);
  await page.evaluate(() => { window.__cap = null; window.__lastcall.settings.paused = false; });
}
await browser.close();
