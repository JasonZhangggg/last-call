// The player's right arm. It lives off-screen below the view, reaches out to the revolver when it's
// your turn to pull, carries it up beside your head and puts it back; in dice it takes your cup and
// shakes it, lifts a glass and drinks from it.
//
// `arm.root` is the control frame the movers drive: the revolver's grip frame (`arm.grip`, where the
// gun's own origin sits and a held glass hangs at `arm.glassAt`), or for the dice cup a frame over
// the cup's top. Whatever the hand holds goes exactly where the root goes.
//
// The arm is a skinned model (tools/models/player_arm.py writes it) solved here every frame: the
// hand is put on the root, the elbow is found by a two-bone solve from a shoulder below and right of
// the view with the elbow hanging down and out, and then the forearm is turned onto the hand's own
// line so the wrist never bends more than WRIST_MAX. The upper arm runs from the elbow toward the
// shoulder and on past it off-screen, so a far reach leans the shoulder in rather than locking the
// arm straight. The forearm's roll is shared between the wrist and a mid-forearm twist bone.
// Without the model it falls back to the code-built arm: the morph hand and a capsule forearm.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { scene, camera } from './core.js';
import { Mover, easeInOutCubic, smoothDamp } from './motion.js';
import { rightHand, shapeHand } from './characters.js';
import { UP, clamp } from '../util.js';

// camera space: the revolver held up before your face to the right, its muzzle turned back at your
// temple. A forearm that comes from below and to the right can only meet a barrel pointing back at
// you with the hand turned palm down, so it lies on its side (AIM_CANT about the barrel), as the
// hand found it on the felt.
const AIM_POS = new THREE.Vector3(0.215, -0.07, -0.41);
const AIM_AT = new THREE.Vector3(0.05, 0.05, 0.045);
const AIM_CANT = -1.15;
const HIDE_POS = new THREE.Vector3(0.3, -0.6, -0.12);
// the shoulder and the way the elbow hangs, in the body's frame: the camera's place and heading,
// without its pitch or roll, so the head looks up and down without carrying the shoulder with it
const SHOULDER = new THREE.Vector3(0.21, -0.24, 0.06);
const POLE = new THREE.Vector3(0.7, -0.7, 0.1).normalize();
// the arm (tools/models/player_arm.py): elbow to wrist; the upper arm is at least L1, longer to reach
const L1 = 0.3, L2 = 0.27;
// the elbow keeps at least this much bend on a long reach; the wrist bends at most WRIST_MAX
const MIN_BEND = THREE.MathUtils.degToRad(40), WRIST_MAX = THREE.MathUtils.degToRad(25);
// the hand meets the revolver as it lies, this far above it, and lifts it as the fingers close
const LIFT = 0.006;
const SWAY = 0.45;
const MODEL = 'models/player_arm.glb';
const POSES = ['relaxed', 'open', 'gun', 'glass', 'cup'];

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _f = new THREE.Vector3(), _ax = new THREE.Vector3(), _q = new THREE.Quaternion(), _o = new THREE.Object3D();
const _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _P = new THREE.Vector3(), _Q = new THREE.Quaternion(), _Qh = new THREE.Quaternion(), _W = new THREE.Vector3();
const _S = new THREE.Vector3(), _E = new THREE.Vector3(), _n = new THREE.Vector3(), _u = new THREE.Vector3(), _a = new THREE.Vector3(), _ol = new THREE.Vector3(), _pole = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _mb = new THREE.Matrix4();
const _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _r = new THREE.Quaternion(), _tw = new THREE.Quaternion(), _body = new THREE.Quaternion(), _sq = new THREE.Quaternion();
const _sp = new THREE.Vector3(), _rim = new THREE.Vector3(), _rg = new THREE.Vector3();
const IDENTITY = new THREE.Quaternion();
const smoothstep = (a, b, v) => { const u = clamp((v - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };

export const arm = {
  root: null, grip: null, hand: null, fore: null, mover: null, aimQuat: new THREE.Quaternion(), hidden: true, grasp: 'gun', glassAt: null,
  closed: 0, open: 0, glassy: 0, cuppy: 0, cv: {},
  // the skinned arm, when the model loaded: its bones and this frame's solve (camera space)
  rig: null, solved: { wristBend: 0, twist: 0, elbow: new THREE.Vector3(), shoulder: new THREE.Vector3(), wrist: new THREE.Vector3(), reach: 0 },
  sip: null,
  // the shoulder and the elbow's hang (see SHOULDER), here so a probe can try others
  shoulder: SHOULDER.clone(), pole: POLE.clone(),
};

let gltf = null;
/** Fetches the arm's model during the loading screen. Without it the arm is built in code. */
export async function loadPlayerArm() {
  try {
    const res = await fetch(MODEL);
    if (!res.ok) throw new Error(`${res.status} ${MODEL}`);
    gltf = await new GLTFLoader().parseAsync(await res.arrayBuffer(), '');
  } catch (err) { console.warn('the player arm model did not load; using the code-built arm', err); }
}

export function buildPlayerArm() {
  const root = new THREE.Group(); camera.add(root);
  _o.position.copy(AIM_POS); _o.lookAt(AIM_AT); arm.aimQuat.copy(_o.quaternion).multiply(_q.setFromAxisAngle(_ax.set(0, 0, 1), AIM_CANT));
  const skin = new THREE.MeshStandardMaterial({ color: 0xc08a68, roughness: 0.62 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x2b2027, roughness: 0.92 });
  const linen = new THREE.MeshStandardMaterial({ color: 0xd9cdb6, roughness: 0.85 });
  arm.grip = new THREE.Object3D(); root.add(arm.grip);
  if (gltf) buildSkinned({ skin, cloth, linen }); else buildCodeArm(root, skin, cloth, linen);
  root.position.copy(HIDE_POS); root.quaternion.copy(arm.hideQuat ?? arm.aimQuat); root.visible = false;
  if (arm.fore) arm.fore.visible = false;
  arm.root = root;
  arm.mover = new Mover(root, camera); arm.mover.smooth = arm.mover.rotSmooth = 0.1;
}

/* ---------- the skinned arm ---------- */

function buildSkinned(mats) {
  const model = gltf.scene;
  camera.add(model);
  model.traverse((o) => {
    if (!o.isMesh) return;
    const mat = mats[o.material.name];
    if (!mat) throw new Error(`the player arm uses a material it has no colour for: ${o.material.name}`);
    o.material = mat; o.castShadow = o.receiveShadow = true;
    // posed far from its rest pose, so its rest bounds say nothing
    o.frustumCulled = false;
  });
  const node = (n) => { const o = model.getObjectByName(n); if (!o) throw new Error(`the player arm has no node ${n}`); return o; };
  const bones = { upper: node('upperarmR'), elbow: node('elbowR'), fore: node('forearmR'), twist: node('twistR'), wrist: node('wristR'), hand: node('handR') };
  // the upper arm's parent (the armature) in camera space, to write the upper arm in camera space
  model.updateMatrixWorld(true);
  const base = new THREE.Matrix4().copy(camera.matrixWorld).invert().multiply(bones.upper.parent.matrixWorld);
  const baseInvQ = new THREE.Quaternion(); base.decompose(_v, baseInvQ, _s); baseInvQ.invert();
  const baseInv = base.clone().invert();
  // sockets: each control frame against the hand bone (the wrist joint is the hand bone's origin)
  const local = (n) => { const o = node(n); o.updateMatrix(); return { pos: o.position.clone(), quat: o.quaternion.clone() }; };
  const sockets = { gun: local('grip_gun'), glass: local('grip_glass'), cup: local('grip_cup') };
  const g = sockets.gun, gInv = g.quat.clone().invert();
  const glass = { pos: sockets.glass.pos.clone().sub(g.pos).applyQuaternion(gInv), quat: gInv.clone().multiply(sockets.glass.quat) };
  // what the movers and dice.js read: the wrist and the hand's own line up its forearm in the grip frame
  bones.hand.userData = { wrist: g.pos.clone().negate().applyQuaternion(gInv), fore: UP.clone().applyQuaternion(gInv), glass };
  arm.hand = bones.hand; arm.glassAt = glass;
  // finger poses: the first key of each pose's clip, per finger bone
  const fingers = [];
  for (const clip of gltf.animations) {
    const k = POSES.indexOf(clip.name);
    if (k < 0) continue;
    for (const t of clip.tracks) {
      const name = t.name.split('.')[0];
      let f = fingers.find((x) => x.name === name);
      if (!f) fingers.push(f = { name, bone: node(name), q: POSES.map(() => new THREE.Quaternion()) });
      f.q[k].fromArray(t.values, 0);
    }
  }
  arm.hideQuat = hangQuat(g);
  arm.rig = { model, bones, base, baseInv, baseInvQ, sockets, fingers, w: new Float32Array(POSES.length) };
}

/** The grip frame of a hand hanging at your side, fingers down and a little forward, palm in. */
function hangQuat(gun) {
  _y.set(0.15, 0.95, 0.25).normalize();               // the hand bone's +y, up its forearm
  _z.set(0.25, 0.1, 1).normalize();                    // toward the elbow's point, so the thumb leads
  _z.addScaledVector(_y, -_z.dot(_y)).normalize(); _x.crossVectors(_y, _z);
  return new THREE.Quaternion().setFromRotationMatrix(_mb.makeBasis(_x, _y, _z)).multiply(gun.quat);
}

/** Bone orientation whose -y runs from `from` to `to` and whose +z leans toward `bend`. */
function boneQuat(from, to, bend, out) {
  _y.subVectors(from, to).normalize(); _z.copy(bend).addScaledVector(_y, -bend.dot(_y)).normalize(); _x.crossVectors(_y, _z);
  return out.setFromRotationMatrix(_mb.makeBasis(_x, _y, _z));
}

function poseFingers(R) {
  const w = R.w, closed = arm.closed, c = arm.cuppy, gl = arm.glassy * (1 - c);
  w[0] = (1 - closed) * (1 - arm.open); w[1] = (1 - closed) * arm.open;
  w[2] = closed * (1 - gl - c); w[3] = closed * gl; w[4] = closed * c;
  for (const f of R.fingers) {
    const out = f.bone.quaternion.set(0, 0, 0, 0);
    for (let k = 0; k < w.length; k++) {
      if (w[k] < 1e-4) continue;
      const q = f.q[k], s = out.x * q.x + out.y * q.y + out.z * q.z + out.w * q.w < 0 ? -w[k] : w[k];
      out.x += q.x * s; out.y += q.y * s; out.z += q.z * s; out.w += q.w * s;
    }
    if (out.lengthSq() < 1e-8) out.identity(); else out.normalize();
  }
}

/**
 * Poses the skinned arm on the root. Everything in camera space: the control frame, the shoulder in
 * the body's frame, the elbow, then the bones.
 */
function solveSkinned() {
  const R = arm.rig, B = R.bones, out = arm.solved;
  camera.updateMatrixWorld();
  arm.root.updateWorldMatrix(true, false);
  _m.copy(camera.matrixWorldInverse).multiply(arm.root.matrixWorld).decompose(_P, _Q, _s);
  // the hand bone from the control frame and its socket (the cup's socket while holding the cup)
  const g = R.sockets.gun, c = R.sockets.cup, k = arm.cuppy;
  _sq.slerpQuaternions(g.quat, c.quat, k); _sp.lerpVectors(g.pos, c.pos, k);
  _Qh.copy(_Q).multiply(_sq.invert());
  _W.copy(_sp).applyQuaternion(_Qh).negate().add(_P);
  // the body: the camera's heading only
  _f.set(0, 0, -1).applyQuaternion(camera.quaternion);
  _body.setFromAxisAngle(UP, Math.atan2(-_f.x, -_f.z)).premultiply(_q.copy(camera.quaternion).invert());
  _S.copy(arm.shoulder).applyQuaternion(_body);
  _pole.copy(arm.pole).normalize().applyQuaternion(_body);
  // the elbow from a two-bone solve; past arm's length the upper arm lengthens (the shoulder leans in)
  _d.subVectors(_W, _S); const dist = Math.max(0.05, _d.length()); _d.divideScalar(dist);
  const cb = Math.cos(Math.PI - MIN_BEND), sb = Math.sin(Math.PI - MIN_BEND);
  const l1 = Math.max(L1, L2 * cb + Math.sqrt(Math.max(0, dist * dist - L2 * L2 * sb * sb)));
  const cosA = clamp((l1 * l1 + dist * dist - L2 * L2) / (2 * l1 * dist), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  _n.copy(_pole).addScaledVector(_d, -_pole.dot(_d)).normalize();
  _E.copy(_S).addScaledVector(_d, cosA * l1).addScaledVector(_n, sinA * l1);
  // the forearm turned onto the hand's line, so the wrist bends at most WRIST_MAX (smoothly)
  _u.subVectors(_W, _E).normalize();
  _f.set(0, -1, 0).applyQuaternion(_Qh);
  const off = _u.angleTo(_f);
  if (off > 1e-5) {
    _ax.crossVectors(_f, _u).normalize();
    _u.copy(_f).applyAxisAngle(_ax, WRIST_MAX * Math.tanh(off / WRIST_MAX));
  }
  _E.copy(_W).addScaledVector(_u, -L2);
  // the elbow's point faces away from both bones (or down and out with the arm nearly straight)
  _a.subVectors(_S, _E).normalize();
  _ol.copy(_a).add(_u).negate().addScaledVector(_pole, 0.06);
  boneQuat(_S, _E, _ol, _q2); boneQuat(_E, _W, _ol, _q3);
  B.upper.position.copy(_E).applyMatrix4(R.baseInv);
  B.upper.quaternion.copy(R.baseInvQ).multiply(_q2);
  B.fore.quaternion.copy(_q2).invert().multiply(_q3);
  // the elbow's own bone turns half as far and swells a little, so the sleeve rounds the bend
  B.elbow.quaternion.slerpQuaternions(IDENTITY, B.fore.quaternion, 0.5);
  const half = Math.acos(clamp(Math.abs(B.elbow.quaternion.w), 0, 1)), swell = Math.min(1.2, 1 / Math.max(0.5, Math.cos(half * 0.9)));
  B.elbow.scale.set(swell, 1, swell);
  // the hand against the forearm: its turn about the forearm goes to the wrist and half of it to the
  // twist bone; what is left is the wrist's bend
  _r.copy(_q3).invert().multiply(_Qh);
  _tw.set(0, _r.y, 0, _r.w);
  if (_tw.lengthSq() < 1e-10) _tw.identity(); else _tw.normalize();
  if (_tw.w < 0) _tw.set(-_tw.x, -_tw.y, -_tw.z, -_tw.w);
  B.wrist.quaternion.copy(_tw);
  B.twist.quaternion.slerpQuaternions(IDENTITY, _tw, 0.5);
  B.hand.quaternion.copy(_tw).invert().multiply(_r);
  out.wristBend = 2 * Math.acos(clamp(Math.abs(B.hand.quaternion.w), 0, 1));
  out.twist = 2 * Math.atan2(_tw.y, _tw.w);
  out.elbow.copy(_E); out.shoulder.copy(_S); out.wrist.copy(_W); out.reach = l1;
}

/* ---------- the code-built arm (the fallback) ---------- */

function buildCodeArm(root, skin, cloth, linen) {
  arm.hand = rightHand({ palm: [0.044, 0.048, 0.021], r: 0.0092 }, skin);
  arm.glassAt = arm.hand.userData.glass;
  root.add(arm.hand);
  // forearm along +y from the wrist; the group is pointed at the shoulder every frame
  const fore = new THREE.Group(); camera.add(fore);
  const along = (mesh, from, len) => { mesh.position.y = from + len / 2; fore.add(mesh); return mesh; };
  // its own copy of the skin: sharing one with the morphed hand rebuilds its program state each frame
  along(new THREE.Mesh(new THREE.CapsuleGeometry(0.029, 0.2, 4, 12), skin.clone()), -0.005, 0.24);
  along(new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.043, 0.035, 18), linen), 0.15, 0.035);
  along(new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.06, 1, 18), cloth), 0.18, 1);
  for (const m of [arm.hand, ...fore.children]) m.castShadow = true;
  arm.fore = fore;
}

const CODE_SHOULDER = new THREE.Vector3(0.3, -0.6, 0.14);
function solveCodeArm() {
  const { root, fore } = arm;
  shapeHand(arm.hand, arm.closed * (1 - arm.glassy), arm.closed * arm.glassy, arm.open * (1 - arm.closed));
  root.updateMatrixWorld();
  camera.worldToLocal(root.localToWorld(_v.copy(arm.hand.userData.wrist)));
  fore.position.copy(_v);
  // along the hand's own line, but never swung more than SWAY off the line to the shoulder
  _d.subVectors(CODE_SHOULDER, _v).normalize();
  _f.copy(arm.hand.userData.fore).transformDirection(root.matrixWorld).transformDirection(camera.matrixWorldInverse);
  const off = _f.angleTo(_d);
  if (off > 1e-4) _d.applyAxisAngle(_ax.crossVectors(_d, _f).normalize(), Math.min(off, SWAY));
  fore.quaternion.setFromUnitVectors(UP, _d);
}

/* ---------- moves ---------- */

const FWD = new THREE.Vector3(0, 0, 1);
/**
 * Lay the open hand on something at a world point: the revolver passes its lying rotation; without
 * one the hand comes in upright, knuckles toward the point, as for a cup or a glass.
 */
export function armReach(world, quat) {
  arm.hidden = false; arm.root.visible = true; arm.sip = null;
  if (!quat) quat = _q.setFromUnitVectors(FWD, _d.subVectors(world, camera.position).setY(0).normalize());
  arm.mover.go(scene, _v.copy(world).setY(world.y + LIFT), quat, 1, { dur: 0.55, ease: easeInOutCubic });
}
/** Raise whatever is in the hand up beside your head, kept inside a narrow (portrait) view. */
export function armRaise() {
  arm.hidden = false; arm.root.visible = true; arm.sip = null;
  const halfW = -AIM_POS.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect / camera.zoom;
  _v.copy(AIM_POS).setX(Math.min(AIM_POS.x, halfW * 0.62));
  arm.mover.go(camera, _v, arm.aimQuat, 1, { dur: 0.6, ease: easeInOutCubic });
}
/** Where your right shoulder is, in the world: where a reach comes from. */
export function shoulderWorld(out) {
  if (!arm.rig) return camera.localToWorld(out.copy(CODE_SHOULDER));
  _f.set(0, 0, -1).applyQuaternion(camera.quaternion);
  return out.copy(arm.shoulder).applyAxisAngle(UP, Math.atan2(-_f.x, -_f.z)).add(camera.position);
}
export function armHide() {
  if (arm.hidden) return;
  arm.hidden = true; arm.sip = null;
  arm.mover.go(camera, HIDE_POS, arm.hideQuat ?? arm.aimQuat, 1, { dur: 0.45, ease: easeInOutCubic });
}

/**
 * The drink, in camera space. With `lips` (a grip-frame pose under the camera) the glass goes from
 * where it is to the lips over `dur` seconds, wrist first: the rim rises toward the mouth with the
 * glass still near upright, and the glass tips as the forearm comes up under it. With null it goes
 * back down to where it came from, the other way round: upright first, then lowered.
 */
const sipFrom = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() }, sipNow = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
export function armSip(lips, dur = 0.8) {
  const m = arm.mover;
  m.flight = null; m.stopSprings();
  if (m.parent !== camera) { camera.add(m.obj); m.parent = camera; m.pos.copy(m.obj.position); m.quat.copy(m.obj.quaternion); }
  sipNow.pos.copy(m.obj.position); sipNow.quat.copy(m.obj.quaternion);
  if (lips) sipFrom.pos.copy(sipNow.pos), sipFrom.quat.copy(sipNow.quat);
  arm.sip = lips ? { a: sipFrom, b: lips, up: true, t: 0, dur } : { a: sipFrom, b: { pos: sipNow.pos.clone(), quat: sipNow.quat.clone() }, up: false, t: 0, dur };
}
const RIM_H = 0.056;
function stepSip(dt) {
  const s = arm.sip, gl = arm.glassAt, m = arm.mover;
  s.t = Math.min(s.dur, s.t + dt);
  // k runs from the held pose (0) to the lips (1) either way: the rim leads the tip going up, so on
  // the way back down the tip unwinds first
  const e = easeInOutCubic(s.t / s.dur), k = s.up ? e : 1 - e;
  const lift = smoothstep(0, 0.78, k), tip = smoothstep(0.32, 1, k);
  _rg.set(0, RIM_H, 0).applyQuaternion(gl.quat).add(gl.pos);
  _rim.copy(_rg).applyQuaternion(s.a.quat).add(s.a.pos);
  _v.copy(_rg).applyQuaternion(s.b.quat).add(s.b.pos);
  // a little toward the face midway, so the rim comes up to the lip rather than in at it
  _rim.lerp(_v, lift); _rim.z += 0.02 * Math.sin(Math.PI * lift);
  m.quat.slerpQuaternions(s.a.quat, s.b.quat, tip);
  m.pos.copy(_rg).applyQuaternion(m.quat).negate().add(_rim);
  m.obj.position.copy(m.pos); m.obj.quaternion.copy(m.quat);
  if (s.t >= s.dur) arm.sip = null;
}

export function updatePlayerArm(dt) {
  if (arm.sip && arm.mover.flying) arm.sip = null;
  if (arm.sip) stepSip(dt);
  arm.mover.update(dt);
  const { root } = arm;
  if (arm.hidden && !arm.mover.flying && root.visible) root.visible = false;
  // opened wide on the way to something, closed round it while holding it, slack otherwise
  const holding = arm.grip.children.length > 0;
  arm.closed = smoothDamp(arm.closed, holding ? 1 : 0, arm.cv, 'c', 0.09, dt);
  arm.open = smoothDamp(arm.open, holding || arm.hidden ? 0 : 1, arm.cv, 'o', 0.15, dt);
  arm.glassy = smoothDamp(arm.glassy, arm.grasp === 'glass' ? 1 : 0, arm.cv, 'g', 0.12, dt);
  arm.cuppy = smoothDamp(arm.cuppy, arm.grasp === 'cup' ? 1 : 0, arm.cv, 'u', 0.12, dt);
  if (!root.visible) {
    // tucked away: settle what the hand will next do, so nothing blends in from a stale grasp
    const cv = arm.cv; cv.c = cv.o = cv.g = cv.u = 0;
    arm.closed = arm.open = 0; arm.glassy = arm.grasp === 'glass' ? 1 : 0; arm.cuppy = arm.grasp === 'cup' ? 1 : 0;
  }
  if (arm.rig) {
    arm.rig.model.visible = root.visible;
    if (!root.visible) return;
    poseFingers(arm.rig);
    solveSkinned();
    return;
  }
  arm.fore.visible = root.visible;
  if (root.visible) solveCodeArm();
}
