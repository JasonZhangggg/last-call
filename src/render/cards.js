// Card views: one mesh per model card, driven by Movers. The model owns which hand a card is in;
// this module only decides where that hand is drawn.
import * as THREE from 'three';
import { scene, camera, canvasTex } from './core.js';
import { cardFront, cardBack, cardGlow } from './textures.js';
import { Mover, easeOutCubic } from './motion.js';
import { quatE } from '../util.js';

export const CW = 0.11, CH = 0.154, CT = 0.0012;
export const views = new Map();
export const handUI = { selected: new Set(), hover: null, enabled: false };

const FACE_DOWN = (yaw = 0, out) => quatE(Math.PI / 2, yaw, 0, out);
const FACE_UP = (yaw = 0, out) => quatE(-Math.PI / 2, yaw, 0, out);
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _o = new THREE.Object3D();

export function buildCards(deck) {
  const geo = new THREE.BoxGeometry(CW, CH, CT);
  const edge = new THREE.MeshStandardMaterial({ color: 0xe6d8b8, roughness: 0.7 });
  const backMap = canvasTex(cardBack());
  const back = new THREE.MeshStandardMaterial({ map: backMap, roughness: 0.5, alphaTest: 0.5, emissiveMap: backMap, emissive: 0xffffff, emissiveIntensity: 0.07 });
  const fronts = {};
  const glowMap = canvasTex(cardGlow(), { srgb: false });
  const glowGeo = new THREE.PlaneGeometry(CW * 1.48, CH * 1.36);
  for (const c of deck) {
    if (!fronts[c.rank]) {
      const map = canvasTex(cardFront(c.rank));
      fronts[c.rank] = new THREE.MeshStandardMaterial({ map, roughness: 0.55, alphaTest: 0.5, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.14 });
    }
    const mesh = new THREE.Mesh(geo, [edge, edge, edge, edge, fronts[c.rank], back]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ map: glowMap, color: 0xffb648, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.z = -0.003; glow.renderOrder = -1; mesh.add(glow);
    mesh.position.set(0, 0.003 + c.id * CT, 0); FACE_DOWN(0, mesh.quaternion);
    scene.add(mesh);
    const view = { id: c.id, rank: c.rank, mesh, glow, mover: new Mover(mesh, scene), glowTarget: 0, glowColor: new THREE.Color(0xffb648), seat: null, pendingDelay: 0 };
    mesh.userData.view = view;
    views.set(c.id, view);
  }
  return views;
}

/** Every texture and shader the cards will ever show, uploaded now rather than mid-game. */
export function warmCards(renderer) {
  const seen = new Set();
  for (const v of views.values()) for (const m of [...v.mesh.material, v.glow.material]) for (const t of [m.map, m.emissiveMap]) if (t && !seen.has(t)) { seen.add(t); renderer.initTexture(t); }
}

export function setGlow(view, opacity, color = 0xffb648) { view.glowTarget = opacity; view.glowColor.set(color); }
export function clearGlows() { for (const v of views.values()) v.glowTarget = 0; }

/* ---------- table placements ---------- */
let pileCount = 0;
export function gatherToDeck() {
  pileCount = 0;
  let i = 0;
  for (const v of views.values()) {
    v.seat = null; v.glowTarget = 0;
    v.mover.go(scene, _v.set(0, 0.004 + i * CT * 1.05, 0), FACE_DOWN((Math.random() - 0.5) * 0.06, _q), 1, { dur: 0.55, arc: 0.06, delay: Math.random() * 0.18 });
    i++;
  }
}
export function toPile(view, delay = 0) {
  const i = pileCount++;
  view.seat = null;
  view.mover.go(scene, _v.set((Math.random() - 0.5) * 0.18, 0.004 + (i % 40) * CT * 1.1, (Math.random() - 0.5) * 0.14), FACE_DOWN((Math.random() - 0.5) * 2 * Math.PI, _q), 1, { dur: 0.55, arc: 0.14, delay, ease: easeOutCubic });
}
export function toSpare(view, i) {
  view.seat = null;
  view.mover.go(scene, _v.set(0.4, 0.004 + i * CT * 1.05, -0.48), FACE_DOWN(0.5, _q), 1, { dur: 0.5, arc: 0.05 });
}
export function toReveal(view, i, n) {
  _o.position.set((i - (n - 1) / 2) * 0.155, 0.25, 0.14);
  _o.lookAt(camera.position);
  view.mover.go(scene, _o.position, _o.quaternion, 1.3, { dur: 0.65, arc: 0.05 });
}
export function settleRevealed(view, i, n) {
  view.mover.go(scene, _v.set((i - (n - 1) / 2) * 0.125, 0.012 + i * 0.002, 0.22), FACE_UP((Math.random() - 0.5) * 0.2, _q), 1, { dur: 0.5, arc: 0.04 });
}
/** Queue a card to be dealt into a seat's hand; layout picks it up and flies it in. */
export function dealTo(view, seat, delay) { view.seat = seat; view.pendingDelay = delay; }

/* ---------- hands, laid out every frame ---------- */
const RANK_ORDER = { sun: 0, moon: 1, star: 2, wild: 3 };
export const sortForDisplay = (hand) => hand.slice().sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank] || a.id - b.id);

function hold(view, parent, pos, quat, scale, dealArc) {
  view.mover.smooth = 0.075;
  if (view.mesh.parent !== parent || view.pendingDelay) {
    view.mover.go(parent, pos, quat, scale, { dur: 0.48, arc: dealArc, delay: view.pendingDelay, ease: easeOutCubic });
    view.pendingDelay = 0;
  } else view.mover.follow(parent, pos, quat, scale);
}

/**
 * Lays out the player's hand in camera space, sized to the viewport so it reads the same on a
 * phone and a monitor, and each opponent's hand as a fan held over the table edge.
 */
export function layoutHands(game, characters, reserveBottomPx) {
  const me = game.players[0];
  const mine = sortForDisplay(me.hand.filter((c) => views.get(c.id).seat === 0));
  const n = mine.length;
  if (n) {
    const d = 0.5;
    const hh = d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / camera.zoom, hw = hh * camera.aspect;
    let s = (0.2 * 2 * hh) / CH, spacing = CW * s * 0.72;
    const total = CW * s + spacing * (n - 1), maxW = hw * 2 * 0.9;
    if (total > maxW) { const f = maxW / total; s *= f; spacing *= f; }
    const px = (2 * hh) / innerHeight;
    const baseY = -hh + reserveBottomPx * px + (CH * s) / 2;
    mine.forEach((c, i) => {
      const v = views.get(c.id), t = i - (n - 1) / 2;
      const sel = handUI.selected.has(c.id), hov = handUI.hover === c.id && handUI.enabled;
      const lift = sel ? CH * s * 0.3 : hov ? CH * s * 0.1 : 0;
      _v.set(t * spacing, baseY - t * t * 0.0025 * s + lift, -d + i * 0.0015);
      quatE(-0.06 + (hov ? 0.04 : 0), 0, -t * 0.045, _q);
      hold(v, camera, _v, _q, s * (hov && !sel ? 1.04 : 1), 0.03);
      v.mesh.castShadow = false;
      v.glowTarget = sel ? 0.95 : 0;
      v.glowColor.set(0xffb648);
    });
  }
  for (let seat = 1; seat < game.players.length; seat++) {
    const hand = game.players[seat].hand.filter((c) => views.get(c.id).seat === seat), m = hand.length, ch = characters[seat];
    hand.forEach((c, i) => {
      const v = views.get(c.id), t = i - (m - 1) / 2, a = t * 0.16;
      _v.set(Math.sin(a) * 0.15, (Math.cos(a) - 1) * 0.15, -i * 0.002);
      quatE(-0.42, Math.PI, a, _q);
      hold(v, ch.handAnchor, _v, _q, 0.78, 0.12);
      v.mesh.castShadow = true;
    });
  }
}

export function updateCards(dt) {
  const k = 1 - Math.exp(-dt * 10);
  for (const v of views.values()) {
    v.mover.update(dt);
    const m = v.glow.material;
    m.opacity += (v.glowTarget - m.opacity) * k;
    m.color.lerp(v.glowColor, k);
    v.glow.visible = m.opacity > 0.01;
    if (!v.mesh.castShadow && v.mesh.parent === scene) v.mesh.castShadow = true;
  }
}

export function pickCard(raycaster, game) {
  const meshes = game.players[0].hand.map((c) => views.get(c.id).mesh);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  return hit ? hit.object.userData.view.id : null;
}
