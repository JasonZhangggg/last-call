// The three regulars. Built from primitives merged per material (see Kit in world.js) and
// animated procedurally: look-at, breathing, eyelid blinks, tells and reactions.
// The director drives them only through react(), tell() and lookTarget.
import * as THREE from 'three';
import { scene, canvasTex } from './core.js';
import { mats, Kit, place, mergeGeometries } from './world.js';
import { normalCanvas, weaveHeight, hammeredHeight, poreHeight, mottleCanvas, maskCanvas, vnoise } from './textures.js';
import { rand, clamp, damp, quatE, UP } from '../util.js';

export const SEAT_RADIUS = 1.32;
const _a = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _c = new THREE.Color();
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* ---------- shape helpers (all return geometry already in place) ---------- */

/** Cylinder from a to b, radius ra at a and rb at b. */
function tube(a, b, ra, rb = ra, seg = 14) {
  _d.subVectors(b, a); const len = Math.max(1e-4, _d.length());
  const g = new THREE.CylinderGeometry(rb, ra, len, seg);
  g.applyQuaternion(_q.setFromUnitVectors(UP, _d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
const ball = (p, r, s = 1, seg = 14) => place(new THREE.SphereGeometry(r, seg, Math.max(6, seg * 0.7 | 0)), [p.x, p.y, p.z], [0, 0, 0], s);
const lathe = (pts, seg = 32, p, r, s) => place(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg), p, r, s);

/** Superellipsoid: a box with fully rounded edges and true normals. */
function roundBox(w, h, d, e = 0.3) {
  const g = new THREE.SphereGeometry(1, 28, 18), P = g.attributes.position, N = g.attributes.normal;
  const f = (v, k) => Math.sign(v) * Math.pow(Math.abs(v), k);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    P.setXYZ(i, f(x, e) * w / 2, f(y, e) * h / 2, f(z, e) * d / 2);
    _a.set(f(x, 2 - e) / w, f(y, 2 - e) / h, f(z, 2 - e) / d).normalize(); N.setXYZ(i, _a.x, _a.y, _a.z);
  }
  return g;
}

/** Pushes vertices along their normals by smooth noise: beards, hair, gathered cloth. */
function lumpy(g, amp, freq, seed = 0) {
  const P = g.attributes.position, N = g.attributes.normal;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const n = Math.sin(x * freq + seed) * Math.sin(y * freq * 1.31 + seed * 2) * Math.sin(z * freq * 0.87 + 1) + vnoise(x * freq * 2 + 9, y * freq * 2 + z * freq, 512, 512) - 0.5;
    P.setXYZ(i, x + N.getX(i) * n * amp, y + N.getY(i) * n * amp, z + N.getZ(i) * n * amp);
  }
  g.computeVertexNormals(); return g;
}

/** A tube with a radius profile along a curve (mustache, feathers' quills, pipes). */
function sweep(points, radius, seg = 24, radial = 8) {
  const c = new THREE.CatmullRomCurve3(points), g = new THREE.TubeGeometry(c, seg, 1, radial, false);
  const P = g.attributes.position, frames = c.computeFrenetFrames(seg, false);
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, r = typeof radius === 'function' ? radius(t) : radius, p = c.getPointAt(t);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j; _a.set(P.getX(k), P.getY(k), P.getZ(k)).sub(p).multiplyScalar(r).add(p); P.setXYZ(k, _a.x, _a.y, _a.z);
    }
  }
  g.computeVertexNormals(); return g;
}

/**
 * A right hand in its own frame: palm facing +z, fingers along +y, thumb on +x.
 * Fingers curl gently toward +z so they wrap the back of a held card fan; the thumb crosses to
 * the front. Mirror with a negative x scale for the left hand.
 */
function handGeometry({ palm = [0.042, 0.046, 0.02], r = 0.0085 } = {}) {
  const parts = [ball(V(0, 0, 0), 1, [palm[0], palm[1], palm[2]], 16)];
  const fingers = [[0.026, [0.03, 0.022, 0.018], 0.08], [0.009, [0.033, 0.024, 0.019], 0.02], [-0.009, [0.03, 0.022, 0.018], -0.05], [-0.026, [0.024, 0.018, 0.015], -0.12]];
  for (const [x, lens, splay] of fingers) {
    const p = V(x, palm[1] * 0.72, -0.002); let ang = 0.18;
    const rr = x < -0.02 ? r * 0.88 : r;
    const base = p.clone();
    lens.forEach((len, i) => {
      _d.set(Math.sin(splay) * Math.cos(ang), Math.cos(splay) * Math.cos(ang), Math.sin(ang));
      const q = p.clone().addScaledVector(_d, len);
      parts.push(tube(p, q, rr * (1 - i * 0.08), rr * (1 - (i + 1) * 0.08), 8), ball(q, rr * (1 - (i + 1) * 0.08), 1, 8));
      p.copy(q); ang += 0.32;
    });
    parts.push(ball(base, rr * 1.02, 1, 8));
  }
  const t0 = V(0.03, -0.018, 0.006), t1 = V(0.05, 0.008, 0.026), t2 = V(0.045, 0.03, 0.042);
  parts.push(ball(V(0.024, -0.012, 0.004), 1, [0.018, 0.024, 0.016], 10), tube(t0, t1, r * 1.25, r * 1.1, 8), ball(t1, r * 1.1, 1, 8), tube(t1, t2, r * 1.1, r * 0.95, 8), ball(t2, r * 0.95, 1, 8));
  parts.push(tube(V(0, -0.075, -0.004), V(0, -0.03, -0.002), palm[0] * 0.62, palm[0] * 0.78, 12));
  return mergeGeometries(parts);
}

/** A torus around axis `dir` at p. */
function ring(p, dir, R, r) {
  const g = new THREE.TorusGeometry(R, r, 6, 24);
  g.applyQuaternion(_q.setFromUnitVectors(V(0, 0, 1), dir.clone().normalize())); g.translate(p.x, p.y, p.z);
  return g;
}

/*
 * The right fist, authored in the grip frame that gun.js parents the revolver to: origin where the
 * revolver's own origin sits, +z along the barrel, +y up, the raked grip running down and back
 * from about (0, -0.005, -0.072) to (0, -0.087, -0.04). The palm wraps the grip's right side,
 * three fingers curl round the front strap, the index finger rests in the trigger guard and the
 * thumb lies along the left of the frame.
 */
const FIST_WRIST = V(0.016, -0.062, -0.115);
function fistGeometry({ r = 0.0085, palm = [0.042, 0.046, 0.02] } = {}) {
  const gz = (y) => -0.072 + ((-0.005 - y) / 0.082) * 0.032;
  const k = palm[1] / 0.046;
  const parts = [ball(V(0.024, -0.05, -0.078), 1, [palm[2] * 1.05, palm[1] * 1.0, palm[0] * 0.95], 16)];
  [-0.036, -0.054, -0.071].forEach((y, i) => {
    const z = gz(y), rr = r * (1 - i * 0.07) * 1.05, R = 0.024;
    parts.push(sweep([V(0.026, y, z - 0.012), V(0.026, y, z + 0.012), V(0.013, y, z + R), V(-0.006, y, z + R * 0.95), V(-0.02, y + 0.002, z + 0.008)], rr, 14, 8), ball(V(-0.02, y + 0.002, z + 0.008), rr * 0.95, 1, 8));
  });
  parts.push(sweep([V(0.024, -0.02, -0.05), V(0.019, -0.022, -0.02), V(0.012, -0.026, 0.0), V(0.002, -0.03, 0.008)], r * 0.95, 12, 8), ball(V(0.002, -0.03, 0.008), r * 0.85, 1, 8));
  parts.push(sweep([V(0.022, -0.018, -0.098), V(0.0, -0.006, -0.086), V(-0.019, -0.008, -0.062), V(-0.021, -0.012, -0.038)], (t) => r * (1.35 - t * 0.4), 14, 8), ball(V(-0.021, -0.012, -0.038), r * 0.95, 1, 8));
  parts.push(tube(FIST_WRIST.clone().add(V(0, -0.006, -0.04)), FIST_WRIST.clone().lerp(V(0.024, -0.05, -0.078), 0.6), palm[0] * 0.6 * k, palm[0] * 0.72, 12));
  return mergeGeometries(parts);
}

/* ---------- detail textures shared by every character ---------- */
let TEX = null;
function detail() {
  if (TEX) return TEX;
  const n = (c) => { const t = canvasTex(c, { srgb: false, repeat: [1, 1] }); return t; };
  TEX = {
    cloth: n(normalCanvas(256, weaveHeight(80), 1.6)),
    hammered: n(normalCanvas(256, hammeredHeight, 3)),
    pores: n(normalCanvas(256, poreHeight, 1.2)),
    hair: n(normalCanvas(256, (u, v) => vnoise(u * 90, v * 3, 90, 3) * 0.8 + vnoise(u * 200, v * 6, 200, 6) * 0.3, 4)),
    skin: canvasTex(mottleCanvas(256, { amount: 0.16, scale: 5, warm: [1, 0.93, 0.9] }), { repeat: [1, 1] }),
    mask: canvasTex(maskCanvas(512)),
  };
  TEX.cloth.repeat.set(5, 5); TEX.hammered.repeat.set(2, 2); TEX.hair.repeat.set(3, 1);
  return TEX;
}

/* ---------- the shared chair ---------- */
let CHAIR = null;
function chairGeometry() {
  if (CHAIR) return CHAIR;
  const p = [];
  for (const s of [-1, 1]) {
    p.push(tube(V(s * 0.25, -0.76, -0.27), V(s * 0.25, 0.4, -0.29), 0.024, 0.02, 10), ball(V(s * 0.25, 0.43, -0.29), 0.03, 1, 10));
    p.push(tube(V(s * 0.23, -0.76, 0.17), V(s * 0.23, -0.3, 0.17), 0.022, 0.022, 10));
  }
  p.push(sweep([V(-0.27, 0.36, -0.28), V(-0.12, 0.39, -0.31), V(0.12, 0.39, -0.31), V(0.27, 0.36, -0.28)], 0.03, 20, 10));
  p.push(sweep([V(-0.25, -0.02, -0.27), V(0, -0.02, -0.3), V(0.25, -0.02, -0.27)], 0.02, 12, 8));
  for (const x of [-0.12, 0, 0.12]) p.push(place(new THREE.BoxGeometry(0.05, 0.34, 0.014), [x, 0.16, -0.28 + Math.abs(x) * 0.1], [0.05, 0, 0]));
  p.push(place(new THREE.BoxGeometry(0.54, 0.05, 0.48), [0, -0.31, -0.05]));
  CHAIR = mergeGeometries(p);
  return CHAIR;
}

/* ---------- designs ----------
   Each design returns materials and a build(rig) that adds parts to the rig's kits.
   rig.k.upper / rig.k.head are Kits merged onto those bones. Animated parts are returned. */

function physical(o) { return new THREE.MeshPhysicalMaterial(o); }
function standard(o) { return new THREE.MeshStandardMaterial(o); }

const DESIGNS = {
  brass() {
    const T = detail();
    const body = standard({ color: 0xd9a95a, map: mats.brassMap, metalnessMap: mats.brassRough, roughnessMap: mats.brassRough, normalMap: T.hammered, normalScale: new THREE.Vector2(0.12, 0.12), metalness: 1, roughness: 0.85, envMapIntensity: 1.8 });
    const iron = standard({ color: 0x2c2926, metalness: 0.8, roughness: 0.42, normalMap: T.hammered, normalScale: new THREE.Vector2(0.2, 0.2) });
    const copper = standard({ color: 0xc2734a, metalness: 1, roughness: 0.35, envMapIntensity: 1.6 });
    const lensMat = standard({ color: 0x0a2830, emissive: 0x44e4ff, emissiveIntensity: 2.4, roughness: 0.1 });
    const tipMat = standard({ color: 0x300, emissive: 0xff3a22, emissiveIntensity: 2 });
    const dialMat = standard({ color: 0xe8dcbc, roughness: 0.5, emissive: 0x2a2010, emissiveIntensity: 0.3 });
    return {
      sleeve: body, hand: body, arm: { shoulder: 0.055, elbow: 0.046, wrist: 0.036 }, handOpts: { palm: [0.044, 0.046, 0.021], r: 0.0088 },
      tint: [body, iron, copper, dialMat],
      cuff(k, el, wr) { k.add(iron, ring(wr.clone().lerp(el, 0.12), _d.subVectors(el, wr), 0.043, 0.008)); },
      torso(k, up) {
        k.add(body, lathe([[0, -0.3], [0.16, -0.3], [0.19, -0.22], [0.215, -0.05], [0.225, 0.12], [0.2, 0.26], [0.15, 0.33], [0.075, 0.37], [0, 0.375]], 36, [0, 0, 0], [0, 0, 0], [1.08, 1, 0.86]));
        for (const y of [-0.18, 0.2]) {
          const r = y < 0 ? 0.204 : 0.22;
          k.add(iron, place(new THREE.TorusGeometry(r, 0.012, 8, 40), [0, y, 0], [Math.PI / 2, 0, 0], [1.08, 0.86, 1]));
          for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; k.add(body, ball(V(Math.cos(a) * (r + 0.009) * 1.08, y, Math.sin(a) * (r + 0.009) * 0.86), 0.007, 1, 6)); }
        }
        for (let i = 0; i < 5; i++) k.add(iron, place(new THREE.BoxGeometry(0.15, 0.011, 0.02), [0, -0.02 - i * 0.022, 0.187]));
        k.add(iron, place(roundBox(0.19, 0.13, 0.03), [0, -0.064, 0.18]));
        for (const s of [-1, 1]) k.add(copper, sweep([V(s * 0.06, 0.05, -0.17), V(s * 0.14, 0.18, -0.16), V(s * 0.17, 0.3, -0.07), V(s * 0.1, 0.36, 0.02)], 0.013, 20, 8));
        for (const s of [-1, 1]) {
          k.add(body, place(new THREE.SphereGeometry(0.1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), [s * 0.215, 0.255, 0], [0, 0, -s * 0.35], [1, 0.8, 1]));
          k.add(iron, place(new THREE.TorusGeometry(0.1, 0.008, 6, 24), [s * 0.215, 0.255, 0], [Math.PI / 2, 0, -s * 0.35], [1, 1, 1]));
        }
        k.add(body, place(new THREE.TorusGeometry(0.047, 0.01, 8, 28), [0, 0.13, 0.19]));
        k.add(dialMat, place(new THREE.CircleGeometry(0.042, 28), [0, 0.13, 0.192]));
        const needle = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.036, 0.002), new THREE.MeshBasicMaterial({ color: 0x8a1a10 }));
        needle.geometry.translate(0, 0.014, 0); needle.position.set(0, 0.13, 0.195); up.add(needle);
        return { needle };
      },
      head(k, h, neck) {
        neck.add(new THREE.Mesh(mergeGeometries([place(new THREE.CylinderGeometry(0.045, 0.06, 0.1, 14), [0, 0.03, 0]), ...[0, 1, 2].map((i) => place(new THREE.TorusGeometry(0.052 - i * 0.003, 0.009, 6, 18), [0, -0.005 + i * 0.03, 0], [Math.PI / 2, 0, 0]))]), iron));
        k.add(body, place(roundBox(0.29, 0.26, 0.25, 0.28), [0, 0.005, 0]));
        k.add(iron, place(roundBox(0.23, 0.18, 0.04, 0.35), [0, 0.0, 0.112]));
        k.add(body, place(new THREE.TorusGeometry(0.058, 0.014, 10, 36), [0, 0.03, 0.136]));
        k.add(iron, place(new THREE.TorusGeometry(0.046, 0.005, 6, 32), [0, 0.03, 0.136]));
        for (let i = 0; i < 4; i++) k.add(body, place(new THREE.BoxGeometry(0.11 - i * 0.012, 0.008, 0.012), [0, -0.045 - i * 0.014, 0.134]));
        for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; k.add(body, ball(V(Math.cos(a) * 0.105, Math.sin(a) * 0.075, 0.13), 0.0075, 1, 6)); }
        k.add(body, place(roundBox(0.22, 0.035, 0.05, 0.4), [0, 0.105, 0.11], [0.2, 0, 0]));
        for (const s of [-1, 1]) {
          k.add(iron, place(new THREE.CylinderGeometry(0.034, 0.034, 0.035, 16), [s * 0.152, 0, 0], [0, 0, Math.PI / 2]));
          k.add(body, place(new THREE.TorusGeometry(0.024, 0.006, 6, 16), [s * 0.171, 0, 0], [0, Math.PI / 2, 0]));
        }
        k.add(iron, tube(V(0.07, 0.13, -0.02), V(0.07, 0.26, -0.03), 0.006, 0.004, 6), ball(V(0.07, 0.13, -0.02), 0.014, 1, 8));
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), tipMat); tip.position.set(0.07, 0.27, -0.03); h.add(tip);
        const lens = new THREE.Mesh(new THREE.SphereGeometry(0.046, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), lensMat);
        lens.rotation.x = Math.PI / 2; lens.scale.set(1, 0.35, 1); lens.position.set(0, 0.03, 0.124); h.add(lens);
        const pupil = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.004, 6, 20), iron); pupil.position.set(0, 0.03, 0.141); h.add(pupil);
        // the shutter blink: a brass cap swinging down over the lens
        const lid = new THREE.Group(); lid.position.set(0, 0.03, 0.12); h.add(lid);
        lid.add(new THREE.Mesh(new THREE.SphereGeometry(0.056, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), body));
        lid.children[0].scale.set(1, 1, 0.5);
        return { eyes: [lens], lids: [lid], lidOpen: -0.25, lidClosed: Math.PI / 2 - 0.05, extraGlow: [tipMat] };
      },
      update(ch, dt, t, E) {
        const live = 1 - E.out;
        ch.parts.needle.rotation.z = (-0.6 + Math.sin(t * 0.8 + ch.phase) * 0.15 + E.tremble * (0.9 + Math.sin(t * 31) * 0.2) + E.lean * 0.4) * live + E.out * 1.4;
      },
    };
  },

  noctua() {
    const T = detail();
    const velvet = physical({ color: 0x4a1f4c, roughness: 0.78, sheen: 1, sheenColor: new THREE.Color(0xd090d8), sheenRoughness: 0.32, normalMap: T.cloth, normalScale: new THREE.Vector2(0.25, 0.25) });
    const velvetDark = physical({ color: 0x1e0c1c, roughness: 0.85, sheen: 1, sheenColor: new THREE.Color(0x8a5a9a), sheenRoughness: 0.4, side: THREE.DoubleSide });
    const lace = standard({ color: 0xe9dfcf, roughness: 0.75, side: THREE.DoubleSide, normalMap: T.cloth, normalScale: new THREE.Vector2(0.8, 0.8) });
    const porcelain = physical({ color: 0xf2ebe0, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12, normalMap: T.pores, normalScale: new THREE.Vector2(0.15, 0.15) });
    const mask = physical({ map: T.mask, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 });
    const pearl = physical({ color: 0xf6efe4, roughness: 0.2, clearcoat: 1, sheen: 1, sheenColor: new THREE.Color(0xffd8e8), sheenRoughness: 0.3 });
    const hat = physical({ color: 0x261a2c, roughness: 0.8, sheen: 1, sheenColor: new THREE.Color(0x7a5a8a), sheenRoughness: 0.5, side: THREE.DoubleSide });
    const ribbon = physical({ color: 0x6a2a5a, roughness: 0.5, sheen: 1, sheenColor: new THREE.Color(0xe0a0d0) });
    const plume = standard({ color: 0x2b7a70, roughness: 0.6, side: THREE.DoubleSide, normalMap: T.hair, normalScale: new THREE.Vector2(0.6, 0.6) });
    const plumeDark = standard({ color: 0x141018, roughness: 0.6, side: THREE.DoubleSide, normalMap: T.hair });
    const socket = standard({ color: 0x140a10, roughness: 0.5 });
    const irisMat = standard({ color: 0x2a1400, emissive: 0xffa632, emissiveIntensity: 2.6 });
    const gemMat = standard({ color: 0x0a3a38, emissive: 0x2fd6c0, emissiveIntensity: 1.2, roughness: 0.1 });
    return {
      sleeve: velvet, hand: porcelain, arm: { shoulder: 0.045, elbow: 0.037, wrist: 0.03 }, handOpts: { palm: [0.036, 0.042, 0.016], r: 0.0072 },
      tint: [velvet, velvetDark, lace, porcelain, mask, pearl, hat, ribbon, plume],
      torso(k) {
        k.add(velvet, lathe([[0, -0.3], [0.18, -0.3], [0.185, -0.22], [0.145, -0.1], [0.15, 0.0], [0.178, 0.12], [0.17, 0.24], [0.13, 0.32], [0.06, 0.37], [0, 0.375]], 36, [0, 0, 0], [0, 0, 0], [1.1, 1, 0.84]));
        // capelet with a scalloped hem
        const cape = new THREE.LatheGeometry([[0.27, 0.1], [0.25, 0.16], [0.2, 0.26], [0.13, 0.33], [0.075, 0.38]].map(([x, y]) => new THREE.Vector2(x, y)), 48, 0.5, Math.PI * 2 - 1.0);
        const P = cape.attributes.position;
        for (let i = 0; i < P.count; i++) { const x = P.getX(i), z = P.getZ(i), y = P.getY(i); if (y < 0.12) P.setY(i, y + Math.abs(Math.sin(Math.atan2(z, x) * 7)) * 0.03 - 0.01); }
        cape.computeVertexNormals();
        k.add(velvetDark, place(cape, [0, 0, 0], [0, 0, 0], [1.1, 1, 0.9]));
        // standing lace collar fanned behind the head
        const col = new THREE.LatheGeometry([[0.085, 0.36], [0.13, 0.44], [0.2, 0.56]].map(([x, y]) => new THREE.Vector2(x, y)), 24, Math.PI * 0.4, Math.PI * 1.2);
        const C = col.attributes.position;
        for (let i = 0; i < C.count; i++) { const y = C.getY(i); if (y > 0.5) { const a = Math.atan2(C.getZ(i), C.getX(i)); C.setY(i, y + Math.cos(a * 11) * 0.025); } }
        col.computeVertexNormals();
        k.add(lace, place(col, [0, -0.02, -0.02]));
        k.add(lace, place(lumpy(new THREE.TorusGeometry(0.075, 0.022, 8, 28), 0.012, 60), [0, 0.36, 0.0], [Math.PI / 2 + 0.15, 0, 0]));
        // pearls in two loops and a glowing brooch
        for (const [rx, ry, n, y0] of [[0.07, 0.06, 17, 0.33], [0.09, 0.1, 23, 0.33]]) {
          for (let i = 0; i < n; i++) { const a = Math.PI * (0.06 + 0.88 * i / (n - 1)); k.add(pearl, ball(V(Math.cos(a) * rx * 1.4, y0 - Math.sin(a) * ry, 0.118 + Math.sin(a) * 0.03), 0.0068, 1, 8)); }
        }
        k.add(mats.brass, place(new THREE.TorusGeometry(0.022, 0.004, 6, 20), [0, 0.2, 0.158], [-0.3, 0, 0], [1, 1.3, 1]));
        for (let i = 0; i < 4; i++) k.add(mats.brass, ball(V(0, 0.08 - i * 0.055, 0.15 - i * 0.008), 0.009, [1, 1, 0.6], 8));
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.022), gemMat); gem.position.set(0, 0.2, 0.165); gem.scale.set(1, 1.3, 0.6); gem.rotation.x = -0.3;
        return { gem };
      },
      shoulder(k, sh) { k.add(velvet, ball(sh, 0.068, [1, 0.95, 1.05], 16)); },
      cuff(k, el, wr) {
        k.add(lace, tube(wr.clone().lerp(el, 0.12), wr.clone().lerp(el, -0.22), 0.036, 0.05, 16));
      },
      head(k, h) {
        k.add(mask, place(new THREE.SphereGeometry(0.15, 40, 28), [0, 0, 0], [0, 0, 0], [1, 1.1, 0.95]));
        const eyes = [], lids = [];
        for (const s of [-1, 1]) {
          const e = new THREE.Group(); e.position.set(s * 0.058, 0.018, 0.108); e.rotation.y = s * 0.35; h.add(e);
          e.add(new THREE.Mesh(new THREE.SphereGeometry(0.038, 20, 14), socket));
          const iris = new THREE.Mesh(new THREE.CircleGeometry(0.022, 24), irisMat); iris.position.z = 0.0372; e.add(iris);
          const pu = new THREE.Mesh(new THREE.CircleGeometry(0.008, 14), socket); pu.position.z = 0.0376; e.add(pu);
          eyes.push(iris);
          const lid = new THREE.Group(); e.add(lid);
          lid.add(new THREE.Mesh(new THREE.SphereGeometry(0.041, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), porcelain));
          lids.push(lid);
          k.add(porcelain, place(new THREE.TorusGeometry(0.05, 0.007, 8, 32), [s * 0.06, 0.016, 0.118], [0, s * 0.35, 0], [1, 1.15, 1]));
          k.add(porcelain, sweep([V(s * 0.025, 0.06, 0.142), V(s * 0.07, 0.075, 0.13), V(s * 0.115, 0.09, 0.098), V(s * 0.15, 0.12, 0.06)], (t) => 0.011 * (1 - t * 0.75), 16, 8));
        }
        k.add(mats.brass, place(new THREE.ConeGeometry(0.02, 0.07, 14), [0, -0.04, 0.15], [Math.PI / 2 + 0.6, 0, 0]));
        // wide hat with an upturned brim, ribbon band and plumes
        const brim = new THREE.LatheGeometry([[0.11, 0.004], [0.24, -0.006], [0.3, 0.008], [0.318, 0.035], [0.31, 0.036], [0.29, 0.016], [0.24, 0.006], [0.11, 0.014]].map(([x, y]) => new THREE.Vector2(x, y)), 56);
        k.add(hat, place(brim, [0, 0.125, -0.005], [-0.14, 0, 0.07]));
        k.add(hat, place(new THREE.LatheGeometry([[0.13, 0], [0.125, 0.08], [0.115, 0.13], [0.09, 0.15], [0, 0.155]].map(([x, y]) => new THREE.Vector2(x, y)), 40), [0, 0.13, -0.015], [-0.14, 0, 0.07]));
        k.add(ribbon, place(new THREE.CylinderGeometry(0.129, 0.131, 0.032, 40, 1, true), [0, 0.15, -0.012], [-0.14, 0, 0.07]));
        k.add(ribbon, place(new THREE.TorusGeometry(0.315, 0.005, 6, 64).rotateX(Math.PI / 2).translate(0, 0.034, 0), [0, 0.125, -0.005], [-0.14, 0, 0.07]));
        k.add(ribbon, ball(V(0.12, 0.155, -0.04), 1, [0.018, 0.032, 0.03], 10));
        const feather = (pts, w, mat) => {
          const c = new THREE.CatmullRomCurve3(pts), g = new THREE.PlaneGeometry(1, 1, 1, 16), P = g.attributes.position;
          for (let i = 0; i < P.count; i++) { const t = P.getY(i) + 0.5, p = c.getPoint(t), side = P.getX(i); const wid = w * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 - t * 0.3); P.setXYZ(i, p.x + side * wid, p.y, p.z + side * wid * 0.4); }
          g.computeVertexNormals(); k.add(mat, g);
        };
        feather([V(0.11, 0.17, -0.04), V(0.17, 0.3, -0.08), V(0.15, 0.42, -0.16), V(0.08, 0.47, -0.24)], 0.035, plume);
        feather([V(0.12, 0.16, -0.06), V(0.2, 0.26, -0.1), V(0.24, 0.33, -0.2)], 0.025, plumeDark);
        feather([V(0.1, 0.17, -0.02), V(0.13, 0.27, 0.0), V(0.12, 0.34, -0.05)], 0.018, plume);
        k.add(mats.brass, ball(V(0.12, 0.16, -0.02), 0.012, 1, 10));
        return { eyes, lids, lidOpen: 0.25, lidClosed: Math.PI / 2 + 0.05, extraGlow: [gemMat] };
      },
    };
  },

  gristle() {
    const T = detail();
    const coat = physical({ color: 0x223355, roughness: 0.8, normalMap: T.cloth, normalScale: new THREE.Vector2(0.18, 0.18), sheen: 0.5, sheenColor: new THREE.Color(0x5a74a8), sheenRoughness: 0.5 });
    const facing = standard({ color: 0x8e2420, roughness: 0.75, normalMap: T.cloth, normalScale: new THREE.Vector2(0.4, 0.4) });
    const skin = physical({ color: 0xd59a7a, map: T.skin, roughness: 0.55, normalMap: T.pores, normalScale: new THREE.Vector2(0.3, 0.3), sheen: 0.4, sheenColor: new THREE.Color(0xff9a80), sheenRoughness: 0.5 });
    const beard = standard({ color: 0xa8461c, roughness: 0.85, normalMap: T.hair, normalScale: new THREE.Vector2(0.5, 0.5) });
    const leather = standard({ color: 0x15100d, roughness: 0.42 });
    const linen = standard({ color: 0xece4d4, roughness: 0.8, normalMap: T.cloth, normalScale: new THREE.Vector2(0.6, 0.6) });
    const felt = physical({ color: 0x121218, roughness: 0.85, sheen: 0.6, sheenColor: new THREE.Color(0x444458), side: THREE.DoubleSide });
    const eyeball = standard({ color: 0x1a0e08, roughness: 0.3 });
    const eyeMat = standard({ color: 0x200400, emissive: 0xff5a24, emissiveIntensity: 2.6 });
    const SX = 1.16, SZ = 0.86, R = (y) => (y < -0.08 ? 0.21 + (y + 0.3) * 0.06 : y < 0.12 ? 0.225 : 0.225 - (y - 0.12) * 0.4);
    const front = (x, y) => Math.sqrt(Math.max(0, 1 - (x / (R(y) * SX)) ** 2)) * R(y) * SZ;
    return {
      sleeve: coat, hand: skin, arm: { shoulder: 0.06, elbow: 0.05, wrist: 0.04 }, handOpts: { palm: [0.046, 0.05, 0.022], r: 0.0098 },
      tint: [coat, facing, skin, beard, linen, felt],
      torso(k) {
        k.add(coat, lathe([[0, -0.3], [0.2, -0.3], [0.215, -0.2], [0.225, -0.05], [0.228, 0.12], [0.215, 0.24], [0.17, 0.32], [0.08, 0.38], [0, 0.385]], 36, [0, 0, 0], [0, 0, 0], [SX, 1, SZ]));
        // lapels: red facings in a V, edged in gold
        for (const s of [-1, 1]) {
          const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(s * 0.11, 0.02); sh.lineTo(s * 0.13, 0.3); sh.lineTo(s * 0.05, 0.36); sh.lineTo(0, 0.1); sh.closePath();
          const g = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 });
          const P = g.attributes.position;
          for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i) - 0.05, z = P.getZ(i); P.setZ(i, front(x, y) + z - 0.006); P.setY(i, y); }
          g.computeVertexNormals(); k.add(facing, g);
        }
        for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { const x = s * 0.085, y = 0.2 - i * 0.075; k.add(mats.brass, ball(V(x, y, front(x, y) + 0.012), 0.013, [1, 1, 0.55], 10)); }
        // belt and buckle
        k.add(leather, place(new THREE.CylinderGeometry(R(-0.17) + 0.008, R(-0.17) + 0.01, 0.05, 36, 1, true), [0, -0.17, 0], [0, 0, 0], [SX, 1, SZ]));
        k.add(mats.brass, place(new THREE.TorusGeometry(0.03, 0.007, 6, 4), [0, -0.17, R(-0.17) * SZ + 0.012], [0, 0, Math.PI / 4], [1.3, 1, 1]));
        // linen cravat
        k.add(linen, place(lumpy(new THREE.SphereGeometry(0.06, 16, 12), 0.008, 70), [0, 0.32, 0.11], [0, 0, 0], [1.1, 0.8, 0.7]));
        k.add(linen, place(lumpy(new THREE.ConeGeometry(0.05, 0.13, 14), 0.008, 60), [0, 0.24, 0.155], [Math.PI - 0.2, 0, 0], [1, 1, 0.5]));
        k.add(linen, tube(V(0, 0.33, -0.02), V(0, 0.38, -0.02), 0.085, 0.075, 20));
        // epaulettes with bullion fringe
        for (const s of [-1, 1]) {
          k.add(mats.brass, place(new THREE.CylinderGeometry(0.075, 0.082, 0.022, 24), [s * 0.2, 0.3, 0], [0, 0, -s * 0.3], [1, 1, 0.82]));
          for (let i = 0; i < 13; i++) {
            const a = (i / 12 - 0.5) * Math.PI * 1.15 + (s > 0 ? 0 : Math.PI), x = Math.cos(a) * 0.08, z = Math.sin(a) * 0.066;
            const top = V(s * 0.2 + x * Math.cos(0.3), 0.29 - Math.abs(x) * Math.sin(0.3) * 0, z);
            k.add(mats.brass, tube(top, top.clone().add(V(x * 0.15, -0.06, z * 0.15)), 0.007, 0.006, 6));
          }
        }
        // pocket-watch chain across the waistcoat
        const chain = new THREE.CatmullRomCurve3([V(0.085, -0.02, front(0.085, -0.02) + 0.01), V(0.12, -0.1, front(0.12, -0.1) + 0.012), V(0.16, -0.08, front(0.16, -0.08) + 0.006)]);
        for (let i = 0; i < 16; i++) { const p = chain.getPoint(i / 15); k.add(mats.brass, place(new THREE.TorusGeometry(0.006, 0.0018, 4, 8), [p.x, p.y, p.z], [0, i % 2 ? Math.PI / 2 : 0, 0.6])); }
        return {};
      },
      cuff(k, el, wr) {
        k.add(facing, tube(wr.clone().lerp(el, 0.04), wr.clone().lerp(el, 0.3), 0.05, 0.056, 16));
        k.add(mats.brass, ball(wr.clone().lerp(el, 0.22).add(V(0, 0.05, 0.01)), 0.009, 1, 8));
        k.add(mats.brass, ring(wr.clone().lerp(el, 0.3), _d.subVectors(el, wr), 0.053, 0.004));
      },
      head(k, h) {
        k.add(skin, place(new THREE.SphereGeometry(0.16, 36, 26), [0, 0.005, 0], [0, 0, 0], [1.03, 1, 0.98]));
        for (const s of [-1, 1]) k.add(skin, place(new THREE.SphereGeometry(1, 14, 10), [s * 0.158, 0.005, -0.01], [0, s * 0.3, 0], [0.022, 0.045, 0.034]));
        k.add(skin, ball(V(0, -0.008, 0.16), 0.042, [0.95, 1, 1], 18), ball(V(-0.02, -0.028, 0.168), 0.02, 1, 10), ball(V(0.02, -0.028, 0.168), 0.02, 1, 10));
        // the beard: a lumpy mass, side whiskers, a braided tuft with a bead
        k.add(beard, place(lumpy(new THREE.SphereGeometry(0.15, 32, 20), 0.014, 55, 1), [0, -0.1, 0.045], [0, 0, 0], [1.1, 1.0, 0.85]));
        for (const s of [-1, 1]) k.add(beard, place(lumpy(new THREE.SphereGeometry(0.075, 18, 12), 0.01, 70, s), [s * 0.11, -0.05, 0.04], [0, 0, 0], [0.9, 1.3, 1]));
        k.add(beard, place(lumpy(new THREE.ConeGeometry(0.075, 0.16, 18, 4), 0.008, 80), [0, -0.245, 0.07], [Math.PI + 0.15, 0, 0]));
        k.add(mats.brass, place(new THREE.TorusGeometry(0.03, 0.009, 8, 18), [0, -0.27, 0.074], [Math.PI / 2 - 0.15, 0, 0]));
        for (const s of [-1, 1]) k.add(beard, sweep([V(s * 0.005, -0.035, 0.175), V(s * 0.05, -0.05, 0.17), V(s * 0.1, -0.035, 0.145), V(s * 0.125, 0.0, 0.12)], (t) => 0.022 * (1 - t * 0.75) * Math.min(1, 0.4 + t * 4), 20, 10));
        // one bushy brow over the good eye, a leather patch over the other
        k.add(beard, place(lumpy(new THREE.CapsuleGeometry(0.016, 0.06, 4, 10), 0.004, 120), [-0.06, 0.068, 0.142], [0, -0.25, Math.PI / 2 - 0.2]));
        k.add(beard, place(lumpy(new THREE.CapsuleGeometry(0.014, 0.055, 4, 10), 0.004, 120), [0.062, 0.075, 0.142], [0, 0.25, Math.PI / 2 + 0.25]));
        k.add(leather, place(new THREE.SphereGeometry(1, 20, 12), [0.06, 0.04, 0.142], [0, 0.36, 0], [0.04, 0.034, 0.016]));
        k.add(leather, place(new THREE.TorusGeometry(0.164, 0.0045, 6, 48), [0, 0.02, 0], [0.12, 0, 0.5]));
        const e = new THREE.Group(); e.position.set(-0.06, 0.035, 0.132); e.rotation.y = -0.3; h.add(e);
        e.add(new THREE.Mesh(new THREE.SphereGeometry(0.027, 18, 12), eyeball));
        const iris = new THREE.Mesh(new THREE.CircleGeometry(0.015, 18), eyeMat); iris.position.z = 0.0266; e.add(iris);
        const lid = new THREE.Group(); e.add(lid);
        lid.add(new THREE.Mesh(new THREE.SphereGeometry(0.0292, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), skin));
        // bicorne: two felt flaps meeting at a ridge, gold-edged, with a cockade
        const sh = new THREE.Shape(); sh.moveTo(-0.33, 0.07); sh.quadraticCurveTo(0, -0.03, 0.33, 0.07); sh.bezierCurveTo(0.24, 0.1, 0.16, 0.2, 0, 0.215); sh.bezierCurveTo(-0.16, 0.2, -0.24, 0.1, -0.33, 0.07);
        const edge = [V(-0.33, 0.07, 0), V(-0.22, 0.13, 0), V(-0.1, 0.195, 0), V(0, 0.215, 0), V(0.1, 0.195, 0), V(0.22, 0.13, 0), V(0.33, 0.07, 0)];
        for (const s of [-1, 1]) {
          const g = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 16 });
          g.translate(0, 0, -0.006);
          k.add(felt, place(g, [0, 0.1, s * 0.035], [-s * 0.2, 0, 0]));
          k.add(mats.brass, place(sweep(edge, 0.006, 32, 6), [0, 0.1, s * 0.035], [-s * 0.2, 0, 0]));
        }
        k.add(felt, place(new THREE.SphereGeometry(0.155, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), [0, 0.1, 0], [0, 0, 0], [1.05, 0.7, 0.95]));
        k.add(leather, place(new THREE.CylinderGeometry(0.035, 0.035, 0.008, 20), [-0.12, 0.2, 0.034], [Math.PI / 2 - 0.2, 0, 0]));
        k.add(facing, place(new THREE.CylinderGeometry(0.024, 0.024, 0.01, 20), [-0.12, 0.2, 0.036], [Math.PI / 2 - 0.2, 0, 0]));
        k.add(mats.brass, ball(V(-0.12, 0.2, 0.044), 0.009, [1, 1, 0.6], 8));
        return { eyes: [iris], lids: [lid], lidOpen: 0.1, lidClosed: Math.PI / 2 + 0.05, extraGlow: [] };
      },
    };
  },
};

/** Where the opponent's fan sits, relative to handAnchor (cards.js holds them at this frame). */
const FAN_FRAME = quatE(-0.42, Math.PI, 0);
const FAN_AT = V(0.07, 0.155, 0.37), LEFT_GRIP = { p: V(-0.004, -0.074, -0.021), roll: 0.22 };
const SHOULDER = 0.215, L1 = 0.27, L2 = 0.26;

/**
 * Character reactions. Each is a 0..1 envelope the update loop eases toward its target:
 *   lean     leaning in over the table (calling Liar, the reveal)
 *   tremble  holding the revolver
 *   flinch   one-shot jolt on the trigger click
 *   relief   sagging back after surviving
 *   reach    right hand moves to ch.reachTarget (world), to pick the revolver up
 *   aim      right hand raised beside the head, barrel at the right temple
 *   out      eliminated: lights out, eyes shut, slumped, arm limp, drained of colour
 */
export function buildCharacter(designKey, angle) {
  const design = DESIGNS[designKey]();
  const group = new THREE.Group();
  group.position.set(Math.cos(angle) * SEAT_RADIUS, 0, Math.sin(angle) * SEAT_RADIUS);
  group.lookAt(0, 0, 0);
  scene.add(group);
  const waist = new THREE.Group(); waist.position.y = -0.3; group.add(waist);
  const upper = new THREE.Group(); upper.position.y = 0.3; waist.add(upper);
  const neck = new THREE.Group(); neck.position.y = 0.36; upper.add(neck);
  const head = new THREE.Group(); head.position.y = 0.14; neck.add(head);

  const ku = new Kit(), kh = new Kit();
  const parts = design.torso(ku, upper) || {};
  if (parts.gem) upper.add(parts.gem);
  const face = design.head(kh, head, neck);
  const A = design.arm;

  // Left arm: static, its hand pinching the base of the card fan. handAnchor hangs off the hand.
  const fan = new THREE.Matrix4().compose(FAN_AT, FAN_FRAME, V(1, 1, 1));
  const lm = new THREE.Matrix4().compose(LEFT_GRIP.p, quatE(0, 0, LEFT_GRIP.roll), V(-1, 1, 1)).premultiply(fan);
  const lh = handGeometry(design.handOpts).applyMatrix4(lm);
  { const ix = lh.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i]; ix[i] = ix[i + 2]; ix[i + 2] = t; } }
  ku.add(design.hand, lh);
  const lwr = V(0, -0.068, -0.004).applyMatrix4(lm), lsh = V(SHOULDER, 0.245, -0.01), lel = V(0.255, 0.03, 0.13);
  ku.add(design.sleeve, tube(lsh, lel, A.shoulder, A.elbow, 16), ball(lsh, A.shoulder, 1, 16), ball(lel, A.elbow, 1, 14), tube(lel, lwr, A.elbow, A.wrist, 16));
  design.shoulder?.(ku, lsh); design.cuff(ku, lel, lwr);
  const leftHand = new THREE.Group(); upper.add(leftHand);
  lm.decompose(leftHand.position, leftHand.quaternion, _a);
  leftHand.updateMatrix();
  const handAnchor = new THREE.Group(); leftHand.add(handAnchor);
  new THREE.Matrix4().copy(leftHand.matrix).invert().multiply(new THREE.Matrix4().makeTranslation(FAN_AT.x, FAN_AT.y, FAN_AT.z)).decompose(handAnchor.position, handAnchor.quaternion, handAnchor.scale);

  // Right arm: shoulder, upper arm, forearm and fist, posed every frame by two-bone IK.
  const uArm = new THREE.Group(); uArm.position.set(-SHOULDER, 0.245, -0.01); upper.add(uArm);
  const fArm = new THREE.Group(); fArm.position.y = -L1; uArm.add(fArm);
  const rHand = new THREE.Group(); fArm.add(rHand);
  const grip = new THREE.Object3D(); rHand.add(grip);
  const ka = new Kit(), kf = new Kit(), kr = new Kit(), O = V(0, 0, 0);
  ka.add(design.sleeve, tube(O, V(0, -L1, 0), A.shoulder, A.elbow, 16), ball(O, A.shoulder, 1, 16), ball(V(0, -L1, 0), A.elbow, 1, 14));
  design.shoulder?.(ka, O);
  kf.add(design.sleeve, tube(O, V(0, -L2, 0), A.elbow, A.wrist, 16));
  design.cuff(kf, O, V(0, -L2, 0));
  kr.add(design.hand, fistGeometry(design.handOpts));
  for (const [kit, bone] of [[ka, uArm], [kf, fArm], [kr, rHand]]) for (const m of kit.build(bone, { cast: true })) m.receiveShadow = true;
  for (const m of ku.build(upper, { cast: true })) m.receiveShadow = true;
  for (const m of kh.build(head, { cast: true })) m.receiveShadow = true;

  const chair = new THREE.Mesh(chairGeometry(), mats.chair); chair.castShadow = true; chair.receiveShadow = true; group.add(chair);

  const glowMats = [...new Set([face.eyes[0].material, ...face.extraGlow])];
  const tints = design.tint.map((m) => ({ m, base: m.color.clone(), sheen: m.sheenColor?.clone() }));
  return {
    group, waist, upper, neck, head, eyes: face.eyes, handAnchor, leftHand,
    arm: { upper: uArm, fore: fArm, hand: rHand, pos: V(0, 0, 0), quat: new THREE.Quaternion() }, grip, reachTarget: new THREE.Vector3(),
    lids: face.lids, lidOpen: face.lidOpen, lidClosed: face.lidClosed,
    parts, design, tints, tintAt: 0,
    glow: glowMats.map((m) => ({ m, base: m.emissiveIntensity })),
    eyeMat: face.eyes[0].material,
    lookTarget: new THREE.Vector3(),
    yaw: 0, pitch: 0, phase: Math.random() * 6, blinkAt: rand(1, 4), blink: 0, flicker: 0,
    env: { lean: 0, tremble: 0, flinch: 0, relief: 0, out: 0, aim: 0, reach: 0 },
    target: { lean: 0, tremble: 0, relief: 0, out: 0, aim: 0, reach: 0 },
  };
}

export function react(ch, kind, on = true) {
  if (kind === 'flinch') { ch.env.flinch = 1; return; }
  ch.target[kind] = on ? 1 : 0;
}
export function resetCharacter(ch) {
  for (const k of Object.keys(ch.target)) ch.target[k] = 0;
  ch.env.flinch = 0; ch.flicker = 0;
}
export const tell = (ch, seconds = 1.3) => { ch.flicker = seconds; };
export const headWorld = (ch, out) => ch.head.getWorldPosition(out);

/** Drains colour toward a dim grey as a character goes out. Only touches materials on change. */
function applyTint(ch, k) {
  if (Math.abs(k - ch.tintAt) < 0.004) return;
  ch.tintAt = k;
  for (const t of ch.tints) {
    const l = t.base.r * 0.3 + t.base.g * 0.59 + t.base.b * 0.11;
    t.m.color.copy(t.base).lerp(_c.setRGB(l, l, l), k * 0.75).multiplyScalar(1 - k * 0.35);
    if (t.sheen) t.m.sheenColor.copy(t.sheen).multiplyScalar(1 - k * 0.8);
  }
}

/* ---------- right arm ---------- */
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3(), _s1 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _S = new THREE.Vector3(), _W = new THREE.Vector3(), _E = new THREE.Vector3(), _n = new THREE.Vector3(), _pole = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

/** Grip-frame orientation from the back-of-hand (+x) and barrel (+z) directions. */
function basis(x, z, out = new THREE.Quaternion()) {
  _z.copy(z).normalize(); _y.crossVectors(_z, _x.copy(x)).normalize(); _x.crossVectors(_y, _z);
  return out.setFromRotationMatrix(_m1.makeBasis(_x, _y, _z));
}
/** Bone orientation whose -y runs from `from` to `to` and whose +z leans toward `bend`. */
function boneQuat(from, to, bend, out) {
  _y.subVectors(from, to).normalize(); _z.copy(bend).addScaledVector(_y, -bend.dot(_y)).normalize(); _x.crossVectors(_y, _z);
  return out.setFromRotationMatrix(_m1.makeBasis(_x, _y, _z));
}

// Grip poses in upper-body space: resting palm-down on the table right of the fan, and hanging limp.
const REST = { pos: V(-0.2, 0.034, 0.41), quat: basis(V(0, 1, 0), V(-0.25, 0, 1)) };
const LIMP = { pos: V(-0.27, -0.2, 0.12), quat: basis(V(-1, 0, 0), V(0, -1, 0.25)) };
// In head space: barrel aimed at the right temple, the muzzle (0.205 m up the barrel) 7 cm away.
const AIM_DIR = V(0.97, -0.14, 0.2).normalize();
const AIM_LOCAL = new THREE.Matrix4().compose(V(-0.155, 0.035, 0.035).addScaledVector(AIM_DIR, -0.265), basis(V(0, 0, -1), AIM_DIR), V(1, 1, 1));

function poseArm(ch, t) {
  const E = ch.env, arm = ch.arm, live = 1 - E.out;
  ch.group.updateMatrixWorld(true);
  _m2.copy(ch.upper.matrixWorld).invert();
  const pos = arm.pos.copy(REST.pos), quat = arm.quat.copy(REST.quat);
  pos.y += Math.sin(t * 0.9 + ch.phase) * 0.002 * live;
  if (E.reach > 0.001) {
    _p1.copy(ch.reachTarget).applyMatrix4(_m2);
    basis(_p2.set(0, 1, 0), _s1.set(_p1.x + SHOULDER, 0, _p1.z + 0.01), _q1);
    pos.lerp(_p1.add(_s1.set(0, 0.02, 0)), E.reach); quat.slerp(_q1, E.reach);
  }
  if (E.aim > 0.001) {
    _m1.multiplyMatrices(_m2, ch.head.matrixWorld).multiply(AIM_LOCAL).decompose(_p1, _q1, _s1);
    const sh = E.tremble * live;
    _p1.x += (Math.sin(t * 41) + Math.sin(t * 23.7)) * 0.0022 * sh;
    _p1.y += (Math.sin(t * 37.3) + Math.sin(t * 13.1)) * 0.0028 * sh;
    _p1.z += Math.sin(t * 29.9) * 0.002 * sh;
    pos.lerp(_p1, E.aim); quat.slerp(_q1, E.aim);
  }
  if (E.out > 0.001) { pos.lerp(LIMP.pos, E.out); quat.slerp(LIMP.quat, E.out); }

  // wrist from the grip pose, then two-bone IK with the elbow pushed out and down
  _W.copy(FIST_WRIST).applyQuaternion(quat).add(pos);
  _S.copy(arm.upper.position);
  _d.subVectors(_W, _S); const dist = clamp(_d.length(), 0.08, L1 + L2 - 0.002); _d.normalize();
  _W.copy(_S).addScaledVector(_d, dist);
  const cosA = clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  _pole.set(-1, -0.75 + E.aim * 0.35, -0.25 + E.aim * 0.1).normalize();
  _n.copy(_pole).addScaledVector(_d, -_pole.dot(_d)).normalize();
  _E.copy(_S).addScaledVector(_d, cosA * L1).addScaledVector(_n, sinA * L1);
  boneQuat(_S, _E, _n, _q2); arm.upper.quaternion.copy(_q2);
  boneQuat(_E, _W, _n, _q3); arm.fore.quaternion.copy(_q2).invert().multiply(_q3);
  arm.hand.quaternion.copy(_q3).invert().multiply(quat);
  arm.hand.position.copy(FIST_WRIST).applyQuaternion(arm.hand.quaternion).negate(); arm.hand.position.y -= L2;
}

export function updateCharacter(ch, dt, t) {
  const E = ch.env, T = ch.target;
  for (const k of ['lean', 'tremble', 'relief', 'aim', 'reach']) E[k] += (T[k] - E[k]) * damp(dt, 4);
  E.out += (T.out - E.out) * damp(dt, 2.4);
  E.flinch *= Math.exp(-dt * 6);
  const live = 1 - E.out;

  ch.group.worldToLocal(_a.copy(ch.lookTarget)); _a.y -= 0.5;
  const yaw = clamp(Math.atan2(_a.x, _a.z), -1, 1), pitch = clamp(-Math.atan2(_a.y, Math.hypot(_a.x, _a.z)), -0.45, 0.6);
  const k = damp(dt, 3.2);
  ch.yaw += (yaw - ch.yaw) * k; ch.pitch += (pitch - ch.pitch) * k;

  const jitter = E.tremble * live;
  const tx = (Math.sin(t * 47) + Math.sin(t * 31.3)) * 0.004 * jitter;
  const breath = Math.sin(t * (1.7 + jitter * 2) + ch.phase);
  ch.neck.rotation.y = ch.yaw * live * (1 - E.aim * 0.65) + tx * 3 + E.out * 0.25;
  ch.head.rotation.x = ch.pitch * 0.7 * live + E.out * 0.75 - E.flinch * 0.25 + E.relief * -0.12;
  ch.head.rotation.z = E.out * 0.32 + Math.sin(t * 0.7 + ch.phase) * 0.02 * live + tx * 4;
  ch.waist.rotation.x = E.out * 0.42 + E.lean * 0.16 - E.flinch * 0.12 - E.relief * 0.08;
  ch.waist.rotation.z = tx * 2 + E.out * 0.12;
  ch.upper.position.y = 0.3 + breath * 0.005 * live - E.out * 0.04;
  poseArm(ch, t);

  if (t > ch.blinkAt) { ch.blink = 1; ch.blinkAt = t + rand(2.5, 6); if (Math.random() < 0.2) ch.blinkAt = t + 0.28; }
  ch.blink = Math.max(0, ch.blink - dt * 7);
  const shut = Math.max(Math.sin(ch.blink * Math.PI), E.out, E.flinch * 0.9, E.relief * 0.35 * live);
  const lid = ch.lidOpen + (ch.lidClosed - ch.lidOpen) * shut;
  for (const l of ch.lids) l.rotation.x = lid;
  ch.flicker = Math.max(0, ch.flicker - dt);
  const flicker = ch.flicker > 0 ? (Math.sin(t * 60) > 0.2 ? 0.12 : 1.15) : 1;
  for (const g of ch.glow) g.m.emissiveIntensity = g.base * live * live * (g.m === ch.eyeMat ? flicker : 1);
  ch.design.update?.(ch, dt, t, E);
  applyTint(ch, E.out);
}
