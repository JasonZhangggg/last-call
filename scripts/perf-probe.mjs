// Measures where a frame's CPU goes, per game mode, in headless Chromium.
//   node scripts/perf-probe.mjs [--secs 20] [--size 960x540] [--modes deck,dice,auction] [--out file.json]
// Builds an unminified copy of the page (so profiles keep function names) with timers around the
// simulation sub-steps and the draw, then for each mode records: JS ms per sub-step and per draw,
// sub-steps per frame, renderer.info per frame, bytes allocated per frame, CPU self time by module
// and inclusive time of each update function, plus a scene inventory (shadow casters, textures).
// SwiftShader draws on the CPU, so draw *wall* time is not a GPU number; JS times and counts transfer.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1] ?? true]] : a), []));
const SECS = +(args.secs || 20), [W, H] = String(args.size || '960x540').split('x').map(Number);
const MODES = String(args.modes || 'deck,dice,auction').split(',');
const HASH = { deck: '#autoplay', dice: '#autoplay-dice', auction: '#autoplay-auction' };
const ROOT = path.resolve('.'), TMP = path.join(os.tmpdir(), 'lastcall-perf'); mkdirSync(TMP, { recursive: true });

const must = (src, re, rep) => { if (!re.test(src)) throw new Error(`probe hook not found: ${re}`); return src.replace(re, rep); };
const instrument = {
  name: 'instrument',
  setup(b) {
    b.onLoad({ filter: /src[\\/]main\.js$/ }, (a) => {
      let s = readFileSync(a.path, 'utf8');
      s = must(s, /function frame\(\) \{/, `function frame() {
  const P = globalThis.__perf, R = globalThis.__lastcall?.renderer;
  if (!P?.on) return __frame();
  R.info.autoReset = false; R.info.reset();
  const a = performance.now(); P.draw = 0; P.n = 0; __frame();
  P.frames.push([performance.now() - a, P.n, P.draw, R.info.render.calls, R.info.render.triangles]);
}
function __frame() {`);
      s = must(s, /simulate\(dt \/ n, t0 \+ \(dt \* i\) \/ n\);/, `{ const P = globalThis.__perf, a = performance.now(); simulate(dt / n, t0 + (dt * i) / n); if (P?.on) { P.steps.push(performance.now() - a); P.n++; } }`);
      s = must(s, /render\(dt, t\);\n/, `{ const a = performance.now(); render(dt, t); if (globalThis.__perf) globalThis.__perf.draw = performance.now() - a; }\n`);
      const mark = (name) => `performance.mark('${name}'); `;
      s = must(s, /\n  buildWorld\(\);/, `\n  ${mark('fonts')}buildWorld();`);
      s = must(s, /  await compileScene\(\)/, `  ${mark('built')}await compileScene()`);
      s = must(s, /  warmCards\(renderer\);/, `  ${mark('compiled')}warmCards(renderer);`);
      s = must(s, /  clock\.start\(\);\n  renderer\.setAnimationLoop/, `  ${mark('warmed')}clock.start();\n  renderer.setAnimationLoop`);
      return { contents: s, loader: 'js' };
    });
  },
};
const out = await build({ entryPoints: ['src/main.js'], bundle: true, format: 'esm', write: false, external: ['three', 'three/addons/*'], target: 'es2022', plugins: [instrument] });
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const page = readFileSync('index.html', 'utf8').replace('<script type="module" src="./src/main.js"></script>', () => `<script type="module">${js}</script>`);
const file = path.join(TMP, 'index.html'); writeFileSync(file, page);
// module of each line of the bundled page, from esbuild's "// src/..." section markers
const lines = page.split('\n'), modOf = []; let cur = 'html';
lines.forEach((l, i) => { const m = /^\/\/ (src\/[\w/.-]+)$/.exec(l); if (m) cur = m[1]; modOf[i] = cur; });

const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const r2 = (x) => Math.round(x * 100) / 100;
const UPDATES = ['simulate', 'updateWorld', 'updateCamera', 'updateCharacter', 'dampVec3', 'updateCards', 'updateAuctionTable', 'updatePlayerArm', 'updateGun', 'updateDiceTable', 'updateHover', 'placeTags', 'render', 'adapt', 'shareLook', 'checkPostOutput'];

const results = {};
const browser = await chromium.launch();
for (const mode of MODES) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push(e.message));
  pg.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|fonts\.g/.test(m.text())) errors.push(m.text()); });
  await pg.addInitScript(() => { try { localStorage.setItem('lastcall.quality', '"high"'); } catch {} globalThis.__perf = { on: false, frames: [], steps: [] }; });
  await pg.route('**/*', (route) => {
    const u = route.request().url();
    if (u.includes('/build/three.module.js')) return route.fulfill({ path: path.join(ROOT, 'tools/vendor/three/build/three.module.js'), contentType: 'text/javascript' });
    if (u.includes('/examples/jsm/')) return route.fulfill({ path: path.join(ROOT, 'tools/vendor/three/examples/jsm', u.split('/examples/jsm/')[1]), contentType: 'text/javascript' });
    if (u.startsWith('file:')) return route.continue();
    return route.abort();
  });
  const t0 = Date.now();
  await pg.goto('file://' + file + HASH[mode]);
  await pg.waitForFunction(() => document.getElementById('loading')?.hidden, null, { timeout: 180000 });
  const bootMs = Date.now() - t0;
  const boot = await pg.evaluate(() => Object.fromEntries(performance.getEntriesByType('mark').map((m) => [m.name, Math.round(m.startTime)])));
  if (args.split) await pg.evaluate(() => {
    // experiment: one material per program variant, so no material flips between variants mid-frame
    const scene = window.__lastcall.camera.parent, seen = new Map();
    scene.traverse((o) => {
      if (!o.material || Array.isArray(o.material)) return;
      const key = `${!!o.isInstancedMesh}${!!o.instanceColor}${!!o.isSkinnedMesh}${Object.keys(o.geometry.morphAttributes).join()}${o.geometry.morphAttributes.position?.length}`;
      let v = seen.get(o.material); if (!v) seen.set(o.material, v = new Map([[key, o.material]]));
      if (!v.has(key)) v.set(key, o.material.clone());
      o.material = v.get(key);
    });
  });
  await pg.waitForFunction(() => window.__lastcall?.D?.phase === 'playing', null, { timeout: 120000 });
  await pg.waitForTimeout(4000);

  const cdp = await ctx.newCDPSession(pg);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 2048, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  await cdp.send('Profiler.start');
  await pg.evaluate(() => { __perf.on = true; });
  await pg.waitForTimeout(SECS * 1000);
  await pg.evaluate(() => { __perf.on = false; });
  const { profile } = await cdp.send('Profiler.stop');
  const { profile: heap } = await cdp.send('HeapProfiler.getSamplingProfile');
  await cdp.send('HeapProfiler.stopSampling');
  const perf = await pg.evaluate(() => __perf);

  const inv = await pg.evaluate(() => {
    const { renderer: R, quality } = window.__lastcall, scene = R.info && window.__lastcall.camera.parent;
    const casters = [], tex = new Map(); let objects = 0, meshes = 0, visibleMeshes = 0, autoMatrix = 0, hiddenRoots = 0;
    scene.traverse((o) => {
      objects++; if (o.matrixAutoUpdate) autoMatrix++;
      if (!o.visible) hiddenRoots++;
      if (!o.isMesh && !o.isPoints) return;
      meshes++;
      let shown = true; for (let p = o; p; p = p.parent) if (!p.visible) { shown = false; break; }
      if (shown) visibleMeshes++;
      const tris = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
      if (o.castShadow && shown) casters.push(tris);
      for (const m of [].concat(o.material)) for (const k in m) { const t = m[k]; if (t?.isTexture && t.image) tex.set(t.uuid, t); }
    });
    let texBytes = 0; const sizes = {};
    for (const t of tex.values()) {
      const w = t.image.width || 0, h = t.image.height || 0, mip = t.generateMipmaps && t.minFilter !== 1006 && t.minFilter !== 1003 ? 4 / 3 : 1;
      texBytes += w * h * 4 * mip * (t.isCubeTexture ? 6 : 1); sizes[`${w}x${h}`] = (sizes[`${w}x${h}`] || 0) + 1;
    }
    const sh = window.__lastcall.renderer.shadowMap;
    return {
      rung: quality.rung, mode: quality.mode, programs: R.info.programs.length, geometries: R.info.memory.geometries, textures: R.info.memory.textures,
      objects, autoMatrix, meshes, visibleMeshes, hiddenRoots, shadowCasters: casters.length, shadowCasterTris: Math.round(casters.reduce((a, b) => a + b, 0)),
      shadowAutoUpdate: sh.autoUpdate, sceneTextures: tex.size, sceneTexMB: Math.round(texBytes / 1048576 * 10) / 10, texSizes: sizes,
      canvas: [R.domElement.width, R.domElement.height],
    };
  });

  // CPU: self time per module and per function, inclusive time per update function
  const byId = new Map(profile.nodes.map((n) => [n.id, n])), self = new Map();
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) || 0) + (profile.timeDeltas[i] || 0) / 1000));
  const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const modSelf = {}, fnSelf = {}, incl = {}, threeBy = {};
  for (const [id, ms] of self) {
    const n = byId.get(id), cf = n.callFrame;
    const mod = cf.url.includes('three.module') ? 'three' : cf.url.includes('/jsm/') ? 'three/addons' : cf.url.startsWith('file:') ? modOf[cf.lineNumber] : `(${cf.functionName || cf.url || 'native'})`;
    modSelf[mod] = (modSelf[mod] || 0) + ms;
    const fk = `${cf.functionName || '(anon)'} ${mod}`; fnSelf[fk] = (fnSelf[fk] || 0) + ms;
    if (mod === 'three') { let p = parent.get(id); while (p != null && !byId.get(p).callFrame.url.startsWith('file:')) p = parent.get(p); const k = `${cf.functionName}<${p != null ? byId.get(p).callFrame.functionName : '?'}`; threeBy[k] = (threeBy[k] || 0) + ms; }
    const seen = new Set();
    for (let p = id; p != null; p = parent.get(p)) {
      const f = byId.get(p).callFrame.functionName;
      if (UPDATES.includes(f) && byId.get(p).callFrame.url.startsWith('file:') && !seen.has(f)) { seen.add(f); incl[f] = (incl[f] || 0) + ms; }
    }
  }
  // allocations per function (sampled, including objects already collected)
  const alloc = {}; let allocBytes = 0;
  const walk = (n) => { const cf = n.callFrame; const mod = cf.url.includes('three.module') ? 'three' : cf.url.includes('/jsm/') ? 'addons' : cf.url.startsWith('file:') ? modOf[cf.lineNumber] : ''; const k = `${cf.functionName || '(anon)'} ${mod}`; alloc[k] = (alloc[k] || 0) + n.selfSize; allocBytes += n.selfSize; (n.children || []).forEach(walk); };
  walk(heap.head);

  const F = perf.frames, nf = F.length, top = (o, k = 14) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k).map(([a, b]) => [a, r2(b)]));
  results[mode] = {
    bootMs, boot, frames: nf, fps: r2(nf / SECS),
    frameMs: { mean: r2(mean(F.map((f) => f[0]))), p95: r2(pct(F.map((f) => f[0]), 0.95)) },
    stepMs: { mean: r2(mean(perf.steps)), p95: r2(pct(perf.steps, 0.95)) }, stepsPerFrame: r2(mean(F.map((f) => f[1]))),
    drawMs: { mean: r2(mean(F.map((f) => f[2]))), p95: r2(pct(F.map((f) => f[2]), 0.95)) },
    drawCalls: { mean: r2(mean(F.map((f) => f[3]))), max: Math.max(...F.map((f) => f[3])) }, triangles: Math.round(mean(F.map((f) => f[4]))),
    allocKBPerFrame: r2(allocBytes / 1024 / nf), allocKBPerStep: r2(allocBytes / 1024 / perf.steps.length),
    inclusiveMsPerFrame: Object.fromEntries(Object.entries(incl).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, r2(v / nf)])),
    selfMsPerFrameByModule: Object.fromEntries(Object.entries(top(modSelf, 16)).map(([k, v]) => [k, r2(v / nf)])),
    topSelfFns: Object.fromEntries(Object.entries(top(fnSelf, 16)).map(([k, v]) => [k, r2(v / nf)])),
    threeSelfByAppCaller: Object.fromEntries(Object.entries(top(threeBy, 14)).map(([k, v]) => [k, r2(v / nf)])),
    topAllocKBPerFrame: Object.fromEntries(Object.entries(top(alloc, 12)).map(([k, v]) => [k, r2(v / 1024 / nf)])),
    inventory: inv, errors,
  };
  console.log(mode, JSON.stringify(results[mode], null, 1));
  await ctx.close();
}
await browser.close();
if (args.out) writeFileSync(args.out, JSON.stringify(results, null, 1));
