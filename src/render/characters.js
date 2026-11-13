// The three regulars. Built from primitives merged per material (see Kit in world.js) and
// animated procedurally: look-at, breathing, eyelid blinks, tells and reactions.
// The director drives them only through react(), tell() and lookTarget.
import * as THREE from 'three';
import { scene, canvasTex } from './core.js';
import { mats, Kit, place, mergeGeometries } from './world.js';
import { normalCanvas, weaveHeight, hammeredHeight, poreHeight, mottleCanvas, maskCanvas, vnoise } from './textures.js';
import { smoothDamp } from './motion.js';
import { GRIP as GUN_GRIP, MUZZLE } from './gun.js';
import { rand, clamp, quatE, UP } from '../util.js';
import { hasRig, buildRigged, updateRig } from './rig.js';

export const SEAT_RADIUS = 1.32;
const _a = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _c = new THREE.Color();
const V = (x, y, z) => new THREE.Vector3(x, y, z);
// the revolver's line through the head at the temple, in head space
const AIM_DIR = V(1, -0.04, -0.16).normalize();

/* ---------- shape helpers (all return geometry already in place) ---------- */

/** Cylinder from a to b, radius ra at a and rb at b. */
function tube(a, b, ra, rb = ra, seg = 14) {
  _d.subVectors(b, a); const len = Math.max(1e-4, _d.length());
  const g = new THREE.CylinderGeometry(rb, ra, len, seg);
  g.applyQuaternion(_q.setFromUnitVectors(UP, _d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
const ball = (p, r, s = 1, seg = 14) => place(new THREE.SphereGeometry(r, seg, Math.max(6, seg * 0.7 | 0)), [p.x, p.y, p.z], [0, 0, 0], s);
const lathe = (pts, seg = 32, p, r, s) => place(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg), p, r, s);

/** Superellipsoid: a box with fully rounded edges and true normals. */
function roundBox(w, h, d, e = 0.3) {
  const g = new THREE.SphereGeometry(1, 28, 18), P = g.attributes.position, N = g.attributes.normal;
  const f = (v, k) => Math.sign(v) * Math.pow(Math.abs(v), k);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    P.setXYZ(i, f(x, e) * w / 2, f(y, e) * h / 2, f(z, e) * d / 2);
    _a.set(f(x, 2 - e) / w, f(y, 2 - e) / h, f(z, 2 - e) / d).normalize(); N.setXYZ(i, _a.x, _a.y, _a.z);
  }
  return g;
}

/** Pushes vertices along their normals by smooth noise: beards, hair, gathered cloth. */
function lumpy(g, amp, freq, seed = 0) {
  const P = g.attributes.position, N = g.attributes.normal;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const n = Math.sin(x * freq + seed) * Math.sin(y * freq * 1.31 + seed * 2) * Math.sin(z * freq * 0.87 + 1) + vnoise(x * freq * 2 + 9, y * freq * 2 + z * freq, 512, 512) - 0.5;
    P.setXYZ(i, x + N.getX(i) * n * amp, y + N.getY(i) * n * amp, z + N.getZ(i) * n * amp);
  }
  g.computeVertexNormals(); return g;
}

/** A tube with a radius profile along a curve (mustache, feathers' quills, pipes). */
function sweep(points, radius, seg = 24, radial = 8) {
  const c = new THREE.CatmullRomCurve3(points), g = new THREE.TubeGeometry(c, seg, 1, radial, false);
  const P = g.attributes.position, frames = c.computeFrenetFrames(seg, false);
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, r = typeof radius === 'function' ? radius(t) : radius, p = c.getPointAt(t);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j; _a.set(P.getX(k), P.getY(k), P.getZ(k)).sub(p).multiplyScalar(r).add(p); P.setXYZ(k, _a.x, _a.y, _a.z);
    }
  }
  g.computeVertexNormals(); return g;
}

/*
 * Hands. Every hand is one mesh with morph targets between finger poses, so it relaxes, opens or
 * closes round something smoothly in one draw call. A pose only bends joints, so every pose of a
 * hand has the same topology and any two blend.
 *
 * The hand frame (a right hand; mirror in x for the left): palm centre at the origin, palm facing
 * +z, fingers along +y, thumb on +x, the wrist joint at HAND_WRIST. Sizes scale with `palm` (the
 * half extents the designs give) and `r` (a finger's radius at its knuckle).
 */
const HAND_WRIST = V(0, -0.068, -0.004);
// per finger, index to little: knuckle (x, y), phalanx lengths, splay and thickness
const FINGERS = [
  { at: [0.025, 0.04], len: [0.033, 0.021, 0.017], splay: 0.07, r: 1 },
  { at: [0.0085, 0.043], len: [0.036, 0.023, 0.018], splay: 0.0, r: 1.03 },
  { at: [-0.0085, 0.041], len: [0.034, 0.022, 0.017], splay: -0.06, r: 0.97 },
  { at: [-0.0245, 0.035], len: [0.027, 0.017, 0.015], splay: -0.14, r: 0.85 },
];
// the thumb: its base joint deep in the heel of the palm, then metacarpal, proximal and end
const THUMB = { at: [0.017, -0.03], len: [0.036, 0.027, 0.023] };
// radius at the knuckle, the two joints and the tip, as a share of the knuckle's
const TAPER = [1, 0.9, 0.82, 0.7], THUMB_TAPER = [1.18, 1.08, 0.98, 0.84];
const JOINT_MAX = [1.55, 1.8, 1.25];

function handRig({ palm = [0.042, 0.046, 0.02], r = 0.0085 } = {}) {
  const sx = palm[0] / 0.042, sy = palm[1] / 0.046, sz = palm[2] / 0.02;
  return {
    sx, sy, sz, r,
    fingers: FINGERS.map((f) => ({ k: V(f.at[0] * sx, f.at[1] * sy, -0.001), len: f.len.map((l) => l * sy), splay: f.splay, r: r * f.r })),
    thumb: { k: V(THUMB.at[0] * sx, THUMB.at[1] * sy, 0.002 * sz), len: THUMB.len.map((l) => l * sy), r },
    // how far the palm's skin stands in front of its centre where something is held
    front: 0.0105 * sz,
  };
}

/** A finger's joints (knuckle, two joints, tip) for bends [knuckle, middle, end], each adding to the last. */
function fingerJoints(f, bend, J) {
  // a curling finger draws in toward the middle of the hand
  const sp = f.splay * (1 - 0.5 * Math.min(1, bend[0])), s = Math.sin(sp), c = Math.cos(sp);
  J[0].copy(f.k); let a = 0;
  for (let j = 0; j < 3; j++) { a += bend[j]; J[j + 1].copy(J[j]).addScaledVector(_d.set(s * Math.cos(a), c * Math.cos(a), Math.sin(a)), f.len[j]); }
  return J;
}
/**
 * The thumb's joints for [spread, lift, roll, bend1, bend2]: its metacarpal leans `spread` from the
 * fingers toward +x and `lift` out of the palm's plane. Its pad faces the fingers, turned `roll`
 * toward the palm's side, and the two bends curl it toward the pad.
 */
const _tm = new THREE.Vector3(), _tn = new THREE.Vector3(), _tc = new THREE.Vector3();
function thumbJoints(t, [spread, lift, roll, b1, b2], J) {
  _tm.set(Math.sin(spread) * Math.cos(lift), Math.cos(spread) * Math.cos(lift), Math.sin(lift));
  _tn.set(0, 1, 0).addScaledVector(_tm, -_tm.y).normalize();
  _tc.crossVectors(_tm, _tn); _tn.multiplyScalar(Math.cos(roll)).addScaledVector(_tc, Math.sin(roll));
  J[0].copy(t.k); J[1].copy(J[0]).addScaledVector(_tm, t.len[0]);
  J[2].copy(J[1]).addScaledVector(_d.copy(_tm).multiplyScalar(Math.cos(b1)).addScaledVector(_tn, Math.sin(b1)), t.len[1]);
  J[3].copy(J[2]).addScaledVector(_d.copy(_tm).multiplyScalar(Math.cos(b1 + b2)).addScaledVector(_tn, Math.sin(b1 + b2)), t.len[2]);
  return J;
}

/*
 * Closing a hand round a thing: each joint in turn, knuckle first, bends until the finger beyond it
 * would touch the thing's surface (a signed distance in the hand frame), so a finger closes as a
 * whole until it meets the thing and then wraps it joint by joint.
 */
const _sp = new THREE.Vector3();
function touches(J, from, rad, sdfs) {
  for (let j = from; j < 3; j++) for (let k = 1; k <= 4; k++) {
    const t = k / 4; _sp.lerpVectors(J[j], J[j + 1], t);
    if (sdfs[j](_sp) < rad[j] + (rad[j + 1] - rad[j]) * t) return true;
  }
  return false;
}
function closeChain(joints, bend, idx, rad, sdfs, max) {
  const J = [V(0, 0, 0), V(0, 0, 0), V(0, 0, 0), V(0, 0, 0)], b = bend.slice();
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k], seg = 3 - idx.length + k;
    // a bone that starts inside the thing straightens back out of it first
    joints(b, J);
    while (b[i] > -0.5 && touches(J, seg, rad, sdfs)) { b[i] -= 0.02; joints(b, J); }
    while (b[i] < max[k]) {
      b[i] += 0.02; joints(b, J);
      if (touches(J, seg, rad, sdfs)) { b[i] -= 0.02; break; }
    }
  }
  return b;
}
/** Finger bends that wrap `sdf`, each from `from`. The palm is in the way of the outer two bones. */
function wrapFingers(rig, sdf, from = [0.05, 0.1, 0.05], only = [0, 1, 2, 3]) {
  const palm = (p) => Math.max(Math.abs(p.x) - 0.036 * rig.sx, Math.abs(p.y) - 0.042 * rig.sy, p.z - rig.front) + 0.003;
  const both = (p) => Math.min(sdf(p), palm(p));
  return rig.fingers.map((f, i) => (only.includes(i)
    ? closeChain((b, J) => fingerJoints(f, b, J), from, [0, 1, 2], TAPER.map((k) => k * f.r), [sdf, both, both], JOINT_MAX)
    : null));
}
const wrapThumb = (rig, sdf, base) => closeChain((b, J) => thumbJoints(rig.thumb, b, J), base, [3, 4], THUMB_TAPER.map((k) => k * rig.r), [sdf, sdf, sdf], [1.2, 1.3]);

/** A tube through `pts` whose radius runs through `radii` (one per point), a little fuller at the joints. */
function digit(pts, radii, parts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = cum[cum.length - 1];
  const radius = (t) => {
    const s = t * total; let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const u = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    let r = radii[i - 1] + (radii[i] - radii[i - 1]) * u;
    for (let k = 2; k < cum.length - 1; k++) r += radii[k] * 0.07 * Math.exp(-(((s - cum[k]) / (radii[k] * 0.9)) ** 2));
    return r;
  };
  parts.push(sweep(pts, radius, 18, 8), ball(pts[pts.length - 1], radii[radii.length - 1], 1, 8));
}

/** The palm: narrower at the heel, thinner toward the knuckles, cupped a little across its width. */
function palmGeometry(rig, parts) {
  const { sx, sy, sz } = rig, W = 0.038 * sx, H = 0.045 * sy, D = 0.0125 * sz;
  const g = roundBox(2 * W, 2 * H, 2 * D, 0.4), P = g.attributes.position, N = g.attributes.normal;
  for (let i = 0; i < P.count; i++) {
    let x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const u = (y / H + 1) / 2, e = x / W;
    const wx = 0.82 + 0.18 * Math.min(1, u * 1.5), wz = (1.05 - 0.28 * u) * (z > 0 ? 0.88 : 1);
    x *= wx; z *= wz;
    z += 0.004 * sz * e * e;
    y -= 0.006 * sy * Math.max(0, -e) * u;
    P.setXYZ(i, x, y, z);
    _a.set(N.getX(i) / wx, N.getY(i), N.getZ(i) / wz).normalize(); N.setXYZ(i, _a.x, _a.y, _a.z);
  }
  const blob = (p, rot, s) => place(new THREE.SphereGeometry(1, 12, 9), p, rot, s);
  parts.push(g,
    // the ball of the thumb and the heel under the little finger
    blob([0.019 * sx, -0.018 * sy, 0.004 * sz], [0, 0, -0.45], [0.016 * sx, 0.027 * sy, 0.0105 * sz]),
    blob([-0.022 * sx, -0.014 * sy, 0.002 * sz], [0, 0, 0.1], [0.012 * sx, 0.027 * sy, 0.0095 * sz]),
    // the wrist runs on past the joint into the sleeve, so a bent wrist never shows a gap
    place(new THREE.CylinderGeometry(0.024 * sx, 0.021 * sx, 0.072, 14), [0, -0.068, -0.004], [0, 0, 0], [1, 1, 0.72]),
    blob([HAND_WRIST.x, HAND_WRIST.y, HAND_WRIST.z], [0, 0, 0], [0.021 * sx, 0.021 * sx, 0.016 * sx]));
  // knuckles on the back of the hand
  for (const f of rig.fingers) parts.push(blob([f.k.x, f.k.y - 0.004 * sy, -0.0045 * sz], [0, 0, 0], [f.r * 1.05, f.r * 1.2, f.r * 0.8]));
}

/** A hand in its own frame for a pose { fingers: four [knuckle, middle, end] bends, thumb: thumbJoints' five }. */
function handGeometry(rig, pose) {
  const parts = [], J = [V(0, 0, 0), V(0, 0, 0), V(0, 0, 0), V(0, 0, 0)];
  palmGeometry(rig, parts);
  rig.fingers.forEach((f, i) => {
    fingerJoints(f, pose.fingers[i], J);
    // each finger starts inside the palm, so it grows out of it rather than sitting on it
    const root = J[0].clone().addScaledVector(_d.subVectors(J[1], J[0]).setZ(0).normalize(), -0.016 * rig.sy);
    digit([root, ...J.map((p) => p.clone())], [1.04, ...TAPER].map((k) => k * f.r), parts);
  });
  thumbJoints(rig.thumb, pose.thumb, J);
  digit(J.map((p) => p.clone()), THUMB_TAPER.map((k) => k * rig.r), parts);
  return mergeGeometries(parts);
}

/** Bends of a loose finger set: each finger a little more curled than the one before it toward the little finger. */
const loose = (b, step = 0.06) => [0, 1, 2, 3].map((i) => b.map((v, j) => v + i * step * (j === 0 ? 1 : 0.6)));
// relaxed, as lying on the table; opened wide to take hold of something
const OPEN = { fingers: loose([0.12, 0.2, 0.12]), thumb: [0.55, 0.35, 0.6, 0.25, 0.3] };
const SPREAD = { fingers: [[0.02, 0.06, 0.03], [0, 0.05, 0.03], [0.02, 0.05, 0.03], [0.05, 0.06, 0.03]], thumb: [1.0, 0.55, 0.8, 0.02, 0.05] };

function morphHand(base, targets, mat, mirror) {
  const all = [base, ...targets];
  if (mirror) { for (const g of all) g.applyMatrix4(MIRROR_X); flipWinding(base); }
  for (const g of targets) if (g.attributes.position.count !== base.attributes.position.count) throw new Error('hand poses differ in topology');
  base.morphAttributes.position = targets.map((g) => g.attributes.position);
  base.morphAttributes.normal = targets.map((g) => g.attributes.normal);
  base.computeBoundingSphere();
  const m = new THREE.Mesh(base, mat); m.castShadow = m.receiveShadow = true;
  return m;
}
const MIRROR_X = new THREE.Matrix4().makeScale(-1, 1, 1);
function flipWinding(g) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i]; ix[i] = ix[i + 2]; ix[i + 2] = t; } }

/** A torus around axis `dir` at p. */
function ring(p, dir, R, r) {
  const g = new THREE.TorusGeometry(R, r, 6, 24);
  g.applyQuaternion(_q.setFromUnitVectors(V(0, 0, 1), dir.clone().normalize())); g.translate(p.x, p.y, p.z);
  return g;
}

/* ---------- the left hand: on the table, or round the base of a fan of cards ---------- */
const LEFT_FAN = { fingers: loose([0.22, 0.42, 0.36], 0.07), thumb: [0.6, 0.55, 0.9, 0.25, 0.3] };
/** A left hand (mirrored), morph influence 0 lying open and 1 holding a fan. */
export const leftHand = (opts, mat) => { const rig = handRig(opts); return morphHand(handGeometry(rig, OPEN), [handGeometry(rig, LEFT_FAN)], mat, true); };
const LEFT_WRIST = HAND_WRIST;

/*
 * The right hand works in the revolver's grip frame (see gun.js: +z along the barrel, +y up, the
 * plough-handle grip under the hammer). Its palm lies on the grip's right panel (-x, since +x is
 * the shooter's left), its thumb up the raked grip, fingers forward round the front strap.
 * Morph targets: 0 closed on the revolver (three fingers round the grip, the index in the trigger
 * guard on the trigger, the thumb across behind the hammer), 1 round a shot glass (fingers round
 * the outside, the thumb opposite them, the rim clear above), 2 opened wide to take hold.
 */
const GRIP_HALF = 0.0135;
// the grip's front and back straps at height y, from the outline in gun.js (bevel included)
const frontZ = (y) => -0.0265 + (y + 0.03) * 0.3, backZ = (y) => -0.0715 + (y + 0.03) * 0.35;
const GRIP_UP = V(0, 1, 0.32).normalize();
/** The grip as a signed distance in gun model space: a rounded slab between the straps, the frame above. */
function gripSDF(p) {
  const y = clamp(p.y, -0.1, -0.012), zc = (frontZ(y) + backZ(y)) / 2, hd = (frontZ(y) - backZ(y)) / 2, rc = 0.008;
  const qx = Math.abs(p.x) - (GRIP_HALF - rc), qz = Math.abs(p.z - zc) - (hd - rc);
  const slab = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - rc;
  const grip = Math.max(slab, -0.1 - p.y);
  // the frame and cylinder above it
  const frame = Math.max(Math.abs(p.x) - 0.016, Math.abs(p.y - 0.004) - 0.025, Math.abs(p.z + 0.008) - 0.04);
  return Math.min(grip, frame);
}
/** Hand frame to gun model space, for a hand of this size. */
function gripFrame(rig) {
  const z = V(1, 0, 0), fwd = V(0, -GRIP_UP.z, GRIP_UP.y);
  // the grip runs a little across the palm, from the heel under the little finger up to the index's root
  const x = GRIP_UP.clone().multiplyScalar(Math.cos(0.05)).addScaledVector(fwd, -Math.sin(0.05)), y = z.clone().cross(x);
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  // the palm's skin on the grip's right panel, the fingers' middle at the grip's middle height
  const at = V(-(GRIP_HALF + rig.front + 0.001), -0.06, frontZ(-0.06) - 0.004).addScaledVector(y, -0.04 * rig.sy).addScaledVector(x, 0.004);
  return m.setPosition(at);
}
const _hp = new THREE.Vector3();
const inFrame = (m, sdf) => (p) => sdf(_hp.copy(p).applyMatrix4(m));

// a shot glass (diceTable.js): radius at its base and rim, and height
const GLASS = { r0: 0.0192, r1: 0.0218, h: 0.056 }, GLASS_H_HAND = GLASS.h;
/**
 * Where a held glass stands in the hand frame: its axis along the thumb's side of the palm, the
 * base level with the ring finger so the rim stands clear above the index finger and thumb.
 */
function glassInHand(rig) {
  const axis = V(1, 0, 0), base = V(-0.012 * rig.sx, 0.028 * rig.sy, rig.front + GLASS.r1 + 0.001);
  return { base, axis };
}
function glassSDF({ base, axis }) {
  const v = new THREE.Vector3();
  return (p) => {
    v.subVectors(p, base); const h = v.dot(axis); v.addScaledVector(axis, -h);
    const side = v.length() - (GLASS.r0 + (GLASS.r1 - GLASS.r0) * clamp(h / GLASS.h, 0, 1)), cap = Math.max(-h, h - GLASS.h);
    return Math.hypot(Math.max(side, 0), Math.max(cap, 0)) + Math.min(Math.max(side, cap), 0);
  };
}

/**
 * The right hand for a character or the player. Returns the mesh; its userData has `wrist` (the
 * wrist joint in the grip frame, for the arm) and `glass` (a held glass's pose in the grip frame).
 */
export function rightHand(opts, mat) {
  const rig = handRig(opts), M = gripFrame(rig);
  // closed on the revolver: three fingers round the grip, the index hooked into the guard, the thumb behind the hammer
  const grip = inFrame(M, gripSDF), fist = { fingers: wrapFingers(rig, grip, [0.1, 0.15, 0.75]), thumb: null };
  fist.fingers[0] = [0.3, 1.05, 0.65];
  fist.thumb = wrapThumb(rig, grip, [0.4, 0.9, 0.1, 0, 0]);
  // round a glass
  const gl = glassInHand(rig), gsdf = glassSDF(gl);
  const wrap = { fingers: wrapFingers(rig, gsdf, [0.2, 0.3, 0.1]), thumb: wrapThumb(rig, gsdf, [0.05, 1.0, 0, 0, 0]) };
  const toGrip = new THREE.Matrix4().makeTranslation(-GUN_GRIP.x, -GUN_GRIP.y, -GUN_GRIP.z).multiply(M);
  const geos = [OPEN, fist, wrap, SPREAD].map((pose) => handGeometry(rig, pose).applyMatrix4(toGrip));
  const mesh = morphHand(geos[0], geos.slice(1), mat, false);
  const pos = gl.base.clone().applyMatrix4(toGrip), up = gl.axis.clone().transformDirection(toGrip);
  mesh.userData = { wrist: HAND_WRIST.clone().applyMatrix4(toGrip), fore: V(0, -1, 0).transformDirection(toGrip), glass: { pos, quat: new THREE.Quaternion().setFromUnitVectors(UP, up) } };
  return mesh;
}
/** Sets a right hand's shape: how far it is closed on the revolver and on a glass, and opened wide. */
export function shapeHand(mesh, fist, glass, spread) {
  const w = mesh.morphTargetInfluences; w[0] = fist; w[1] = glass; w[2] = spread;
}

/* ---------- detail textures shared by every character ---------- */
let TEX = null;
function detail() {
  if (TEX) return TEX;
  const n = (c) => { const t = canvasTex(c, { srgb: false, repeat: [1, 1] }); return t; };
  TEX = {
    cloth: n(normalCanvas(256, weaveHeight(80), 1.6)),
    hammered: n(normalCanvas(256, hammeredHeight, 3)),
    pores: n(normalCanvas(256, poreHeight, 1.2)),
    hair: n(normalCanvas(256, (u, v) => vnoise(u * 90, v * 3, 90, 3) * 0.8 + vnoise(u * 200, v * 6, 200, 6) * 0.3, 4)),
    skin: canvasTex(mottleCanvas(256, { amount: 0.16, scale: 5, warm: [1, 0.93, 0.9] }), { repeat: [1, 1] }),
    mask: canvasTex(maskCanvas(512)),
  };
  TEX.cloth.repeat.set(5, 5); TEX.hammered.repeat.set(2, 2); TEX.hair.repeat.set(3, 1);
  return TEX;
}

/* ---------- the shared chair ---------- */
let CHAIR = null;
function chairGeometry() {
  if (CHAIR) return CHAIR;
  const p = [];
  for (const s of [-1, 1]) {
    p.push(tube(V(s * 0.25, -0.76, -0.27), V(s * 0.25, 0.4, -0.29), 0.024, 0.02, 10), ball(V(s * 0.25, 0.43, -0.29), 0.03, 1, 10));
    p.push(tube(V(s * 0.23, -0.76, 0.17), V(s * 0.23, -0.3, 0.17), 0.022, 0.022, 10));
  }
  p.push(sweep([V(-0.27, 0.36, -0.28), V(-0.12, 0.39, -0.31), V(0.12, 0.39, -0.31), V(0.27, 0.36, -0.28)], 0.03, 20, 10));
  p.push(sweep([V(-0.25, -0.02, -0.27), V(0, -0.02, -0.3), V(0.25, -0.02, -0.27)], 0.02, 12, 8));
  for (const x of [-0.12, 0, 0.12]) p.push(place(new THREE.BoxGeometry(0.05, 0.34, 0.014), [x, 0.16, -0.28 + Math.abs(x) * 0.1], [0.05, 0, 0]));
  p.push(place(new THREE.BoxGeometry(0.54, 0.05, 0.48), [0, -0.31, -0.05]));
  CHAIR = mergeGeometries(p);
  return CHAIR;
}

/* ---------- designs ----------
   Each design returns materials and a build(rig) that adds parts to the rig's kits.
   rig.k.upper / rig.k.head are Kits merged onto those bones. Animated parts are returned. */

function physical(o) { return new THREE.MeshPhysicalMaterial(o); }
function standard(o) { return new THREE.MeshStandardMaterial(o); }

const DESIGNS = {
  brass() {
    const T = detail();
    const body = standard({ color: 0xd9a95a, map: mats.brassMap, metalnessMap: mats.brassRough, roughnessMap: mats.brassRough, normalMap: T.hammered, normalScale: new THREE.Vector2(0.12, 0.12), metalness: 1, roughness: 0.85, envMapIntensity: 1.8 });
    const iron = standard({ color: 0x2c2926, metalness: 0.8, roughness: 0.42, normalMap: T.hammered, normalScale: new THREE.Vector2(0.2, 0.2) });
    const copper = standard({ color: 0xc2734a, metalness: 1, roughness: 0.35, envMapIntensity: 1.6 });
    const lensMat = standard({ color: 0x0a2830, emissive: 0x44e4ff, emissiveIntensity: 2.4, roughness: 0.1 });
    const tipMat = standard({ color: 0x300, emissive: 0xff3a22, emissiveIntensity: 2 });
    // the shutter's pole would gather the hammered normal map into a starburst; it is its own mesh anyway
    const shutter = standard({ color: 0xd9a95a, map: mats.brassMap, metalness: 1, roughness: 0.45, envMapIntensity: 1.8 });
    const dialMat = standard({ color: 0xe8dcbc, roughness: 0.5, emissive: 0x2a2010, emissiveIntensity: 0.3 });
    return {
      mats: { body, iron, copper, lens: lensMat, tip: tipMat, shutter, dial: dialMat, needle: new THREE.MeshBasicMaterial({ color: 0x8a1a10 }) },
      sleeve: body, hand: body, arm: { shoulder: 0.055, elbow: 0.046, wrist: 0.036, gap: 0.012 }, handOpts: { palm: [0.044, 0.046, 0.021], r: 0.0088 }, temple: V(-0.146, 0.06, 0.03),
      tint: [body, iron, copper, dialMat, shutter], noShadow: [dialMat, copper],
      cuff(k, el, wr) { k.add(iron, ring(V(0, wr.y + 0.012, 0), V(0, 1, 0), 0.039, 0.0075)); },
      torso(k, up) {
        k.add(body, lathe([[0, -0.3], [0.16, -0.3], [0.19, -0.22], [0.215, -0.05], [0.225, 0.12], [0.2, 0.26], [0.15, 0.33], [0.075, 0.37], [0, 0.375]], 36, [0, 0, 0], [0, 0, 0], [1.08, 1, 0.86]));
        for (const y of [-0.18, 0.2]) {
          const r = y < 0 ? 0.204 : 0.22;
          k.add(iron, place(new THREE.TorusGeometry(r, 0.012, 8, 40), [0, y, 0], [Math.PI / 2, 0, 0], [1.08, 0.86, 1]));
          for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; k.add(body, ball(V(Math.cos(a) * (r + 0.009) * 1.08, y, Math.sin(a) * (r + 0.009) * 0.86), 0.007, 1, 6)); }
        }
        for (let i = 0; i < 5; i++) k.add(iron, place(new THREE.BoxGeometry(0.15, 0.011, 0.02), [0, -0.02 - i * 0.022, 0.187]));
        k.add(iron, place(roundBox(0.19, 0.13, 0.03), [0, -0.064, 0.18]));
        for (const s of [-1, 1]) k.add(copper, sweep([V(s * 0.06, 0.05, -0.17), V(s * 0.14, 0.18, -0.16), V(s * 0.17, 0.3, -0.07), V(s * 0.1, 0.36, 0.02)], 0.013, 20, 8));
        for (const s of [-1, 1]) {
          k.add(body, place(new THREE.SphereGeometry(0.1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), [s * 0.215, 0.255, 0], [0, 0, -s * 0.35], [1, 0.8, 1]));
          k.add(iron, place(new THREE.TorusGeometry(0.1, 0.008, 6, 24), [s * 0.215, 0.255, 0], [Math.PI / 2, 0, -s * 0.35], [1, 1, 1]));
        }
        k.add(body, place(new THREE.TorusGeometry(0.047, 0.01, 8, 28), [0, 0.13, 0.19]));
        k.add(dialMat, place(new THREE.CircleGeometry(0.042, 28), [0, 0.13, 0.192]));
        const needle = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.036, 0.002), new THREE.MeshBasicMaterial({ color: 0x8a1a10 }));
        needle.geometry.translate(0, 0.014, 0); needle.position.set(0, 0.13, 0.195); up.add(needle);
        return { needle };
      },
      head(k, h, neck) {
        neck.add(new THREE.Mesh(mergeGeometries([place(new THREE.CylinderGeometry(0.045, 0.06, 0.1, 14), [0, 0.03, 0]), ...[0, 1, 2].map((i) => place(new THREE.TorusGeometry(0.052 - i * 0.003, 0.009, 6, 18), [0, -0.005 + i * 0.03, 0], [Math.PI / 2, 0, 0]))]), iron));
        k.add(body, place(roundBox(0.29, 0.26, 0.25, 0.28), [0, 0.005, 0]));
        k.add(iron, place(roundBox(0.23, 0.18, 0.04, 0.35), [0, 0.0, 0.112]));
        k.add(body, place(new THREE.TorusGeometry(0.058, 0.014, 10, 36), [0, 0.03, 0.136]));
        k.add(iron, place(new THREE.TorusGeometry(0.046, 0.005, 6, 32), [0, 0.03, 0.136]));
        for (let i = 0; i < 4; i++) k.add(body, place(new THREE.BoxGeometry(0.11 - i * 0.012, 0.008, 0.012), [0, -0.045 - i * 0.014, 0.134]));
        for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; k.add(body, ball(V(Math.cos(a) * 0.105, Math.sin(a) * 0.075, 0.13), 0.0075, 1, 6)); }
        k.add(body, place(roundBox(0.22, 0.035, 0.05, 0.4), [0, 0.105, 0.11], [0.2, 0, 0]));
        for (const s of [-1, 1]) {
          k.add(iron, place(new THREE.CylinderGeometry(0.034, 0.034, 0.035, 16), [s * 0.152, 0, 0], [0, 0, Math.PI / 2]));
          k.add(body, place(new THREE.TorusGeometry(0.024, 0.006, 6, 16), [s * 0.171, 0, 0], [0, Math.PI / 2, 0]));
        }
        k.add(iron, tube(V(0.07, 0.13, -0.02), V(0.07, 0.26, -0.03), 0.006, 0.004, 6), ball(V(0.07, 0.13, -0.02), 0.014, 1, 8));
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), tipMat); tip.position.set(0.07, 0.27, -0.03); h.add(tip);
        const lens = new THREE.Mesh(new THREE.SphereGeometry(0.046, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), lensMat);
        lens.rotation.x = Math.PI / 2; lens.scale.set(1, 0.35, 1); lens.position.set(0, 0.03, 0.124); h.add(lens);
        const pupil = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.004, 6, 20), iron); pupil.position.set(0, 0.03, 0.141); h.add(pupil);
        // the shutter blink: a brass cap swinging down over the lens
        const lid = new THREE.Group(); lid.position.set(0, 0.03, 0.12); h.add(lid);
        lid.add(new THREE.Mesh(new THREE.SphereGeometry(0.056, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), shutter));
        lid.children[0].scale.set(1, 1, 0.5);
        return { eyes: [lens], lids: [lid], lidOpen: -0.25, lidClosed: Math.PI / 2 - 0.05, extraGlow: [tipMat] };
      },
      update(ch, dt, t, E) {
        const live = 1 - E.out;
        ch.parts.needle.rotation.z = (-0.6 + Math.sin(t * 0.8 + ch.phase) * 0.15 + E.tremble * (0.9 + Math.sin(t * 31) * 0.2) + E.lean * 0.4) * live + E.out * 1.4;
      },
    };
  },

  noctua() {
    const T = detail();
    const velvet = physical({ color: 0x4a1f4c, roughness: 0.78, sheen: 1, sheenColor: new THREE.Color(0xd090d8), sheenRoughness: 0.32, normalMap: T.cloth, normalScale: new THREE.Vector2(0.25, 0.25) });
    const velvetDark = physical({ color: 0x1e0c1c, roughness: 0.85, sheen: 1, sheenColor: new THREE.Color(0x8a5a9a), sheenRoughness: 0.4, side: THREE.DoubleSide });
    const lace = standard({ color: 0xe9dfcf, roughness: 0.75, side: THREE.DoubleSide, normalMap: T.cloth, normalScale: new THREE.Vector2(0.8, 0.8) });
    const porcelain = physical({ color: 0xf2ebe0, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12, normalMap: T.pores, normalScale: new THREE.Vector2(0.15, 0.15) });
    const mask = physical({ map: T.mask, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 });
    const pearl = physical({ color: 0xf6efe4, roughness: 0.2, clearcoat: 1, sheen: 1, sheenColor: new THREE.Color(0xffd8e8), sheenRoughness: 0.3 });
    const hat = physical({ color: 0x261a2c, roughness: 0.8, sheen: 1, sheenColor: new THREE.Color(0x7a5a8a), sheenRoughness: 0.5, side: THREE.DoubleSide });
    const ribbon = physical({ color: 0x6a2a5a, roughness: 0.5, sheen: 1, sheenColor: new THREE.Color(0xe0a0d0) });
    const plume = standard({ color: 0x2b7a70, roughness: 0.6, side: THREE.DoubleSide, normalMap: T.hair, normalScale: new THREE.Vector2(0.6, 0.6) });
    const plumeDark = standard({ color: 0x141018, roughness: 0.6, side: THREE.DoubleSide, normalMap: T.hair });
    const socket = standard({ color: 0x140a10, roughness: 0.5 });
    const irisMat = standard({ color: 0x2a1400, emissive: 0xffa632, emissiveIntensity: 2.6 });
    const gemMat = standard({ color: 0x0a3a38, emissive: 0x2fd6c0, emissiveIntensity: 1.2, roughness: 0.1 });
    return {
      mats: { velvet, cape: velvetDark, lace, porcelain, mask, pearl, hat, ribbon, plume, plume_dark: plumeDark, socket, iris: irisMat, gem: gemMat, brass: mats.brass },
      // her model's face and the shapes its arms are kept out of (tools/models/noctua.py)
      rig: {
        eye: 'iris', glow: ['gem'], lids: ['lidR', 'lidL'], lidOpen: 0.25, lidClosed: Math.PI / 2 + 0.05,
        colliders: { TORSO: { y0: -0.1, y1: 0.16, rx: 0.196, rz: 0.15, ry: 0.2 }, HEAD: { half: V(0.125, 0.14, 0.11), round: 0.02 } },
      },
      sleeve: velvet, hand: porcelain, arm: { shoulder: 0.045, elbow: 0.037, wrist: 0.03, gap: 0.016 }, handOpts: { palm: [0.036, 0.042, 0.016], r: 0.0072 }, temple: V(-0.143, 0.045, 0.03),
      tint: [velvet, velvetDark, lace, porcelain, mask, pearl, hat, ribbon, plume], noShadow: [pearl, mats.brass, ribbon, plume, plumeDark],
      torso(k) {
        k.add(velvet, lathe([[0, -0.3], [0.18, -0.3], [0.185, -0.22], [0.145, -0.1], [0.15, 0.0], [0.178, 0.12], [0.17, 0.24], [0.13, 0.32], [0.06, 0.37], [0, 0.375]], 36, [0, 0, 0], [0, 0, 0], [1.1, 1, 0.84]));
        // capelet with a scalloped hem
        const cape = new THREE.LatheGeometry([[0.27, 0.1], [0.25, 0.16], [0.2, 0.26], [0.13, 0.33], [0.075, 0.38]].map(([x, y]) => new THREE.Vector2(x, y)), 48, 0.5, Math.PI * 2 - 1.0);
        const P = cape.attributes.position;
        for (let i = 0; i < P.count; i++) { const x = P.getX(i), z = P.getZ(i), y = P.getY(i); if (y < 0.12) P.setY(i, y + Math.abs(Math.sin(Math.atan2(z, x) * 7)) * 0.03 - 0.01); }
        cape.computeVertexNormals();
        k.add(velvetDark, place(cape, [0, 0, 0], [0, 0, 0], [1.1, 1, 0.9]));
        // standing lace collar fanned behind the head
        const col = new THREE.LatheGeometry([[0.085, 0.36], [0.13, 0.44], [0.2, 0.56]].map(([x, y]) => new THREE.Vector2(x, y)), 24, Math.PI * 0.4, Math.PI * 1.2);
        const C = col.attributes.position;
        for (let i = 0; i < C.count; i++) { const y = C.getY(i); if (y > 0.5) { const a = Math.atan2(C.getZ(i), C.getX(i)); C.setY(i, y + Math.cos(a * 11) * 0.025); } }
        col.computeVertexNormals();
        k.add(lace, place(col, [0, -0.02, -0.02]));
        k.add(lace, place(lumpy(new THREE.TorusGeometry(0.075, 0.022, 8, 28), 0.012, 60), [0, 0.36, 0.0], [Math.PI / 2 + 0.15, 0, 0]));
        // pearls in two loops and a glowing brooch
        for (const [rx, ry, n, y0] of [[0.07, 0.06, 17, 0.33], [0.09, 0.1, 23, 0.33]]) {
          for (let i = 0; i < n; i++) { const a = Math.PI * (0.06 + 0.88 * i / (n - 1)); k.add(pearl, ball(V(Math.cos(a) * rx * 1.4, y0 - Math.sin(a) * ry, 0.118 + Math.sin(a) * 0.03), 0.0068, 1, 8)); }
        }
        k.add(mats.brass, place(new THREE.TorusGeometry(0.022, 0.004, 6, 20), [0, 0.2, 0.158], [-0.3, 0, 0], [1, 1.3, 1]));
        for (let i = 0; i < 4; i++) k.add(mats.brass, ball(V(0, 0.08 - i * 0.055, 0.15 - i * 0.008), 0.009, [1, 1, 0.6], 8));
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.022), gemMat); gem.position.set(0, 0.2, 0.165); gem.scale.set(1, 1.3, 0.6); gem.rotation.x = -0.3;
        return { gem };
      },
      shoulder(k, sh) { k.add(velvet, ball(sh, 0.068, [1, 0.95, 1.05], 16)); },
      cuff(k, el, wr) {
        const frill = lathe([[0.029, wr.y + 0.026], [0.032, wr.y + 0.008], [0.036, wr.y - 0.006], [0.04, wr.y - 0.013]], 32);
        const P = frill.attributes.position;
        for (let i = 0; i < P.count; i++) { const x = P.getX(i), z = P.getZ(i), y = P.getY(i), w = Math.max(0, wr.y - y + 0.004) * 7 * Math.sin(Math.atan2(z, x) * 11); P.setXYZ(i, x * (1 + w * 0.12), y + w * 0.004, z * (1 + w * 0.12)); }
        frill.computeVertexNormals();
        k.add(lace, frill);
      },
      head(k, h) {
        k.add(mask, place(new THREE.SphereGeometry(0.15, 40, 28), [0, 0, 0], [0, 0, 0], [1, 1.1, 0.95]));
        const eyes = [], lids = [];
        for (const s of [-1, 1]) {
          const e = new THREE.Group(); e.position.set(s * 0.058, 0.018, 0.108); e.rotation.y = s * 0.35; h.add(e);
          e.add(new THREE.Mesh(new THREE.SphereGeometry(0.038, 20, 14), socket));
          const iris = new THREE.Mesh(new THREE.CircleGeometry(0.022, 24), irisMat); iris.position.z = 0.0372; e.add(iris);
          const pu = new THREE.Mesh(new THREE.CircleGeometry(0.008, 14), socket); pu.position.z = 0.0376; e.add(pu);
          eyes.push(iris);
          const lid = new THREE.Group(); e.add(lid);
          lid.add(new THREE.Mesh(new THREE.SphereGeometry(0.041, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), porcelain));
          lids.push(lid);
          k.add(porcelain, place(new THREE.TorusGeometry(0.05, 0.007, 8, 32), [s * 0.06, 0.016, 0.118], [0, s * 0.35, 0], [1, 1.15, 1]));
          k.add(porcelain, sweep([V(s * 0.025, 0.06, 0.142), V(s * 0.07, 0.075, 0.13), V(s * 0.115, 0.09, 0.098), V(s * 0.15, 0.12, 0.06)], (t) => 0.011 * (1 - t * 0.75), 16, 8));
        }
        k.add(mats.brass, place(new THREE.ConeGeometry(0.02, 0.07, 14), [0, -0.04, 0.15], [Math.PI / 2 + 0.6, 0, 0]));
        // wide hat with an upturned brim, ribbon band and plumes
        const brim = new THREE.LatheGeometry([[0.11, 0.004], [0.24, -0.006], [0.3, 0.008], [0.318, 0.035], [0.31, 0.036], [0.29, 0.016], [0.24, 0.006], [0.11, 0.014]].map(([x, y]) => new THREE.Vector2(x, y)), 56);
        k.add(hat, place(brim, [0, 0.125, -0.005], [-0.14, 0, 0.07]));
        k.add(hat, place(new THREE.LatheGeometry([[0.13, 0], [0.125, 0.08], [0.115, 0.13], [0.09, 0.15], [0, 0.155]].map(([x, y]) => new THREE.Vector2(x, y)), 40), [0, 0.13, -0.015], [-0.14, 0, 0.07]));
        k.add(ribbon, place(new THREE.CylinderGeometry(0.129, 0.131, 0.032, 40, 1, true), [0, 0.15, -0.012], [-0.14, 0, 0.07]));
        k.add(ribbon, place(new THREE.TorusGeometry(0.315, 0.005, 6, 64).rotateX(Math.PI / 2).translate(0, 0.034, 0), [0, 0.125, -0.005], [-0.14, 0, 0.07]));
        k.add(ribbon, ball(V(0.12, 0.155, -0.04), 1, [0.018, 0.032, 0.03], 10));
        const feather = (pts, w, mat) => {
          const c = new THREE.CatmullRomCurve3(pts), g = new THREE.PlaneGeometry(1, 1, 1, 16), P = g.attributes.position;
          for (let i = 0; i < P.count; i++) { const t = P.getY(i) + 0.5, p = c.getPoint(t), side = P.getX(i); const wid = w * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 - t * 0.3); P.setXYZ(i, p.x + side * wid, p.y, p.z + side * wid * 0.4); }
          g.computeVertexNormals(); k.add(mat, g);
        };
        feather([V(0.11, 0.17, -0.04), V(0.17, 0.3, -0.08), V(0.15, 0.42, -0.16), V(0.08, 0.47, -0.24)], 0.035, plume);
        feather([V(0.12, 0.16, -0.06), V(0.2, 0.26, -0.1), V(0.24, 0.33, -0.2)], 0.025, plumeDark);
        feather([V(0.1, 0.17, -0.02), V(0.13, 0.27, 0.0), V(0.12, 0.34, -0.05)], 0.018, plume);
        k.add(mats.brass, ball(V(0.12, 0.16, -0.02), 0.012, 1, 10));
        return { eyes, lids, lidOpen: 0.25, lidClosed: Math.PI / 2 + 0.05, extraGlow: [gemMat] };
      },
    };
  },

  gristle() {
    const T = detail();
    const coat = physical({ color: 0x223355, roughness: 0.8, normalMap: T.cloth, normalScale: new THREE.Vector2(0.18, 0.18), sheen: 0.5, sheenColor: new THREE.Color(0x5a74a8), sheenRoughness: 0.5 });
    const facing = standard({ color: 0x8e2420, roughness: 0.75, normalMap: T.cloth, normalScale: new THREE.Vector2(0.4, 0.4) });
    const skin = physical({ color: 0xd59a7a, map: T.skin, roughness: 0.55, normalMap: T.pores, normalScale: new THREE.Vector2(0.3, 0.3), sheen: 0.4, sheenColor: new THREE.Color(0xff9a80), sheenRoughness: 0.5 });
    const beard = standard({ color: 0xa8461c, roughness: 0.85, normalMap: T.hair, normalScale: new THREE.Vector2(0.5, 0.5) });
    const leather = standard({ color: 0x15100d, roughness: 0.42 });
    const linen = standard({ color: 0xece4d4, roughness: 0.8, normalMap: T.cloth, normalScale: new THREE.Vector2(0.6, 0.6) });
    const felt = physical({ color: 0x121218, roughness: 0.85, sheen: 0.6, sheenColor: new THREE.Color(0x444458), side: THREE.DoubleSide });
    const eyeball = standard({ color: 0x1a0e08, roughness: 0.3 });
    const eyeMat = standard({ color: 0x200400, emissive: 0xff5a24, emissiveIntensity: 2.6 });
    const SX = 1.16, SZ = 0.86, R = (y) => (y < -0.08 ? 0.21 + (y + 0.3) * 0.06 : y < 0.12 ? 0.225 : 0.225 - (y - 0.12) * 0.4);
    const front = (x, y) => Math.sqrt(Math.max(0, 1 - (x / (R(y) * SX)) ** 2)) * R(y) * SZ;
    return {
      sleeve: coat, hand: skin, arm: { shoulder: 0.06, elbow: 0.05, wrist: 0.04, gap: 0.018 }, handOpts: { palm: [0.046, 0.05, 0.022], r: 0.0098 }, temple: V(-0.156, 0.065, 0.025),
      tint: [coat, facing, skin, beard, linen, felt], noShadow: [mats.brass, linen],
      torso(k) {
        k.add(coat, lathe([[0, -0.3], [0.2, -0.3], [0.215, -0.2], [0.225, -0.05], [0.228, 0.12], [0.215, 0.24], [0.17, 0.32], [0.08, 0.38], [0, 0.385]], 36, [0, 0, 0], [0, 0, 0], [SX, 1, SZ]));
        // lapels: red facings in a V, edged in gold
        for (const s of [-1, 1]) {
          const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(s * 0.11, 0.02); sh.lineTo(s * 0.13, 0.3); sh.lineTo(s * 0.05, 0.36); sh.lineTo(0, 0.1); sh.closePath();
          const g = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 });
          const P = g.attributes.position;
          for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i) - 0.05, z = P.getZ(i); P.setZ(i, front(x, y) + z - 0.006); P.setY(i, y); }
          g.computeVertexNormals(); k.add(facing, g);
        }
        for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { const x = s * 0.085, y = 0.2 - i * 0.075; k.add(mats.brass, ball(V(x, y, front(x, y) + 0.012), 0.013, [1, 1, 0.55], 10)); }
        // belt and buckle
        k.add(leather, place(new THREE.CylinderGeometry(R(-0.17) + 0.008, R(-0.17) + 0.01, 0.05, 36, 1, true), [0, -0.17, 0], [0, 0, 0], [SX, 1, SZ]));
        k.add(mats.brass, place(new THREE.TorusGeometry(0.03, 0.007, 6, 4), [0, -0.17, R(-0.17) * SZ + 0.012], [0, 0, Math.PI / 4], [1.3, 1, 1]));
        // linen cravat
        k.add(linen, place(lumpy(new THREE.SphereGeometry(0.06, 16, 12), 0.008, 70), [0, 0.32, 0.11], [0, 0, 0], [1.1, 0.8, 0.7]));
        k.add(linen, place(lumpy(new THREE.ConeGeometry(0.05, 0.13, 14), 0.008, 60), [0, 0.24, 0.155], [Math.PI - 0.2, 0, 0], [1, 1, 0.5]));
        k.add(linen, tube(V(0, 0.33, -0.02), V(0, 0.38, -0.02), 0.085, 0.075, 20));
        // epaulettes with bullion fringe
        for (const s of [-1, 1]) {
          k.add(mats.brass, place(new THREE.CylinderGeometry(0.075, 0.082, 0.022, 24), [s * 0.2, 0.3, 0], [0, 0, -s * 0.3], [1, 1, 0.82]));
          for (let i = 0; i < 13; i++) {
            const a = (i / 12 - 0.5) * Math.PI * 1.15 + (s > 0 ? 0 : Math.PI), x = Math.cos(a) * 0.08, z = Math.sin(a) * 0.066;
            const top = V(s * 0.2 + x * Math.cos(0.3), 0.29 - Math.abs(x) * Math.sin(0.3) * 0, z);
            k.add(mats.brass, tube(top, top.clone().add(V(x * 0.15, -0.06, z * 0.15)), 0.007, 0.006, 6));
          }
        }
        // pocket-watch chain across the waistcoat
        const chain = new THREE.CatmullRomCurve3([V(0.085, -0.02, front(0.085, -0.02) + 0.01), V(0.12, -0.1, front(0.12, -0.1) + 0.012), V(0.16, -0.08, front(0.16, -0.08) + 0.006)]);
        for (let i = 0; i < 16; i++) { const p = chain.getPoint(i / 15); k.add(mats.brass, place(new THREE.TorusGeometry(0.006, 0.0018, 4, 8), [p.x, p.y, p.z], [0, i % 2 ? Math.PI / 2 : 0, 0.6])); }
        return {};
      },
      cuff(k, el, wr) {
        const y = wr.y;
        k.add(facing, lathe([[0.034, y + 0.004], [0.043, y - 0.002], [0.049, y + 0.004], [0.052, y + 0.035], [0.052, y + 0.06], [0.05, y + 0.068], [0.044, y + 0.072]], 22));
        k.add(mats.brass, ball(V(0, y + 0.045, 0.052), 0.008, [1, 1, 0.6], 8));
        k.add(mats.brass, ring(V(0, y + 0.066, 0), V(0, 1, 0), 0.0505, 0.0035));
      },
      head(k, h) {
        k.add(skin, place(new THREE.SphereGeometry(0.16, 36, 26), [0, 0.005, 0], [0, 0, 0], [1.03, 1, 0.98]));
        for (const s of [-1, 1]) k.add(skin, place(new THREE.SphereGeometry(1, 14, 10), [s * 0.158, 0.005, -0.01], [0, s * 0.3, 0], [0.022, 0.045, 0.034]));
        k.add(skin, ball(V(0, -0.008, 0.16), 0.042, [0.95, 1, 1], 18), ball(V(-0.02, -0.028, 0.168), 0.02, 1, 10), ball(V(0.02, -0.028, 0.168), 0.02, 1, 10));
        // the beard: a lumpy mass, side whiskers, a braided tuft with a bead
        k.add(beard, place(lumpy(new THREE.SphereGeometry(0.15, 32, 20), 0.014, 55, 1), [0, -0.1, 0.045], [0, 0, 0], [1.1, 1.0, 0.85]));
        for (const s of [-1, 1]) k.add(beard, place(lumpy(new THREE.SphereGeometry(0.075, 18, 12), 0.01, 70, s), [s * 0.11, -0.05, 0.04], [0, 0, 0], [0.9, 1.3, 1]));
        k.add(beard, place(lumpy(new THREE.ConeGeometry(0.075, 0.16, 18, 4), 0.008, 80), [0, -0.245, 0.07], [Math.PI + 0.15, 0, 0]));
        k.add(mats.brass, place(new THREE.TorusGeometry(0.03, 0.009, 8, 18), [0, -0.27, 0.074], [Math.PI / 2 - 0.15, 0, 0]));
        for (const s of [-1, 1]) k.add(beard, sweep([V(s * 0.005, -0.035, 0.175), V(s * 0.05, -0.05, 0.17), V(s * 0.1, -0.035, 0.145), V(s * 0.125, 0.0, 0.12)], (t) => 0.022 * (1 - t * 0.75) * Math.min(1, 0.4 + t * 4), 20, 10));
        // one bushy brow over the good eye, a leather patch over the other
        k.add(beard, place(lumpy(new THREE.CapsuleGeometry(0.016, 0.06, 4, 10), 0.004, 120), [-0.06, 0.068, 0.142], [0, -0.25, Math.PI / 2 - 0.2]));
        k.add(beard, place(lumpy(new THREE.CapsuleGeometry(0.014, 0.055, 4, 10), 0.004, 120), [0.062, 0.075, 0.142], [0, 0.25, Math.PI / 2 + 0.25]));
        k.add(leather, place(new THREE.SphereGeometry(1, 20, 12), [0.06, 0.04, 0.142], [0, 0.36, 0], [0.04, 0.034, 0.016]));
        k.add(leather, place(new THREE.TorusGeometry(0.164, 0.0045, 6, 48), [0, 0.02, 0], [0.12, 0, 0.5]));
        const e = new THREE.Group(); e.position.set(-0.06, 0.035, 0.132); e.rotation.y = -0.3; h.add(e);
        e.add(new THREE.Mesh(new THREE.SphereGeometry(0.027, 18, 12), eyeball));
        const iris = new THREE.Mesh(new THREE.CircleGeometry(0.015, 18), eyeMat); iris.position.z = 0.0266; e.add(iris);
        const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.0062, 14), eyeball); pupil.position.z = 0.0268; e.add(pupil);
        const lid = new THREE.Group(); e.add(lid);
        lid.add(new THREE.Mesh(new THREE.SphereGeometry(0.0292, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), skin));
        // bicorne: two felt flaps meeting at a ridge, gold-edged, with a cockade
        const sh = new THREE.Shape(); sh.moveTo(-0.33, 0.07); sh.quadraticCurveTo(0, -0.03, 0.33, 0.07); sh.bezierCurveTo(0.24, 0.1, 0.16, 0.2, 0, 0.215); sh.bezierCurveTo(-0.16, 0.2, -0.24, 0.1, -0.33, 0.07);
        const edge = [V(-0.33, 0.07, 0), V(-0.22, 0.13, 0), V(-0.1, 0.195, 0), V(0, 0.215, 0), V(0.1, 0.195, 0), V(0.22, 0.13, 0), V(0.33, 0.07, 0)];
        for (const s of [-1, 1]) {
          const g = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 16 });
          g.translate(0, 0, -0.006);
          k.add(felt, place(g, [0, 0.1, s * 0.035], [-s * 0.2, 0, 0]));
          k.add(mats.brass, place(sweep(edge, 0.006, 32, 6), [0, 0.1, s * 0.035], [-s * 0.2, 0, 0]));
        }
        k.add(felt, place(new THREE.SphereGeometry(0.155, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), [0, 0.1, 0], [0, 0, 0], [1.05, 0.7, 0.95]));
        k.add(leather, place(new THREE.CylinderGeometry(0.035, 0.035, 0.008, 20), [-0.12, 0.2, 0.034], [Math.PI / 2 - 0.2, 0, 0]));
        k.add(facing, place(new THREE.CylinderGeometry(0.024, 0.024, 0.01, 20), [-0.12, 0.2, 0.036], [Math.PI / 2 - 0.2, 0, 0]));
        k.add(mats.brass, ball(V(-0.12, 0.2, 0.044), 0.009, [1, 1, 0.6], 8));
        return { eyes: [iris], lids: [lid], lidOpen: -0.45, lidClosed: Math.PI / 2 + 0.05, extraGlow: [] };
      },
    };
  },
};

/** Where the opponent's fan sits, relative to handAnchor (cards.js holds them at this frame). */
const FAN_FRAME = quatE(-0.42, Math.PI, 0);
// The hand sits on the player's side of the fan's base, palm to the card backs, fingers across
// them toward the holder's right and the thumb round the front.
const FAN_AT = V(0.07, 0.155, 0.37), LEFT_GRIP = { p: V(-0.035, -0.064, -0.021), roll: -1.0 };
// Reading the hand (inspect): the fan's base raised toward the chin and the cards turned up to the eyes.
const FAN_UP = V(0.05, 0.3, 0.27), FAN_UP_TURN = quatE(-0.3, 0, 0);
const SHOULDER = 0.215, L1 = 0.27, L2 = 0.26;

/** Frame from where its +y and +z should point (z is made orthogonal to y). */
function frame(y, z, out = new THREE.Quaternion()) {
  _y.copy(y).normalize(); _z.copy(z); _z.addScaledVector(_y, -_z.dot(_y)).normalize(); _x.crossVectors(_y, _z);
  return out.setFromRotationMatrix(_m1.makeBasis(_x, _y, _z));
}

/** Every kit mesh receives shadows; only the parts big enough to throw a visible one cast them. */
function dress(meshes, design) { for (const m of meshes) { m.receiveShadow = true; m.castShadow = !design.noShadow?.includes(m.material); } }

/** Two bone groups and a hand bone hung under `upper` at shoulder `at`, posed by solveArm(). */
function buildArm(upper, at, design, handMesh) {
  const A = design.arm, O = V(0, 0, 0);
  const uArm = new THREE.Group(); uArm.position.copy(at); upper.add(uArm);
  const fArm = new THREE.Group(); fArm.position.y = -L1; uArm.add(fArm);
  const hand = new THREE.Group(); fArm.add(hand);
  const ka = new Kit(), kf = new Kit();
  ka.add(design.sleeve, tube(O, V(0, -L1, 0), A.shoulder, A.elbow, 16), ball(O, A.shoulder, 1, 16), ball(V(0, -L1, 0), A.elbow, 1, 14));
  design.shoulder?.(ka, O);
  // The sleeve stops short of the wrist in a hem with a recessed lining, so the wrist comes out of
  // an opening rather than butting into a flat cap.
  const end = -L2 + A.gap, rIn = A.wrist * 0.8;
  kf.add(design.sleeve, lathe([[0, end + 0.035], [rIn, end + 0.035], [rIn, end + 0.003], [(rIn + A.wrist) / 2, end - 0.0015], [A.wrist, end + 0.003], [A.wrist + (A.elbow - A.wrist) * 0.12, end + L2 * 0.12], [A.elbow, -0.002], [A.elbow * 0.5, 0.012]], 18));
  design.cuff(kf, O, V(0, end, 0));
  for (const [kit, bone] of [[ka, uArm], [kf, fArm]]) dress(kit.build(bone), design);
  hand.add(handMesh);
  return { upper: uArm, fore: fArm, hand, handMesh, pos: V(0, 0, 0), quat: new THREE.Quaternion() };
}

/**
 * Character reactions. Each is a 0..1 envelope driven by a critically damped spring toward its
 * target, so none starts or stops at full speed:
 *   lean     leaning in over the table (calling Liar, the reveal)
 *   tremble  holding the revolver
 *   flinch   one-shot jolt on the trigger click (a scripted pulse, see flinchAt)
 *   relief   sagging back after surviving
 *   reach    right hand goes to ch.reachTarget / ch.reachQuat (world), to pick the revolver up or lay it down
 *   aim      right hand raised beside the head, the muzzle at the right temple
 *   out      eliminated: lights out, eyes shut, slumped, arms limp, drained of colour
 *   inspect  the held fan raised close to the face to read it (only while it holds cards)
 * Three more follow the props: hold (cards in the left hand), grip (right hand closed) and glass
 * (the right hand shaped for a glass rather than the revolver: ch.grasp is 'glass' or 'gun').
 */
export function buildCharacter(designKey, angle) {
  const design = DESIGNS[designKey]();
  const group = new THREE.Group();
  group.position.set(Math.cos(angle) * SEAT_RADIUS, 0, Math.sin(angle) * SEAT_RADIUS);
  group.lookAt(0, 0, 0);
  scene.add(group);
  if (hasRig(designKey)) return riggedCharacter(designKey, design, group);
  const waist = new THREE.Group(); waist.position.y = -0.3; group.add(waist);
  const upper = new THREE.Group(); upper.position.y = 0.3; waist.add(upper);
  const neck = new THREE.Group(); neck.position.y = 0.36; upper.add(neck);
  const head = new THREE.Group(); head.position.y = 0.14; neck.add(head);

  // each morphed hand gets its own copy of the hand material: three rebuilds a material's program
  // state every time it alternates between meshes with different morph targets (1 left, 3 right)
  const handMat = design.hand.clone(), rightMat = design.hand.clone();
  const ku = new Kit(), kh = new Kit();
  const parts = design.torso(ku, upper) || {};
  if (parts.gem) upper.add(parts.gem);
  const face = design.head(kh, head, neck);
  dress(ku.build(upper), design); dress(kh.build(head), design);

  // Left arm: rests on the table edge, rises to hold the fan while it has cards. handAnchor hangs
  // off the hand at the fan's pivot; in the holding pose its frame is the upper body's own.
  const left = buildArm(upper, V(SHOULDER, 0.245, -0.01), design, leftHand(design.handOpts, handMat));
  const fanPose = new THREE.Matrix4().compose(FAN_AT, FAN_FRAME, V(1, 1, 1)).multiply(new THREE.Matrix4().compose(LEFT_GRIP.p, quatE(0, 0, LEFT_GRIP.roll), V(1, 1, 1)));
  const fan = { pos: V(0, 0, 0), quat: new THREE.Quaternion() };
  fanPose.decompose(fan.pos, fan.quat, _a);
  const fanUp = { pos: V(0, 0, 0), quat: new THREE.Quaternion() };
  new THREE.Matrix4().compose(FAN_UP, FAN_UP_TURN, V(1, 1, 1)).multiply(new THREE.Matrix4().makeTranslation(-FAN_AT.x, -FAN_AT.y, -FAN_AT.z)).multiply(fanPose).decompose(fanUp.pos, fanUp.quat, _a);
  const handAnchor = new THREE.Group(); left.hand.add(handAnchor);
  new THREE.Matrix4().copy(fanPose).invert().multiply(new THREE.Matrix4().makeTranslation(FAN_AT.x, FAN_AT.y, FAN_AT.z)).decompose(handAnchor.position, handAnchor.quaternion, handAnchor.scale);

  // Right arm: shoulder, upper arm, forearm and the revolver hand, posed every frame by two-bone IK.
  const right = buildArm(upper, V(-SHOULDER, 0.245, -0.01), design, rightHand(design.handOpts, rightMat));
  const grip = new THREE.Object3D(); right.hand.add(grip);

  // Aim in head space: barrel level and pointing into the temple, the muzzle 3 cm off it.
  const aimDir = AIM_DIR, aimQ = basis(V(0, 0, -1), aimDir);
  const muzzle = design.temple.clone().addScaledVector(aimDir, -0.03);
  const aimLocal = new THREE.Matrix4().compose(muzzle.sub(MUZZLE.clone().applyQuaternion(aimQ)), aimQ, V(1, 1, 1));

  const chair = new THREE.Mesh(chairGeometry(), mats.chair); chair.castShadow = true; chair.receiveShadow = true; group.add(chair);

  const glowMats = [...new Set([face.eyes[0].material, ...face.extraGlow])];
  const tints = [...design.tint, handMat, rightMat].map((m) => ({ m, base: m.color.clone(), sheen: m.sheenColor?.clone() }));
  return {
    group, waist, upper, neck, head, eyes: face.eyes, handAnchor, leftHand: left.hand,
    arm: right, leftArm: left, fan, fanUp, aimLocal, grip, reachTarget: new THREE.Vector3(), reachQuat: new THREE.Quaternion(),
    grasp: 'gun', glassAt: right.handMesh.userData.glass,
    lids: face.lids, lidOpen: face.lidOpen, lidClosed: face.lidClosed,
    parts, design, tints, tintAt: 0,
    glow: glowMats.map((m) => ({ m, base: m.emissiveIntensity })),
    eyeMat: face.eyes[0].material,
    ...freshState(),
  };
}

/** What every character starts with, however its body is made: where it looks, and its reactions at rest. */
const freshState = () => ({
  lookTarget: new THREE.Vector3(),
  yaw: 0, pitch: 0, lv: {}, phase: Math.random() * 6, breath: 0, blinkAt: rand(1, 4), blinkT: 1, flicker: 0,
  glanceAt: rand(1, 3), glanceYaw: 0, glancePitch: 0,
  flinchT: Infinity, flinchFrom: 0,
  env: { lean: 0, tremble: 0, flinch: 0, relief: 0, out: 0, aim: 0, reach: 0, hold: 0, grip: 0, glass: 0, inspect: 0 },
  target: { lean: 0, tremble: 0, relief: 0, out: 0, aim: 0, reach: 0, inspect: 0 },
  vel: {},
});

/** A character whose body is a loaded model (see rig.js); the same object the code-built ones are. */
function riggedCharacter(designKey, design, group) {
  const body = buildRigged(designKey, design, group);
  const chair = new THREE.Mesh(chairGeometry(), mats.chair); chair.castShadow = true; chair.receiveShadow = true; group.add(chair);
  return {
    group, ...body, design, reachTarget: new THREE.Vector3(), reachQuat: new THREE.Quaternion(), grasp: 'gun',
    tints: design.tint.map((m) => ({ m, base: m.color.clone(), sheen: m.sheenColor?.clone() })), tintAt: 0,
    glow: [body.eyeMat, ...body.extraGlow].map((m) => ({ m, base: m.emissiveIntensity })),
    ...freshState(),
  };
}

export function react(ch, kind, on = true) {
  if (kind === 'flinch') { ch.flinchT = 0; ch.flinchFrom = ch.env.flinch; return; }
  ch.target[kind] = on ? 1 : 0;
}
export function resetCharacter(ch) {
  for (const k of Object.keys(ch.target)) ch.target[k] = 0;
  ch.flicker = 0;
}
export const tell = (ch, seconds = 1.3) => { ch.flicker = seconds; };
export const headWorld = (ch, out) => ch.head.getWorldPosition(out);
/** A shot to the right temple, in head space: where it goes in, where it comes out, and its line. */
export const wound = (ch) => ({ head: ch.head, entry: ch.design.temple, exit: V(-ch.design.temple.x, ch.design.temple.y, ch.design.temple.z), dir: AIM_DIR });

/**
 * The flinch pulse at `t` seconds after the click: a 90 ms rise that leaves and arrives at rest
 * (smootherstep), then a critically damped fall that also leaves at rest. Velocity is continuous
 * throughout, and the rise's peak acceleration stays within what the head can do smoothly.
 */
const FLINCH_RISE = 0.09, FLINCH_W = 9;
function flinchAt(t, from) {
  if (t < FLINCH_RISE) { const u = t / FLINCH_RISE; return from + (1 - from) * u * u * u * (u * (u * 6 - 15) + 10); }
  const x = (t - FLINCH_RISE) * FLINCH_W;
  return (1 + x) * Math.exp(-x);
}

/** Drains colour toward a dim grey as a character goes out. Only touches materials on change. */
function applyTint(ch, k) {
  if (Math.abs(k - ch.tintAt) < 0.004) return;
  ch.tintAt = k;
  for (const t of ch.tints) {
    const l = t.base.r * 0.3 + t.base.g * 0.59 + t.base.b * 0.11;
    t.m.color.copy(t.base).lerp(_c.setRGB(l, l, l), k * 0.75).multiplyScalar(1 - k * 0.35);
    if (t.sheen) t.m.sheenColor.copy(t.sheen).multiplyScalar(1 - k * 0.8);
  }
}

/* ---------- arms ---------- */
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4(), _p1 = new THREE.Vector3(), _s1 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion();
const _S = new THREE.Vector3(), _W = new THREE.Vector3(), _E = new THREE.Vector3(), _n = new THREE.Vector3(), _pole = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

/** Grip-frame orientation from the grip's +x (the shooter's left) and barrel (+z) directions. */
function basis(x, z, out = new THREE.Quaternion()) {
  _z.copy(z).normalize(); _y.crossVectors(_z, _x.copy(x)).normalize(); _x.crossVectors(_y, _z);
  return out.setFromRotationMatrix(_m1.makeBasis(_x, _y, _z));
}
/** Bone orientation whose -y runs from `from` to `to` and whose +z leans toward `bend`. */
function boneQuat(from, to, bend, out) {
  _y.subVectors(from, to).normalize(); _z.copy(bend).addScaledVector(_y, -bend.dot(_y)).normalize(); _x.crossVectors(_y, _z);
  return out.setFromRotationMatrix(_m1.makeBasis(_x, _y, _z));
}

// Poses resting on the table are in seat (group) space so they stay put when the body leans; the
// rest are in upper-body space.
// Right hand, palm down beside the fan with the fingers loose; its grip x points down.
const REST = { pos: V(-0.2, 0.017, 0.41), quat: basis(V(0, -1, 0), V(-0.25, 0, 1)) };
const LIMP = { pos: V(-0.27, -0.2, 0.12), quat: basis(V(1, 0, 0), V(0, -1, 0.25)) };
// Left hand, palm down on the table edge, fingers toward the table's middle.
const LEFT_REST = { pos: V(0.19, 0.03, 0.355), quat: frame(V(-0.28, -0.06, 1), V(0, -1, 0)) };
const LEFT_LIMP = { pos: V(0.26, -0.19, 0.1), quat: frame(V(0, -1, 0.25), V(-1, 0, 0)) };

/** Brings a seat-space pose into upper-body space (the body may be leaning or slumped). */
function fromSeat(ch, pose, pos, quat) {
  _m3.copy(ch.upper.matrixWorld).invert().multiply(ch.group.matrixWorld);
  pos.copy(pose.pos).applyMatrix4(_m3);
  return quat.setFromRotationMatrix(_m3).multiply(pose.quat);
}

// A wrist target out of reach eases onto the straight arm instead of hitting it: a hard clamp
// would stop the hand dead mid-move (a kink in its velocity) whenever a pose passes the limit.
const REACH_MAX = L1 + L2 - 0.002, REACH_KNEE = REACH_MAX - 0.02;
const reachLimit = (d) => (d <= REACH_KNEE ? d : REACH_KNEE + (REACH_MAX - REACH_KNEE) * (1 - Math.exp((REACH_KNEE - d) / (REACH_MAX - REACH_KNEE))));

/** Two-bone IK from the shoulder to the wrist the hand pose implies, elbow bent toward `pole`. */
const ELBOW_SWAY = 0.6;
/**
 * `fore`, if given, is the hand's own direction up its forearm, in the hand's frame: the elbow then
 * swings toward where the hand says the forearm should come from, so the wrist bends less. The hand
 * itself always keeps exactly the pose asked for, since the revolver and the cards are held in it.
 */
function solveArm(arm, wrist, fore, pole, sway = ELBOW_SWAY) {
  const { pos, quat } = arm;
  _W.copy(wrist).applyQuaternion(quat).add(pos);
  _S.copy(arm.upper.position);
  _d.subVectors(_W, _S); const dist = Math.max(0.08, reachLimit(_d.length())); _d.normalize();
  _W.copy(_S).addScaledVector(_d, dist);
  const cosA = clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  // the elbow the hand would like: one forearm back from the wrist along the hand's own line
  if (fore) _x.copy(fore).applyQuaternion(quat).multiplyScalar(L2).add(_W).sub(_S).addScaledVector(_d, -_x.dot(_d));
  else _x.set(0, 0, 0);
  _n.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize();
  // swing the elbow round the shoulder-wrist line toward that, but only so far: past ELBOW_SWAY it
  // would fold in through the chest or out behind the back
  if (_x.lengthSq() > 1e-8) {
    _x.normalize();
    const swing = Math.atan2(_y.crossVectors(_n, _x).dot(_d), _n.dot(_x));
    _n.applyAxisAngle(_d, clamp(swing, -sway, sway));
  }
  _E.copy(_S).addScaledVector(_d, cosA * L1).addScaledVector(_n, sinA * L1);
  boneQuat(_S, _E, _n, _q2); arm.upper.quaternion.copy(_q2);
  boneQuat(_E, _W, _n, _q3); arm.fore.quaternion.copy(_q2).invert().multiply(_q3);
  arm.hand.quaternion.copy(_q3).invert().multiply(quat);
  arm.hand.position.copy(wrist).applyQuaternion(arm.hand.quaternion).negate(); arm.hand.position.y -= L2;
}

/**
 * Re-solve a character's right arm to a grip pose in upper-body space, over its own pose this frame.
 * `pole`, if given, is where the elbow points (upper-body space, +z forward); `free` (0..1) scales how
 * far the elbow may still swing toward the hand's line, so a pose can fade that out and back in.
 */
export function poseRightHand(ch, pos, quat, pole, free = 1) {
  ch.arm.pos.copy(pos); ch.arm.quat.copy(quat);
  solveArm(ch.arm, ch.arm.handMesh.userData.wrist, ch.arm.handMesh.userData.fore, pole ? _pole.copy(pole).normalize() : _pole.set(-1, -0.7, -0.1).normalize(), ELBOW_SWAY * free);
}

const _sw = new THREE.Vector3(), _sr = new THREE.Vector3(), _sg = new THREE.Vector3(), _su = new THREE.Vector3();
const _sf = new THREE.Quaternion(), _sh = new THREE.Quaternion(), _st = new THREE.Quaternion(), _Y = new THREE.Vector3(0, 1, 0);
/**
 * A drinking hand's grip pose (upper-body space) with the wrist kept nearly straight: the arm is
 * solved with its elbow toward `pole`, the hand runs on along the forearm, turned about it so the
 * held glass leans toward `up` (base to rim), with at most `give` radians of wrist bend to get
 * closer. The wrist is moved until the glass's rim is at `rim`. Poses ch.arm as a side effect.
 */
export function straightGrip(ch, rim, up, pole, give, pos, quat) {
  const arm = ch.arm, wrist = arm.handMesh.userData.wrist, fore = arm.handMesh.userData.fore, gl = ch.glassAt;
  _sw.copy(rim);
  quat.copy(arm.quat);
  for (let k = 0; k < 3; k++) {
    arm.quat.copy(quat); arm.pos.copy(wrist).applyQuaternion(quat).negate().add(_sw);
    solveArm(arm, wrist, null, _pole.copy(pole).normalize(), 0);
    _sf.copy(arm.upper.quaternion).multiply(arm.fore.quaternion);
    // straight: the hand's own forearm line along the forearm (+y in its frame)
    _sh.setFromUnitVectors(fore, _Y);
    // turned about the forearm so the glass leans toward `up`
    _sg.set(0, 1, 0).applyQuaternion(gl.quat).applyQuaternion(_sh);
    _su.copy(up).applyQuaternion(_st.copy(_sf).invert());
    _sh.premultiply(_st.setFromAxisAngle(_Y, Math.atan2(_su.x, _su.z) - Math.atan2(_sg.x, _sg.z)));
    // and a little wrist bend, no more than `give`, to stand it up further
    _sg.set(0, 1, 0).applyQuaternion(gl.quat).applyQuaternion(_sh);
    const miss = _sg.angleTo(_su);
    if (miss > 1e-4) _sh.premultiply(_st.setFromAxisAngle(_sr.crossVectors(_sg, _su).normalize(), Math.min(miss, give)));
    quat.copy(_sf).multiply(_sh);
    // where the rim ended up, and the wrist moved by the miss
    _sr.set(0, GLASS_H_HAND, 0).applyQuaternion(gl.quat).add(gl.pos).sub(wrist).applyQuaternion(quat).add(_sw);
    _sw.add(_sg.subVectors(rim, _sr));
  }
  arm.quat.copy(quat);
  return pos.copy(wrist).applyQuaternion(quat).negate().add(_sw);
}

/**
 * The grip-frame pose (world) of a hand holding a glass that stands upright at `base`, reached
 * from `from` (a shoulder). Given `fore` (the hand's own line up its forearm, userData.fore), the
 * forearm comes straight from the shoulder, thumb up, the fingers round the glass's far side.
 * Without it the palm faces the glass as seen from `from`.
 */
export function glassGrip(glassAt, base, from, pos, quat, fore) {
  _d.subVectors(fore ? from : base, fore ? base : from).setY(0).normalize();
  _q.copy(glassAt.quat).invert(); (fore ? _a.copy(fore) : _a.set(1, 0, 0)).applyQuaternion(_q);
  quat.setFromAxisAngle(UP, Math.atan2(_d.x, _d.z) - Math.atan2(_a.x, _a.z)).multiply(_q);
  return pos.copy(glassAt.pos).applyQuaternion(quat).negate().add(base);
}

function poseArms(ch, t) {
  const E = ch.env, live = 1 - E.out;
  ch.head.updateWorldMatrix(true, false);
  _m2.copy(ch.upper.matrixWorld).invert();

  const arm = ch.arm, pos = arm.pos, quat = arm.quat;
  fromSeat(ch, REST, pos, quat);
  pos.y += Math.sin(t * 0.9 + ch.phase) * 0.0015 * live;
  if (E.reach > 0.001) {
    // the grip frame lands on the revolver's own pose (palm down on its upturned right panel) a
    // little above it, so closing the hand lifts it straight up without turning it
    _p1.copy(ch.reachTarget).applyMatrix4(_m2);
    _q1.setFromRotationMatrix(_m2).multiply(ch.reachQuat);
    pos.lerp(_p1.add(_s1.set(0, 0.006, 0)), E.reach); quat.slerp(_q1, E.reach);
    // an arc rather than a straight line, so the hand lifts clear of the table on the way
    pos.y += bell(E.reach) * 0.035;
  }
  if (E.aim > 0.001) {
    _m1.multiplyMatrices(_m2, ch.head.matrixWorld).multiply(ch.aimLocal).decompose(_p1, _q1, _s1);
    const sh = E.tremble * live;
    _p1.x += (Math.sin(t * 41) + Math.sin(t * 23.7)) * 0.0022 * sh;
    _p1.y += (Math.sin(t * 37.3) + Math.sin(t * 13.1)) * 0.0028 * sh;
    _p1.z += Math.sin(t * 29.9) * 0.002 * sh;
    pos.lerp(_p1, E.aim); quat.slerp(_q1, E.aim);
    // swing out round the shoulder instead of cutting through the chest
    const b = bell(E.aim) * live; pos.x -= b * 0.07; pos.z += b * 0.05;
  }
  if (E.out > 0.001) { pos.lerp(LIMP.pos, E.out); quat.slerp(LIMP.quat, E.out); }
  // elbow out to the side and down; raised to the temple it swings out and a little forward
  solveArm(arm, arm.handMesh.userData.wrist, arm.handMesh.userData.fore, _pole.set(-1, -0.75 + E.aim * 0.3, -0.25 + E.aim * 0.5).normalize());
  // the hand opens wide as it goes to take hold of something, and closes round it as it arrives
  shapeHand(arm.handMesh, E.grip * (1 - E.glass), E.grip * E.glass, smoothstep(0, 0.5, E.reach) * (1 - E.grip) * live);

  const la = ch.leftArm;
  fromSeat(ch, LEFT_REST, la.pos, la.quat);
  la.pos.y += Math.sin(t * 0.8 + ch.phase + 2) * 0.0012 * live;
  if (E.hold > 0.001) { la.pos.lerp(ch.fan.pos, E.hold); la.quat.slerp(ch.fan.quat, E.hold); la.pos.y += bell(E.hold) * 0.025; }
  const up = E.inspect * E.hold;
  if (up > 0.001) { la.pos.lerp(ch.fanUp.pos, up); la.quat.slerp(ch.fanUp.quat, up); }
  if (E.hold > 0.001) {
    // leaning in or reaching tips the upper body forward, which would lower the held fan into the
    // felt; the fan keeps at least the height it has sitting upright
    _m1.copy(ch.group.matrixWorld).invert().multiply(ch.upper.matrixWorld);
    const y = _p1.copy(la.pos).applyMatrix4(_m1).y, floor = ch.fan.pos.y - 0.01;
    if (y < floor) la.pos.y += (floor - y) * E.hold;
  }
  if (E.out > 0.001) { la.pos.lerp(LEFT_LIMP.pos, E.out); la.quat.slerp(LEFT_LIMP.quat, E.out); }
  solveArm(la, LEFT_WRIST, null, _pole.set(1, -0.75, -0.25).normalize());
  la.handMesh.morphTargetInfluences[0] = E.hold;
  // movers parented to the hands read these world matrices for their velocity
  ch.handAnchor.updateWorldMatrix(true, false); ch.grip.updateWorldMatrix(true, false);
}

// Smoothing time per envelope (s): about how long it takes to arrive, leaving and landing at rest.
const SMOOTH = { lean: 0.3, tremble: 0.25, relief: 0.3, aim: 0.3, reach: 0.27, out: 0.55, hold: 0.3, grip: 0.09, glass: 0.12, inspect: 0.3 };
const LOOK_SMOOTH = 0.3;
const bell = (k) => 4 * k * (1 - k);
const smoothstep = (a, b, v) => { const u = clamp((v - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };

export function updateCharacter(ch, dt, t) {
  const E = ch.env, T = ch.target, vel = ch.vel;
  // The right hand closes as it arrives at the revolver and stays closed while it holds it. While
  // the revolver is still flying into the palm the hand waits where it reached, and only then
  // raises it; swinging the target round mid-flight can flip the flight's rotation path.
  const held = ch.grip.children[0], settling = !!held && ch.grasp === 'gun' && held.position.lengthSq() > 1e-10;
  // a glass is taken as the hand arrives round it; the revolver's grip a little before
  const glass = ch.grasp === 'glass' ? 1 : 0;
  const grip = held || T.aim ? 1 : T.reach ? smoothstep(glass ? 0.75 : 0.45, glass ? 0.97 : 0.9, E.reach) : 0;
  const hold = ch.handAnchor.children.length > 0 && !T.out ? 1 : 0;
  for (const k in SMOOTH) {
    const goal = k === 'grip' ? grip : k === 'glass' ? glass : k === 'hold' ? hold : k === 'reach' ? +(T.reach || settling) : k === 'aim' ? +(T.aim && !settling) : T[k];
    E[k] = clamp(smoothDamp(E[k], goal, vel, k, SMOOTH[k], dt), 0, 1);
  }
  ch.flinchT += dt;
  E.flinch = ch.flinchT < 3 ? flinchAt(ch.flinchT, ch.flinchFrom) : 0;
  const live = 1 - E.out;

  // Glances: every few seconds the gaze drifts a little off its subject and back, so a held look
  // never reads as locked on. The drift rides the same look spring, so it starts and lands at rest.
  if (t > ch.glanceAt) {
    const away = Math.random() < 0.65;
    ch.glanceYaw = away ? rand(-0.14, 0.14) : 0; ch.glancePitch = away ? rand(-0.03, 0.07) : 0;
    ch.glanceAt = t + rand(1.4, 4.2);
  }
  const roam = live * (1 - E.aim) * (1 - E.lean * 0.7);
  ch.group.worldToLocal(_a.copy(ch.lookTarget)); _a.y -= 0.5;
  const yaw = clamp(Math.atan2(_a.x, _a.z) + ch.glanceYaw * roam, -1, 1), pitch = clamp(-Math.atan2(_a.y, Math.hypot(_a.x, _a.z)) + ch.glancePitch * roam, -0.45, 0.6);
  ch.yaw = smoothDamp(ch.yaw, yaw, ch.lv, 'y', LOOK_SMOOTH, dt);
  ch.pitch = smoothDamp(ch.pitch, pitch, ch.lv, 'p', LOOK_SMOOTH, dt);

  const jitter = E.tremble * live;
  const tx = (Math.sin(t * 47) + Math.sin(t * 31.3)) * 0.004 * jitter;
  // integrate the phase: scaling t by a changing rate would race the phase and shake the body
  ch.breath += dt * (1.7 + jitter * 2);
  // a quicker in-breath and a longer out-breath
  const bp = ch.breath + ch.phase, breath = Math.sin(bp) + Math.sin(2 * bp) * 0.22;
  // weight shifting in the seat: two slow incommensurate sways, too slow to read as a loop
  const ph = ch.phase, sway = (Math.sin(t * 0.21 + ph) * 0.6 + Math.sin(t * 0.37 + ph * 2.3) * 0.4) * live;
  const drift = (Math.sin(t * 0.29 + ph * 1.7) * 0.6 + Math.sin(t * 0.53 + ph * 0.6) * 0.4) * live;
  const lean = E.out * 0.42 + E.lean * 0.16 - E.flinch * 0.045 - E.relief * 0.08;
  if (ch.rig) updateRig(ch, dt, t, tx, sway, drift); else {
  ch.waist.rotation.x = lean + drift * 0.012;
  ch.waist.rotation.y = sway * 0.03;
  ch.waist.rotation.z = tx * 2 + E.out * 0.12 + sway * 0.014;
  // the chest lifts with each breath and the shoulders ride on it; the neck keeps the gaze level
  ch.upper.rotation.x = -breath * 0.007 * live;
  ch.upper.position.y = 0.3 + breath * 0.0045 * live - E.out * 0.04 - E.flinch * 0.008 - E.relief * 0.008;
  ch.neck.rotation.y = ch.yaw * live * (1 - E.aim * 0.65) + tx * 2 + E.out * 0.25 - sway * 0.03 * live;
  ch.neck.rotation.x = (breath * 0.006 - (lean - E.out * 0.42) * 0.55 - drift * 0.01) * live;
  ch.head.rotation.x = ch.pitch * 0.7 * live + E.out * 0.75 - E.flinch * 0.085 + E.relief * -0.12;
  ch.head.rotation.z = E.out * 0.32 + (Math.sin(t * 0.7 + ph) * 0.016 + Math.sin(t * 0.43 + ph * 3.1) * 0.012 - sway * 0.012) * live + tx * 2.5;
  poseArms(ch, t);
  }

  // A blink shuts fast and opens slower; now and then a second follows straight after.
  if (t > ch.blinkAt) { ch.blinkT = 0; ch.blinkAt = t + rand(2.2, 5.5); if (Math.random() < 0.18) ch.blinkAt = t + 0.3; }
  ch.blinkT += dt;
  const b = ch.blinkT / 0.24, blink = b >= 1 ? 0 : b < 0.3 ? smoothstep(0, 0.3, b) : 1 - smoothstep(0.3, 1, b);
  const shut = Math.max(blink, E.out, E.flinch * 0.9, E.relief * 0.35 * live);
  const lid = ch.lidOpen + (ch.lidClosed - ch.lidOpen) * shut;
  for (const l of ch.lids) l.rotation.x = lid;
  ch.flicker = Math.max(0, ch.flicker - dt);
  const flicker = ch.flicker > 0 ? (Math.sin(t * 60) > 0.2 ? 0.12 : 1.15) : 1;
  for (const g of ch.glow) g.m.emissiveIntensity = g.base * live * live * (g.m === ch.eyeMat ? flicker : 1);
  ch.design.update?.(ch, dt, t, E);
  applyTint(ch, E.out);
}
