// Motion primitives shared by cards, the revolver and the camera.
//
// Two kinds of movement, chosen per object:
//   flights  discrete moves (deal, play, reveal): timed, eased, optionally arced. A flight is
//            blended in world space between a world snapshot of where the object was and its
//            target in the new parent's space, re-read every frame. So a reparent never teleports,
//            a card waiting to be dealt doesn't ride along with the camera, and a moving target (a
//            reflowing hand, a leaning character) is still hit exactly.
//   springs  continuous following once settled: critically damped position, rotation and scale.
// Every ease used for a flight starts and ends at zero velocity. A flight that interrupts motion
// inherits the object's current velocity, so nothing ever jumps from moving to still or back.
import * as THREE from 'three';
import { settings } from '../util.js';

export const easeInOutCubic = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
export const easeOutCubic = (u) => 1 - Math.pow(1 - u, 3);
/** Front-loaded like an ease-out (peak speed at a third of the way), but leaves from rest. */
export const easeFling = (u) => 1 - Math.pow(1 - u, 3) * (1 + 3 * u);

/** Flight durations shrink with the game pace setting, less than linearly so motion stays legible. */
export const paced = (sec) => sec / Math.sqrt(settings.speed || 1);

/** Critically damped spring step (Game Programming Gems 4, "SmoothDamp"). Returns the new value. */
export function smoothDamp(cur, target, state, key, smoothTime, dt) {
  const omega = 2 / Math.max(1e-4, smoothTime), x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target, vel = state[key] || 0;
  const temp = (vel + omega * change) * dt;
  state[key] = (vel - omega * temp) * exp;
  return target + (change + temp) * exp;
}
/** smoothDamp on each axis of a Vector3, in place. `vel` is a plain object holding x/y/z. */
export function dampVec3(cur, target, vel, smoothTime, dt) {
  cur.x = smoothDamp(cur.x, target.x, vel, 'x', smoothTime, dt);
  cur.y = smoothDamp(cur.y, target.y, vel, 'y', smoothTime, dt);
  cur.z = smoothDamp(cur.z, target.z, vel, 'z', smoothTime, dt);
  return cur;
}

const _w = new THREE.Vector3(), _tw = new THREE.Vector3(), _pp = new THREE.Vector3(), _ps = new THREE.Vector3(), _s = new THREE.Vector3();
const _pq = new THREE.Quaternion(), _tq = new THREE.Quaternion(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _r = new THREE.Vector3();

/** Rotation vector (axis * angle) of a unit quaternion, shortest way round. */
function logQuat(q, out) {
  const sgn = q.w < 0 ? -1 : 1, w = Math.min(1, q.w * sgn), s = Math.sqrt(Math.max(0, 1 - w * w));
  const k = s < 1e-6 ? 2 : (2 * Math.acos(w)) / s;
  return out.set(q.x * sgn * k, q.y * sgn * k, q.z * sgn * k);
}
function expQuat(r, out) {
  const a = r.length(), k = a < 1e-6 ? 0.5 : Math.sin(a / 2) / a;
  return out.set(r.x * k, r.y * k, r.z * k, Math.cos(a / 2)).normalize();
}

/**
 * A transform that follows a target (parent, position, rotation, scale).
 * mover.go() starts a flight; mover.follow() just moves the target and lets the spring settle.
 */
export class Mover {
  constructor(obj, parent) {
    this.obj = obj;
    this.parent = parent;
    this.pos = obj.position.clone();
    this.quat = obj.quaternion.clone();
    this.scale = obj.scale.x;
    this.flight = null;
    this.vel = {};
    this.rvel = {};
    this.smooth = 0.09;
    this.rotSmooth = 0.09;
    this.world = obj.getWorldPosition(new THREE.Vector3());
    this.worldVel = new THREE.Vector3();
    this.from = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 1, vel: new THREE.Vector3() };
  }
  /** Set a new resting target without a flight (springs carry it there, or the flight in progress). */
  follow(parent, pos, quat, scale = this.scale) {
    if (parent !== this.parent) return this.go(parent, pos, quat, scale);
    this.pos.copy(pos); this.quat.copy(quat); this.scale = scale;
    return this;
  }
  /** Fly to a new target over `dur` seconds (scaled by the pace setting), lifting by `arc` mid-way. */
  go(parent, pos, quat, scale = 1, { dur = 0.5, arc = 0, delay = 0, ease = easeInOutCubic } = {}) {
    const o = this.obj, f = this.from;
    o.updateWorldMatrix(true, false);
    o.matrixWorld.decompose(f.pos, f.quat, _s);
    f.scale = _s.x;
    f.vel.copy(this.worldVel);
    if (delay > 0) f.vel.set(0, 0, 0);
    if (o.parent !== parent) parent.add(o);
    this.parent = parent;
    this.pos.copy(pos); this.quat.copy(quat); this.scale = scale;
    this.flight = { t: -delay, dur: Math.max(0.01, paced(dur)), arc, ease };
    this.vel = {}; this.rvel = {};
    this.applyWorld(f.pos, f.quat, f.scale);
    return this;
  }
  /** Place instantly (only for moves nobody can see). */
  snap(parent, pos, quat, scale = 1) {
    if (this.obj.parent !== parent) parent.add(this.obj);
    this.parent = parent; this.flight = null; this.vel = {}; this.rvel = {};
    this.pos.copy(pos); this.quat.copy(quat); this.scale = scale;
    this.obj.position.copy(pos); this.obj.quaternion.copy(quat); this.obj.scale.setScalar(scale);
  }
  /** Writes a world-space pose into the object's local transform under its current parent. */
  applyWorld(pos, quat, scale) {
    const o = this.obj, p = this.parent;
    p.updateWorldMatrix(true, false);
    p.matrixWorld.decompose(_pp, _pq, _ps);
    o.position.copy(pos).applyMatrix4(_m.copy(p.matrixWorld).invert());
    o.quaternion.copy(_pq).invert().multiply(quat);
    o.scale.setScalar(scale / _ps.x);
  }
  update(dt) {
    const o = this.obj, f = this.flight;
    if (f) {
      f.t += dt;
      const u = Math.min(1, Math.max(0, f.t / f.dur)), e = f.ease(u), F = this.from, p = this.parent;
      p.updateWorldMatrix(true, false);
      p.matrixWorld.decompose(_pp, _pq, _ps);
      _tw.copy(this.pos).applyMatrix4(p.matrixWorld);
      _tq.copy(_pq).multiply(this.quat);
      _w.lerpVectors(F.pos, _tw, e);
      // lift follows eased progress, so it too leaves and lands at zero vertical speed
      if (f.arc) _w.y += f.arc * 4 * e * (1 - e);
      // Hermite velocity term: matches the inherited velocity at u = 0, fades to nothing by u = 1
      if (u > 0) _w.addScaledVector(F.vel, f.dur * u * (1 - u) * (1 - u));
      _q.slerpQuaternions(F.quat, _tq, e);
      this.applyWorld(_w, _q, F.scale + (this.scale * _ps.x - F.scale) * e);
      if (u >= 1) { this.flight = null; o.position.copy(this.pos); o.quaternion.copy(this.quat); o.scale.setScalar(this.scale); }
    } else {
      const st = this.smooth, v = this.vel;
      dampVec3(o.position, this.pos, v, st, dt);
      o.scale.setScalar(smoothDamp(o.scale.x, this.scale, v, 's', st, dt));
      // rotation spring: damp the rotation vector from target to current toward zero
      logQuat(_q.copy(this.quat).invert().multiply(o.quaternion), _r);
      const rv = this.rvel;
      if (_r.lengthSq() > 1e-12 || rv.x || rv.y || rv.z) {
        const rs = this.rotSmooth;
        _r.set(smoothDamp(_r.x, 0, rv, 'x', rs, dt), smoothDamp(_r.y, 0, rv, 'y', rs, dt), smoothDamp(_r.z, 0, rv, 'z', rs, dt));
        o.quaternion.copy(this.quat).multiply(expQuat(_r, _q));
      }
    }
    _w.copy(o.position).applyMatrix4(o.parent.matrixWorld);
    if (dt > 0) this.worldVel.subVectors(_w, this.world).divideScalar(dt);
    this.world.copy(_w);
  }
  get flying() { return !!this.flight; }
}
