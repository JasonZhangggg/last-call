// Characters loaded from a .glb (tools/models/<name>.py writes it): a skeleton, one skinned mesh,
// sockets for what the hands hold, and keyed clips.
//
// How a rigged character moves each frame (updateRig):
//   1. An AnimationMixer plays `idle` and adds the other clips on top as layers. The layers are
//      driven by the same reaction envelopes and targets as the code-built characters, so the
//      modes and the director drive both kinds the same way (react, tell, ch.env, ch.grip ...).
//   2. A little procedural motion goes on top: the gaze, slow weight shifts, a tremble.
//   3. Contact correction: a two-bone solve per arm moves the hand the last of the way onto what
//      it touches (the table at rest, the revolver, the temple, the fan, the lip) and leaves the
//      clip's own motion alone in between.
//   4. Collision: the elbow, forearm, wrist and the held prop are kept out of the torso and head
//      (TORSO, HEAD below, in the chest's and head's own spaces) and above the table top.
//
// Every bone's rest rotation is the identity and its axes are the character's (+y up, +z to the
// table), so the chest, neck and head bones stand in for the old `upper`, `neck` and `head` groups.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { smoothDamp } from './motion.js';
import { TABLE } from './world.js';
import { MUZZLE } from './gun.js';
import { clamp } from '../util.js';
// fetched beside the page (the Worker serves them, the build copies them into dist/models)
const SOURCES = { brass: 'models/brass.glb', gristle: 'models/gristle.glb' };
const LOADED = {};

/** Parses every character model. A model that fails to load leaves its character code-built. */
export async function loadRigs() {
  const loader = new GLTFLoader();
  await Promise.all(Object.entries(SOURCES).map(async ([key, url]) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      LOADED[key] = await loader.parseAsync(await res.arrayBuffer(), '');
    }
    catch (err) { console.warn(`model ${key} did not load; using the code-built body`, err); }
  }));
}
export const hasRig = (key) => !!LOADED[key];

const L1 = 0.27, L2 = 0.26;
// Collision shapes (Brass's; a design's `rig` gives its own). The torso is a capsule with an
// elliptical section in the chest's space; the head is a rounded box in the head's space.
export const TORSO = { y0: -0.22, y1: 0.2, rx: 0.243, rz: 0.194, ry: 0.17 };
export const HEAD = { half: new THREE.Vector3(0.135, 0.12, 0.115), round: 0.02 };
// What else differs between the rigged bodies, by node and material name; a design's `rig` overrides it.
const FACE = { eye: 'lens', glow: ['tip'], lids: ['lid'], lidOpen: -0.25, lidClosed: Math.PI / 2 - 0.05, parts: ['needle'], torso: TORSO, head: HEAD };
// the shapes of the character being posed
let TS = TORSO, HS = HEAD;
const UPPER_R = 0.046, ELBOW_R = 0.056, FORE_R = 0.043, WRIST_R = 0.037, GLASS_R = 0.024, BARREL_R = 0.014, FINGER_FLOOR = 0.016;

const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _tp = new THREE.Vector3(), _tq = new THREE.Quaternion(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3();
const _S = new THREE.Vector3(), _W = new THREE.Vector3(), _E = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _mb = new THREE.Matrix4();
const _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _qc = new THREE.Quaternion(), _qe = new THREE.Quaternion(), _e = new THREE.Euler();
const _t = new THREE.Vector3(), _m0 = new THREE.Vector3(), _m1 = new THREE.Vector3(), _hm = new THREE.Matrix4();
const IDENTITY = new THREE.Quaternion();
const smoothstep = (a, b, v) => { const u = clamp((v - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };

/** How deep a ball of radius r at p (chest space) sits in the torso: 1 on its surface, less inside. */
function torsoLevel(p, r) {
  const dy = Math.max(0, p.y - TS.y1, TS.y0 - p.y);
  return Math.hypot(p.x / (TS.rx + r), p.z / (TS.rz + r), dy / (TS.ry + r));
}
/** Moves p (chest space) out of the torso sideways, the way an arm slides round a barrel. */
function clearTorso(p, r) {
  const dy = Math.max(0, p.y - TS.y1, TS.y0 - p.y) / (TS.ry + r);
  if (dy >= 1) return 0;
  const k = Math.hypot(p.x / (TS.rx + r), p.z / (TS.rz + r)), want = Math.sqrt(1 - dy * dy);
  if (k >= want) return 0;
  const before = Math.hypot(p.x, p.z), f = want / Math.max(k, 1e-4);
  if (k < 1e-4) p.x = -(TS.rx + r) * want; else { p.x *= f; p.z *= f; }
  return Math.hypot(p.x, p.z) - before;
}
/** Moves p (head space) out of the head. */
function clearHead(p, r) {
  const h = HS.half, qx = Math.abs(p.x) - h.x, qy = Math.abs(p.y) - h.y, qz = Math.abs(p.z) - h.z;
  const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)), d = out + Math.min(Math.max(qx, qy, qz), 0) - HS.round - r;
  if (d >= 0) return 0;
  if (out > 1e-5) { const f = -d / out; p.x += Math.sign(p.x) * Math.max(qx, 0) * f; p.y += Math.sign(p.y) * Math.max(qy, 0) * f; p.z += Math.sign(p.z) * Math.max(qz, 0) * f; }
  // inside the box itself: out through the nearest face
  else if (qx >= qy && qx >= qz) p.x += (Math.sign(p.x) || -1) * -d; else if (qz >= qy) p.z += (Math.sign(p.z) || 1) * -d; else p.y += (Math.sign(p.y) || 1) * -d;
  return -d;
}

/** Bone orientation whose -y runs from `from` to `to` and whose +z leans toward `bend`. */
function boneQuat(from, to, bend, out) {
  _y.subVectors(from, to).normalize(); _z.copy(bend).addScaledVector(_y, -bend.dot(_y)).normalize(); _x.crossVectors(_y, _z);
  return out.setFromRotationMatrix(_mb.makeBasis(_x, _y, _z));
}
const REACH_MAX = L1 + L2 - 0.002, REACH_KNEE = REACH_MAX - 0.02;
const reachLimit = (d) => (d <= REACH_KNEE ? d : REACH_KNEE + (REACH_MAX - REACH_KNEE) * (1 - Math.exp((REACH_KNEE - d) / (REACH_MAX - REACH_KNEE))));

/* ---------- loading ---------- */

/**
 * Clips other than `idle` become additive layers: each key is kept as its difference from the rest
 * pose (idle's first frame, or the bind pose for a bone idle doesn't move), so a layer adds its
 * motion to whatever plays underneath.
 */
function additive(clip, idle) {
  if (clip.blendMode === THREE.AdditiveAnimationBlendMode) return clip;
  for (const track of clip.tracks) {
    const ref = idle.tracks.find((t) => t.name === track.name), v = track.values;
    if (track.name.endsWith('.quaternion')) {
      if (ref) _q.fromArray(ref.values, 0).invert(); else _q.identity();
      for (let i = 0; i < v.length; i += 4) _tq.fromArray(v, i).premultiply(_q).toArray(v, i);
    } else if (track.name.endsWith('.position') && ref) {
      for (let i = 0; i < v.length; i += 3) { v[i] -= ref.values[0]; v[i + 1] -= ref.values[1]; v[i + 2] -= ref.values[2]; }
    }
  }
  clip.blendMode = THREE.AdditiveAnimationBlendMode;
  return clip;
}

const LAYERS = ['reach', 'aim', 'hold_cards', 'hold_glass', 'drink', 'flinch', 'lean', 'slump'];
const SHAPES = ['fist_r', 'glass_r', 'spread_r', 'fan_l'];
// how long a layer takes to blend away once its cause is gone (s, as smoothDamp's time)
const FADE_OUT = 0.2, SWAP = 0.05;

function armOf(root, chest, side, control) {
  const bone = (n) => root.getObjectByName(n + side);
  const a = { clav: bone('clavicle'), upper: bone('upperarm'), elbow: bone('elbow'), fore: bone('forearm'), wristBone: bone('hand'), hand: control, pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  // the control frame against its bone: the wrist joint and the forearm's line in that frame
  control.updateMatrix();
  a.rc = control.quaternion.clone().invert();
  a.wrist = control.position.clone().negate().applyQuaternion(a.rc);
  a.foreDir = new THREE.Vector3(0, 1, 0).applyQuaternion(a.rc);
  a.handMesh = { userData: { wrist: a.wrist, fore: a.foreDir } };
  a.sign = side === 'R' ? -1 : 1;
  a.tips = ['index3', 'middle3', 'ring3', 'little3', 'thumb3'].map(bone);
  return a;
}

/** The body of a rigged character: everything buildCharacter returns that is made of bones. */
export function buildRigged(key, design, group) {
  const gltf = LOADED[key], root = gltf.scene, M = design.mats, F = { ...FACE, ...design.rig };
  group.add(root);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mat = M[o.material.name];
    if (!mat) throw new Error(`model ${key} uses a material the design does not have: ${o.material.name}`);
    o.material = mat; o.receiveShadow = true; o.castShadow = !design.noShadow?.includes(mat);
    // a skinned mesh is culled by its rest pose's bounds, and a leaning body leaves them
    o.frustumCulled = false;
  });
  const node = (n) => { const o = root.getObjectByName(n); if (!o) throw new Error(`model ${key} has no node ${n}`); return o; };
  const chest = node('chest'), head = node('head');
  const grip = node('grip_gun'), glass = node('grip_glass'), palm = node('palm_l');
  const right = armOf(root, chest, 'R', grip), left = armOf(root, chest, 'L', palm);
  // a held glass's pose in the grip frame
  glass.updateMatrix(); grip.updateMatrix();
  const glassAt = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  _m.copy(grip.matrix).invert().multiply(glass.matrix).decompose(glassAt.pos, glassAt.quat, _s);
  right.handMesh.userData.glass = glassAt;

  const clips = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));
  const mixer = new THREE.AnimationMixer(root);
  const idle = mixer.clipAction(clips.idle); idle.play();
  const layer = {}, shape = {};
  for (const name of LAYERS) {
    const action = mixer.clipAction(additive(clips[name], clips.idle));
    action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.setEffectiveWeight(0); action.play();
    layer[name] = { action, w: 0, on: false, v: {} };
  }
  for (const name of SHAPES) {
    const action = mixer.clipAction(additive(clips[name], clips.idle));
    action.setEffectiveWeight(0); action.play(); action.paused = true;
    shape[name] = action;
  }
  const rig = {
    root, mixer, idle, layer, shape, chest, head, hips: node('hips'), mouth: node('mouth'),
    targets: { restR: node('rest_r'), restL: node('rest_l'), aim: node('aim'), fan: node('fan_hold'), fanUp: node('fan_up') },
    sip: { hold: 0, tip: 0, was: 0 }, fanFloor: 0, colliders: { TORSO: F.torso, HEAD: F.head },
  };
  rig.fanFloor = node('fan_hold').position.y - 0.01;
  rig.post = [node('spine'), node('neck'), head, right.upper, right.fore, right.wristBone, left.upper, left.fore, left.wristBone];
  rig.postQ = rig.post.map((b) => b.quaternion.clone()); rig.chestY = chest.position.y;
  return {
    rig, waist: node('spine'), upper: chest, neck: node('neck'), head,
    arm: right, leftArm: left, grip, handAnchor: node('fan'), leftHand: palm, glassAt,
    eyes: [], eyeMat: M[F.eye], extraGlow: F.glow.map((n) => M[n]), lids: F.lids.map(node), lidOpen: F.lidOpen, lidClosed: F.lidClosed,
    parts: Object.fromEntries(F.parts.map((n) => [n, node(n)])),
  };
}

/** The drink, from src/modes/dice.js: `hold` has the glass held before the chest, `tip` drinks from it. */
export function rigSip(ch, hold, tip) { ch.rig.sip.hold = hold; ch.rig.sip.tip = tip; }

/* ---------- per frame ---------- */

/** Turns a layer on or off. Turned on from nothing, its clip plays from the start. */
function drive(l, on, dt, out = FADE_OUT) {
  if (on && !l.on && l.w < 0.05) { l.action.reset(); l.w = 1; l.v.w = 0; }
  l.on = on;
  if (on) l.w = l.w > 0.995 ? 1 : smoothDamp(l.w, 1, l.v, 'w', SWAP, dt);
  else if (l.w > 0) { l.w = smoothDamp(l.w, 0, l.v, 'w', out, dt); if (l.w < 0.002) l.w = l.v.w = 0; }
  l.action.setEffectiveWeight(l.w);
}

/** A node's world pose brought into the chest's space. */
function inChest(rig, node, pos, quat) {
  _m.multiplyMatrices(_inv, node.matrixWorld).decompose(pos, quat, _s);
}

// the elbow's circle round the shoulder-to-wrist line, for the solve in hand
let _cos = 0, _sin = 0;
function elbowAt(phi) { _b.copy(_n).applyAxisAngle(_d, phi); return _E.copy(_S).addScaledVector(_d, _cos * L1).addScaledVector(_b, _sin * L1); }
function elbowClear(phi) {
  elbowAt(phi);
  return torsoLevel(_E, ELBOW_R) >= 1 && aboveTable(_E, ELBOW_R) && torsoLevel(_c.lerpVectors(_S, _E, 0.62), UPPER_R) >= 1
    && torsoLevel(_c.lerpVectors(_E, _W, 0.5), FORE_R) >= 1 && aboveTable(_c, FORE_R)
    && torsoLevel(_c.lerpVectors(_E, _W, 0.8), FORE_R) >= 1 && aboveTable(_c, FORE_R);
}
/** Whether a ball at p (chest space) is clear of the table: off its edge, or resting on its top. */
let _chestWorld = null;
function aboveTable(p, r) {
  _t.copy(p).applyMatrix4(_chestWorld);
  return _t.y >= r || Math.hypot(_t.x, _t.z) > TABLE.radius + r;
}

/**
 * Solves one arm so its control frame sits at a.pos / a.quat (chest space), the elbow bent the way
 * the clip had it and swung clear of the torso, and writes the bones.
 */
function solveArm(a, gun) {
  const pos = a.pos, quat = a.quat;
  _qc.copy(a.clav.quaternion);
  _S.copy(a.upper.position).applyQuaternion(_qc).add(a.clav.position);
  // where the clip left the elbow, before anything is moved
  _E.copy(a.fore.position).applyQuaternion(a.upper.quaternion).applyQuaternion(_qc).add(_S);
  // the wrist, and a held revolver's barrel, stay out of the torso; the hand is carried along
  _v.copy(a.wrist).applyQuaternion(quat).add(pos); _w.copy(_v);
  if (clearTorso(_w, WRIST_R)) pos.add(_w.sub(_v));
  if (gun) for (let k = 1; k > 0.4; k -= 0.5) {
    _v.copy(MUZZLE).multiplyScalar(k).applyQuaternion(quat).add(pos); _w.copy(_v);
    if (clearTorso(_w, BARREL_R)) pos.add(_w.sub(_v));
  }
  _W.copy(a.wrist).applyQuaternion(quat).add(pos);
  _d.subVectors(_W, _S); const dist = Math.max(0.08, reachLimit(_d.length())); _d.normalize();
  _W.copy(_S).addScaledVector(_d, dist);
  _cos = clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1); _sin = Math.sqrt(1 - _cos * _cos);
  _n.subVectors(_E, _S).addScaledVector(_d, -_n.dot(_d));
  if (_n.lengthSq() < 1e-8) _n.set(a.sign, -0.75, -0.25).addScaledVector(_d, -_n.dot(_d));
  _n.normalize();
  // swing the elbow round that line, outward, until it and the forearm clear the torso
  let phi = 0;
  if (!elbowClear(0)) {
    // outward is whichever way takes the elbow further from the body's middle
    const dir = Math.abs(elbowAt(0.2).x) >= Math.abs(elbowAt(-0.2).x) ? 1 : -1;
    let lo = 0, hi = 0, found = false;
    for (let k = 1; k <= 12 && !found; k++) { hi = dir * k * 0.15; if (elbowClear(hi)) found = true; else lo = hi; }
    if (found) { for (let k = 0; k < 6; k++) { const mid = (lo + hi) / 2; if (elbowClear(mid)) hi = mid; else lo = mid; } phi = hi; }
  }
  a.swing = phi;
  elbowAt(phi);
  boneQuat(_S, _E, _b, _q2); boneQuat(_E, _W, _b, _q3);
  a.upper.quaternion.copy(_qc).invert().multiply(_q2);
  a.fore.quaternion.copy(_q2).invert().multiply(_q3);
  a.wristBone.quaternion.copy(_q3).invert().multiply(quat).multiply(a.rc);
  // the elbow's own bone turns half as far, and swells a little, so the tube rounds the bend
  a.elbow.quaternion.slerpQuaternions(IDENTITY, a.fore.quaternion, 0.5);
  const half = Math.acos(clamp(Math.abs(a.elbow.quaternion.w), 0, 1)), swell = Math.min(1.25, 1 / Math.max(0.5, Math.cos(half * 0.9)));
  a.elbow.scale.set(swell, 1, swell);
}

/** Blends an arm's pose toward a target node by k. */
function pull(rig, a, node, k) {
  if (k <= 0.001) return;
  inChest(rig, node, _tp, _tq);
  a.pos.lerp(_tp, k); a.quat.slerp(_tq, k);
}

/** Keeps the wrist of a posed arm above the table top, in from its edge. */
function overTable(ch, a) {
  _v.copy(a.wrist).applyQuaternion(a.quat).add(a.pos).applyMatrix4(ch.rig.chest.matrixWorld);
  if (Math.hypot(_v.x, _v.z) > TABLE.radius + WRIST_R || _v.y >= WRIST_R * 0.6) return;
  a.pos.y += (WRIST_R * 0.6 - _v.y);
}

/**
 * An open hand over the table rests its fingers on it, not in it: if a fingertip joint of the
 * solved arm is under the felt the hand is raised by that much (by `open`, 0..1) and solved again.
 * A hand closed round something lying on the table is left where its grip puts it.
 */
function settleFingers(a, open, gun) {
  if (open < 0.05) return;
  a.wristBone.updateWorldMatrix(true, true);
  const w = a.wristBone.matrixWorld.elements;
  if (w[13] > 0.15 || Math.hypot(w[12], w[14]) > TABLE.radius) return;
  let low = Infinity;
  for (const tip of a.tips) low = Math.min(low, tip.matrixWorld.elements[13]);
  if (low >= FINGER_FLOOR) return;
  a.pos.y += (FINGER_FLOOR - low) * open;
  solveArm(a, gun);
}

/** Called from updateCharacter in place of the code-built body's posing. `tx` is this frame's tremble. */
export function updateRig(ch, dt, t, tx, sway, drift) {
  const rig = ch.rig, E = ch.env, T = ch.target, L = rig.layer, live = 1 - E.out, out = !!T.out;
  const held = ch.grip.children[0], settling = !!held && ch.grasp === 'gun' && held.position.lengthSq() > 1e-10;
  const sip = rig.sip, drinkEnd = L.drink.action.getClip().duration;
  TS = rig.colliders.TORSO; HS = rig.colliders.HEAD;

  // 1. layers
  drive(L.reach, !out && !!(T.reach || settling), dt);
  drive(L.aim, !out && !!T.aim && !settling, dt, 0.24);
  drive(L.hold_cards, !out && ch.handAnchor.children.length > 0, dt, 0.24);
  drive(L.lean, !out && !!T.lean, dt, 0.26);
  drive(L.slump, out, dt, 0.4);
  // the drink plays through once its tip is asked for, then hands back to the held glass
  if (sip.tip > sip.was && sip.hold && !L.drink.on) { L.drink.on = true; L.drink.action.reset(); L.drink.w = 0; }
  if (L.drink.on && (L.drink.action.time >= drinkEnd - 1e-3 || !sip.hold || out)) L.drink.on = false;
  sip.was = sip.tip;
  const drinking = L.drink.on;
  if (drinking) L.drink.w = L.drink.w > 0.995 ? 1 : smoothDamp(L.drink.w, 1, L.drink.v, 'w', SWAP, dt);
  else if (L.drink.w > 0) { L.drink.w = sip.hold && !out ? 0 : smoothDamp(L.drink.w, 0, L.drink.v, 'w', FADE_OUT, dt); if (L.drink.w < 0.002) L.drink.w = L.drink.v.w = 0; }
  L.drink.action.setEffectiveWeight(L.drink.w);
  const glassOn = !out && !!sip.hold;
  if (glassOn && !L.hold_glass.on && L.hold_glass.w < 0.05 && L.drink.w < 0.05) { L.hold_glass.action.reset(); L.hold_glass.v.w = 0; }
  L.hold_glass.on = glassOn;
  // while the drink plays it stands in for the held pose it starts and ends on
  L.hold_glass.w = glassOn ? 1 - L.drink.w : L.hold_glass.w > 0 ? smoothDamp(L.hold_glass.w, 0, L.hold_glass.v, 'w', FADE_OUT, dt) : 0;
  if (L.hold_glass.w < 0.002) L.hold_glass.w = 0;
  L.hold_glass.action.setEffectiveWeight(L.hold_glass.w);
  if (ch.flinchT <= dt * 1.5) { L.flinch.action.reset(); L.flinch.w = 1; }
  if (L.flinch.w && L.flinch.action.time >= L.flinch.action.getClip().duration - 1e-3) L.flinch.w = 0;
  L.flinch.action.setEffectiveWeight(L.flinch.w * live);
  // the hands' shapes follow what they hold
  rig.shape.fist_r.setEffectiveWeight(E.grip * (1 - E.glass));
  rig.shape.glass_r.setEffectiveWeight(E.grip * E.glass);
  rig.shape.spread_r.setEffectiveWeight(smoothstep(0, 0.5, E.reach) * (1 - E.grip) * live);
  rig.shape.fan_l.setEffectiveWeight(E.hold);
  // breathing quickens with a tremble and stops with the lights
  rig.idle.timeScale = live * (1 + E.tremble * 1.2);
  if (!rig.started) { rig.started = true; rig.idle.time = ch.phase; }
  // The mixer only writes a bone when its clips' value changes, so the bones posed after it are
  // first put back to what the mixer last gave them; otherwise steps 2 and 3 would pile up.
  const post = rig.post, postQ = rig.postQ;
  for (let i = 0; i < post.length; i++) post[i].quaternion.copy(postQ[i]);
  rig.chest.position.y = rig.chestY;
  rig.mixer.update(dt);
  for (let i = 0; i < post.length; i++) postQ[i].copy(post[i].quaternion);
  rig.chestY = rig.chest.position.y;

  // 2. the gaze, slow weight shifts and the tremble, on top of the clips
  const glassW = Math.max(L.hold_glass.w, L.drink.w), ph = ch.phase;
  ch.waist.quaternion.multiply(_qe.setFromEuler(_e.set(drift * 0.012 - E.relief * 0.08, sway * 0.03, tx * 2 + sway * 0.014)));
  ch.upper.position.y -= E.relief * 0.008;
  rig.mouth.getWorldPosition(_m0);
  ch.neck.quaternion.multiply(_qe.setFromEuler(_e.set(-drift * 0.01 * live, (ch.yaw * (1 - E.aim * 0.65) * (1 - 0.7 * glassW) - sway * 0.03) * live + tx * 2, 0)));
  ch.head.quaternion.multiply(_qe.setFromEuler(_e.set((ch.pitch * 0.7 * (1 - 0.6 * L.drink.w) - E.relief * 0.12) * live, 0, (Math.sin(t * 0.7 + ph) * 0.016 + Math.sin(t * 0.43 + ph * 3.1) * 0.012 - sway * 0.012) * live + tx * 2.5)));
  ch.group.updateMatrixWorld(true);
  _inv.copy(rig.chest.matrixWorld).invert(); _chestWorld = rig.chest.matrixWorld;

  // 3. contact correction, right arm
  const R = ch.arm;
  inChest(rig, R.hand, R.pos, R.quat);
  pull(rig, R, rig.targets.restR, (1 - L.reach.w) * (1 - L.aim.w) * (1 - glassW) * (1 - L.slump.w));
  const reach = smoothstep(0.5, 0.97, E.reach) * live;
  if (reach > 0.001) {
    _tp.copy(ch.reachTarget); _tp.y += 0.006; _tp.applyMatrix4(_inv);
    _tq.setFromRotationMatrix(_inv).multiply(ch.reachQuat);
    R.pos.lerp(_tp, reach); R.quat.slerp(_tq, reach);
  }
  const aim = smoothstep(0.55, 0.98, E.aim) * live;
  if (aim > 0.001) {
    inChest(rig, rig.targets.aim, _tp, _tq);
    const sh = E.tremble * live;
    _tp.x += (Math.sin(t * 41) + Math.sin(t * 23.7)) * 0.0022 * sh; _tp.y += (Math.sin(t * 37.3) + Math.sin(t * 13.1)) * 0.0028 * sh; _tp.z += Math.sin(t * 29.9) * 0.002 * sh;
    R.pos.lerp(_tp, aim); R.quat.slerp(_tq, aim);
  }
  if (L.drink.w > 0.001) {
    // the head has turned to look since the clip was keyed: the rim follows the mouth to where it is now
    rig.mouth.getWorldPosition(_m1).sub(_m0); const far = _m1.length(), drinkAt = L.drink.action.time;
    R.pos.addScaledVector(_m1.transformDirection(_inv), far * L.drink.w * smoothstep(0.3, 0.75, drinkAt) * (1 - smoothstep(1.3, 1.7, drinkAt)));
  }
  // what the hand holds stays out of the head; an aimed revolver is meant to be at the temple
  if (held && ch.grasp === 'glass') {
    _hm.multiplyMatrices(_m.copy(rig.head.matrixWorld).invert(), rig.chest.matrixWorld);
    _v.set(0, 0.028, 0).applyQuaternion(ch.glassAt.quat).add(ch.glassAt.pos).applyQuaternion(R.quat).add(R.pos); _w.copy(_v);
    if (clearTorso(_w, GLASS_R)) R.pos.add(_u.subVectors(_w, _v));
    _v.set(0, 0.028, 0).applyQuaternion(ch.glassAt.quat).add(ch.glassAt.pos).applyQuaternion(R.quat).add(R.pos).applyMatrix4(_hm); _w.copy(_v);
    if (clearHead(_w, GLASS_R)) R.pos.add(_u.subVectors(_w, _v).transformDirection(_m.copy(_hm).invert()).multiplyScalar(_w.distanceTo(_v)));
  }
  overTable(ch, R);
  solveArm(R, !!held && ch.grasp === 'gun');
  settleFingers(R, 1 - E.grip, false);

  // left arm
  const Lf = ch.leftArm;
  inChest(rig, Lf.hand, Lf.pos, Lf.quat);
  pull(rig, Lf, rig.targets.restL, (1 - L.hold_cards.w) * (1 - L.slump.w));
  pull(rig, Lf, rig.targets.fan, smoothstep(0.55, 0.98, E.hold) * live);
  pull(rig, Lf, rig.targets.fanUp, E.inspect * E.hold * live);
  if (E.hold > 0.001) {
    // leaning in tips the body forward, which would lower the fan into the felt
    const y = _v.copy(Lf.pos).applyMatrix4(rig.chest.matrixWorld).y - ch.group.position.y;
    if (y < rig.fanFloor) Lf.pos.y += (rig.fanFloor - y) * E.hold * live;
  }
  overTable(ch, Lf);
  solveArm(Lf, false);
  settleFingers(Lf, 1 - E.hold, false);
  // movers parented to the hands read these world matrices for their velocity
  ch.group.updateMatrixWorld(true);
}
