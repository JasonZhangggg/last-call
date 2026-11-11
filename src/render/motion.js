// Motion primitives shared by cards, the revolver and the camera.
//
// Two kinds of movement, chosen per object:
//   flights  discrete moves (deal, play, reveal): timed, eased, optionally arced. They re-read
//            the target every frame, so a moving target (a reflowing hand) is still hit exactly.
//   springs  continuous following once settled: critically damped, no velocity jump, no overshoot.
import * as THREE from 'three';

export const easeInOutCubic = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
export const easeOutCubic = (u) => 1 - Math.pow(1 - u, 3);
export const easeOutBack = (u) => { const c = 1.4; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };

/** Critically damped spring step (Game Programming Gems 4, "SmoothDamp"). Returns the new value. */
export function smoothDamp(cur, target, state, key, smoothTime, dt) {
  const omega = 2 / Math.max(1e-4, smoothTime), x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target, vel = state[key] || 0;
  const temp = (vel + omega * change) * dt;
  state[key] = (vel - omega * temp) * exp;
  return target + (change + temp) * exp;
}

const _p = new THREE.Vector3();

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
    this.smooth = 0.09;
    this.rotRate = 14;
  }
  /** Set a new resting target without a flight (springs carry it there). */
  follow(parent, pos, quat, scale = this.scale) {
    if (parent !== this.parent) return this.go(parent, pos, quat, scale);
    this.pos.copy(pos); this.quat.copy(quat); this.scale = scale;
    return this;
  }
  /** Fly to a new target over `dur` seconds, lifting by `arc` at the midpoint. */
  go(parent, pos, quat, scale = 1, { dur = 0.5, arc = 0, delay = 0, ease = easeInOutCubic } = {}) {
    if (this.obj.parent !== parent) parent.attach(this.obj);
    this.parent = parent;
    this.pos.copy(pos); this.quat.copy(quat); this.scale = scale;
    this.flight = {
      fromPos: this.obj.position.clone(), fromQuat: this.obj.quaternion.clone(), fromScale: this.obj.scale.x,
      t: -delay, dur: Math.max(0.01, dur), arc, ease,
    };
    this.vel = {};
    return this;
  }
  update(dt) {
    const o = this.obj, f = this.flight;
    if (f) {
      f.t += dt;
      const u = Math.min(1, Math.max(0, f.t / f.dur)), e = f.ease(u);
      o.position.lerpVectors(f.fromPos, this.pos, e);
      if (f.arc) o.position.y += Math.sin(Math.PI * u) * f.arc;
      o.quaternion.slerpQuaternions(f.fromQuat, this.quat, e);
      o.scale.setScalar(f.fromScale + (this.scale - f.fromScale) * e);
      if (u >= 1) this.flight = null;
      return;
    }
    const st = this.smooth, v = this.vel;
    _p.set(
      smoothDamp(o.position.x, this.pos.x, v, 'x', st, dt),
      smoothDamp(o.position.y, this.pos.y, v, 'y', st, dt),
      smoothDamp(o.position.z, this.pos.z, v, 'z', st, dt),
    );
    o.position.copy(_p);
    o.quaternion.slerp(this.quat, 1 - Math.exp(-this.rotRate * dt));
    o.scale.setScalar(smoothDamp(o.scale.x, this.scale, v, 's', st, dt));
  }
  get flying() { return !!this.flight && this.flight.t < this.flight.dur; }
}
