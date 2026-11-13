// The dice table: a leather cup and five dice per seat, and a tray of six glasses per seat, one of
// them poisoned. Every piece is an instance whose transform comes from a proxy Object3D that a
// Mover flies, so the whole set costs a handful of draw calls. Seats are addressed by view
// (0 is you, 1..3 the characters left to right), like cards.js.
import * as THREE from 'three';
import { scene, canvasTex } from './core.js';
import { mats, place, mergeGeometries } from './world.js';
import { Mover } from './motion.js';
import { fbm, vnoise, softDot } from './textures.js';
import { quatE } from '../util.js';

export const DIE = 0.032;
export const PER_SEAT = 5, GLASSES = 6;
const CUP_R = 0.076, CUP_H = 0.132;
const GLASS_H = 0.056, LIQUID_TOP = 0.044;
// [distance from the table centre, offset to the owner's right] per view
const CUP_AT = [[0.5, -0.1], [0.62, -0.06], [0.6, -0.04], [0.62, -0.06]];
const TRAY_AT = [[0.64, 0.3], [0.9, 0.25], [0.9, 0.25], [0.9, 0.25]];
const RING = 0.038;

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3();
const _c = new THREE.Color(), _e = new THREE.Euler();
const ZERO_SCALE = new THREE.Vector3(0, 0, 0), ONE = new THREE.Vector3(1, 1, 1), AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0);

export const table = {
  group: null, built: false,
  spots: [], // per view: { at, yaw, right, out, tray, trayQuat }
  cups: [], dice: [], glasses: [], empty: [false, false, false, false], // empty: a view whose seat sits the game out
  held: null, heldLiquid: null, heldMover: null,
  meshes: {},
};

/* ---------- textures ---------- */
const mk = (w, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };

// Pip layouts on a 3x3 grid, in tile units from the centre.
const PIPS = {
  1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};
export const pipLayout = (face) => PIPS[face];
const TILE = 128;
/** Six bone-white faces in a 3x2 atlas. The one is a larger red pip, since ones are wild. */
function pipAtlas() {
  const [c, ctx] = mk(TILE * 3, TILE * 2), img = ctx.createImageData(TILE * 3, TILE * 2), d = img.data;
  for (let y = 0; y < TILE * 2; y++) for (let x = 0; x < TILE * 3; x++) {
    const n = fbm(x / 40, y / 40, 9.6, 6.4) - 0.5, grain = vnoise(x * 0.6, y * 0.08, 230, 20) - 0.5;
    const k = 0.95 + n * 0.08 + grain * 0.03, i = (y * TILE * 3 + x) * 4;
    d[i] = 236 * k; d[i + 1] = 226 * k; d[i + 2] = 200 * k; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  for (let f = 1; f <= 6; f++) {
    const ox = ((f - 1) % 3) * TILE, oy = Math.floor((f - 1) / 3) * TILE, cx = ox + TILE / 2, cy = oy + TILE / 2;
    const one = f === 1, r = one ? 19 : 12.5, step = 34;
    for (const [gx, gy] of PIPS[f]) {
      const px = cx + gx * step, py = cy + gy * step;
      const g = ctx.createRadialGradient(px - r * 0.25, py - r * 0.3, r * 0.1, px, py, r);
      if (one) { g.addColorStop(0, '#8e1d14'); g.addColorStop(0.75, '#6a120c'); g.addColorStop(1, '#3a0805'); }
      else { g.addColorStop(0, '#3a2a20'); g.addColorStop(0.75, '#1c120c'); g.addColorStop(1, '#0c0705'); }
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,250,235,0.35)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px, py, r + 1, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
    }
    if (one) { ctx.strokeStyle = 'rgba(150,40,26,0.55)'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.stroke(); }
  }
  return c;
}

function leatherCanvas(w = 256, h = 128) {
  const [c, ctx] = mk(w, h), img = ctx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h;
    const n = fbm(u * 8, v * 4, 8, 4), pore = vnoise(u * 120, v * 60, 120, 60);
    const crease = Math.pow(1 - Math.abs(vnoise(u * 18, v * 9, 18, 9) * 2 - 1), 8) * 0.25;
    const k = 0.62 + n * 0.55 - crease - (pore > 0.82 ? 0.08 : 0), i = (y * w + x) * 4;
    d[i] = 92 * k; d[i + 1] = 40 * k; d[i + 2] = 24 * k; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // a stitched seam down one side and tooled lines under each band
  ctx.strokeStyle = 'rgba(214,176,120,0.75)'; ctx.lineWidth = 2;
  for (let y = 6; y < h - 4; y += 9) { ctx.beginPath(); ctx.moveTo(w * 0.5 - 3, y); ctx.lineTo(w * 0.5 + 3, y + 5); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(20,6,2,0.55)'; ctx.lineWidth = 1.5;
  for (const y of [h * 0.14, h * 0.2, h * 0.8, h * 0.86]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  return c;
}

/* ---------- geometry ---------- */

/** A die with rounded edges: a subdivided box whose vertices are pushed onto a rounded shell. */
function dieGeometry(size = DIE, round = 0.0048) {
  const g = new THREE.BoxGeometry(1, 1, 1, 10, 10, 10), P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv;
  const h = size / 2, inner = h - round;
  // grid steps 0..5 from the centre, bunched toward the edge so the rounding gets most of them
  const STEPS = [0, inner * 0.5, inner, h - round * 0.62, h - round * 0.26, h];
  const remap = (c) => Math.sign(c) * STEPS[Math.round(Math.abs(c) * 10)];
  const p = new THREE.Vector3(), k = new THREE.Vector3(), n = new THREE.Vector3();
  // atlas tile per BoxGeometry face group (px, nx, py, ny, pz, nz) holds faces 2, 5, 1, 6, 3, 4
  const tileOf = [2, 5, 1, 6, 3, 4].map((f) => [(f - 1) % 3, Math.floor((f - 1) / 3)]);
  const axes = [[(v) => -v.z, (v) => v.y], [(v) => v.z, (v) => v.y], [(v) => v.x, (v) => -v.z], [(v) => v.x, (v) => v.z], [(v) => v.x, (v) => v.y], [(v) => -v.x, (v) => v.y]];
  // BoxGeometry lays its faces out one after another, (10 + 1)^2 vertices each
  for (let i = 0; i < P.count; i++) {
    const fi = Math.floor(i / 121), [col, row] = tileOf[fi], [ua, va] = axes[fi];
    p.set(remap(P.getX(i)), remap(P.getY(i)), remap(P.getZ(i)));
    k.set(Math.max(-inner, Math.min(inner, p.x)), Math.max(-inner, Math.min(inner, p.y)), Math.max(-inner, Math.min(inner, p.z)));
    n.subVectors(p, k).normalize();
    P.setXYZ(i, k.x + n.x * round, k.y + n.y * round, k.z + n.z * round);
    N.setXYZ(i, n.x, n.y, n.z);
    const uu = ua(p) / size + 0.5, vv = va(p) / size + 0.5;
    UV.setXY(i, (col + uu) / 3, 1 - (row + 1) / 2 + vv / 2);
  }
  g.clearGroups();
  return g;
}

/** Turns face `f` to the top. Opposite faces sum to seven: +y 1, +x 2, +z 3, -z 4, -x 5, -y 6. */
const FACE_UP = [null, [0, 0, 0], [0, 0, Math.PI / 2], [-Math.PI / 2, 0, 0], [Math.PI / 2, 0, 0], [0, 0, -Math.PI / 2], [Math.PI, 0, 0]]
  .map((r) => r && new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], 'XYZ')));

function cupGeometry() {
  const r = CUP_R, h = CUP_H, w = 0.0055;
  const prof = [[0, h - 0.009], [r * 0.85 - w, h - 0.009], [r - w, 0.006], [r - w * 0.4, 0], [r + 0.0015, 0], [r + 0.001, 0.012], [r * 0.87, h - 0.005], [r * 0.85, h], [0, h + 0.003]];
  // profile runs inside first, so reverse it: LatheGeometry faces point out for a profile drawn bottom to top on the outside
  const pts = prof.reverse().map(([x, y]) => new THREE.Vector2(x, y));
  const leather = new THREE.LatheGeometry(pts, 36);
  const brass = mergeGeometries([
    place(new THREE.TorusGeometry(r + 0.0012, 0.0042, 8, 40), [0, 0.009, 0], [Math.PI / 2, 0, 0]),
    place(new THREE.TorusGeometry(r * 0.864, 0.0036, 8, 40), [0, h - 0.012, 0], [Math.PI / 2, 0, 0]),
    place(new THREE.CylinderGeometry(0.012, 0.014, 0.004, 16), [0, h + 0.004, 0]),
  ]);
  return { leather, brass };
}

function glassGeometry() {
  const prof = [[0, 0.011], [0.0158, 0.011], [0.0186, GLASS_H - 0.002], [0.0196, GLASS_H], [0.0214, GLASS_H], [0.0218, GLASS_H - 0.003], [0.0192, 0.004], [0.0178, 0], [0, 0]];
  const glass = new THREE.LatheGeometry(prof.reverse().map(([x, y]) => new THREE.Vector2(x, y)), 20);
  const liquid = new THREE.CylinderGeometry(0.0172, 0.0156, LIQUID_TOP - 0.012, 18).translate(0, (LIQUID_TOP + 0.012) / 2, 0);
  return { glass, liquid };
}

function trayGeometry() {
  const wood = [], brass = [];
  wood.push(place(new THREE.BoxGeometry(0.185, 0.012, 0.125), [0, 0.006, 0]));
  for (const z of [-0.0625, 0.0625]) brass.push(place(new THREE.BoxGeometry(0.189, 0.016, 0.004), [0, 0.008, z]));
  for (const x of [-0.0925, 0.0925]) brass.push(place(new THREE.BoxGeometry(0.004, 0.016, 0.129), [x, 0.008, 0]));
  return { wood: mergeGeometries(wood), brass: mergeGeometries(brass) };
}

/* ---------- build ---------- */
function instancedMesh(geo, mat, count, { cast = false, receive = false, color = false } = {}) {
  const im = new THREE.InstancedMesh(geo, mat, count);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.castShadow = cast; im.receiveShadow = receive; im.frustumCulled = false;
  if (color) for (let i = 0; i < count; i++) im.setColorAt(i, _c.setRGB(1, 1, 1));
  table.group.add(im);
  return im;
}

export function buildDiceTable() {
  const g = table.group = new THREE.Group(); g.visible = false; scene.add(g);
  const atlas = canvasTex(pipAtlas());
  const dieMat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.32, metalness: 0, emissiveMap: atlas, emissive: 0xffffff, emissiveIntensity: 0.1 });
  const leatherTex = canvasTex(leatherCanvas()), leatherBump = canvasTex(leatherCanvas(), { srgb: false });
  const leather = new THREE.MeshStandardMaterial({ map: leatherTex, bumpMap: leatherBump, bumpScale: 0.6, roughness: 0.62, color: 0xffffff });
  const cup = cupGeometry(), gl = glassGeometry(), tray = trayGeometry();
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xcfe2e4, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.32, envMapIntensity: 4, depthWrite: false });
  const liquidMat = new THREE.MeshStandardMaterial({ color: 0xa35a14, roughness: 0.1, emissive: 0x52240a, emissiveIntensity: 0.5, transparent: true, opacity: 0.88 });
  const trayWood = new THREE.MeshStandardMaterial({ color: 0x3c1e0e, roughness: 0.45 });
  const haloMat = new THREE.MeshBasicMaterial({ map: canvasTex(softDot(), { srgb: false }), color: 0xffb648, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });

  const M = table.meshes;
  M.dice = instancedMesh(dieGeometry(), dieMat, PER_SEAT * 4, { cast: true, receive: true, color: true });
  M.halo = instancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), haloMat, PER_SEAT * 4);
  M.halo.renderOrder = 1;
  M.cup = instancedMesh(cup.leather, leather, 4, { cast: true, receive: true });
  // instanced copies of shared materials: three rebuilds a material's program state each time it
  // alternates between instanced and plain meshes
  const brass = mats.brass.clone();
  M.cupBrass = instancedMesh(cup.brass, brass, 4, { cast: true });
  M.trayWood = instancedMesh(tray.wood, trayWood, 4, { receive: true, cast: true });
  M.trayBrass = instancedMesh(tray.brass, brass, 4);
  M.liquid = instancedMesh(gl.liquid, liquidMat, GLASSES * 4);
  M.glass = instancedMesh(gl.glass, glassMat, GLASSES * 4);
  M.liquid.renderOrder = 2; M.glass.renderOrder = 3;

  const held = table.held = new THREE.Group();
  const heldLiquid = table.heldLiquid = new THREE.Mesh(gl.liquid, liquidMat.clone());
  const heldGlass = new THREE.Mesh(gl.glass, glassMat.clone());
  heldLiquid.renderOrder = 2; heldGlass.renderOrder = 3;
  held.add(heldLiquid, heldGlass); held.visible = false; g.add(held);
  table.heldMover = new Mover(held, g); table.heldMover.smooth = table.heldMover.rotSmooth = 0.06;

  const proxy = () => { const o = new THREE.Object3D(); g.add(o); return o; };
  for (let v = 0; v < 4; v++) {
    const c = proxy();
    table.cups.push({ obj: c, mover: new Mover(c, g), shake: 0, shakeTarget: 0, hidden: false });
    const list = [];
    for (let i = 0; i < PER_SEAT; i++) {
      const o = proxy();
      list.push({ obj: o, mover: new Mover(o, g), face: 1, yaw: 0, shown: true, glow: 0, glowTarget: 0, tint: new THREE.Color(1, 1, 1), tintTarget: new THREE.Color(1, 1, 1) });
    }
    table.dice.push(list);
    table.glasses.push(Array.from({ length: GLASSES }, () => ({ state: 'full', pos: new THREE.Vector3(), quat: new THREE.Quaternion() })));
  }
  table.built = true;
}

/** Per-view frames on the felt from each seat's angle around the table (radians, as cos/sin of x/z). */
/** A seat nobody plays this game: no cup and no tray of glasses in front of its chair. */
export function setSeatEmpty(v, empty) {
  if (table.empty[v] === empty) return;
  table.empty[v] = empty; table.cups[v].hidden = empty;
  writeTray(v); writeGlasses(v);
}
function writeTray(v) {
  const M = table.meshes, s = table.spots[v];
  _m.compose(s.tray, s.quat, table.empty[v] ? ZERO_SCALE : ONE);
  M.trayWood.setMatrixAt(v, _m); M.trayBrass.setMatrixAt(v, _m);
  M.trayWood.instanceMatrix.needsUpdate = true; M.trayBrass.instanceMatrix.needsUpdate = true;
}

export function layoutSeats(angles) {
  table.spots = angles.map((a, v) => {
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), right = new THREE.Vector3(out.z, 0, -out.x);
    const yaw = Math.atan2(out.x, out.z);
    const [cr, cl] = CUP_AT[v], [tr, tl] = TRAY_AT[v];
    const at = out.clone().multiplyScalar(cr).addScaledVector(right, cl);
    const tray = out.clone().multiplyScalar(tr).addScaledVector(right, tl);
    return { at, yaw, right, out, tray, quat: quatE(0, yaw, 0) };
  });
  const M = table.meshes;
  for (let v = 0; v < 4; v++) {
    const s = table.spots[v];
    writeTray(v);
    table.glasses[v].forEach((gl, i) => {
      const lx = ((i % 3) - 1) * 0.056, lz = (Math.floor(i / 3) - 0.5) * 0.056;
      gl.pos.set(lx, 0.012, lz).applyQuaternion(s.quat).add(s.tray);
    });
    setGlasses(v, 0);
  }
  M.trayWood.instanceMatrix.needsUpdate = true; M.trayBrass.instanceMatrix.needsUpdate = true;
}

export const showDiceTable = (on) => { table.group.visible = on; };

/* ---------- poses ---------- */
const local = (v, x, y, z, out) => out.set(x, y, z).applyQuaternion(table.spots[v].quat).add(table.spots[v].at);

/** The cup over its dice, a little tilted peek toward its owner, lifted off and set mouth-up aside, or up in the owner's hand. */
export function cupPose(v, kind, pos, quat) {
  const s = table.spots[v];
  if (kind === 'rest') { pos.copy(s.at); quat.copy(s.quat); }
  else if (kind === 'peek' || kind === 'glance') {
    // tipped back on its far rim, so the mouth turns toward its owner
    const a = kind === 'peek' ? 1.05 : 0.5;
    local(v, 0, CUP_R * Math.sin(a) + 0.002, -CUP_R + CUP_R * Math.cos(a), pos);
    quat.copy(s.quat).multiply(_q.setFromAxisAngle(AX, -a));
  }
  else if (kind === 'off') { local(v, -0.15, CUP_H + 0.003, 0.02, pos); quat.copy(s.quat).multiply(_q.setFromAxisAngle(AX, Math.PI)); }
  else if (kind === 'air') { local(v, 0.0, v === 0 ? 0.13 : 0.16, v === 0 ? 0.0 : 0.17, pos); quat.copy(s.quat); }
  return pos;
}
export function cupTo(v, kind, opts = { dur: 0.45 }) {
  const c = table.cups[v];
  cupPose(v, kind, _p, _q2);
  c.mover.go(table.group, _p, _q2, 1, opts);
  return c.mover;
}
export function cupSnap(v, kind) { const c = table.cups[v]; cupPose(v, kind, _p, _q2); c.mover.snap(table.group, _p, _q2, 1); }
export const cupWorld = (v, out) => table.cups[v].obj.getWorldPosition(out);
export const CUP_TOP = CUP_H;
/** Hands the cup to `parent` (a hand) where it stands, so it rides along from here. */
export function cupToHand(v, parent) {
  const o = table.cups[v].obj;
  o.updateWorldMatrix(true, false); parent.updateWorldMatrix(true, false);
  o.matrixWorld.decompose(_p, _q2, _s);
  parent.worldToLocal(_p);
  parent.matrixWorld.decompose(_s, _q, _s);
  _q.invert().multiply(_q2);
  table.cups[v].mover.go(parent, _p, _q, 1, { dur: 0.1 });
}
export function setShake(v, on) { table.cups[v].shakeTarget = on ? 1 : 0; }
export function setCupHidden(v, hidden) { table.cups[v].hidden = hidden; }

/** Where die i of view v rests in its cluster, showing `face` on top. */
export function diePose(v, i, face, yaw, pos, quat) {
  const a = (i / PER_SEAT) * Math.PI * 2 + 0.6;
  local(v, Math.cos(a) * RING, DIE / 2, Math.sin(a) * RING, pos);
  quat.copy(table.spots[v].quat).multiply(_q.setFromAxisAngle(AY, yaw)).multiply(FACE_UP[face]);
  return pos;
}
/** Sets each die's face and lays the cluster down at once (hidden ones disappear). `faces` may hold nulls for unknown dice. */
export function setDice(v, count, faces, { fly = false, dur = 0.5 } = {}) {
  table.dice[v].forEach((d, i) => {
    d.shown = i < count;
    if (faces) d.face = faces[i] || 1 + ((i * 7 + v * 3) % 6);
    d.yaw = Math.random() * 1.2 - 0.6;
    d.glowTarget = 0; d.tintTarget.setRGB(1, 1, 1);
    diePose(v, i, d.face, d.yaw, _p, _q2);
    if (fly) d.mover.go(table.group, _p, _q2, 1, { dur, arc: 0.04, delay: i * 0.03 });
    else d.mover.snap(table.group, _p, _q2, 1);
  });
}
/** Jostles each die in place while its cup shakes, so a lifted cup never shows them frozen. */
export function rerollFaces(v, faces) {
  table.dice[v].forEach((d, i) => { if (faces) d.face = faces[i] || d.face; d.yaw = Math.random() * 1.2 - 0.6; diePose(v, i, d.face, d.yaw, _p, _q2); d.mover.snap(table.group, _p, _q2, 1); });
}

/** Counted dice sit this much larger than in play, so a zoomed view of the line reads at a glance. */
export const ROW_SCALE = 1.5;
// tipped far enough toward you that the lamp overhead glints off the face into the felt, not into your eye
const ROW_DIE = DIE * ROW_SCALE, ROW_TILT = 0.9, ROW_GAP = ROW_DIE * 1.3, ROW_STEP = ROW_DIE * 2.6, ROW_Z = 0.07;
const rowShape = (n, perRow) => { const per = Math.max(1, Math.min(n, perRow)); return [per, Math.ceil(n / per)]; };
/** The count line in front of you: slot k of n in rows of `perRow`, each face tilted up to the camera. */
export function rowPose(k, n, face, pos, quat, perRow = 10) {
  const [per, rows] = rowShape(n, perRow), row = Math.floor(k / per), col = k % per;
  const inRow = row < rows - 1 ? per : n - row * per;
  pos.set((col - (inRow - 1) / 2) * ROW_GAP, ROW_DIE / 2 * (Math.cos(ROW_TILT) + Math.sin(ROW_TILT)) + 0.001, ROW_Z + row * ROW_STEP);
  quat.setFromAxisAngle(AX, ROW_TILT).multiply(FACE_UP[face]);
  return pos;
}
/** The middle of the count line and its half width, for framing it. */
export function rowFrame(n, perRow, out) {
  const [per, rows] = rowShape(Math.max(1, n), perRow);
  out.set(0, ROW_DIE / 2, ROW_Z + (rows - 1) * ROW_STEP / 2);
  return { halfWidth: (per - 1) * ROW_GAP / 2 + ROW_DIE / 2, halfDepth: (rows - 1) * ROW_STEP / 2 + ROW_DIE / 2 };
}
export function dieTo(v, i, pos, quat, opts, scale = 1) { return table.dice[v][i].mover.go(table.group, pos, quat, scale, opts); }
export function dieGlow(v, i, glow, tint) { const d = table.dice[v][i]; d.glowTarget = glow; if (tint) d.tintTarget.copy(tint); }
export const dieFace = (v, i) => table.dice[v][i].face;

/** Tray state: the first `drunk` glasses are empty and upturned, the rest full. */
export function setGlasses(v, drunk, { gone = -1 } = {}) {
  table.glasses[v].forEach((gl, i) => { gl.state = i === gone ? 'gone' : i < drunk ? 'empty' : 'full'; });
  writeGlasses(v);
}
export function setGlassState(v, i, state) { table.glasses[v][i].state = state; writeGlasses(v); }
export const glassWorld = (v, i, out) => out.copy(table.glasses[v][i].pos);

function writeGlasses(v) {
  const M = table.meshes, s = table.spots[v];
  table.glasses[v].forEach((gl, i) => {
    const idx = v * GLASSES + i;
    if (gl.state === 'gone' || table.empty[v]) { _m.compose(gl.pos, s.quat, ZERO_SCALE); M.glass.setMatrixAt(idx, _m); M.liquid.setMatrixAt(idx, _m); return; }
    if (gl.state === 'spilled') {
      spillPose(v, _s, _q); _m.compose(_s, _q, ONE); M.glass.setMatrixAt(idx, _m);
      _m.compose(gl.pos, s.quat, ZERO_SCALE); M.liquid.setMatrixAt(idx, _m);
      return;
    }
    if (gl.state === 'empty') {
      _q.copy(s.quat).multiply(_q2.setFromAxisAngle(AX, Math.PI));
      _m.compose(_s.copy(gl.pos).setY(gl.pos.y + GLASS_H), _q, ONE); M.glass.setMatrixAt(idx, _m);
      _m.compose(gl.pos, s.quat, ZERO_SCALE); M.liquid.setMatrixAt(idx, _m);
      return;
    }
    _m.compose(gl.pos, s.quat, ONE); M.glass.setMatrixAt(idx, _m); M.liquid.setMatrixAt(idx, _m);
  });
  M.glass.instanceMatrix.needsUpdate = true; M.liquid.instanceMatrix.needsUpdate = true;
}

/* ---------- the glass in a hand ---------- */
/** Lifts glass i of view v out of its tray into `parent` at a local pose. */
export function takeGlass(v, i, parent, pos, quat, dur = 0.3) {
  const gl = table.glasses[v][i], h = table.held, mv = table.heldMover;
  h.visible = true; table.heldLiquid.visible = true; table.heldLiquid.scale.y = 1;
  table.heldLiquid.material.color.copy(table.meshes.liquid.material.color);
  table.heldLiquid.material.emissive.copy(table.meshes.liquid.material.emissive);
  mv.snap(table.group, gl.pos, table.spots[v].quat, 1);
  setGlassState(v, i, 'gone');
  mv.go(parent, pos, quat, 1, { dur });
}
export function heldTo(parent, pos, quat, opts) { return table.heldMover.go(parent, pos, quat, 1, opts); }
/** Puts the held glass back in its slot, empty and upturned. */
export function returnGlass(v, i, dur = 0.45) {
  const gl = table.glasses[v][i], s = table.spots[v];
  _q.copy(s.quat).multiply(_q2.setFromAxisAngle(AX, Math.PI));
  table.heldMover.go(table.group, _s.copy(gl.pos).setY(gl.pos.y + GLASS_H), _q, 1, { dur, arc: 0.06 });
  return table.heldMover;
}
/** Swaps the landed held glass back into the tray instance. */
export function dropHeld(v, i, state = 'empty') { table.held.visible = false; if (v != null) setGlassState(v, i, state); }
/** The glass falls from a limp hand and lies on its side by the tray. */
export function spillHeld(v) {
  spillPose(v, _s, _q);
  return table.heldMover.go(table.group, _s, _q, 1, { dur: 0.55, arc: 0.05 });
}
/** Where a spilled glass lies: on its side by the tray. Once it lands, dropHeld(v, i, 'spilled') keeps it there. */
function spillPose(v, pos, quat) {
  const s = table.spots[v];
  pos.copy(s.tray).addScaledVector(s.out, -0.11).addScaledVector(s.right, -0.05).setY(0.021);
  return quat.copy(s.quat).multiply(_q2.setFromEuler(_e.set(0, 0.7, Math.PI / 2, 'YXZ')));
}

/* ---------- picking ---------- */
const _hits = [];
/** True when the ray touches your own cup. */
export function rayHitsMyCup(raycaster) {
  const M = table.meshes.cup;
  M.computeBoundingSphere();
  _hits.length = 0;
  M.raycast(raycaster, _hits);
  return _hits.some((h) => h.instanceId === 0);
}

/* ---------- per frame ---------- */
const _w = new THREE.Quaternion();
export function updateDiceTable(dt, t) {
  if (!table.group.visible) return;
  const M = table.meshes;
  const k = 1 - Math.exp(-dt * 8);
  for (let v = 0; v < 4; v++) {
    const c = table.cups[v];
    c.mover.update(dt);
    c.shake += (c.shakeTarget - c.shake) * (1 - Math.exp(-dt * 12));
    const o = c.obj, sh = c.shake, ph = t * 21 + v * 1.7;
    // a cup in a hand rides the hand; the table group sits at the origin, so world space is group space
    if (o.parent !== table.group) { o.updateWorldMatrix(true, false); o.matrixWorld.decompose(_p, _q, _s); }
    else { _p.copy(o.position); _q.copy(o.quaternion); }
    if (sh > 0.001) {
      _p.y += (Math.sin(ph) * 0.5 + 0.5) * 0.03 * sh;
      _p.x += Math.sin(ph * 0.5 + 1) * 0.012 * sh;
      _p.z += Math.cos(ph * 0.5) * 0.012 * sh;
      _q.multiply(_w.setFromEuler(_e.set(Math.sin(ph * 0.5) * 0.22 * sh, 0, Math.cos(ph * 0.5 + 0.4) * 0.22 * sh)));
    }
    _m.compose(_p, _q, c.hidden ? ZERO_SCALE : ONE);
    M.cup.setMatrixAt(v, _m); M.cupBrass.setMatrixAt(v, _m);
    const dice = table.dice[v];
    for (let i = 0; i < dice.length; i++) {
      const d = dice[i];
      d.mover.update(dt);
      const idx = v * PER_SEAT + i;
      _m.compose(d.obj.position, d.obj.quaternion, d.shown ? d.obj.scale : ZERO_SCALE);
      M.dice.setMatrixAt(idx, _m);
      d.tint.lerp(d.tintTarget, k);
      M.dice.setColorAt(idx, d.tint);
      d.glow += (d.glowTarget - d.glow) * k;
      const ds = d.obj.scale.x, gs = d.shown && d.glow > 0.01 ? DIE * 3.4 * ds * d.glow : 0;
      _m.compose(_s.set(d.obj.position.x, Math.max(0.003, d.obj.position.y - DIE * ds / 2 + 0.002), d.obj.position.z), _w.identity(), _p.set(gs, gs, gs));
      M.halo.setMatrixAt(idx, _m);
    }
  }
  M.cup.instanceMatrix.needsUpdate = true; M.cupBrass.instanceMatrix.needsUpdate = true;
  M.dice.instanceMatrix.needsUpdate = true; M.dice.instanceColor.needsUpdate = true; M.halo.instanceMatrix.needsUpdate = true;
  if (table.held.visible) table.heldMover.update(dt);
}
