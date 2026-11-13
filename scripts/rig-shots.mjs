// Stages a character (--who brass|noctua|gristle, default brass) through his poses on a virtual clock and photographs each one close up: at rest,
// holding cards, reaching for the revolver, aiming it at his temple, and drinking (a still at the
// lip and a filmstrip of the whole drink). The game is held on your first turn, so nothing else moves.
//   node scripts/rig-shots.mjs [--who gristle] [--out artifacts/rig/after] [--only cards|dice] [--zoom 1.9] [--page dist/index.html]
// Run it on the build before a change and after it (different --out) to compare.
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
// pages load from a fake http origin that is served from disk: Chromium won't fetch() from file://
const HOST = 'http://last-call.local';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1] ?? true]] : a), []));
const ROOT = path.resolve('.'), OUT = path.resolve(args.out || 'artifacts/rig'), PAGE = path.resolve(args.page || 'dist/index.html');
const ZOOM = +(args.zoom || 2.5), FPS = 30, WHO = args.who || 'brass';
if (!existsSync(PAGE)) throw new Error(`${PAGE} is missing; run \`npm run build\` first`);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const problems = [];
// seat is the player's own view, zoomed; the others are close-ups from in front and from either side
const VIEWS = { seat: null, front: { pos: [0, 0.42, 1.15], look: [0, 0.2, 0] }, right: { pos: [-0.85, 0.5, 0.8], look: [-0.14, 0.28, 0.12] }, left: { pos: [0.75, 0.4, 0.85], look: [0.1, 0.15, 0.25] }, hand: { pos: [-0.5, 0.35, 0.95], look: [-0.14, 0.03, 0.5] } };

async function open(mode) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
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
    let a = 7;
    Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    try { localStorage.setItem('lastcall.coach', JSON.stringify({ lead: 1, liar: 1, dice: 1, 'liar-dice': 1, auction: 1, disgrace: 1 })); } catch {}
    // the clock only moves while frames are being run: 100 ms a frame undrawn, a film frame otherwise
    let v = performance.now(), held = false;
    performance.now = () => v;
    const S = window.__rs = { film: false, left: 0, done: null, draw: false, cam: null };
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf(() => {
      if (!held) {
        v += S.film ? step : 100; S.n = (S.n || 0) + 1;
        S.tick?.();
        if (S.left > 0 && --S.left === 0) { held = true; S.draw = S.wantDraw; const d = S.done; S.done = null; setTimeout(d, 0); }
      }
      cb(v);
    });
    // the same instant drawn again (from another camera)
    S.redraw = () => new Promise((r) => { S.draw = true; raf(() => raf(() => r())); });
    S.run = (n, film, draw) => new Promise((r) => { S.film = film; S.left = n; S.done = r; S.wantDraw = draw; held = false; });
  }, 1000 / FPS);
  await page.goto(HOST + PAGE);
  await page.waitForSelector('#title-menu:not([hidden])');
  await page.evaluate((who) => {
    const L = window.__lastcall, S = window.__rs;
    S.who = who; S.ch = L.D.characters[who];
    // a free camera, given in Brass's own space (he faces +z, his right hand is on -x), set after
    // the game has placed its own
    const V = L.camera.position.constructor, at = new V();
    const sample = () => {
      // your own hand of cards hangs in front of the game's camera, not this one
      for (const b of L.cards.hands[0]) b.mesh.visible = !S.view;
      if (!S.view) return;
      S.ch.group.updateWorldMatrix(true, false);
      L.camera.position.fromArray(S.view.pos).applyMatrix4(S.ch.group.matrixWorld);
      L.camera.lookAt(at.fromArray(S.view.look).applyMatrix4(S.ch.group.matrixWorld));
      L.camera.zoom = S.view.zoom || 1; L.camera.updateProjectionMatrix(); L.camera.updateMatrixWorld();
    };
    /*
     * The collision probe. Every simulated frame it takes each vertex of his arms and hands (posed:
     * skinned or morphed), and of whatever they hold, and counts those inside the torso capsule
     * (chest space; the same capsule rig.js keeps arms out of), and finds the lowest one over the
     * table. The arm's first 12 cm are left out: the shoulder joint sits in the body by design.
     */
    const ch = S.ch, T = ch.rig?.colliders?.TORSO ?? { y0: -0.22, y1: 0.2, rx: 0.243, rz: 0.194, ry: 0.17 }, TABLE_R = 1.06;
    const level = (p) => Math.hypot(p.x / T.rx, p.z / T.rz, Math.max(0, p.y - T.y1, T.y0 - p.y) / T.ry);
    const ARM = /^(upperarm|elbow|forearm|hand|index|middle|ring|little|thumb)/, arms = [];
    const meshesOf = (root, skip = []) => { const out = []; const walk = (o) => { if (skip.includes(o)) return; if (o.isMesh && o.visible) out.push(o); o.children.forEach(walk); }; walk(root); return out; };
    if (ch.rig) ch.group.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const J = o.geometry.attributes.skinIndex, W = o.geometry.attributes.skinWeight, pick = [];
      for (let i = 0; i < J.count; i++) { let b = 0; for (let k = 1; k < 4; k++) if (W.getComponent(i, k) > W.getComponent(i, b)) b = k; if (ARM.test(o.skeleton.bones[J.getComponent(i, b)].name)) pick.push(i); }
      const names = pick.map((i) => { let b = 0; for (let k = 1; k < 4; k++) if (W.getComponent(i, k) > W.getComponent(i, b)) b = k; return o.skeleton.bones[J.getComponent(i, b)].name; });
      for (const upper of [true, false]) arms.push({ mesh: o, pick: pick.filter((_, k) => /^(upperarm|elbow)/.test(names[k]) === upper), names: names.filter((n) => /^(upperarm|elbow)/.test(n) === upper), key: upper ? 'upper' : 'fore' });
    });
    else for (const a of [ch.arm, ch.leftArm]) {
      const fore = meshesOf(a.fore, [ch.grip, ch.handAnchor]);
      for (const m of meshesOf(a.upper, [ch.grip, ch.handAnchor])) arms.push({ mesh: m, pick: null, key: fore.includes(m) ? 'fore' : 'upper' });
    }
    const inv = new L.camera.matrixWorld.constructor(), v = new V(), sR = new V(), sL = new V();
    S.stats = {}; S.phase = null;
    const measure = (list, st) => {
      const inside = { upper: 0, fore: 0, prop: 0 };
      for (const { mesh, pick, names, key } of list) {
        const n = pick ? pick.length : mesh.geometry.attributes.position.count;
        for (let k = 0; k < n; k++) {
          mesh.getVertexPosition(pick ? pick[k] : k, v).applyMatrix4(mesh.matrixWorld);
          if (key === 'upper' && (v.distanceTo(sR) < 0.12 || v.distanceTo(sL) < 0.12)) continue;
          if (key !== 'prop' && Math.hypot(v.x, v.z) < TABLE_R && v.y < st.tableMin) { st.tableMin = v.y; st.lowest = names ? names[k] : key; }
          const lv = level(v.applyMatrix4(inv));
          if (lv < 1) { inside[key]++; st[key + 'Depth'] = Math.max(st[key + 'Depth'], (1 - lv) * T.rz); }
        }
      }
      for (const k in inside) st[k + 'Inside'] = Math.max(st[k + 'Inside'], inside[k]);
    };
    const frame = () => {
      if (!S.phase || S.n === S.seen) return;
      S.seen = S.n;
      const st = S.stats[S.phase] ??= { frames: 0, upperInside: 0, upperDepth: 0, foreInside: 0, foreDepth: 0, propInside: 0, propDepth: 0, tableMin: Infinity, lowest: '' };
      st.frames++;
      ch.group.updateMatrixWorld(true);
      inv.copy(ch.upper.matrixWorld).invert(); ch.arm.upper.getWorldPosition(sR); ch.leftArm.upper.getWorldPosition(sL);
      measure(arms, st);
      measure([...ch.grip.children, ...ch.handAnchor.children].flatMap((o) => meshesOf(o)).map((mesh) => ({ mesh, pick: null, key: 'prop' })), st);
    };
    // what he is made of, for the draw-call budget (his chair is shared and not counted)
    S.census = () => { const list = meshesOf(ch.group, [ch.grip, ch.handAnchor]).filter((o) => o.parent !== ch.group); return { meshes: list.length, tris: list.reduce((n, o) => n + (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3, 0) }; };
    L.hooks.probe = { hz: 50, maxDt: 0.25, draw: () => { const d = S.draw; S.draw = false; return d; }, sample, frame };
    S.tick = () => {
      if (!S.cam) return;
      L.rig.focusTarget.copy(S.ch.tagAnchor); L.rig.focusTarget.y -= S.cam.down;
      L.rig.zoomTarget = S.cam.zoom; L.rig.leanTarget = 0; L.rig.lookYawTarget = L.rig.lookPitchTarget = 0;
    };
  }, WHO);
  await page.click('#solo-btn');
  if (mode !== 'deck') await page.click(`#solo-mode-seg button[data-v="${mode}"]`);
  await page.click('#solo-start-btn');
  // frames are only drawn for a photograph: the software renderer takes seconds over each
  const run = (n, film = true, draw = false) => page.evaluate(([n, film, draw]) => window.__rs.run(n, film, draw), [n, film, draw]);
  const until = async (pred, arg, { film = true, max = 600, stride = 2 } = {}) => {
    for (let i = 0; i < max; i += stride) { if (await page.evaluate(pred, arg)) return true; await run(stride, film); }
    console.log('  gave up waiting for', String(pred).slice(0, 90)); return false;
  };
  const shot = async (name, views = ['seat']) => {
    await run(1);
    for (const v of views) {
      await page.evaluate((view) => { window.__rs.view = view; return window.__rs.redraw(); }, VIEWS[v]);
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(OUT, `${name}-${v}.png`) }); console.log(`  ${path.join(OUT, name)}-${v}.png`);
    }
    await page.evaluate(() => { window.__rs.view = null; });
  };
  // your first turn: the deal is done and the table waits
  await until(() => { const D = window.__lastcall.D; return D.prompt?.seat === D.me && !D.busy && !D.queue.length; }, null, { film: false, max: 3000, stride: 5 });
  await page.evaluate((zoom) => { window.__rs.cam = { zoom, down: 0.36 }; }, ZOOM);
  // only the scene: the HUD would sit over him
  await page.addStyleTag({ content: 'body * { visibility: hidden !important } canvas { visibility: visible !important }' });
  await run(60);
  const phase = (name) => page.evaluate((name) => { window.__rs.phase = name; }, name);
  const report = async () => {
    const { stats, census } = await page.evaluate(() => ({ stats: window.__rs.stats, census: window.__rs.census() }));
    console.log(`  ${WHO}: ${census.meshes} draw calls, ${census.tris} triangles`);
    const mm = (x) => (x * 1000).toFixed(1);
    console.log('  vertices inside the torso capsule, most in any frame (deepest, mm); lowest arm vertex over the table top (mm)');
    for (const [k, s] of Object.entries(stats)) console.log(`  ${k.padEnd(6)} ${String(s.frames).padStart(4)} frames: forearm and hand ${s.foreInside} (${mm(s.foreDepth)}), held props ${s.propInside} (${mm(s.propDepth)}), upper arm past the shoulder ${s.upperInside} (${mm(s.upperDepth)}); lowest ${mm(s.tableMin)} ${s.lowest}`);
  };
  return { page, run, until, shot, phase, report };
}

if (args.only !== 'dice') {
  const { page, run, until, shot, phase, report } = await open('deck');
  await phase('cards'); await run(30);
  await shot('cards', ['seat', 'left']);
  // the fan put away for a moment, so both hands lie on the table
  await page.evaluate(() => {
    const L = window.__lastcall, S = window.__rs, hand = L.cards.hands[1];
    S.saved = hand.splice(0);
    for (const b of S.saved) b.mover.snap(L.gun.obj.parent, new L.camera.position.constructor(0, -3, 0), b.mover.quat);
  });
  await phase('rest'); await run(50); await shot('rest', ['seat', 'front']);
  await page.evaluate(() => { const S = window.__rs; window.__lastcall.cards.hands[1].push(...S.saved); });
  await run(50);
  // the revolver slid to his spot, as deck.js stages it
  await page.evaluate(() => {
    const L = window.__lastcall, S = window.__rs, ch = S.ch, V = L.camera.position.constructor, Q = L.camera.quaternion.constructor, E = L.camera.rotation.constructor;
    const g = ch.group.position, r = Math.hypot(g.x, g.z), ux = g.x / r, uz = g.z / r;
    const spot = new V(ux * 0.72 + uz * 0.1, 0.026, uz * 0.72 - ux * 0.1);
    const lie = new Q().setFromEuler(new E(0, Math.atan2(-spot.x, -spot.z) + 0.35, -Math.PI / 2, 'YXZ'));
    S.scene = L.gun.obj.parent; S.home = { pos: L.gun.obj.position.clone(), quat: L.gun.obj.quaternion.clone() };
    L.gun.mover.go(S.scene, spot, lie, 1, { dur: 0.55 });
    ch.reachTarget.copy(spot); ch.reachQuat.copy(lie);
  });
  await run(24); await phase('reach');
  await page.evaluate(() => { const t = window.__rs.ch.target; t.reach = 1; t.lean = 1; });
  await until(() => window.__rs.ch.env.reach > 0.5); await shot('reach-mid', ['hand']);
  await until(() => window.__rs.ch.env.reach > 0.94); await run(6); await shot('reach', ['seat', 'hand']);
  await phase('aim');
  await page.evaluate(() => {
    const L = window.__lastcall, ch = window.__rs.ch, V = L.camera.position.constructor, Q = L.camera.quaternion.constructor;
    L.gun.mover.go(ch.grip, new V(), new Q(), 1, { dur: 0.32 });
    Object.assign(ch.target, { reach: 0, lean: 0, aim: 1, tremble: 1 });
  });
  await until(() => window.__rs.ch.env.aim > 0.5); await shot('aim-mid', ['right']);
  await until(() => window.__rs.ch.env.aim > 0.985 && !window.__lastcall.gun.mover.flight); await run(20); await shot('aim', ['seat', 'right', 'front']);
  // and back down onto the felt
  await phase('lower');
  await page.evaluate(() => { Object.assign(window.__rs.ch.target, { aim: 0, tremble: 0, reach: 1 }); });
  await until(() => window.__rs.ch.env.reach > 0.94 && window.__rs.ch.env.aim < 0.04); await run(10);
  await report();
  await page.close();
}

if (args.only !== 'cards') {
  const { page, run, phase, report } = await open('dice');
  await phase('drink');
  
  await page.evaluate(() => {
    const L = window.__lastcall, S = window.__rs, seat = L.D.designOf.indexOf(S.who);
    S.drinking = true;
    L.MODES.dice.on.drink(L.T, { seat, poisoned: false, drinks: 1 }).then(() => { S.drinking = false; });
  });
  const measure = () => page.evaluate(() => {
    const L = window.__lastcall, ch = window.__rs.ch, held = L.diceTable.held, V = L.camera.position.constructor, Q = L.camera.quaternion.constructor;
    if (!held?.visible || !ch.grip.children.includes(held)) return null;
    const qf = new Q(), qh = new Q(), a = new V(), b = new V();
    ch.arm.fore.getWorldQuaternion(qf); ch.arm.hand.getWorldQuaternion(qh);
    const bend = a.set(0, 1, 0).applyQuaternion(qf).angleTo(b.copy(ch.arm.handMesh.userData.fore).applyQuaternion(qh)) * 180 / Math.PI;
    const rim = held.localToWorld(new V(0, 0.056, 0)), mouth = ch.rig ? ch.rig.mouth.getWorldPosition(new V()) : ch.head.localToWorld(new V(0, -0.07, 0.12));
    return { bend, gap: rim.distanceTo(mouth) * 100 };
  });
  const TMP = path.join(OUT, 'drink-frames'); rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
  const frames = []; let best = null, seatShot = false;
  for (let f = 0; f < 280 && await page.evaluate(() => window.__rs.drinking); f += 3) {
    await run(3);
    await page.evaluate((view) => { window.__rs.view = view; return window.__rs.redraw(); }, VIEWS.right);
    await page.waitForTimeout(150);
    const m = await measure(), file = path.join(TMP, `${String(f).padStart(4, '0')}.png`);
    await page.screenshot({ path: file });
    if (m && m.gap < 2.5 && !seatShot) { seatShot = true; await page.evaluate(() => { window.__rs.view = null; return window.__rs.redraw(); }); await page.waitForTimeout(150); await page.screenshot({ path: path.join(OUT, 'sip-seat.png') }); }
    frames.push([file, Math.round(((f + 3) * 1000) / FPS), m]);
    if (m && (!best || m.gap < best[2].gap)) best = frames[frames.length - 1];
  }
  const strip = frames.filter((_, i) => i % 2 === 0);
  execFileSync('montage', [...strip.flatMap(([f, ms, m]) => ['-label', `${ms} ms${m ? `  wrist ${m.bend.toFixed(0)} deg  rim ${m.gap.toFixed(1)} cm` : ''}`, f]), '-tile', '6x', '-geometry', '320x180+2+2', '-pointsize', '10', path.join(OUT, 'drink-strip.png')]);
  console.log(`  ${path.join(OUT, 'drink-strip.png')} (${strip.length} frames)`);
  if (best) {
    execFileSync('cp', [best[0], path.join(OUT, 'sip-right.png')]);
    console.log(`  ${path.join(OUT, 'sip-right.png')} at ${best[1]} ms: wrist ${best[2].bend.toFixed(0)} deg off the forearm, rim ${best[2].gap.toFixed(1)} cm from the mouth`);
  } else console.log('  the glass never reached his hand');
  rmSync(TMP, { recursive: true, force: true });
  await report();
  await page.close();
}
await browser.close();
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
