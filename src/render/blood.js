// Blood for a fatal shot: a short spray of droplets out of the far temple, and splats where they
// land (the table, the shooter's chair, the floor) plus a mark at each temple. One instanced mesh
// for the droplets and one for the splats; each is hidden while it has nothing to draw.
import * as THREE from 'three';
import { scene, canvasTex, quality } from './core.js';
import { TABLE, FLOOR } from './world.js';
import { splatCanvas } from './textures.js';
import { wound } from './characters.js';
import { settings, rand, UP } from '../util.js';

const DROPS = 48, SPLATS = 40, BIG = 8, G = 9.8, STEP = 1 / 60;
const TABLE_Y = 0.0035, FLOOR_Y = FLOOR + 0.008;
// the chair in its character's frame (see chairGeometry): the seat's top and the back's front face
const SEAT = { y: -0.285, x: 0.27, z0: -0.29, z1: 0.19 }, BACK = { z: -0.265, x: 0.25, y0: -0.02, y1: 0.4 };

const drops = Array.from({ length: DROPS }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0, delay: 0, age: 0, big: false, live: false }));
const splats = Array.from({ length: SPLATS }, () => ({ base: new THREE.Matrix4(), on: null, age: 0, live: false }));
export const blood = { drops: null, splats: null, flying: 0, next: 0, chairInv: new THREE.Matrix4(), chair: new THREE.Matrix4() };
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _l = new THREE.Vector3();

export function buildBlood() {
  const dropMat = new THREE.MeshStandardMaterial({ color: 0x640907, emissive: 0x220202, roughness: 0.3, metalness: 0 });
  blood.drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 7, 5), dropMat, DROPS);
  const splatMat = new THREE.MeshStandardMaterial({
    map: canvasTex(splatCanvas()), transparent: true, depthWrite: false, roughness: 0.3, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  blood.splats = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), splatMat, SPLATS);
  blood.splats.receiveShadow = true;
  for (const m of [blood.drops, blood.splats]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false; m.count = 0; m.visible = false;
    scene.add(m);
  }
}

/** Puts down a splat: `base` places the unit quad (+z its normal), in world space or, with `on`, in that bone's frame. */
function addSplat(base, on) {
  const s = splats[blood.next]; blood.next = (blood.next + 1) % SPLATS;
  s.base.copy(base); s.on = on; s.age = 0; s.live = true;
  blood.splats.visible = true;
}
/** A splat at p facing n, its tail pointing along d (any vector, flattened onto the surface). */
function splatAt(p, n, d, w, h) {
  _x.copy(d).addScaledVector(n, -d.dot(n));
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0).addScaledVector(n, -n.x);
  _x.normalize(); _y.crossVectors(n, _x);
  _m.makeBasis(_x, _y, n).scale(_s.set(w, h, 1)).setPosition(p);
  return _m;
}

/** The far temple bursts out along the bullet's line, and both temples are marked. */
export function spray(ch) {
  if (!settings.blood) return;
  const W = wound(ch);
  W.head.updateWorldMatrix(true, false);
  ch.group.updateWorldMatrix(false, false);
  blood.chair.copy(ch.group.matrixWorld); blood.chairInv.copy(ch.group.matrixWorld).invert();
  // the marks live in head space, so they slump with the head; a dark entry, a larger exit
  addSplat(splatAt(_p.copy(W.entry).addScaledVector(_n.set(-1, 0, 0), 0.008), _n, _d.set(0, -1, 0.3), 0.04, 0.032), W.head);
  addSplat(splatAt(_p.copy(W.exit).addScaledVector(_n.set(1, 0, 0), 0.01), _n, _d.copy(W.dir).negate().add(_a.set(0, -0.6, 0)), 0.055, 0.042), W.head);
  const exit = _a.copy(W.exit).applyMatrix4(W.head.matrixWorld), dir = _b.copy(W.dir).transformDirection(W.head.matrixWorld);
  _x.crossVectors(dir, UP).normalize(); _y.crossVectors(_x, dir);
  // toward the middle of the table: the heavier drops arc onto the felt and the wood in front of the
  // seat, where the table can see them; the rest follow the bullet's line out to the floor
  const inX = -exit.x / Math.hypot(exit.x, exit.z), inZ = -exit.z / Math.hypot(exit.x, exit.z);
  const n = quality.rung >= 4 ? DROPS / 2 : DROPS;
  for (let i = 0; i < n; i++) {
    const D = drops[i], big = i < BIG, onTable = i < 5;
    const spread = big ? 0.3 : 0.55, speed = onTable ? rand(1.6, 2.3) : big ? rand(1.4, 2.4) : rand(1.6, 3.6);
    D.v.copy(dir).multiplyScalar(onTable ? 0.5 : 1).addScaledVector(_x, rand(-spread, spread)).addScaledVector(_y, rand(-spread * 0.6, spread) + 0.15);
    if (onTable) { D.v.x += inX * 1.4; D.v.z += inZ * 1.4; }
    D.v.normalize().multiplyScalar(speed);
    D.p.copy(exit).addScaledVector(dir, rand(0, 0.015));
    D.r = big ? rand(0.012, 0.017) : rand(0.006, 0.01);
    D.delay = (i / n) * 0.07; D.age = 0; D.big = big; D.live = true;
  }
  blood.flying = n;
  if (settings.reducedMotion) { while (blood.flying) simulateDrops(STEP); for (const s of splats) s.age = 1; }
  else blood.drops.visible = true;
}

/** Wipes everything off: a new table, a rematch, leaving it. */
export function clearBlood() {
  for (const D of drops) D.live = false;
  for (const s of splats) s.live = false;
  blood.flying = 0; blood.next = 0;
  blood.drops.count = 0; blood.drops.visible = false;
  blood.splats.count = 0; blood.splats.visible = false;
}

function land(D, p, n, along) {
  D.live = false; blood.flying--;
  if (!D.big) return;
  // a faster, flatter hit smears further along its path
  const sp = D.v.length(), flat = 1 - Math.abs(D.v.dot(n)) / sp, w = 0.05 + sp * 0.02 + D.r * 3;
  addSplat(splatAt(p, n, along, w * (1 + flat * 0.8), w), null);
}

function simulateDrops(dt) {
  for (const D of drops) {
    if (!D.live) continue;
    if (D.delay > 0) { D.delay -= dt; continue; }
    const py = D.p.y;
    D.v.y -= G * dt; D.v.multiplyScalar(1 - dt * 0.4);
    D.p.addScaledVector(D.v, dt); D.age += dt;
    const r2 = D.p.x * D.p.x + D.p.z * D.p.z;
    if (py > TABLE_Y && D.p.y <= TABLE_Y && r2 < TABLE.radius * TABLE.radius) {
      const k = r2 > 0.98 * 0.98 ? 0.98 / Math.sqrt(r2) : 1;
      land(D, _p.set(D.p.x * k, TABLE_Y, D.p.z * k), _n.set(0, 1, 0), D.v); continue;
    }
    // the chair, in its own frame
    _l.copy(D.p).applyMatrix4(blood.chairInv);
    if (Math.abs(_l.x) < SEAT.x && _l.z > SEAT.z0 && _l.z < SEAT.z1 && _l.y <= SEAT.y && _l.y > SEAT.y - 0.04) {
      _p.set(_l.x, SEAT.y + 0.003, _l.z).applyMatrix4(blood.chair);
      land(D, _p, _n.set(0, 1, 0).transformDirection(blood.chair), D.v); continue;
    }
    if (Math.abs(_l.x) < BACK.x && _l.y > BACK.y0 && _l.y < BACK.y1 && _l.z <= BACK.z && _l.z > BACK.z - 0.05) {
      _p.set(_l.x, _l.y, BACK.z + 0.004).applyMatrix4(blood.chair);
      land(D, _p, _n.set(0, 0, 1).transformDirection(blood.chair), _d.set(0, -1, 0)); continue;
    }
    if (D.p.y <= FLOOR_Y) { land(D, _p.set(D.p.x, FLOOR_Y, D.p.z), _n.set(0, 1, 0), D.v); continue; }
    if (D.age > 1.6) { D.live = false; blood.flying--; }
  }
}

export function updateBlood(dt) {
  const B = blood;
  if (B.flying > 0) {
    simulateDrops(dt);
    let k = 0;
    for (const D of drops) {
      if (!D.live || D.delay > 0) continue;
      // stretched along its flight, more the faster it goes
      const sp = D.v.length();
      _q.setFromUnitVectors(UP, _d.copy(D.v).divideScalar(sp || 1));
      _m.compose(D.p, _q, _s.set(D.r, D.r * (1 + sp * 0.9), D.r));
      B.drops.setMatrixAt(k++, _m);
    }
    B.drops.count = k; B.drops.instanceMatrix.needsUpdate = true;
    if (!B.flying) B.drops.visible = false;
  }
  if (!B.splats.visible) return;
  let k = 0, moving = false;
  for (const s of splats) {
    if (!s.live) continue;
    // a splat spreads out over its first fifth of a second
    s.age = Math.min(1, s.age + dt / 0.2);
    const g = 0.35 + 0.65 * (1 - (1 - s.age) ** 3);
    _m.copy(s.base).scale(_s.set(g, g, 1));
    if (s.on) { s.on.updateWorldMatrix(true, false); _m.premultiply(s.on.matrixWorld); moving = true; }
    if (s.age < 1) moving = true;
    B.splats.setMatrixAt(k++, _m);
  }
  if (moving || B.splats.count !== k) { B.splats.count = k; B.splats.instanceMatrix.needsUpdate = true; }
}
