// Stages your own arm on a virtual clock and photographs it in first person: taking up the revolver,
// holding it at your head and putting it down (cards); taking your cup, reaching for a glass,
// holding it and drinking (dice). The game is held on your first turn and the scripted moves are
// the modes' own handlers (deck `shot`, dice `round` and `drink`), so the arm moves as it does in play.
//   node scripts/arm-shots.mjs [--out artifacts/arm] [--only cards|dice] [--size 960x540] [--page dist/index.html]
// Prints, per phase, the most the wrist bent off the forearm and the forearm's twist, where the elbow
// went (camera space, and on screen), and how far the hand's grip drifted from where the mover put it.
import { createRequire } from 'node:module';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
// pages load from a fake http origin that is served from disk: Chromium won't fetch() from file://
const HOST = 'http://last-call.local';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1] ?? true]] : a), []));
const ROOT = path.resolve('.'), OUT = path.resolve(args.out || 'artifacts/arm'), PAGE = path.resolve(args.page || 'dist/index.html');
const [W, H] = String(args.size || '960x540').split('x').map(Number), FPS = 30;
if (!existsSync(PAGE)) throw new Error(`${PAGE} is missing; run \`npm run build\` first`);
mkdirSync(OUT, { recursive: true });

// debug views (--debug), in the game camera's space
const DEBUG = { side: { pos: [0.95, 0.05, -0.35], at: [0.15, -0.3, -0.35] }, top: { pos: [0.25, 0.9, -0.3], at: [0.2, -0.25, -0.35] } };
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const problems = [];

async function open(mode) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(600000);
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|fonts\.g/.test(m.text())) problems.push(`console: ${m.text()}`); });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.includes('/build/three.module.js')) return route.fulfill({ path: path.join(ROOT, 'tools/vendor/three/build/three.module.js'), contentType: 'text/javascript' });
    if (u.includes('/examples/jsm/')) return route.fulfill({ path: path.join(ROOT, 'tools/vendor/three/examples/jsm', u.split('/examples/jsm/')[1]), contentType: 'text/javascript' });
    return u.startsWith(HOST) ? route.fulfill({ path: decodeURIComponent(new URL(u).pathname) }) : route.abort();
  });
  await page.addInitScript((step) => {
    let a = 11;
    Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    try { localStorage.setItem('lastcall.coach', JSON.stringify({ lead: 1, liar: 1, dice: 1, 'liar-dice': 1, auction: 1, disgrace: 1 })); } catch {}
    // the clock only moves while frames are being run: one film frame each
    let v = performance.now(), held = false;
    performance.now = () => v;
    const S = window.__as = { left: 0, done: null, draw: false };
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf(() => {
      if (!held) {
        v += S.fast ? 100 : step;
        if (S.left > 0 && --S.left === 0) { held = true; const d = S.done; S.done = null; setTimeout(d, 0); }
      }
      cb(v);
    });
    S.redraw = () => new Promise((r) => { S.draw = true; raf(() => raf(() => r())); });
    S.run = (n, fast) => new Promise((r) => { S.fast = fast; S.left = n; S.done = r; held = false; });
  }, 1000 / FPS);
  await page.goto(HOST + PAGE);
  await page.waitForSelector('#title-menu:not([hidden])');
  await page.evaluate(() => {
    const L = window.__lastcall, S = window.__as, V = L.camera.position.constructor, M4 = L.camera.matrixWorld.constructor;
    const v = new V(), w = new V(), sock = new V(), m = new M4(), deg = 180 / Math.PI;
    const ndc = (p) => v.copy(p).applyMatrix4(L.camera.projectionMatrix);
    // the hand's control socket, in the world, against where the mover has put the root
    const drift = () => {
      const R = L.arm.rig; if (!R) return 0;
      const s = L.arm.grasp === 'cup' && L.arm.cuppy > 0.99 ? R.sockets.cup : L.arm.cuppy < 0.01 ? R.sockets.gun : null;
      if (!s) return 0;
      R.bones.hand.updateWorldMatrix(true, false); L.arm.root.updateWorldMatrix(true, false);
      sock.copy(s.pos).applyMatrix4(R.bones.hand.matrixWorld);
      return sock.distanceTo(w.setFromMatrixPosition(L.arm.root.matrixWorld)) * 1000;
    };
    S.measure = () => {
      const a = L.arm, s = a.solved;
      if (!a.root.visible || !a.rig) return null;
      const e = ndc(s.elbow), ex = e.x, ey = e.y, ez = e.z;
      const sh = ndc(s.shoulder), shx = sh.x, shy = sh.y, shz = sh.z;
      m.copy(L.camera.matrixWorld); w.copy(s.elbow).applyMatrix4(m);
      return {
        bend: s.wristBend * deg, twist: s.twist * deg, reach: s.reach,
        elbow: s.elbow.toArray().map((x) => +x.toFixed(3)), elbowY: w.y, elbowNdc: [ex, ey, ez], shoulderNdc: [shx, shy, shz],
        inward: s.wrist.x - s.elbow.x, drift: drift(),
      };
    };
    S.stats = {}; S.phase = null;
    S.sample = () => {
      const r = S.measure(); if (!r || !S.phase) return;
      const st = S.stats[S.phase] ??= { frames: 0, bend: 0, twist: 0, inward: -1, drift: 0, elbowOnScreen: 0, shoulderOnScreen: 0, lowElbow: Infinity, reach: 0 };
      st.frames++;
      st.bend = Math.max(st.bend, r.bend); st.twist = Math.max(st.twist, Math.abs(r.twist)); st.inward = Math.max(st.inward, r.inward);
      st.drift = Math.max(st.drift, r.drift); st.lowElbow = Math.min(st.lowElbow, r.elbowY); st.reach = Math.max(st.reach, r.reach);
      const on = (n) => n[2] < 1 && Math.abs(n[0]) < 1 && Math.abs(n[1]) < 1;
      if (on(r.elbowNdc)) st.elbowOnScreen++;
      if (on(r.shoulderNdc)) st.shoulderOnScreen++;
    };
    L.hooks.probe = { hz: 50, maxDt: 0.25, draw: () => { const d = S.draw; S.draw = false; return d; }, sample: () => {}, frame: () => S.sample() };
  });
  await page.click('#solo-btn');
  if (mode !== 'deck') await page.click(`#solo-mode-seg button[data-v="${mode}"]`);
  await page.click('#solo-start-btn');
  const run = (n, fast = false) => page.evaluate(([n, fast]) => window.__as.run(n, fast), [n, fast]);
  const until = async (pred, arg, max = 900) => {
    for (let i = 0; i < max; i++) { if (await page.evaluate(pred, arg)) return true; await run(1); }
    console.log('  gave up waiting for', String(pred).slice(0, 100)); return false;
  };
  const shot = async (name) => {
    await page.evaluate(() => window.__as.redraw());
    await page.waitForTimeout(120);
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
    if (args.debug) for (const [k, view] of Object.entries(DEBUG)) {
      await page.evaluate((view) => {
        // a second camera beside your head, looking at your arm (the arm hangs off the game's camera)
        const L = window.__lastcall, C = L.camera, V = C.position.constructor;
        const cam = window.__as.cam ??= new C.constructor(45, C.aspect, 0.02, 30);
        cam.aspect = C.aspect; cam.updateProjectionMatrix();
        C.updateMatrixWorld();
        cam.position.fromArray(view.pos).applyMatrix4(C.matrixWorld);
        cam.up.set(0, 1, 0); cam.lookAt(new V().fromArray(view.at).applyMatrix4(C.matrixWorld));
        L.renderer.render(C.parent, cam);
      }, view);
      await page.screenshot({ path: path.join(OUT, `${name}-${k}.png`) });
    }
    const m = await page.evaluate(() => window.__as.measure());
    const f = (x) => x.toFixed(2);
    console.log(`  ${file}${m ? `\n     wrist ${m.bend.toFixed(1)} deg, twist ${m.twist.toFixed(0)} deg, elbow (camera) ${m.elbow.join(' ')} on screen ${f(m.elbowNdc[0])} ${f(m.elbowNdc[1])}, upper arm ${m.reach.toFixed(2)} m, grip drift ${m.drift.toFixed(2)} mm` : ''}`);
  };
  await until(() => { const D = window.__lastcall.D; return D.prompt?.seat === D.me && !D.busy && !D.queue.length; }, null, 4000);
  await page.addStyleTag({ content: 'body * { visibility: hidden !important } canvas { visibility: visible !important }' });
  await run(20);
  const phase = (name) => page.evaluate((name) => { window.__as.phase = name; }, name);
  const report = async () => {
    const stats = await page.evaluate(() => window.__as.stats);
    console.log('  per phase: most wrist bend and twist (deg), most the wrist sat right of the elbow (m, < 0: the elbow stays outside), most grip drift (mm), lowest elbow (m over the table top), frames with the elbow / the shoulder on screen');
    for (const [k, s] of Object.entries(stats)) console.log(`  ${k.padEnd(12)} ${String(s.frames).padStart(4)} frames: wrist ${s.bend.toFixed(1)}, twist ${s.twist.toFixed(0)}, inward ${s.inward.toFixed(3)}, drift ${s.drift.toFixed(2)}, elbow at ${s.lowElbow.toFixed(3)}, on screen ${s.elbowOnScreen} / ${s.shoulderOnScreen}, upper arm up to ${s.reach.toFixed(2)} m`);
  };
  return { page, run, until, shot, phase, report };
}

const flight = (want) => window.__lastcall.arm.mover.flight && window.__lastcall.arm.mover.flight.t / window.__lastcall.arm.mover.flight.dur >= want;

if (args.only !== 'dice') {
  const { page, run, until, shot, phase, report } = await open('deck');
  await page.evaluate(() => { const L = window.__lastcall; window.__as.busy = L.MODES.deck.on.shot(L.T, { seat: L.D.me, fired: false }).then(() => { window.__as.busy = null; }); });
  await phase('gun-reach');
  await until(() => window.__lastcall.arm.root.visible); await until(flight, 0.85); await shot('gun-reach');
  const holding = () => { const L = window.__lastcall; return L.arm.grip.children.includes(L.gun.obj); };
  await until(holding); await phase('gun-raise'); await until(() => window.__lastcall.arm.mover.parent === window.__lastcall.camera); await until(flight, 0.5); await shot('gun-raise');
  await until(() => !window.__lastcall.arm.mover.flight); await phase('gun-aim'); await run(25); await shot('gun-aim');
  await until(() => window.__lastcall.arm.mover.parent !== window.__lastcall.camera); await phase('gun-lower'); await until(flight, 0.5); await shot('gun-lower');
  await until(() => !window.__as.busy, null, 1500);
  await report();
  await page.close();
}

if (args.only !== 'cards') {
  const { page, run, until, shot, phase, report } = await open('dice');
  // your cup: the hand comes onto it, lifts it and shakes it
  await page.evaluate(() => {
    const L = window.__lastcall, g = L.T.game;
    window.__as.busy = L.MODES.dice.on.round(L.T, { round: g.round, diceCounts: g.diceCounts.slice() }).then(() => { window.__as.busy = null; });
  });
  await phase('cup-reach');
  await until(() => window.__lastcall.arm.root.visible); await until(flight, 0.85); await shot('cup-reach');
  await until(() => window.__lastcall.arm.grip.children.length > 0); await phase('cup-shake'); await run(18); await shot('cup-shake');
  await until(() => !window.__as.busy, null, 1500);
  await run(30);
  // a glass from your tray, held, drunk and put back
  await page.evaluate(() => { const L = window.__lastcall; window.__as.busy = L.MODES.dice.on.drink(L.T, { seat: L.D.me, poisoned: false, drinks: 1 }).then(() => { window.__as.busy = null; }); });
  await phase('glass-reach');
  await until(() => window.__lastcall.arm.root.visible && window.__lastcall.arm.grasp === 'glass'); await until(flight, 0.85); await shot('glass-reach');
  await until(() => window.__lastcall.arm.grip.children.length > 0); await shot('glass-take');
  await phase('glass-hold'); await until(() => window.__lastcall.arm.mover.parent === window.__lastcall.camera); await until(() => !window.__lastcall.arm.mover.flight); await shot('glass-hold');
  await until(() => window.__lastcall.arm.sip); await phase('sip-up');
  await until(() => window.__lastcall.arm.sip.t > window.__lastcall.arm.sip.dur * 0.4); await shot('sip-mid');
  await until(() => !window.__lastcall.arm.sip); await phase('sip-lips'); await run(4); await shot('sip-lips');
  await until(() => window.__lastcall.arm.sip); await phase('sip-down'); await until(() => window.__lastcall.arm.sip.t > window.__lastcall.arm.sip.dur * 0.5); await shot('sip-down');
  await phase('glass-back');
  await until(() => !window.__as.busy, null, 1500);
  await report();
  await page.close();
}
await browser.close();
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
