// The player's right forearm, sleeve and hand. It lives off-screen below the view, reaches out
// to the revolver when it's your turn to pull, carries it up beside your head, and puts it back.
// The root's origin is the palm (`arm.grip`), where the gun's own origin sits.
import * as THREE from 'three';
import { scene, camera } from './core.js';
import { Mover, easeInOutCubic } from './motion.js';
import { UP } from '../util.js';

// camera space
const AIM_POS = new THREE.Vector3(0.22, -0.08, -0.4);
const AIM_AT = new THREE.Vector3(0.06, 0.02, 0.08);
const AIM_ARM = new THREE.Vector3(0.4, -0.84, 0.36).normalize();
const HIDE_POS = new THREE.Vector3(0.38, -0.66, -0.16);
const SHOULDER = new THREE.Vector3(0.32, -0.62, 0.12);

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _o = new THREE.Object3D();
export const arm = { root: null, grip: null, mover: null, aimPos: AIM_POS, aimQuat: new THREE.Quaternion(), hidden: true };

export function buildPlayerArm() {
  const root = new THREE.Group(); camera.add(root);
  _o.position.copy(AIM_POS); _o.lookAt(AIM_AT); arm.aimQuat.copy(_o.quaternion);
  const forearm = AIM_ARM.clone().applyQuaternion(arm.aimQuat.clone().invert());
  const skin = new THREE.MeshStandardMaterial({ color: 0xc08a68, roughness: 0.62 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x2b2027, roughness: 0.92 });
  const linen = new THREE.MeshStandardMaterial({ color: 0xd9cdb6, roughness: 0.85 });
  const along = (mesh, from, len) => { mesh.quaternion.setFromUnitVectors(UP, forearm); mesh.position.copy(forearm).multiplyScalar(len / 2).add(from); root.add(mesh); return mesh; };

  // the hand closes around the grip, which is tipped back like the gun's own
  const hand = new THREE.Group(); hand.rotation.x = -0.38; root.add(hand);
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.072, 0.052), skin); palm.position.set(0.004, -0.004, -0.012); hand.add(palm);
  const finger = new THREE.CapsuleGeometry(0.0105, 0.026, 3, 8);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(finger, skin); f.rotation.z = Math.PI / 2;
    f.position.set(0.002, 0.024 - i * 0.019, 0.02); hand.add(f);
  }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.034, 3, 8), skin);
  thumb.rotation.x = Math.PI / 2 - 0.5; thumb.position.set(-0.021, 0.026, 0.004); hand.add(thumb);

  const wrist = new THREE.Vector3(0.002, -0.035, -0.03);
  along(new THREE.Mesh(new THREE.CapsuleGeometry(0.029, 0.2, 4, 12), skin), wrist, 0.24);
  const cuffAt = forearm.clone().multiplyScalar(0.15).add(wrist);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.043, 0.035, 18), linen);
  along(cuff, cuffAt, 0.035);
  along(new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.06, 0.7, 18), cloth), cuffAt.addScaledVector(forearm, 0.03), 0.7);

  arm.grip = new THREE.Object3D(); root.add(arm.grip);
  root.position.copy(HIDE_POS); root.quaternion.copy(arm.aimQuat); root.visible = false;
  arm.root = root;
  arm.mover = new Mover(root, camera); arm.mover.smooth = arm.mover.rotSmooth = 0.1;
}

/** Turns the aiming pose so the forearm points along `dir` (camera space), keeping the wrist's roll. */
function poseToward(dir, out) {
  return out.setFromUnitVectors(AIM_ARM, dir).multiply(arm.aimQuat);
}

/** Reach for a world point on the table, the forearm running back toward the shoulder. */
export function armReach(world) {
  arm.hidden = false; arm.root.visible = true;
  camera.updateMatrixWorld();
  _v.copy(world); camera.worldToLocal(_v);
  _d.subVectors(SHOULDER, _v).normalize();
  poseToward(_d, _q).premultiply(camera.quaternion);
  arm.mover.go(scene, world, _q, 1, { dur: 0.5, ease: easeInOutCubic });
}
/** Raise whatever is in the hand up beside your head. */
export function armRaise() {
  arm.hidden = false; arm.root.visible = true;
  arm.mover.go(camera, AIM_POS, arm.aimQuat, 1, { dur: 0.6, ease: easeInOutCubic });
}
export function armHide() {
  if (arm.hidden) return;
  arm.hidden = true;
  arm.mover.go(camera, HIDE_POS, arm.aimQuat, 1, { dur: 0.45, ease: easeInOutCubic });
}

export function updatePlayerArm(dt) {
  arm.mover.update(dt);
  if (arm.hidden && !arm.mover.flying && arm.root.visible) arm.root.visible = false;
}
