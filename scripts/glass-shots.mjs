// Pauses a self-playing game and screenshots it: in dice, during glass reaches (yours and the
// characters'); with a third argument `cards`, at the table's rest and while a character aims the revolver.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
// pages load from a fake http origin that is served from disk: Chromium won't fetch() from file://
const HOST = 'http://last-call.local';
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
  return u.startsWith(HOST) ? route.fulfill({ path: decodeURIComponent(new URL(u).pathname) }) : route.abort();
});
page.setDefaultTimeout(900000);
await page.goto(HOST + path.join(ROOT, `dist/index.html#autoplay${CARDS ? '' : '-dice'}`));
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
    // autoplay cuts every scripted wait to a fifth and the software renderer only moves 0.25 s a frame,
    // so the drink would never play out: at full waits and a slower pace while a glass is held
    if (holder && L.settings.autoplay) { L.settings.autoplay = false; L.settings.speed = 0.15; }
    if (!holder && !L.settings.autoplay) { L.settings.autoplay = true; L.settings.speed = 1; }
    if (holder) {
      const y = holder.arm.hand.getWorldPosition(h).y;
      if (y !== window.__hy) { window.__hy = y; window.__hf = (window.__hf || 0) + 1; }
      if (window.__hf % 4 === 1) { L.settings.paused = true; window.__cap = `${String(++n).padStart(2, '0')}-ch-hold`; window.__hf++; return; }
    } else window.__hf = 0;
    const sip = ch && near(ch);
    const aim = Object.values(L.D.characters).find((c) => c.group.visible && c.env.aim > 0.95 && c.grip.children.includes(L.gun.mover.obj));
    const key = CARDS ? (aim ? 'aim' : L.D.shown?.round ? 'table' : '') : mine ? `me-${L.arm.mover.flying ? 'move' : 'still'}` : ch ? `ch-${sip ? 'sip' : ch.env.reach > 0.95 ? 'at' : 'going'}` : '';
    if (key && key !== last) { L.settings.paused = true; window.__cap = `${String(++n).padStart(2, '0')}-${key}`; }
    last = key;
  }, 40);
}, CARDS);
for (let k = 0; k < N; k++) {
  const name = await page.waitForFunction(() => window.__cap, null, { polling: 250 }).then((h) => h.jsonValue());
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  // a character holding the glass: how far its wrist bends off the forearm, and the rim's distance from its mouth
  const m = await page.evaluate(() => {
    const L = window.__lastcall, held = L.diceTable.held, V = L.camera.position.constructor, Q = L.camera.quaternion.constructor;
    const ch = held?.visible && Object.values(L.D.characters).find((c) => c.grip.children.includes(held));
    if (!ch) return '';
    const qf = new Q(), qh = new Q(), a = new V(), b = new V();
    ch.arm.fore.getWorldQuaternion(qf); ch.arm.hand.getWorldQuaternion(qh);
    const bend = a.set(0, 1, 0).applyQuaternion(qf).angleTo(b.copy(ch.arm.handMesh.userData.fore).applyQuaternion(qh)) * 180 / Math.PI;
    const rim = held.localToWorld(new V(0, 0.056, 0)), mouth = ch.head.localToWorld(new V(0, -0.07, 0.12));
    return ` wrist ${bend.toFixed(0)} deg, rim to mouth ${(rim.distanceTo(mouth) * 100).toFixed(1)} cm`;
  });
  console.log('captured', name + m);
  await page.evaluate(() => { window.__cap = null; window.__lastcall.settings.paused = false; });
}
await browser.close();
