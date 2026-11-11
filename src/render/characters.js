// The three regulars. Built from primitives; animated procedurally (look-at, breathing, blinks,
// tells and reactions). The director drives them only through react(), tell() and lookTarget.
import * as THREE from 'three';
import { scene } from './core.js';
import { mats } from './world.js';
import { rand, clamp, damp, UP } from '../util.js';

export const SEAT_RADIUS = 1.32;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();

function limb(a, b, r, mat) {
  _d.subVectors(b, a); const len = _d.length();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, 10), mat);
  m.position.copy(a).addScaledVector(_d, 0.5); m.quaternion.setFromUnitVectors(UP, _d.normalize()); m.castShadow = true; return m;
}

const DESIGNS = {
  brass() {
    const body = new THREE.MeshStandardMaterial({ color: 0x8e6a32, metalness: 0.85, roughness: 0.38, envMapIntensity: 1.6 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x24201c, metalness: 0.7, roughness: 0.5 });
    return {
      body, hand: body,
      head(h, upper) {
        const shell = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.25, 0.25), body); shell.castShadow = true; h.add(shell);
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.17, 0.012), iron); plate.position.z = 0.126; h.add(plate);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.012, 10, 28), body); ring.position.set(0, 0.025, 0.133); h.add(ring);
        const lensMat = new THREE.MeshStandardMaterial({ color: 0x0a2228, emissive: 0x44e4ff, emissiveIntensity: 2.4 });
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.044, 28), lensMat); lens.position.set(0, 0.025, 0.134); h.add(lens);
        for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.008, 0.01), body); b.position.set(0, -0.045 - i * 0.014, 0.134); h.add(b); }
        for (const s of [-1, 1]) { const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 14), iron); bolt.rotation.z = Math.PI / 2; bolt.position.set(s * 0.145, 0, 0); h.add(bolt); }
        const rivetGeo = new THREE.SphereGeometry(0.009, 8, 6);
        for (const [x, y] of [[-0.12, 0.11], [0.12, 0.11], [-0.12, -0.11], [0.12, -0.11]]) { const r = new THREE.Mesh(rivetGeo, body); r.position.set(x, y, 0.126); h.add(r); }
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.07, 14), iron); neck.position.y = -0.15; h.add(neck);
        for (const s of [-1, 1]) {
          const pad = new THREE.Mesh(new THREE.SphereGeometry(0.105, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), body);
          pad.position.set(s * 0.23, 0.25, 0); pad.scale.set(1, 0.75, 1); pad.rotation.z = -s * 0.35; pad.castShadow = true; upper.add(pad);
        }
        const gauge = new THREE.Group(); gauge.position.set(0, 0.13, 0.163); upper.add(gauge);
        gauge.add(new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.009, 8, 24), body));
        const dial = new THREE.Mesh(new THREE.CircleGeometry(0.04, 24), new THREE.MeshStandardMaterial({ color: 0xe8dcbc, roughness: 0.5, emissive: 0x2a2010, emissiveIntensity: 0.3 })); dial.position.z = 0.002; gauge.add(dial);
        const needle = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.034, 0.002), new THREE.MeshBasicMaterial({ color: 0x8a1a10 })); needle.position.set(0.006, 0.012, 0.004); needle.rotation.z = -0.5; gauge.add(needle);
        const vents = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.02), iron); vents.position.set(0, -0.04, 0.15); upper.add(vents);
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.13, 6), iron); ant.position.set(0.06, 0.19, -0.02); h.add(ant);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), new THREE.MeshStandardMaterial({ color: 0x300, emissive: 0xff3a22, emissiveIntensity: 2 })); tip.position.set(0.06, 0.26, -0.02); h.add(tip);
        return { eyes: [lens], extraGlow: [tip.material] };
      },
    };
  },
  noctua() {
    const body = new THREE.MeshPhysicalMaterial({ color: 0x3a1d3c, roughness: 0.85, sheen: 1, sheenRoughness: 0.4, sheenColor: new THREE.Color(0xb070b0) });
    const porcelain = new THREE.MeshStandardMaterial({ color: 0xe8e0d2, roughness: 0.22, envMapIntensity: 1.5 });
    return {
      body, hand: porcelain,
      head(h, upper) {
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.25, 0.16, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a1230, roughness: 0.95, side: THREE.DoubleSide }));
        collar.position.y = 0.36; upper.add(collar);
        const face = new THREE.Mesh(new THREE.SphereGeometry(0.15, 32, 24), porcelain); face.scale.set(1, 1.1, 0.95); face.castShadow = true; h.add(face);
        const socket = new THREE.MeshStandardMaterial({ color: 0x170c10, roughness: 0.6 });
        const irisMat = new THREE.MeshStandardMaterial({ color: 0x2a1400, emissive: 0xffa632, emissiveIntensity: 2.6 });
        const eyes = [];
        for (const s of [-1, 1]) {
          const e = new THREE.Group(); e.position.set(s * 0.056, 0.02, 0.128); e.rotation.y = s * 0.42; h.add(e);
          const so = new THREE.Mesh(new THREE.CircleGeometry(0.046, 24), socket); so.position.z = 0.004; e.add(so);
          const ir = new THREE.Mesh(new THREE.CircleGeometry(0.027, 20), irisMat); ir.position.z = 0.006; e.add(ir);
          const pu = new THREE.Mesh(new THREE.CircleGeometry(0.01, 12), socket); pu.position.z = 0.007; e.add(pu);
          eyes.push(ir);
        }
        const pearls = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.011, 8, 40), new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.3, envMapIntensity: 1.5 }));
        pearls.rotation.x = Math.PI / 2 - 0.35; pearls.position.set(0, 0.29, 0.03); upper.add(pearls);
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.022), new THREE.MeshStandardMaterial({ color: 0x0a3a38, emissive: 0x2fd6c0, emissiveIntensity: 1.2, roughness: 0.1 }));
        gem.position.set(0, 0.215, 0.17); gem.scale.set(1, 1.3, 0.6); upper.add(gem);
        const browMat = new THREE.MeshStandardMaterial({ color: 0x6a2a5a, roughness: 0.6 });
        for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.006, 6, 20, Math.PI * 0.8), browMat); b.position.set(s * 0.056, 0.03, 0.132); b.rotation.set(0, s * 0.42, Math.PI * 0.1); h.add(b); }
        const beak = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.07, 12), mats.brass); beak.rotation.x = Math.PI / 2 + 0.5; beak.position.set(0, -0.035, 0.148); h.add(beak);
        const hatMat = new THREE.MeshStandardMaterial({ color: 0x120c10, roughness: 0.85 });
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.012, 48), hatMat); brim.position.y = 0.13; brim.rotation.x = -0.12; brim.castShadow = true; h.add(brim);
        const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.13, 0.14, 32), hatMat); crown.position.set(0, 0.2, -0.01); crown.rotation.x = -0.12; crown.castShadow = true; h.add(crown);
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.131, 0.133, 0.03, 32), browMat); band.position.set(0, 0.148, 0); band.rotation.x = -0.12; h.add(band);
        const feather = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshStandardMaterial({ color: 0x2b6f68, roughness: 0.7 }));
        feather.scale.set(0.022, 0.16, 0.008); feather.position.set(0.12, 0.25, -0.03); feather.rotation.z = -0.5; h.add(feather);
        return { eyes, extraGlow: [gem.material] };
      },
    };
  },
  gristle() {
    const body = new THREE.MeshStandardMaterial({ color: 0x1c2940, roughness: 0.78 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xa8725a, roughness: 0.7 });
    return {
      body, hand: skin,
      head(h, upper) {
        for (let i = 0; i < 3; i++) for (const s of [-1, 1]) { const btn = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), mats.brass); btn.position.set(s * 0.05, 0.2 - i * 0.09, 0.16); upper.add(btn); }
        const skull = new THREE.Mesh(new THREE.SphereGeometry(0.16, 32, 24), skin); skull.scale.set(1.05, 1, 1); skull.castShadow = true; h.add(skull);
        const beardMat = new THREE.MeshStandardMaterial({ color: 0x8a3a1a, roughness: 1 });
        const beard = new THREE.Mesh(new THREE.SphereGeometry(0.14, 24, 16), beardMat); beard.scale.set(1.08, 1, 0.82); beard.position.set(0, -0.1, 0.05); beard.castShadow = true; h.add(beard);
        const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.14, 16), beardMat); tuft.rotation.x = Math.PI; tuft.position.set(0, -0.23, 0.07); h.add(tuft);
        for (const s of [-1, 1]) {
          const side = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), beardMat); side.position.set(s * 0.1, -0.06, 0.05); side.castShadow = true; h.add(side);
          const stache = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.06, 4, 8), beardMat); stache.position.set(s * 0.045, -0.04, 0.155); stache.rotation.z = s * 1.2; h.add(stache);
          const shoulder = new THREE.Group(); shoulder.position.set(s * 0.2, 0.29, 0); shoulder.rotation.z = -s * 0.3; upper.add(shoulder);
          const ep = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.02, 20), mats.brass); ep.scale.z = 0.8; ep.castShadow = true; shoulder.add(ep);
          const fringe = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.011, 6, 24), mats.brass); fringe.rotation.x = Math.PI / 2; fringe.scale.y = 0.8; fringe.position.y = -0.012; shoulder.add(fringe);
        }
        const nose = new THREE.Mesh(new THREE.SphereGeometry(0.042, 16, 12), new THREE.MeshStandardMaterial({ color: 0xb46a52, roughness: 0.6 })); nose.position.set(0, -0.005, 0.158); h.add(nose);
        const black = new THREE.MeshStandardMaterial({ color: 0x0c0a0a, roughness: 0.7 });
        const patch = new THREE.Mesh(new THREE.CircleGeometry(0.036, 20), black); patch.position.set(0.062, 0.045, 0.148); patch.rotation.y = 0.4; h.add(patch);
        const strap = new THREE.Mesh(new THREE.TorusGeometry(0.163, 0.005, 6, 40), black); strap.rotation.set(0.15, 0, 0.55); strap.position.y = 0.01; h.add(strap);
        const eyeMat = new THREE.MeshStandardMaterial({ color: 0x200400, emissive: 0xff4a24, emissiveIntensity: 2.6 });
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 14, 10), eyeMat); eye.position.set(-0.062, 0.045, 0.142); h.add(eye);
        const brow = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.018, 0.03), beardMat); brow.position.set(-0.062, 0.078, 0.14); brow.rotation.z = -0.2; h.add(brow);
        const hatMat = new THREE.MeshStandardMaterial({ color: 0x0f0f14, roughness: 0.75 });
        const hat = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), hatMat); hat.scale.set(0.3, 0.13, 0.13); hat.position.y = 0.1; hat.castShadow = true; h.add(hat);
        const trim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 6, 40, Math.PI), mats.brass); trim.scale.set(0.3, 0.13, 0.13); trim.position.set(0, 0.1, 0.002); h.add(trim);
        const crest = new THREE.Mesh(new THREE.CircleGeometry(0.025, 16), mats.brass); crest.position.set(0, 0.16, 0.112); crest.rotation.x = -0.6; h.add(crest);
        return { eyes: [eye], extraGlow: [] };
      },
    };
  },
};

/**
 * Character reactions. Each is a 0..1 envelope the update loop eases toward its target:
 *   lean     leaning in over the table (calling Liar, the reveal)
 *   tremble  holding the revolver
 *   flinch   one-shot jolt on the trigger click
 *   relief   sagging back after surviving
 */
export function buildCharacter(designKey, angle) {
  const design = DESIGNS[designKey]();
  const group = new THREE.Group();
  group.position.set(Math.cos(angle) * SEAT_RADIUS, 0, Math.sin(angle) * SEAT_RADIUS);
  group.lookAt(0, 0, 0);
  scene.add(group);
  const waist = new THREE.Group(); waist.position.y = -0.3; group.add(waist);
  const upper = new THREE.Group(); upper.position.y = 0.3; waist.add(upper);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.22, 6, 18), design.body); torso.scale.set(1.15, 1, 0.8); torso.position.y = 0.02; torso.castShadow = true; upper.add(torso);
  const neck = new THREE.Group(); neck.position.y = 0.36; upper.add(neck);
  const head = new THREE.Group(); head.position.y = 0.14; neck.add(head);
  const { eyes, extraGlow } = design.head(head, upper);
  for (const s of [-1, 1]) {
    const sh = new THREE.Vector3(s * 0.22, 0.24, 0), el = new THREE.Vector3(s * 0.25, 0.04, 0.2), hd = new THREE.Vector3(s * 0.085, 0.09, 0.34);
    upper.add(limb(sh, el, 0.06, design.body)); upper.add(limb(el, hd, 0.05, design.body));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.048, 14, 10), design.hand); hand.position.copy(hd); hand.scale.set(1, 0.85, 1.1); hand.castShadow = true; upper.add(hand);
  }
  const handAnchor = new THREE.Group(); handAnchor.position.set(0, 0.155, 0.37); upper.add(handAnchor);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.05), mats.chair); back.position.set(0, 0.0, -0.27); back.castShadow = true; group.add(back);
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 10), mats.chair); rail.rotation.z = Math.PI / 2; rail.position.set(0, 0.33, -0.27); group.add(rail);

  const glowMats = [...new Set([eyes[0].material, ...extraGlow])];
  return {
    group, waist, upper, neck, head, eyes, handAnchor,
    glow: glowMats.map((m) => ({ m, base: m.emissiveIntensity })),
    eyeMat: eyes[0].material,
    lookTarget: new THREE.Vector3(),
    yaw: 0, pitch: 0, phase: Math.random() * 6, blinkAt: rand(1, 4), blink: 0, flicker: 0,
    env: { lean: 0, tremble: 0, flinch: 0, relief: 0, out: 0 },
    target: { lean: 0, tremble: 0, relief: 0, out: 0 },
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

export function updateCharacter(ch, dt, t) {
  const E = ch.env, T = ch.target;
  for (const k of ['lean', 'tremble', 'relief']) E[k] += (T[k] - E[k]) * damp(dt, 4);
  E.out += (T.out - E.out) * damp(dt, 2.4);
  E.flinch *= Math.exp(-dt * 6);
  const live = 1 - E.out;

  ch.group.worldToLocal(_a.copy(ch.lookTarget)); _a.y -= 0.5;
  const yaw = clamp(Math.atan2(_a.x, _a.z), -1, 1), pitch = clamp(-Math.atan2(_a.y, Math.hypot(_a.x, _a.z)), -0.45, 0.6);
  const k = damp(dt, 3.2);
  ch.yaw += (yaw - ch.yaw) * k; ch.pitch += (pitch - ch.pitch) * k;

  const jitter = E.tremble * live;
  const tx = (Math.sin(t * 47) + Math.sin(t * 31.3)) * 0.004 * jitter;
  ch.neck.rotation.y = ch.yaw * live + tx * 3;
  ch.head.rotation.x = ch.pitch * 0.7 * live + E.out * 0.6 - E.flinch * 0.25 + E.relief * -0.12;
  ch.head.rotation.z = E.out * 0.35 + Math.sin(t * 0.7 + ch.phase) * 0.02 * live + tx * 4;
  ch.waist.rotation.x = E.out * 0.5 + E.lean * 0.16 - E.flinch * 0.12 - E.relief * 0.08;
  ch.waist.rotation.z = tx * 2;
  ch.upper.position.y = 0.3 + Math.sin(t * (1.7 + jitter * 2) + ch.phase) * 0.005 * live;

  if (t > ch.blinkAt) { ch.blink = 1; ch.blinkAt = t + rand(2.5, 6); }
  ch.blink = Math.max(0, ch.blink - dt * 8);
  const sy = 1 - Math.sin(ch.blink * Math.PI) * 0.9;
  for (const e of ch.eyes) e.scale.y = sy;
  ch.flicker = Math.max(0, ch.flicker - dt);
  const flicker = ch.flicker > 0 ? (Math.sin(t * 60) > 0.2 ? 0.12 : 1.15) : 1;
  for (const g of ch.glow) g.m.emissiveIntensity = g.base * live * (g.m === ch.eyeMat ? flicker : 1);
}
