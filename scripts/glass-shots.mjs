// Pauses a self-playing dice game during glass reaches (yours and the characters') and screenshots them.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = path.resolve(process.argv[2] || 'artifacts/glass'), N = +(process.argv[3] || 8);
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
await page.goto('file://' + path.join(ROOT, 'dist/index.html#autoplay-dice'));
await page.waitForFunction(() => Object.keys(window.__lastcall?.D?.characters ?? {}).length);
await page.evaluate(() => {
  const L = window.__lastcall; let last = '', n = 0;
  setInterval(() => {
    if (L.settings.paused) return;
    const mine = L.arm.root.visible && L.arm.grasp === 'glass';
    const ch = Object.values(L.D.characters).find((c) => c.group.visible && c.grasp === 'glass' && c.env.reach > 0.5);
    const V = L.camera.position.constructor, h = new V(), d = new V();
    const sip = ch && ch.arm.hand.getWorldPosition(h).y > ch.head.getWorldPosition(d).y - 0.3;
    const key = mine ? `me-${L.arm.mover.flying ? 'move' : 'still'}` : ch ? `ch-${sip ? 'sip' : ch.env.reach > 0.95 ? 'at' : 'going'}` : '';
    if (key && key !== last) { L.settings.paused = true; window.__cap = `${String(++n).padStart(2, '0')}-${key}`; }
    last = key;
  }, 40);
});
for (let k = 0; k < N; k++) {
  const name = await page.waitForFunction(() => window.__cap, null, { polling: 250 }).then((h) => h.jsonValue());
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('captured', name);
  await page.evaluate(() => { window.__cap = null; window.__lastcall.settings.paused = false; });
}
await browser.close();
