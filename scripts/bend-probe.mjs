// Samples how far every wrist bends off its forearm while a game plays itself.
import { createRequire } from 'node:module';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const [file = 'dist/index.html', hash = '#autoplay-dice', secs = '240'] = process.argv.slice(2);
const ROOT = path.resolve('.');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('/build/three.module.js')) return route.fulfill({ path: path.join(ROOT, 'tools/vendor/three/build/three.module.js'), contentType: 'text/javascript' });
  if (u.includes('/examples/jsm/')) return route.fulfill({ path: path.join(ROOT, 'tools/vendor/three/examples/jsm', u.split('/examples/jsm/')[1]), contentType: 'text/javascript' });
  return u.startsWith('file:') ? route.continue() : route.abort();
});
await page.goto('file://' + path.join(ROOT, file) + hash);
await page.waitForFunction(() => Object.keys(window.__lastcall?.D?.characters ?? {}).length, null, { timeout: 600000 });
const FORE = process.env.FORE ? JSON.parse(process.env.FORE) : null;
const res = await page.evaluate(([secs, FORE]) => new Promise((done) => {
  const L = window.__lastcall, V = L.camera.position.constructor, Q = L.camera.quaternion.constructor;
  const rf = FORE ? new V(...FORE) : L.arm.hand.userData.fore; console.log('fore', JSON.stringify(rf));
  const q1 = new Q(), q2 = new Q(), a = new V(), b = new V(), out = {};
  const add = (k, deg) => { (out[k] ??= []).push(deg); };
  const bend = (fore, hand, handFore) => {
    fore.getWorldQuaternion(q1); hand.getWorldQuaternion(q2);
    a.set(0, 1, 0).applyQuaternion(q1); b.copy(handFore).applyQuaternion(q2);
    return a.angleTo(b) * 180 / Math.PI;
  };
  const t0 = performance.now();
  const tick = () => {
    for (const ch of Object.values(L.D.characters)) {
      if (!ch?.arm || !ch.group.visible) continue;
      add('right', bend(ch.arm.fore, ch.arm.hand, rf));
      add('left', bend(ch.leftArm.fore, ch.leftArm.hand, new V(0, -1, 0)));
    }
    if (L.arm.root.visible) add('player', bend(L.arm.fore, L.arm.hand, rf));
    if (performance.now() - t0 < secs * 1000) setTimeout(tick, 50); else done(out);
  };
  tick();
}), [+secs, FORE]);
console.log('fore', JSON.stringify(await page.evaluate(() => window.__lastcall.arm.hand.userData.fore)));
for (const [k, v] of Object.entries(res)) {
  v.sort((x, y) => x - y);
  const p = (f) => v[Math.min(v.length - 1, Math.floor(v.length * f))].toFixed(0);
  console.log(`${k.padEnd(7)} n=${v.length} median=${p(0.5)} p95=${p(0.95)} max=${p(1)} over60=${(v.filter((x) => x > 60).length / v.length * 100).toFixed(1)}%`);
}
await browser.close();
