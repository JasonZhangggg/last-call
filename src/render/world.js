// The tavern: room, bar, table, props and lighting. Exposes shared materials and the geometry kit
// that the character builder also uses.
import * as THREE from 'three';
import { scene, canvasTex } from './core.js';
import { woodCanvas, feltCanvas, softDot, roughnessFrom, damaskCanvas, rugCanvas, paintingsCanvas, nightCanvas, brassCanvases, normalCanvas, weaveHeight } from './textures.js';
import { rand, pick } from '../util.js';

export const mats = {};
export const world = { lights: [], haze: null, dust: null, lampPivot: null, spot: null };
export const TABLE = { radius: 1.06, feltRadius: 0.8 };

/* ---------- geometry kit ----------
   Static detail is authored as many primitives, then merged per material so it costs triangles,
   not draw calls. */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

/** Moves a geometry in place: position, Euler rotation (YXZ: tilt, then turn), scale (number or [x, y, z]). */
export function place(geo, p = [0, 0, 0], r = [0, 0, 0], s = 1) {
  _m.compose(_p.fromArray(p), _q.setFromEuler(_e.set(r[0], r[1], r[2], 'YXZ')), typeof s === 'number' ? _s.setScalar(s) : _s.fromArray(s));
  geo.applyMatrix4(_m);
  if (_m.determinant() < 0) {
    if (!geo.index) geo.setIndex([...Array(geo.attributes.position.count).keys()]);
    const ix = geo.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i]; ix[i] = ix[i + 2]; ix[i + 2] = t; }
  }
  return geo;
}

/** Box-projected UVs in metres, so wood grain keeps one scale across differently sized parts. */
export function worldUV(geo, scale = 1) {
  const P = geo.attributes.position, N = geo.attributes.normal, uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i++) {
    const nx = Math.abs(N.getX(i)), ny = Math.abs(N.getY(i)), nz = Math.abs(N.getZ(i));
    const [a, b] = nx >= ny && nx >= nz ? [P.getZ(i), P.getY(i)] : ny >= nz ? [P.getX(i), P.getZ(i)] : [P.getX(i), P.getY(i)];
    uv[i * 2] = a * scale; uv[i * 2 + 1] = b * scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

export function mergeGeometries(geos) {
  let nv = 0, ni = 0;
  for (const g of geos) { const n = g.attributes.position.count; nv += n; ni += g.index ? g.index.count : n; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of geos) {
    const P = g.attributes.position, n = P.count;
    pos.set(P.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.index) { const a = g.index.array; for (let k = 0; k < a.length; k++) idx[io + k] = a[k] + vo; io += a.length; }
    else { for (let k = 0; k < n; k++) idx[io + k] = vo + k; io += n; }
    vo += n; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/** Collects placed geometries per material; build() emits one mesh per material. */
export class Kit {
  constructor() { this.byMat = new Map(); }
  add(mat, ...geos) { let l = this.byMat.get(mat); if (!l) this.byMat.set(mat, l = []); l.push(...geos); return this; }
  build(parent, { cast = false, receive = false } = {}) {
    const out = [];
    for (const [mat, geos] of this.byMat) {
      const m = new THREE.Mesh(mergeGeometries(geos), mat); m.castShadow = cast; m.receiveShadow = receive; parent.add(m); out.push(m);
    }
    this.byMat.clear(); return out;
  }
}

/** One InstancedMesh from [position, rotation, scale] triples. */
function instanced(geo, mat, xforms, { cast = false, receive = false } = {}) {
  const im = new THREE.InstancedMesh(geo, mat, xforms.length);
  xforms.forEach(([p, r = [0, 0, 0], s = 1], i) => {
    _m.compose(_p.fromArray(p), _q.setFromEuler(_e.set(r[0], r[1], r[2], 'YXZ')), typeof s === 'number' ? _s.setScalar(s) : _s.fromArray(s));
    im.setMatrixAt(i, _m);
  });
  im.castShadow = cast; im.receiveShadow = receive; im.computeBoundingSphere(); scene.add(im); return im;
}

const box = (w, h, d, p, r, s) => place(new THREE.BoxGeometry(w, h, d), p, r, s);
const cyl = (rt, rb, h, seg, p, r, s) => place(new THREE.CylinderGeometry(rt, rb, h, seg), p, r, s);

/* ---------- room dimensions ---------- */
const FLOOR = -0.76, CEIL = 3.1, X0 = -4.6, X1 = 4.6, Z0 = -4.95, Z1 = 4.2, RAIL = 0.32;

export function buildWorld() {
  const brass = brassCanvases(256);
  mats.brassMap = canvasTex(brass.color); mats.brassRough = canvasTex(brass.rough, { srgb: false });
  mats.brass = new THREE.MeshStandardMaterial({ color: 0xd8a24e, map: mats.brassMap, metalnessMap: mats.brassRough, roughnessMap: mats.brassRough, metalness: 1, roughness: 1, envMapIntensity: 2 });
  mats.chair = new THREE.MeshStandardMaterial({ color: 0x5a3018, map: canvasTex(woodCanvas(256, { planks: 1, base: [150, 96, 60], dark: [70, 40, 22], seed: 31, seams: false }), { repeat: [1, 1] }), roughness: 0.55 });
  mats.pewter = new THREE.MeshStandardMaterial({ color: 0x9a948a, metalness: 0.85, roughness: 0.42 });
  mats.iron = new THREE.MeshStandardMaterial({ color: 0x2a2622, metalness: 0.8, roughness: 0.55 });
  mats.weaveNormal = canvasTex(normalCanvas(256, weaveHeight(64), 1.2), { srgb: false });
  mats.weaveNormal.wrapS = mats.weaveNormal.wrapT = THREE.RepeatWrapping;
  buildRoom();
  buildBar();
  buildDecor();
  buildLamp();
  buildTable();
  buildAtmosphere();
}

function woodMat(canvas, { repeat = [1, 1], rough = 0.7, color = 0xffffff, bump = 0.004 } = {}) {
  const map = canvasTex(canvas, { repeat });
  const rmap = canvasTex(roughnessFrom(canvas, rough - 0.2, Math.min(1, rough + 0.2)), { srgb: false, repeat });
  return new THREE.MeshStandardMaterial({ color, map, roughnessMap: rmap, bumpMap: rmap, bumpScale: bump, roughness: 1 });
}

function buildRoom() {
  const floorCanvas = woodCanvas(512, { planks: 8, base: [110, 66, 38], dark: [34, 18, 10], seed: 5 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Z1 - Z0), woodMat(floorCanvas, { repeat: [5, 5], rough: 0.65, bump: 0.6 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, FLOOR, (Z0 + Z1) / 2); floor.receiveShadow = true; scene.add(floor);

  const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 2.8), new THREE.MeshStandardMaterial({ map: canvasTex(rugCanvas(512, 384)), normalMap: mats.weaveNormal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.95 }));
  mats.weaveNormal.repeat.set(6, 6);
  rug.rotation.x = -Math.PI / 2; rug.position.set(0, FLOOR + 0.004, -0.15); rug.receiveShadow = true; scene.add(rug);

  // Panelled wainscot below a chair rail, damask above, a crown moulding at the top.
  const panelWood = woodMat(woodCanvas(256, { planks: 2, base: [88, 48, 26], dark: [30, 15, 8], seed: 11, vertical: true }), { rough: 0.6, bump: 0.3 });
  const wood = new Kit(), walls = [
    { len: X1 - X0, at: (u) => [u, Z0], ry: 0 },
    { len: Z1 - Z0, at: (u) => [X0, u + (Z0 + Z1) / 2], ry: Math.PI / 2 },
    { len: Z1 - Z0, at: (u) => [X1, u + (Z0 + Z1) / 2], ry: -Math.PI / 2 },
    { len: X1 - X0, at: (u) => [u, Z1], ry: Math.PI },
  ];
  const panels = [], paperGeos = [];
  for (const w of walls) {
    const [cx, cz] = w.at(0), n = [Math.sin(w.ry), 0, Math.cos(w.ry)];
    const off = (d) => [cx + n[0] * d, cz + n[2] * d];
    const seg = (y, h, d, depth) => { const [x, z] = off(d); return worldUV(box(w.len, h, depth, [x, y, z], [0, w.ry, 0]), 1.4); };
    wood.add(panelWood, seg((FLOOR + RAIL) / 2, RAIL - FLOOR, 0.01, 0.02), seg(FLOOR + 0.07, 0.14, 0.03, 0.04), seg(RAIL, 0.06, 0.04, 0.06), seg(RAIL + 0.05, 0.03, 0.03, 0.05), seg(CEIL - 0.08, 0.16, 0.04, 0.08));
    const count = Math.round(w.len / 0.9);
    for (let i = 0; i < count; i++) {
      const u = -w.len / 2 + (i + 0.5) * (w.len / count), [x, z] = w.at(u), [px, pz] = [x + n[0] * 0.03, z + n[2] * 0.03];
      panels.push([[px, (FLOOR + 0.16 + RAIL - 0.06) / 2, pz], [0, w.ry, 0], [w.len / count - 0.16, RAIL - FLOOR - 0.36, 1]]);
    }
    const [x, z] = off(0.02);
    const g = place(new THREE.PlaneGeometry(w.len, CEIL - RAIL - 0.1), [x, (CEIL + RAIL) / 2, z], [0, w.ry, 0]);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w.len / 0.9, uv.getY(i) * (CEIL - RAIL) / 0.9);
    paperGeos.push(g);
  }
  // A raised panel: bevelled slab, instanced around the room.
  const slab = new THREE.CylinderGeometry(0.62, 0.7071, 0.035, 4, 1); slab.rotateY(Math.PI / 4); slab.rotateX(Math.PI / 2);
  worldUV(slab, 1.6);
  instanced(slab, panelWood, panels, { receive: true });
  wood.build(scene, { receive: true });
  const paper = new THREE.MeshStandardMaterial({ map: canvasTex(damaskCanvas(256), { repeat: [1, 1] }), roughness: 0.85 });
  paper.map.wrapS = paper.map.wrapT = THREE.RepeatWrapping;
  scene.add(new THREE.Mesh(mergeGeometries(paperGeos), paper));

  // ceiling planks and beams
  const ceilMat = woodMat(woodCanvas(256, { planks: 6, base: [52, 30, 18], dark: [16, 9, 5], seed: 41 }), { repeat: [4, 4], rough: 0.85 });
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Z1 - Z0), ceilMat); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, CEIL, (Z0 + Z1) / 2); scene.add(ceil);
  const beamMat = woodMat(woodCanvas(256, { planks: 1, base: [70, 40, 22], dark: [22, 12, 6], seed: 44, seams: false }), { rough: 0.8, bump: 0.5 });
  const beam = worldUV(new THREE.BoxGeometry(0.24, 0.28, Z1 - Z0), 1.2);
  instanced(beam, beamMat, [-3.2, -1.6, 1.6, 3.2].map((x) => [[x, CEIL - 0.14, (Z0 + Z1) / 2]]));
  const cross = worldUV(new THREE.BoxGeometry(X1 - X0, 0.2, 0.18), 1.2);
  instanced(cross, beamMat, [-3.4, -0.6, 2.2].map((z) => [[0, CEIL - 0.34, z]]));
}

function buildBar() {
  const barWood = woodMat(woodCanvas(256, { planks: 3, base: [110, 58, 32], dark: [36, 17, 8], seed: 21 }), { rough: 0.5, bump: 0.3 });
  const k = new Kit();
  k.add(barWood, worldUV(box(4.2, 1.02, 0.6, [0, -0.25, -3.6]), 1.2), worldUV(box(4.4, 0.06, 0.72, [0, 0.3, -3.58]), 1.2), worldUV(box(4.25, 0.1, 0.64, [0, -0.71, -3.6]), 1.2));
  for (let i = 0; i < 6; i++) k.add(barWood, worldUV(box(0.56, 0.62, 0.03, [-1.75 + i * 0.7, -0.26, -3.29]), 1.2));
  for (let i = 0; i < 7; i++) k.add(barWood, worldUV(box(0.06, 0.95, 0.05, [-2.1 + i * 0.7, -0.25, -3.29]), 1.2));
  // back bar: shelves on brackets, a cabinet below
  const shelfY = [0.95, 1.45, 1.95];
  for (const y of shelfY) k.add(barWood, worldUV(box(3.6, 0.045, 0.32, [0, y, -4.77]), 1.2), worldUV(box(3.6, 0.05, 0.02, [0, y - 0.02, -4.61]), 1.2));
  for (const x of [-1.8, 0, 1.8]) k.add(barWood, worldUV(box(0.05, 1.2, 0.3, [x, 1.5, -4.77]), 1.2));
  k.add(barWood, worldUV(box(3.8, 0.9, 0.42, [0, -0.31, -4.72]), 1.2), worldUV(box(3.9, 0.05, 0.48, [0, 0.16, -4.7]), 1.2));
  k.build(scene, { receive: true });
  const top = new THREE.Mesh(box(4.45, 0.025, 0.74, [0, 0.345, -3.58]), new THREE.MeshStandardMaterial({ color: 0x2a140a, roughness: 0.18, metalness: 0.1 })); scene.add(top);
  const bk = new Kit();
  bk.add(mats.brass, place(new THREE.CylinderGeometry(0.022, 0.022, 4.2, 12), [0, -0.55, -3.12], [0, 0, Math.PI / 2]));
  for (const x of [-1.9, -0.6, 0.6, 1.9]) bk.add(mats.brass, cyl(0.012, 0.012, 0.3, 8, [x, -0.47, -3.2], [0.9, 0, 0]));
  bk.build(scene);

  // bottles on the shelves and the counter
  const prof = [[0, 0], [0.036, 0], [0.041, 0.012], [0.041, 0.16], [0.032, 0.2], [0.013, 0.235], [0.012, 0.29], [0.015, 0.3], [0, 0.3]].map(([x, y]) => new THREE.Vector2(x, y));
  const bottleMat = new THREE.MeshStandardMaterial({ roughness: 0.15, metalness: 0.2, envMapIntensity: 2.5 });
  const glass = [0x1f4a1c, 0x5a2d0c, 0x7a4a12, 0x24324a, 0x3a0f14, 0x6b6a52, 0x14301f];
  const spots = [];
  for (let i = 0; i < 48; i++) { const row = i % 3; spots.push([-1.7 + (Math.floor(i / 3) / 15) * 3.4 + rand(-0.04, 0.04), shelfY[row] + 0.023, -4.77 + rand(-0.07, 0.07), rand(0.85, 1.35)]); }
  for (const x of [-1.6, -1.45, 1.2]) spots.push([x, 0.36, -3.7 + rand(-0.1, 0.1), 1.1]);
  const bottles = instanced(new THREE.LatheGeometry(prof, 14), bottleMat, spots.map(([x, y, z, s]) => [[x, y, z], [0, rand(0, 6), 0], [s, s * rand(0.85, 1.2), s]]));
  const col = new THREE.Color(); spots.forEach((_, i) => bottles.setColorAt(i, col.setHex(pick(glass))));
  // tankards hung under the top shelf, glasses on the counter
  const gprof = [[0, 0], [0.03, 0], [0.032, 0.01], [0.026, 0.02], [0.035, 0.11], [0.033, 0.11], [0.024, 0.022], [0, 0.02]].map(([x, y]) => new THREE.Vector2(x, y));
  instanced(new THREE.LatheGeometry(gprof, 14), new THREE.MeshStandardMaterial({ color: 0x9aa89a, roughness: 0.08, metalness: 0.3, envMapIntensity: 3 }),
    [[0.7, 0.36, -3.55], [0.82, 0.36, -3.62], [0.95, 0.36, -3.5], [-0.2, 0.36, -3.66]].map((p) => [p]));
}

function buildDecor() {
  const k = new Kit();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x8a6a30, map: mats.brassMap, metalness: 0.75, roughness: 0.45 });
  const darkWood = mats.chair;

  // window on the left wall, with a sill, mullions and heavy curtains
  const WZ = -2.1, WY = 1.35, WW = 1.1, WH = 1.45, wx = X0 + 0.02;
  const night = new THREE.Mesh(new THREE.PlaneGeometry(WW, WH), new THREE.MeshBasicMaterial({ map: canvasTex(nightCanvas(256, 384)), color: 0x9fb0d8, fog: false }));
  night.position.set(wx + 0.01, WY, WZ); night.rotation.y = Math.PI / 2; scene.add(night);
  for (const s of [-1, 1]) k.add(darkWood, worldUV(box(0.12, WH + 0.2, 0.1, [wx + 0.04, WY, WZ + s * (WW / 2 + 0.05)]), 2));
  k.add(darkWood, worldUV(box(0.12, 0.1, WW + 0.2, [wx + 0.04, WY + WH / 2 + 0.05, WZ]), 2), worldUV(box(0.12, 0.06, WW + 0.2, [wx + 0.04, WY - WH / 2 - 0.03, WZ]), 2));
  k.add(darkWood, worldUV(box(0.24, 0.05, WW + 0.36, [wx + 0.1, WY - WH / 2 - 0.08, WZ]), 2));
  for (const z of [-WW / 6, WW / 6]) k.add(mats.iron, box(0.02, WH, 0.025, [wx + 0.03, WY, WZ + z]));
  for (const y of [-WH / 4, 0, WH / 4]) k.add(mats.iron, box(0.02, 0.025, WW, [wx + 0.03, WY + y, WZ]));
  const curtain = new THREE.MeshPhysicalMaterial({ color: 0x4a0f14, roughness: 0.8, sheen: 1, sheenColor: new THREE.Color(0xc04050), sheenRoughness: 0.5, normalMap: mats.weaveNormal, normalScale: new THREE.Vector2(0.3, 0.3), side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const g = new THREE.PlaneGeometry(0.42, CEIL - 0.35 - FLOOR, 24, 1), P = g.attributes.position;
    for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), gather = 0.6 + 0.4 * Math.abs(y + 0.2) / 2; P.setZ(i, Math.sin(x * 38) * 0.035); P.setX(i, x * gather); }
    g.computeVertexNormals();
    k.add(curtain, place(g, [wx + 0.09, (CEIL - 0.35 + FLOOR) / 2 + 0.02, WZ + s * (WW / 2 + 0.24)], [0, Math.PI / 2, 0]));
  }
  k.add(mats.brass, place(new THREE.CylinderGeometry(0.018, 0.018, WW + 1.1, 10), [wx + 0.12, CEIL - 0.32, WZ], [Math.PI / 2, 0, 0]));

  // framed paintings: one atlas, one merged mesh for all canvases
  const atlas = canvasTex(paintingsCanvas(1024, 320));
  const canvases = [];
  const hang = (slot, x, y, z, ry, w, h) => {
    const g = place(new THREE.PlaneGeometry(w, h), [x, y, z], [0, ry, 0]), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (slot + 0.04 + uv.getX(i) * 0.92) / 4);
    canvases.push(g);
    const n = [Math.sin(ry), Math.cos(ry)], back = (d) => [x - n[0] * d, z - n[1] * d];
    const [fx, fz] = back(0.02);
    for (const [dw, dh, ox, oy] of [[w + 0.16, 0.08, 0, h / 2 + 0.04], [w + 0.16, 0.08, 0, -h / 2 - 0.04], [0.08, h, -w / 2 - 0.04, 0], [0.08, h, w / 2 + 0.04, 0]]) {
      const ex = Math.cos(ry) * ox, ez = -Math.sin(ry) * ox;
      k.add(frameMat, box(dw, dh, 0.05, [fx + ex, y + oy, fz + ez], [0, ry, 0]));
    }
  };
  hang(1, X1 - 0.03, 1.25, -2.7, -Math.PI / 2, 0.85, 0.62);
  hang(3, X1 - 0.03, 1.2, -0.4, -Math.PI / 2, 0.5, 0.62);
  hang(0, X0 + 0.03, 1.3, 0.35, Math.PI / 2, 0.6, 0.75);
  hang(2, 2.95, 1.3, Z0 + 0.03, 0, 0.55, 0.62);
  scene.add(new THREE.Mesh(mergeGeometries(canvases), new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.4 })));

  // sign over the back bar
  const [sc, sctx] = (() => { const c = document.createElement('canvas'); c.width = 512; c.height = 96; return [c, c.getContext('2d')]; })();
  sctx.drawImage(woodCanvas(128, { planks: 1, base: [70, 36, 18], dark: [30, 14, 6], seed: 9, seams: false }), 0, 0, 512, 96);
  sctx.font = '700 54px Cinzel, Georgia, serif'; sctx.textAlign = 'center'; sctx.textBaseline = 'middle';
  sctx.fillStyle = 'rgba(0,0,0,0.6)'; sctx.fillText('THE LAST CALL', 258, 52);
  sctx.fillStyle = '#d6a64e'; sctx.fillText('THE LAST CALL', 256, 50);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.32, 0.04), [darkWood, darkWood, darkWood, darkWood, new THREE.MeshStandardMaterial({ map: canvasTex(sc), roughness: 0.6, metalness: 0.15 }), darkWood]);
  sign.position.set(0, 2.6, Z0 + 0.06); scene.add(sign);

  // barrels and stools, instanced
  const bprof = []; for (let i = 0; i <= 12; i++) { const t = i / 12; bprof.push(new THREE.Vector2(0.27 + Math.sin(t * Math.PI) * 0.045, t * 0.8)); }
  const barrelWood = woodMat(woodCanvas(256, { planks: 14, base: [112, 66, 34], dark: [40, 20, 10], seed: 61, vertical: true }), { rough: 0.7, bump: 0.6 });
  const barrelGeo = new THREE.LatheGeometry(bprof, 28);
  const lid = new THREE.CircleGeometry(0.272, 28); lid.rotateX(-Math.PI / 2); lid.translate(0, 0.79, 0);
  const barrel = mergeGeometries([barrelGeo, lid]);
  const hoops = mergeGeometries([0.08, 0.24, 0.56, 0.72].map((y) => { const r = 0.27 + Math.sin(y / 0.8 * Math.PI) * 0.045 + 0.004; return place(new THREE.CylinderGeometry(r, r, 0.035, 28, 1, true), [0, y, 0]); }));
  const barrelAt = [
    [[-3.9, FLOOR, -4.4], [0, 0.3, 0]], [[-3.3, FLOOR, -4.5], [0, 1.2, 0]], [[-3.62, FLOOR + 0.8, -4.45], [0, 2, 0], 0.95],
    [[3.95, FLOOR, -4.3], [0, 0.7, 0]], [[3.95, FLOOR, -3.6], [0, 2.1, 0], 0.92], [[-4.0, FLOOR, 1.1], [0, 0.4, 0]], [[3.9, FLOOR + 0.27, 1.4], [Math.PI / 2, 0, 0.4]],
  ];
  instanced(barrel, barrelWood, barrelAt);
  const hoopMat = mats.iron.clone(); hoopMat.side = THREE.DoubleSide;
  instanced(hoops, hoopMat, barrelAt);

  const sk = [];
  const seat = cyl(0.17, 0.16, 0.05, 20, [0, 0.72, 0]);
  sk.push(seat);
  for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; sk.push(cyl(0.02, 0.025, 0.72, 8, [Math.cos(a) * 0.12, 0.36, Math.sin(a) * 0.12], [Math.sin(a) * 0.16, 0, -Math.cos(a) * 0.16])); }
  sk.push(place(new THREE.TorusGeometry(0.13, 0.012, 6, 20), [0, 0.25, 0], [Math.PI / 2, 0, 0]));
  const stool = mergeGeometries(sk.map((g) => worldUV(g, 3)));
  instanced(stool, darkWood, [[[-1.55, FLOOR, -2.95], [0, 0.3, 0]], [[-0.5, FLOOR, -3.0], [0, 1.1, 0]], [[0.55, FLOOR, -2.92], [0, 2.3, 0]], [[1.6, FLOOR, -3.0], [0, 0.6, 0]], [[-3.0, FLOOR, -0.9], [0, 0.1, 0]], [[3.3, FLOOR, -1.6], [0, 0.9, 0]]]);

  // a plate rail of pewter and a keg tap on the right wall
  for (let i = 0; i < 5; i++) k.add(mats.pewter, place(new THREE.CylinderGeometry(0.13, 0.1, 0.02, 24), [X1 - 0.08, 2.15, -3.4 + i * 0.32], [0, 0, Math.PI / 2 - 0.25]));
  k.add(darkWood, worldUV(box(0.14, 0.04, 1.9, [X1 - 0.08, 2.04, -2.76]), 2));
  k.build(scene);
}

function buildLamp() {
  const pivot = new THREE.Group(); pivot.position.set(0, 2.9, 0); scene.add(pivot); world.lampPivot = pivot;
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1.05, 6), mats.iron);
  chain.position.y = -0.52; pivot.add(chain);
  const shadeMat = new THREE.MeshStandardMaterial({ color: 0x1f3a2a, metalness: 0.6, roughness: 0.32, side: THREE.DoubleSide });
  const sprof = [[0.335, -0.1], [0.33, -0.09], [0.31, -0.07], [0.22, 0.0], [0.12, 0.06], [0.075, 0.1], [0.03, 0.12]].map(([x, y]) => new THREE.Vector2(x, y));
  const shade = new THREE.Mesh(new THREE.LatheGeometry(sprof, 40), shadeMat); shade.position.y = -1.13; pivot.add(shade);
  const inner = new THREE.Mesh(new THREE.LatheGeometry(sprof.map((p) => new THREE.Vector2(p.x - 0.004, p.y - 0.004)), 40), new THREE.MeshStandardMaterial({ color: 0xffe7b8, emissive: 0xffc478, emissiveIntensity: 0.7, side: THREE.BackSide }));
  inner.position.y = -1.13; pivot.add(inner);
  const lk = new Kit();
  lk.add(mats.brass, cyl(0.035, 0.035, 0.05, 16, [0, -1.0, 0]), place(new THREE.TorusGeometry(0.334, 0.008, 6, 48), [0, -1.23, 0], [Math.PI / 2, 0, 0]), cyl(0.012, 0.012, 0.04, 8, [0, -0.96, 0]));
  lk.build(pivot);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 20, 14), new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffc070, emissiveIntensity: 6 }));
  bulb.position.y = -1.2; pivot.add(bulb);
  // the only shadow caster in the scene
  const spot = new THREE.SpotLight(0xffc486, 14, 6, 0.8, 0.55, 2);
  spot.position.y = -1.27; pivot.add(spot);
  spot.target.position.set(0, -2.9, 0); pivot.add(spot.target);
  spot.castShadow = true; spot.shadow.mapSize.set(2048, 2048); spot.shadow.bias = -0.0004; spot.shadow.normalBias = 0.015;
  spot.shadow.camera.near = 0.5; spot.shadow.camera.far = 4.5;
  world.spot = spot;
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(0xffb46a) }, uOpacity: { value: 0.07 } },
    vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ vY = uv.y; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.5); float a = pow(clamp(vY, 0.0, 1.0), 1.6) * f * uOpacity; gl_FragColor = vec4(uColor * a, a); }`,
  });
  world.beamMat = beamMat;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 1.35, 1.75, 40, 1, true), beamMat);
  beam.position.y = -1.23 - 0.875; pivot.add(beam);
}

/** Resizes the lamp's shadow map (quality ladder). */
export function setShadowSize(size) {
  const s = world.spot.shadow; if (s.mapSize.x === size) return;
  s.mapSize.set(size, size); if (s.map) { s.map.dispose(); s.map = null; }
}

function buildTable() {
  const g = new THREE.Group(); scene.add(g);
  const topCanvas = woodCanvas(512, { planks: 6, base: [128, 64, 34], dark: [48, 20, 10], seed: 3 });
  const topMat = new THREE.MeshStandardMaterial({ map: canvasTex(topCanvas), roughnessMap: canvasTex(roughnessFrom(topCanvas, 0.25, 0.55), { srgb: false }), roughness: 1, metalness: 0.02 });
  const sideMat = new THREE.MeshStandardMaterial({ map: canvasTex(woodCanvas(256, { planks: 2, base: [110, 54, 28], dark: [40, 18, 8], seed: 8 }), { repeat: [8, 1] }), roughness: 0.5 });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(TABLE.radius, 1.02, 0.07, 72), [sideMat, topMat, sideMat]);
  top.position.y = -0.035; top.receiveShadow = true; top.castShadow = true; g.add(top);
  const feltMap = canvasTex(feltCanvas(256), { repeat: [3, 3] });
  const felt = new THREE.Mesh(new THREE.CircleGeometry(TABLE.feltRadius, 72), new THREE.MeshPhysicalMaterial({ map: feltMap, roughness: 0.95, sheen: 0.6, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x4a8a66) }));
  felt.rotation.x = -Math.PI / 2; felt.position.y = 0.0015; felt.receiveShadow = true; g.add(felt);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(TABLE.feltRadius + 0.005, 0.008, 8, 96), mats.brass); ring.rotation.x = Math.PI / 2; ring.position.y = 0.003; g.add(ring);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(TABLE.radius, 0.04, 14, 96), new THREE.MeshStandardMaterial({ color: 0x3a1a0c, roughness: 0.28, metalness: 0.05 }));
  rim.rotation.x = Math.PI / 2; rim.position.y = -0.01; rim.castShadow = true; rim.receiveShadow = true; g.add(rim);
  const base = new Kit();
  const pprof = [[0.5, 0], [0.5, 0.04], [0.42, 0.07], [0.2, 0.1], [0.15, 0.16], [0.11, 0.3], [0.13, 0.36], [0.1, 0.42], [0.1, 0.6], [0.16, 0.66], [0.3, 0.7]].map(([x, y]) => new THREE.Vector2(x, y));
  base.add(sideMat, place(new THREE.LatheGeometry(pprof, 32), [0, -0.76, 0]));
  base.build(g);

  // candle: brass chamberstick, a dripping candle, a flame
  const ck = new Kit(), cx = -0.56, cz = -0.36;
  const dish = [[0, 0], [0.07, 0], [0.072, 0.006], [0.068, 0.012], [0.03, 0.014], [0.026, 0.03], [0.03, 0.034], [0, 0.034]].map(([x, y]) => new THREE.Vector2(x, y));
  ck.add(mats.brass, place(new THREE.LatheGeometry(dish, 24), [cx, 0, cz]), place(new THREE.TorusGeometry(0.018, 0.004, 6, 12), [cx + 0.078, 0.008, cz], [Math.PI / 2, 0, 0]));
  const waxMat = new THREE.MeshStandardMaterial({ color: 0xeee0c4, roughness: 0.5, emissive: 0x5a2e08, emissiveIntensity: 0.35 });
  ck.add(waxMat, cyl(0.02, 0.023, 0.11, 16, [cx, 0.089, cz]));
  for (const [a, l] of [[0.5, 0.05], [2.3, 0.07], [4.1, 0.035]]) ck.add(waxMat, place(new THREE.CapsuleGeometry(0.005, l, 3, 6), [cx + Math.cos(a) * 0.021, 0.14 - l / 2, cz + Math.sin(a) * 0.021]));
  ck.add(mats.iron, cyl(0.0015, 0.0015, 0.016, 4, [cx, 0.151, cz]));
  for (const m of ck.build(g)) m.castShadow = true;
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffc46a }));
  flame.geometry.translate(0, 0.6, 0); flame.scale.set(1, 2.2, 1); flame.position.set(cx, 0.15, cz); g.add(flame);
  const cl = new THREE.PointLight(0xff9a48, 0.45, 2.4, 2); cl.position.set(cx, 0.2, cz); g.add(cl);
  world.lights.push({ l: cl, f: flame, base: 0.45, seed: 7.3, candle: true });

  // pewter tankards, instanced: body with handle, and foam
  const mugProf = [[0, 0.002], [0.044, 0], [0.047, 0.008], [0.043, 0.02], [0.042, 0.1], [0.046, 0.108], [0.046, 0.114], [0.04, 0.114], [0.038, 0.06], [0, 0.06]].map(([x, y]) => new THREE.Vector2(x, y));
  const mug = mergeGeometries([new THREE.LatheGeometry(mugProf, 22), place(new THREE.TorusGeometry(0.032, 0.007, 8, 16, Math.PI), [0.045, 0.06, 0], [0, 0, -Math.PI / 2]), place(new THREE.CylinderGeometry(0.044, 0.044, 0.012, 22), [0, 0.02, 0])]);
  const foam = new THREE.CircleGeometry(0.039, 18); foam.rotateX(-Math.PI / 2); foam.translate(0, 0.1, 0);
  const mugAt = [[0.5, 0.62, 0.4], [-0.78, -0.05, 2.2], [0.3, -0.8, -1.2], [0.82, 0.25, -2.4]].map(([x, z, r]) => [[x, 0, z], [0, r, 0]]);
  instanced(mug, mats.pewter, mugAt, { cast: true });
  instanced(foam, new THREE.MeshStandardMaterial({ color: 0xe9dcc0, roughness: 0.9 }), mugAt);
}

function buildAtmosphere() {
  scene.add(new THREE.HemisphereLight(0x4a5470, 0x2a1408, 0.3));
  // moonlight through the window: cool, from the left and behind
  const moon = new THREE.DirectionalLight(0x8aa4e0, 1.1); moon.position.set(-4.5, 2.6, -2.6); scene.add(moon);
  // warm bounce from the right-hand sconce wall
  const kick = new THREE.DirectionalLight(0xff8a4a, 0.4); kick.position.set(4, 1.2, -1); scene.add(kick);
  // soft warm fill from the room behind the player, so faces read
  const fill = new THREE.DirectionalLight(0xffb27a, 0.32); fill.position.set(0.3, 1.4, 4); scene.add(fill);

  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb35a });
  const sk = new Kit();
  const chimney = new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xff9a40, emissiveIntensity: 0.5, roughness: 0.1, transparent: true, opacity: 0.35, depthWrite: false });
  const chimneys = [], halos = [], wax = new THREE.MeshStandardMaterial({ color: 0xeee0c4, roughness: 0.5, emissive: 0x5a2e08, emissiveIntensity: 0.6 });
  for (const [x, y, z, inten, ry] of [[0, 2.15, -4.88, 5.5, 0], [X0 + 0.07, 1.75, -0.7, 0, Math.PI / 2], [X1 - 0.07, 1.75, -1.55, 4.5, -Math.PI / 2]]) {
    const n = [Math.sin(ry), Math.cos(ry)], out = (d) => [x + n[0] * d, z + n[1] * d];
    const [lx, lz] = out(0.16);
    // The left sconce is decorative only: with the revolver's flash light the scene is at four point lights.
    const l = inten ? new THREE.PointLight(0xff9440, inten, 7.5, 2) : null;
    if (l) { l.position.set(lx, y + 0.08, lz); scene.add(l); }
    const [hx, hz] = out(0.025);
    halos.push(place(new THREE.PlaneGeometry(1.1, 1.1), [hx, y + 0.1, hz], [0, ry, 0]));
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.013, 10, 8), flameMat); f.geometry.translate(0, 0.6, 0); f.scale.set(1, 1.7, 1); f.position.set(lx, y + 0.06, lz); scene.add(f);
    const [bx, bz] = out(0.0), [mx, mz] = out(0.08);
    sk.add(mats.brass, place(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 20), [bx, y, bz], [Math.PI / 2, ry, 0], [1, 1, 1.6]));
    sk.add(mats.brass, place(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 8), [mx, y - 0.04, mz], [Math.PI / 2, ry, 0]));
    sk.add(mats.brass, place(new THREE.CylinderGeometry(0.045, 0.03, 0.025, 16), [lx, y - 0.04, lz]));
    sk.add(wax, place(new THREE.CylinderGeometry(0.014, 0.015, 0.08, 10), [lx, y + 0.012, lz]));
    chimneys.push(place(new THREE.LatheGeometry([[0.02, 0], [0.04, 0.03], [0.045, 0.08], [0.03, 0.15], [0.03, 0.18]].map(([a, b]) => new THREE.Vector2(a, b)), 16, 0, Math.PI * 2), [lx, y - 0.03, lz]));
    world.lights.push({ l, f, base: inten, seed: Math.random() * 100 });
  }
  sk.build(scene);
  scene.add(new THREE.Mesh(mergeGeometries(chimneys), chimney));
  scene.add(new THREE.Mesh(mergeGeometries(halos), new THREE.MeshBasicMaterial({ map: canvasTex(softDot(), { srgb: false }), color: 0x6a3a14, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));

  // moonbeam through the window and its patch on the floor
  const moonMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uColor: { value: new THREE.Color(0x7d98d8) }, uOpacity: { value: 0.05 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv;
      void main(){ float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x); float a = edge * pow(vUv.y, 1.3) * uOpacity; gl_FragColor = vec4(uColor * a, a); }`,
  });
  const shaft = [];
  for (const r of [0, Math.PI / 2]) shaft.push(place(new THREE.PlaneGeometry(1.0, 2.9), [0, 0, 0], [0, r, 0]));
  const sh = new THREE.Mesh(mergeGeometries(shaft), moonMat);
  sh.position.set(X0 + 1.25, 0.4, -1.95); sh.rotation.set(0.1, 0, 0.92); scene.add(sh);
  const patch = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.5), new THREE.MeshBasicMaterial({ map: canvasTex(softDot(), { srgb: false }), color: 0x3a4a6a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  patch.rotation.x = -Math.PI / 2; patch.position.set(X0 + 2.3, FLOOR + 0.006, -2.0); scene.add(patch);

  // haze: camera-facing billboards drifting in the vertex shader, one draw call
  const N = 10, hazeGeo = new THREE.PlaneGeometry(1, 1);
  const hazeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x8d6a4e) }, uOpacity: { value: 0.07 } },
    vertexShader: `uniform float uTime; varying vec2 vUv;
      void main(){ vUv = uv; vec3 c = instanceMatrix[3].xyz; float s = length(instanceMatrix[0].xyz);
        c.x += sin(uTime * 0.05 + c.z * 3.1) * 0.4; c.y += sin(uTime * 0.07 + c.x * 2.3) * 0.12;
        vec4 mv = modelViewMatrix * vec4(c, 1.0); mv.xy += position.xy * s; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv;
      void main(){ float d = length(vUv - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - d), 2.0) * uOpacity; gl_FragColor = vec4(uColor, a); }`,
  });
  const hz = [];
  for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2; hz.push([[Math.cos(a) * rand(1.2, 2.8), rand(0.7, 2.1), Math.sin(a) * rand(1.2, 2.6) - 0.6], [0, 0, 0], rand(1.8, 3.4)]); }
  const haze = instanced(hazeGeo, hazeMat, hz); haze.frustumCulled = false; haze.renderOrder = 2;
  world.haze = hazeMat;

  const DN = 260, pos = new Float32Array(DN * 3), seeds = new Float32Array(DN * 3);
  for (let i = 0; i < DN; i++) { const r = Math.sqrt(Math.random()) * 1.15, a = Math.random() * Math.PI * 2; seeds[i * 3] = Math.cos(a) * r; seeds[i * 3 + 1] = Math.random() * 1.6 + 0.05; seeds[i * 3 + 2] = Math.sin(a) * r; }
  pos.set(seeds);
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(dg, new THREE.PointsMaterial({ map: canvasTex(softDot(), { srgb: false }), color: 0xffd7a0, size: 0.014, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
  world.dust = { obj: dust, seeds, pos, N: DN }; scene.add(dust);
}

export function updateWorld(dt, t) {
  world.lampPivot.rotation.z = Math.sin(t * 0.55) * 0.022;
  world.lampPivot.rotation.x = Math.sin(t * 0.41 + 1) * 0.016;
  for (const L of world.lights) {
    const n = Math.sin(t * 13 + L.seed) * 0.5 + Math.sin(t * 23.7 + L.seed * 2) * 0.3 + Math.sin(t * 5.3 + L.seed) * 0.4;
    if (L.l) L.l.intensity = L.base * (1 + n * (L.candle ? 0.12 : 0.07));
    L.f.scale.y = (L.candle ? 2.2 : 1.7) * (1 + n * 0.08);
  }
  world.haze.uniforms.uTime.value = t;
  const D = world.dust, s = D.seeds;
  for (let i = 0; i < D.N; i++) {
    const j = i * 3;
    D.pos[j] = s[j] + Math.sin(t * 0.13 + i) * 0.06;
    D.pos[j + 1] = ((s[j + 1] + t * 0.012 * (1 + (i % 5) * 0.2)) % 1.7) + 0.02;
    D.pos[j + 2] = s[j + 2] + Math.cos(t * 0.11 + i * 1.3) * 0.06;
  }
  D.obj.geometry.attributes.position.needsUpdate = true;
}
