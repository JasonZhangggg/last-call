import * as THREE from 'three';
import { scene, camera } from './core.js';
import { Mover, easeInOutCubic, easeOutCubic, smoothDamp, paced } from './motion.js';
import { quatE } from '../util.js';

// The gun's origin is the middle of its grip, where a hand holds it (ch.grip and the player's arm
// attach it with an identity transform). Lying on its side its height is the drum's radius.
const GRIP = new THREE.Vector3(0, -0.046, -0.056);
const LYING_Y = 0.026;
const lying = (yaw, out) => quatE(0, yaw, Math.PI / 2, out);
const HOME_QUAT = lying(0.9);
const HOME_POS = new THREE.Vector3(0.44, LYING_Y, 0.3).add(GRIP.clone().applyQuaternion(HOME_QUAT));
const ZERO = new THREE.Vector3(), IDENTITY = new THREE.Quaternion();
const _o = new THREE.Object3D(), _p = new THREE.Vector3(), _c = new THREE.Vector3(), _x = new THREE.Vector3(), _q = new THREE.Quaternion();

// obj is what the hand holds (driven by the Mover); recoil rotates `body` about the grip on top of
// it, so a kick never feeds back into the hand's spring.
export const gun = {
  obj: null, body: null, mover: null, drum: null, hammer: null, flash: null,
  drumAngle: 0, drumFrom: 0, drumTo: 0, drumT: 1, drumDur: 1, drumEase: easeOutCubic,
  cock: 0, cockTarget: 0, cv: {}, kickT: -1, kickAmp: 0, flashT: 0,
};

export function buildGun() {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const model = new THREE.Group(); model.position.copy(GRIP).negate(); body.add(model);
  const steel = new THREE.MeshStandardMaterial({ color: 0x5c5d62, metalness: 1, roughness: 0.3, envMapIntensity: 2.2 });
  const blued = new THREE.MeshStandardMaterial({ color: 0x23252b, metalness: 0.9, roughness: 0.38, envMapIntensity: 2 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a2412, roughness: 0.42, metalness: 0.05 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb8893e, metalness: 1, roughness: 0.32 });
  const add = (parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; parent.add(m); return m; };
  add(model, new THREE.CylinderGeometry(0.0105, 0.012, 0.17, 18), steel, 0, 0.012, 0.12, Math.PI / 2);
  add(model, new THREE.CylinderGeometry(0.0045, 0.0045, 0.172, 10), new THREE.MeshBasicMaterial({ color: 0x050505 }), 0, 0.012, 0.1205, Math.PI / 2);
  add(model, new THREE.BoxGeometry(0.012, 0.012, 0.16), steel, 0, 0.026, 0.12);
  add(model, new THREE.CylinderGeometry(0.006, 0.006, 0.09, 10), blued, 0, -0.004, 0.09, Math.PI / 2);
  add(model, new THREE.BoxGeometry(0.004, 0.012, 0.01), steel, 0, 0.036, 0.195);
  add(model, new THREE.BoxGeometry(0.03, 0.05, 0.075), blued, 0, 0.004, -0.008);
  add(model, new THREE.BoxGeometry(0.032, 0.012, 0.02), brass, 0, -0.024, -0.035);
  const drum = new THREE.Group(); drum.position.set(0, 0.006, 0.008); model.add(drum);
  add(drum, new THREE.CylinderGeometry(0.03, 0.03, 0.05, 24), steel, 0, 0, 0, Math.PI / 2);
  const holeGeo = new THREE.CylinderGeometry(0.0065, 0.0065, 0.052, 12), flute = new THREE.CylinderGeometry(0.006, 0.006, 0.046, 8);
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + Math.PI / 6;
    add(drum, holeGeo, holeMat, Math.cos(a) * 0.018, Math.sin(a) * 0.018, 0.0005, Math.PI / 2);
    add(drum, flute, blued, Math.cos(a + Math.PI / 6) * 0.029, Math.sin(a + Math.PI / 6) * 0.029, 0, Math.PI / 2);
  }
  gun.drum = drum;
  const grip = add(model, new THREE.BoxGeometry(0.026, 0.088, 0.036), wood, 0, -0.046, -0.056, -0.38);
  add(grip, new THREE.CylinderGeometry(0.004, 0.004, 0.028, 8), brass, 0, 0.01, 0, 0, 0, Math.PI / 2);
  const hammerPivot = new THREE.Group(); hammerPivot.position.set(0, 0.026, -0.044); model.add(hammerPivot);
  add(hammerPivot, new THREE.BoxGeometry(0.008, 0.022, 0.012), blued, 0, 0.009, -0.004, -0.4);
  gun.hammer = hammerPivot;
  add(model, new THREE.TorusGeometry(0.018, 0.0035, 6, 14, Math.PI), blued, 0, -0.022, 0.006, 0, Math.PI / 2, Math.PI);
  add(model, new THREE.BoxGeometry(0.004, 0.016, 0.004), blued, 0, -0.024, 0.006, 0.3);
  // No light of its own: the world already uses the four-point-light budget. Bloom carries the flash.
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  flash.position.set(0, 0.012, 0.23); flash.visible = false; model.add(flash); gun.flash = flash;

  g.position.copy(HOME_POS); g.quaternion.copy(HOME_QUAT); scene.add(g);
  gun.obj = g; gun.body = body;
  gun.mover = new Mover(g, scene); gun.mover.smooth = 0.12; gun.mover.rotSmooth = 0.14;
}

/** Back to its place on the table: an arc from a hand or the air, a slide when it's already lying down. */
export function gunHome({ slide = false } = {}) {
  gun.cockTarget = 0;
  gun.mover.go(scene, HOME_POS, HOME_QUAT, 1, slide ? { dur: 0.6 } : { dur: 0.85, arc: 0.12 });
}
export const gunWorld = (out) => gun.obj.getWorldPosition(out);

/** Where the revolver stops when it's slid across the felt to a seat (world xz of the seat). */
export function slideSpotFor(seatX, seatZ, out) {
  const r = Math.hypot(seatX, seatZ) || 1, ux = seatX / r, uz = seatZ / r;
  // a little to the seat's right, where a right hand finds it
  return out.set(ux * 0.88 - uz * 0.16, LYING_Y, uz * 0.88 + ux * 0.16);
}
/** Slide it across the table, still lying on its side, turning its grip toward whoever must pull. */
export function gunSlideTo(spot) {
  gun.cockTarget = 0;
  // hop it over the pile if the straight slide would plough through it
  gunWorld(_p);
  const dx = spot.x - _p.x, dz = spot.z - _p.z, u = Math.max(0, Math.min(1, -(_p.x * dx + _p.z * dz) / (dx * dx + dz * dz || 1)));
  const arc = Math.hypot(_p.x + dx * u, _p.z + dz * u) < 0.3 ? 0.1 : 0;
  gun.mover.go(scene, spot, lying(Math.atan2(spot.x, spot.z) + Math.PI * 0.5, _q), 1, { dur: 0.5, arc });
}
/** Into a hand. The hand is already there, so this only settles it into the palm. */
export function gunToGrip(grip) { gun.mover.go(grip, ZERO, IDENTITY, 1, { dur: 0.22 }); }
/** Out of a lowered hand onto the felt right under it. */
export function gunSetDown() {
  onFeltBelow(gunWorld(_p));
  gun.mover.go(scene, _p, lying(Math.atan2(_p.x, _p.z) + Math.PI * 0.5, _q), 1, { dur: 0.25 });
}
function onFeltBelow(p) {
  const r = Math.hypot(p.x, p.z), k = r > 0.86 ? 0.86 / r : 1;
  return p.set(p.x * k, LYING_Y, p.z * k);
}
// falls under gravity, lands at 72%, rocks once and settles
const easeDrop = (u) => (u < 0.72 ? (u / 0.72) ** 2 : 1 - 0.06 * Math.sin(Math.PI * (u - 0.72) / 0.28));
/** From a limp hand to the felt in front of it, with a small tumble. */
export function gunDrop() {
  onFeltBelow(gunWorld(_p));
  gun.mover.go(scene, _p, lying(Math.random() * Math.PI * 2, _q), 1, { dur: 0.55, ease: easeDrop });
}

/**
 * Raise the revolver to a character's temple on the side the player can see. It rides on the
 * neck, so it turns and trembles with the head instead of hanging where the head used to be.
 */
export function gunToCharacter(ch) {
  ch.group.getWorldPosition(_c);
  _x.set(1, 0, 0).transformDirection(ch.group.matrixWorld);
  const side = _x.dot(_p.subVectors(camera.position, _c)) >= 0 ? 1 : -1;
  const headY = ch.head.position.y;
  // the muzzle sits 0.26 ahead of the grip; 0.46 out leaves it just off the temple
  _o.position.set(side * 0.46, headY + 0.01, 0.07);
  // the barrel rides 0.06 above the grip, so aim the grip a little low
  _o.lookAt(0, headY - 0.04, 0.02);
  gun.mover.go(ch.neck, _o.position, _o.quaternion, 1, { dur: 0.95, arc: 0.16, ease: easeInOutCubic });
}

function turnDrum(by, dur, ease) {
  gun.drumFrom = gun.drumAngle; gun.drumTo = gun.drumAngle + by;
  gun.drumT = 0; gun.drumDur = paced(dur); gun.drumEase = ease;
}
/** A flick: full speed at once, then friction, landing exactly on a chamber. Matches audio.spin(). */
export function spinDrum(chambers = 12) { turnDrum(chambers * Math.PI / 3, 0.95, easeOutCubic); }
/** Cocking the hammer indexes the cylinder by one chamber, in step with it. */
export function cockHammer() { gun.cockTarget = 1; turnDrum(Math.PI / 3, 0.16, easeInOutCubic); }
export function fire(live) {
  gun.cockTarget = 0;
  gun.kickT = 0; gun.kickAmp = live ? 0.45 : 0.05;
  if (live) gun.flashT = 1;
}

// recoil as an underdamped spring released with an impulse: up fast, settles in ~0.4 s
const KICK_W = 30, KICK_Z = 0.42, KICK_WD = KICK_W * Math.sqrt(1 - KICK_Z * KICK_Z);
const kickAt = (t) => Math.exp(-KICK_Z * KICK_W * t) * Math.sin(KICK_WD * t) / 0.535;

export function updateGun(dt) {
  gun.mover.update(dt);
  if (gun.drumT < 1) {
    gun.drumT = Math.min(1, gun.drumT + dt / gun.drumDur);
    gun.drumAngle = gun.drumFrom + (gun.drumTo - gun.drumFrom) * gun.drumEase(gun.drumT);
  }
  gun.drum.rotation.z = gun.drumAngle;
  // cocking is a deliberate thumb pull; the fall is a spring snapping shut
  gun.cock = gun.cockTarget ? smoothDamp(gun.cock, 1, gun.cv, 'c', 0.05, dt) : Math.max(0, gun.cock - dt * 40);
  if (!gun.cockTarget && gun.cock === 0) gun.cv.c = 0;
  gun.hammer.rotation.x = -gun.cock * 0.7;
  let kick = 0;
  if (gun.kickT >= 0) {
    gun.kickT += dt;
    kick = gun.kickAmp * kickAt(gun.kickT);
    if (gun.kickT > 1.2) gun.kickT = -1;
  }
  gun.body.rotation.x = -kick;
  gun.body.position.z = GRIP.z - kick * 0.04;
  gun.flashT = Math.max(0, gun.flashT - dt * 10);
  const f = gun.flashT;
  gun.flash.material.opacity = f * f;
  gun.flash.scale.set(1 + (1 - f) * 1.6, 1 + (1 - f) * 1.6, 2.2 + (1 - f) * 3);
  gun.flash.visible = f > 0;
}
