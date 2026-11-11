import * as THREE from 'three';

export const $ = (s) => document.querySelector(s);
export const rand = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const damp = (dt, k) => 1 - Math.exp(-k * dt);
export const UP = new THREE.Vector3(0, 1, 0);
const _e = new THREE.Euler();
/** Quaternion from a yaw-pitch-roll Euler, written into `out`. */
export const quatE = (x, y, z, out = new THREE.Quaternion()) => out.setFromEuler(_e.set(x, y, z, 'YXZ'));

export const settings = {
  speed: 1,
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  autoplay: location.hash.startsWith('#autoplay'),
  paused: false,
};
/** Game-paced delay. Honors the speed setting, the pause menu and the autoplay test mode. */
export function wait(ms) {
  return new Promise((resolve) => {
    let left = ms * (settings.autoplay ? 0.2 : 1) / settings.speed, last = performance.now();
    const step = () => {
      const now = performance.now();
      if (!settings.paused) left -= now - last;
      last = now;
      if (left <= 0) resolve(); else setTimeout(step, Math.min(60, left));
    };
    setTimeout(step, Math.min(60, Math.max(0, left)));
  });
}

export const store = {
  get(key, fallback) { try { const v = localStorage.getItem(`lastcall.${key}`); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`lastcall.${key}`, JSON.stringify(value)); } catch { /* storage blocked */ } },
};
