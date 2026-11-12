// The player's right hand, forearm and sleeve. It lives off-screen below the view, reaches out
// to the revolver when it's your turn to pull, carries it up beside your head, and puts it back.
// The root's origin is the grip (`arm.grip`), where the gun's own origin sits; the hand is the
// same grip-frame hand the characters use, so the fingers close round the revolver's grip or a
// glass (`arm.grasp`). The forearm hangs off the wrist and runs back toward a shoulder below the
// view, re-aimed each frame.
import * as THREE from 'three';
import { scene, camera } from './core.js';
import { Mover, easeInOutCubic, smoothDamp } from './motion.js';
import { rightHand, shapeHand } from './characters.js';
import { UP } from '../util.js';

// camera space
const AIM_POS = new THREE.Vector3(0.22, -0.08, -0.4);
const AIM_AT = new THREE.Vector3(0.06, 0.02, 0.08);
const HIDE_POS = new THREE.Vector3(0.38, -0.66, -0.16);
const SHOULDER = new THREE.Vector3(0.3, -0.6, 0.14);
// the hand meets the revolver as it lies, this far above it, and lifts it as the fingers close
const LIFT = 0.006;
const WRIST_MAX = 0.6;

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _f = new THREE.Vector3(), _ax = new THREE.Vector3(), _q = new THREE.Quaternion(), _o = new THREE.Object3D();
export const arm = { root: null, grip: null, hand: null, fore: null, mover: null, aimQuat: new THREE.Quaternion(), hidden: true, grasp: 'gun', glassAt: null, closed: 1, open: 0, glassy: 0, cv: {} };

export function buildPlayerArm() {
  const root = new THREE.Group(); camera.add(root);
  _o.position.copy(AIM_POS); _o.lookAt(AIM_AT); arm.aimQuat.copy(_o.quaternion);
  const skin = new THREE.MeshStandardMaterial({ color: 0xc08a68, roughness: 0.62 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x2b2027, roughness: 0.92 });
  const linen = new THREE.MeshStandardMaterial({ color: 0xd9cdb6, roughness: 0.85 });
  arm.hand = rightHand({ palm: [0.044, 0.048, 0.021], r: 0.0092 }, skin);
  arm.glassAt = arm.hand.userData.glass;
  root.add(arm.hand);
  arm.grip = new THREE.Object3D(); root.add(arm.grip);

  // forearm along +y from the wrist; the group is pointed at the shoulder every frame
  const fore = new THREE.Group(); camera.add(fore);
  const along = (mesh, from, len) => { mesh.position.y = from + len / 2; fore.add(mesh); return mesh; };
  along(new THREE.Mesh(new THREE.CapsuleGeometry(0.029, 0.2, 4, 12), skin), -0.005, 0.24);
  along(new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.043, 0.035, 18), linen), 0.15, 0.035);
  along(new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.06, 1, 18), cloth), 0.18, 1);
  for (const m of [arm.hand, ...fore.children]) m.castShadow = true;
  arm.fore = fore;

  root.position.copy(HIDE_POS); root.quaternion.copy(arm.aimQuat); root.visible = fore.visible = false;
  arm.root = root;
  arm.mover = new Mover(root, camera); arm.mover.smooth = arm.mover.rotSmooth = 0.1;
}

const FWD = new THREE.Vector3(0, 0, 1);
/**
 * Lay the open hand on something at a world point: the revolver passes its lying rotation; without
 * one the hand comes in upright, knuckles toward the point, as for a cup or a glass.
 */
export function armReach(world, quat) {
  arm.hidden = false; arm.root.visible = true;
  if (!quat) quat = _q.setFromUnitVectors(FWD, _d.subVectors(world, camera.position).setY(0).normalize());
  arm.mover.go(scene, _v.copy(world).setY(world.y + LIFT), quat, 1, { dur: 0.55, ease: easeInOutCubic });
}
/** Raise whatever is in the hand up beside your head, kept inside a narrow (portrait) view. */
export function armRaise() {
  arm.hidden = false; arm.root.visible = true;
  const halfW = -AIM_POS.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect / camera.zoom;
  _v.copy(AIM_POS).setX(Math.min(AIM_POS.x, halfW * 0.62));
  arm.mover.go(camera, _v, arm.aimQuat, 1, { dur: 0.6, ease: easeInOutCubic });
}
/** Where your right shoulder is, in the world: where a reach comes from. */
export const shoulderWorld = (out) => camera.localToWorld(out.copy(SHOULDER));
export function armHide() {
  if (arm.hidden) return;
  arm.hidden = true;
  arm.mover.go(camera, HIDE_POS, arm.aimQuat, 1, { dur: 0.45, ease: easeInOutCubic });
}

export function updatePlayerArm(dt) {
  arm.mover.update(dt);
  const { root, fore } = arm;
  if (arm.hidden && !arm.mover.flying && root.visible) root.visible = false;
  fore.visible = root.visible;
  // opened wide on the way to something, closed round it while holding it or tucked away
  const holding = arm.grip.children.length > 0;
  arm.closed = smoothDamp(arm.closed, holding || arm.hidden ? 1 : 0, arm.cv, 'c', 0.09, dt);
  arm.open = smoothDamp(arm.open, holding || arm.hidden ? 0 : 1, arm.cv, 'o', 0.15, dt);
  arm.glassy = smoothDamp(arm.glassy, arm.grasp === 'glass' ? 1 : 0, arm.cv, 'g', 0.12, dt);
  shapeHand(arm.hand, arm.closed * (1 - arm.glassy), arm.closed * arm.glassy, arm.open * (1 - arm.closed));
  if (!root.visible) return;
  root.updateMatrixWorld();
  camera.worldToLocal(root.localToWorld(_v.copy(arm.hand.userData.wrist)));
  fore.position.copy(_v);
  // toward the shoulder, but never more than a natural wrist bend off the hand's own line
  _d.subVectors(SHOULDER, _v).normalize();
  _f.copy(arm.hand.userData.fore).transformDirection(root.matrixWorld).transformDirection(camera.matrixWorldInverse);
  const bend = _f.angleTo(_d);
  if (bend > WRIST_MAX) _d.applyAxisAngle(_ax.crossVectors(_d, _f).normalize(), bend - WRIST_MAX);
  fore.quaternion.setFromUnitVectors(UP, _d);
}
