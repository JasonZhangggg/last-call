// Seated first-person camera. Orientation = (direction to the director's focus point)
// + (the player's head turn). Everything is spring-smoothed; shake is smooth noise, not per-frame random.
import * as THREE from 'three';
import { camera } from './core.js';
import { smoothDamp } from './motion.js';
import { clamp, settings } from '../util.js';

const DEFAULT_FOCUS = new THREE.Vector3(0, 0.08, -0.25);
const INTRO_POS = new THREE.Vector3(0, 1.45, 2.7);
const _dir = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

export const rig = {
  seat: new THREE.Vector3(0, 0.82, 1.82),
  focus: DEFAULT_FOCUS.clone(), focusTarget: DEFAULT_FOCUS.clone(), fv: {},
  // player head turn (radians), from the pointer or touch drag
  lookYaw: 0, lookPitch: 0, lookYawTarget: 0, lookPitchTarget: 0, lv: {},
  zoom: 1, zoomTarget: 1, zv: {},
  roll: 0, rollTarget: 0, rv: {},
  shake: 0,
  intro: 0, introTarget: 0, iv: {},
  lookEnabled: true,
};

/** Point the base view at a world position (or back at the table with null). `weight` 0..1. */
export function focusOn(pos, weight = 0.45) {
  if (!pos) rig.focusTarget.copy(DEFAULT_FOCUS);
  else rig.focusTarget.copy(DEFAULT_FOCUS).lerp(pos, weight);
}

const MAX_YAW = 0.95, MAX_PITCH = 0.32;
/** Pointer position in -1..1 maps to a head turn with a soft dead zone in the middle. */
export function lookFromPointer(nx, ny) {
  if (!rig.lookEnabled) { rig.lookYawTarget = rig.lookPitchTarget = 0; return; }
  const curve = (v, dz) => Math.sign(v) * Math.pow(clamp((Math.abs(v) - dz) / (1 - dz), 0, 1), 1.35);
  rig.lookYawTarget = -curve(nx, 0.12) * MAX_YAW;
  rig.lookPitchTarget = -curve(ny, 0.2) * MAX_PITCH;
}
/** Touch drag: relative head turn. */
export function lookByDelta(dx, dy) {
  rig.lookYawTarget = clamp(rig.lookYawTarget - dx * 0.006, -MAX_YAW, MAX_YAW);
  rig.lookPitchTarget = clamp(rig.lookPitchTarget - dy * 0.004, -MAX_PITCH, MAX_PITCH);
}
export function centerLook() { rig.lookYawTarget = 0; rig.lookPitchTarget = 0; }

const noise = (t, s) => Math.sin(t * 1.7 + s) * 0.5 + Math.sin(t * 3.1 + s * 2.3) * 0.3 + Math.sin(t * 5.3 + s * 0.7) * 0.2;

export function updateCamera(dt, t) {
  const motion = settings.reducedMotion ? 0.3 : 1;
  rig.intro = smoothDamp(rig.intro, rig.introTarget, rig.iv, 'i', 0.9, dt);
  for (const k of ['x', 'y', 'z']) rig.focus[k] = smoothDamp(rig.focus[k], rig.focusTarget[k], rig.fv, k, 0.45, dt);
  rig.lookYaw = smoothDamp(rig.lookYaw, rig.lookYawTarget, rig.lv, 'y', 0.28, dt);
  rig.lookPitch = smoothDamp(rig.lookPitch, rig.lookPitchTarget, rig.lv, 'p', 0.28, dt);
  rig.zoom = smoothDamp(rig.zoom, rig.zoomTarget, rig.zv, 'z', 0.6, dt);
  rig.roll = smoothDamp(rig.roll, rig.rollTarget, rig.rv, 'r', 0.5, dt);
  rig.shake *= Math.exp(-dt * 3.2);

  const sh = rig.shake * motion;
  camera.position.lerpVectors(INTRO_POS, rig.seat, rig.intro);
  camera.position.x += Math.sin(t * 0.31) * 0.006 * motion + noise(t * 9, 1) * sh * 0.03;
  camera.position.y += Math.sin(t * 0.47) * 0.004 * motion + noise(t * 9, 4) * sh * 0.02;
  // head turn pivots slightly around the neck, so turning also shifts the eye a little
  camera.position.x -= Math.sin(rig.lookYaw) * 0.08;
  camera.position.z += (1 - Math.cos(rig.lookYaw)) * 0.08;

  _dir.subVectors(rig.focus, camera.position);
  const baseYaw = Math.atan2(-_dir.x, -_dir.z);
  const basePitch = Math.atan2(_dir.y, Math.hypot(_dir.x, _dir.z));
  _e.set(
    basePitch + rig.lookPitch + noise(t * 11, 7) * sh * 0.02,
    baseYaw + rig.lookYaw + noise(t * 11, 2) * sh * 0.025,
    rig.roll + noise(t * 8, 9) * sh * 0.02,
  );
  camera.quaternion.setFromEuler(_e);
  if (Math.abs(camera.zoom - rig.zoom) > 1e-4) { camera.zoom = rig.zoom; camera.updateProjectionMatrix(); }
}

export function fitToViewport() {
  const a = innerWidth / innerHeight;
  camera.aspect = a;
  if (a < 0.8) { camera.fov = 66; rig.seat.set(0, 1.02, 2.1); }
  else if (a < 1.3) { camera.fov = 56; rig.seat.set(0, 0.9, 1.92); }
  else { camera.fov = 50; rig.seat.set(0, 0.82, 1.82); }
  camera.updateProjectionMatrix();
}
