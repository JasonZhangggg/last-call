// Seated first-person camera: a head on a neck. The director frames the shot by moving a focus
// point; the player turns their head with the pointer or a touch drag. The two combine into one
// yaw and pitch, and the eye swings around a neck pivot behind it, so a turn is a turn and not a
// pan. Everything is spring-smoothed; shake is smooth noise with a short attack.
import * as THREE from 'three';
import { camera } from './core.js';
import { smoothDamp, dampVec3 } from './motion.js';
import { clamp, settings } from '../util.js';

const DEFAULT_FOCUS = new THREE.Vector3(0, 0.08, -0.25);
const INTRO_POS = new THREE.Vector3(0, 1.45, 2.7);
const EYE_FROM_NECK = new THREE.Vector3(0, 0.1, -0.09);
const LEAN = new THREE.Vector3(0.03, -0.06, -0.24);
const MAX_YAW = 1.0, YAW_LIMIT = 1.25, PITCH_UP = 0.34, PITCH_DOWN = 0.3;
const _dir = new THREE.Vector3(), _eye = new THREE.Vector3(), _off = new THREE.Vector3(), _ref = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

export const rig = {
  seat: new THREE.Vector3(0, 0.82, 1.82),
  focus: DEFAULT_FOCUS.clone(), focusTarget: DEFAULT_FOCUS.clone(), fv: {},
  // player head turn (radians) relative to the director's framing
  lookYaw: 0, lookPitch: 0, lookYawTarget: 0, lookPitchTarget: 0, lv: {}, lookSmooth: 0.22,
  // the last pointer position (-1..1), kept while the head is locked so unlocking can turn back to it
  px: 0, py: 0, pointerSeen: false,
  zoom: 1, zoomTarget: 1, zv: {},
  roll: 0, rollTarget: 0, rv: {},
  shake: 0, shakeEnv: 0, sv: {},
  intro: 0, introTarget: 0, iv: {},
  // leaning in over the table (reaching for the revolver), 0..1
  lean: 0, leanTarget: 0, lnv: {},
  lookEnabled: true,
  // held still (your cards held up to read): no head turn, the view framed on lockFocus at lockZoom
  lookLocked: false, lockFocus: DEFAULT_FOCUS.clone(), lockZoom: 1,
  // where the head points this frame, framing and the player's turn together, before shake:
  // yaw + is to the left, pitch + is up (what other seats see, via the `look` message)
  viewYaw: 0, viewPitch: 0,
};

/** Point the base view at a world position (or back at the table with null). `weight` 0..1. */
export function focusOn(pos, weight = 0.45) {
  if (!pos) rig.focusTarget.copy(DEFAULT_FOCUS);
  else rig.focusTarget.copy(DEFAULT_FOCUS).lerp(pos, weight);
}

const smoothstep = (a, b, v) => { const u = clamp((v - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const curve = (v, dz) => Math.sign(v) * Math.pow(clamp((Math.abs(v) - dz) / (1 - dz), 0, 1), 1.3);
const range = () => (settings.reducedMotion ? 0.35 : 1);

/**
 * Mouse position in -1..1 (y down) maps to where the head points. Low on the screen, over the
 * hand and the buttons, the turn fades to a fraction so picking cards doesn't swing the room.
 */
export function lookFromPointer(nx, ny) {
  rig.px = nx; rig.py = ny; rig.pointerSeen = true;
  rig.lookSmooth = settings.reducedMotion ? 0.4 : 0.22;
  if (!rig.lookEnabled || rig.lookLocked) { rig.lookYawTarget = rig.lookPitchTarget = 0; return; }
  const g = 0.18 + 0.82 * (1 - smoothstep(0.36, 0.72, ny)), r = range();
  rig.lookYawTarget = -curve(nx, 0.08) * MAX_YAW * g * r;
  rig.lookPitchTarget = (ny < 0 ? curve(-ny, 0.15) * PITCH_UP : -curve(ny, 0.15) * PITCH_DOWN * g) * r;
}
/** Touch drag: relative head turn. */
export function lookByDelta(dx, dy) {
  if (!rig.lookEnabled || rig.lookLocked) return;
  const r = range();
  rig.lookSmooth = 0.1;
  rig.lookYawTarget = clamp(rig.lookYawTarget - dx * 0.005 * r, -MAX_YAW * r, MAX_YAW * r);
  rig.lookPitchTarget = clamp(rig.lookPitchTarget - dy * 0.004 * r, -PITCH_DOWN * r, PITCH_UP * r);
}
/** Ease the head back to the director's framing (finger lifted, pointer gone, a cinematic beat). */
export function centerLook(smooth = 0.6) { rig.lookYawTarget = 0; rig.lookPitchTarget = 0; rig.lookSmooth = smooth; rig.pointerSeen = false; }
/**
 * Hold the head still until unlocked, framed on the table's centre (or `weight` of the way to `pos`)
 * and zoomed by `zoom`; the pointer stops turning it. Unlocking turns the head back to where the
 * pointer rests at an unhurried pace, instead of whipping round on the next twitch of the mouse.
 */
export function lockLook(on, pos = null, weight = 0.45, zoom = 1) {
  rig.lookLocked = on;
  rig.lockZoom = on ? zoom : 1;
  if (on) {
    rig.lockFocus.copy(DEFAULT_FOCUS); if (pos) rig.lockFocus.lerp(pos, weight);
    rig.lookYawTarget = 0; rig.lookPitchTarget = 0; rig.lookSmooth = 0.35;
  } else if (rig.pointerSeen) { lookFromPointer(rig.px, rig.py); rig.lookSmooth = settings.reducedMotion ? 0.6 : 0.45; }
}

const noise = (t, s) => Math.sin(t * 1.7 + s) * 0.5 + Math.sin(t * 3.1 + s * 2.3) * 0.3 + Math.sin(t * 5.3 + s * 0.7) * 0.2;
const softLimit = (x, l) => l * Math.tanh(x / l);

export function updateCamera(dt, t) {
  const rm = settings.reducedMotion, motion = rm ? 0.3 : 1;
  rig.intro = smoothDamp(rig.intro, rig.introTarget, rig.iv, 'i', 0.75, dt);
  dampVec3(rig.focus, rig.lookLocked ? rig.lockFocus : rig.focusTarget, rig.fv, 0.45, dt);
  rig.lookYaw = smoothDamp(rig.lookYaw, rig.lookYawTarget, rig.lv, 'y', rig.lookSmooth, dt);
  rig.lookPitch = smoothDamp(rig.lookPitch, rig.lookPitchTarget, rig.lv, 'p', rig.lookSmooth, dt);
  rig.zoom = smoothDamp(rig.zoom, rig.zoomTarget * rig.lockZoom, rig.zv, 'z', 0.6, dt);
  rig.roll = smoothDamp(rig.roll, rig.rollTarget, rig.rv, 'r', 0.5, dt);
  rig.lean = smoothDamp(rig.lean, rig.leanTarget, rig.lnv, 'l', 0.3, dt);
  rig.shake *= Math.exp(-dt * 3.2);
  rig.shakeEnv = smoothDamp(rig.shakeEnv, rig.shake, rig.sv, 's', 0.025, dt);
  const sh = Math.max(0, rig.shakeEnv) * motion;

  _eye.lerpVectors(INTRO_POS, rig.seat, rig.intro).addScaledVector(LEAN, rig.lean);
  _dir.subVectors(rig.focus, _eye);
  const baseYaw = Math.atan2(-_dir.x, -_dir.z), basePitch = Math.atan2(_dir.y, Math.hypot(_dir.x, _dir.z));
  // The player's own turn takes over from the director's framing instead of stacking on top of it.
  const own = Math.min(1, Math.abs(rig.lookYaw) / MAX_YAW);
  const yaw = softLimit(baseYaw * (1 - 0.6 * own) + rig.lookYaw, YAW_LIMIT);
  const pitch = clamp(basePitch + rig.lookPitch, -1.1, 0.45);
  rig.viewYaw = yaw; rig.viewPitch = pitch;

  _dir.subVectors(DEFAULT_FOCUS, rig.seat);
  const restPitch = Math.atan2(_dir.y, Math.hypot(_dir.x, _dir.z));
  _off.copy(EYE_FROM_NECK).applyEuler(_e.set(pitch, yaw, 0));
  _ref.copy(EYE_FROM_NECK).applyEuler(_e.set(restPitch, 0, 0));
  camera.position.copy(_eye).add(_off).sub(_ref);
  camera.position.x += Math.sin(t * 0.31) * 0.006 * motion + noise(t * 9, 1) * sh * 0.03;
  camera.position.y += Math.sin(t * 0.47) * 0.004 * motion + noise(t * 9, 4) * sh * 0.02;

  // a turning head tips slightly into the turn
  const roll = rig.roll + (rm ? 0 : rig.lookYaw * 0.035);
  _e.set(
    pitch + noise(t * 11, 7) * sh * 0.02,
    yaw + noise(t * 11, 2) * sh * 0.025,
    roll + noise(t * 8, 9) * sh * 0.02,
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
