// Card bodies: a fixed pool of meshes driven by Movers. The server names cards by opaque per-round
// tokens, so a body is bound to a token only once the token is known (your own hand at the deal,
// anyone's cards when they are played) and shows a face only once its rank is known. Hands are
// kept by view (0 is you, 1..3 the characters left to right); this module decides where they are drawn.
import * as THREE from 'three';
import { scene, camera, canvasTex } from './core.js';
import { cardFront, cardBack, cardGlow, RANK_STYLE } from './textures.js';
import { Mover, easeFling } from './motion.js';
import { quatE } from '../util.js';

export const CW = 0.11, CH = 0.154, CT = 0.0012;
export const MAX_CARDS = 21;
/** Bodies held by each view, in the order they arrived. */
export const hands = [[], [], [], []];
const byToken = new Map();
export const handUI = { selected: new Set(), hover: null, enabled: false };

const FACE_DOWN = (yaw = 0, out) => quatE(Math.PI / 2, yaw, 0, out);
const FACE_UP = (yaw = 0, out) => quatE(-Math.PI / 2, yaw, 0, out);
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _o = new THREE.Object3D();
export const bodies = [];
const faces = {};
let unknown = null, active = MAX_CARDS;

/*
 * Paper right under the lamp is several times brighter than anything else on the table, so it
 * would tone-map to flat white and feed the bloom. Cards roll their own highlights off instead:
 * radiance below KNEE is untouched (cards in hand, in shade, all the ink), brighter paper is
 * compressed toward just under the bloom threshold, keeping hue and the ink's contrast.
 */
const PAPER_KNEE = `float cardL = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
  if (cardL > 0.45) outgoingLight *= (0.45 + (cardL - 0.45) * 0.33 / (0.33 + cardL - 0.45)) / cardL;
  #include <opaque_fragment>`;
function rollOffHighlights(m) {
  m.onBeforeCompile = (s) => { s.fragmentShader = s.fragmentShader.replace('#include <opaque_fragment>', PAPER_KNEE); };
  m.customProgramCacheKey = () => 'card-paper';
  return m;
}

export function buildCards() {
  const geo = new THREE.BoxGeometry(CW, CH, CT);
  const edge = rollOffHighlights(new THREE.MeshStandardMaterial({ color: 0xe6d8b8, roughness: 0.7 }));
  const backMap = canvasTex(cardBack());
  const back = rollOffHighlights(new THREE.MeshStandardMaterial({ map: backMap, roughness: 0.5, alphaTest: 0.5, emissiveMap: backMap, emissive: 0xffffff, emissiveIntensity: 0.07 }));
  unknown = [edge, edge, edge, edge, back, back];
  for (const rank of Object.keys(RANK_STYLE)) {
    const map = canvasTex(cardFront(rank));
    const front = rollOffHighlights(new THREE.MeshStandardMaterial({ map, roughness: 0.55, alphaTest: 0.5, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.14 }));
    faces[rank] = [edge, edge, edge, edge, front, back];
  }
  const glowMap = canvasTex(cardGlow(), { srgb: false });
  const glowGeo = new THREE.PlaneGeometry(CW * 1.48, CH * 1.36);
  // Taller than the card and reaching below it, so a card lifting under the pointer stays hovered.
  const hitGeo = new THREE.PlaneGeometry(CW, CH * 1.6).translate(0, -CH * 0.3, CT / 2 + 0.0002);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  for (let i = 0; i < MAX_CARDS; i++) {
    const mesh = new THREE.Mesh(geo, unknown);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ map: glowMap, color: 0xffb648, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.z = -0.003; glow.renderOrder = -1; mesh.add(glow);
    const hit = new THREE.Mesh(hitGeo, hitMat); mesh.add(hit);
    mesh.position.copy(deckPos(i, _v)); deckQuat(i, mesh.quaternion);
    scene.add(mesh);
    const body = { mesh, glow, hit, mover: new Mover(mesh, scene), slot: i, token: null, rank: null, holder: null, glowTarget: 0, glowColor: new THREE.Color(0xffb648), pendingDelay: 0 };
    hit.userData.body = body;
    bodies.push(body);
  }
}

/** Every texture and shader the cards will ever show, uploaded now rather than mid-game. */
export function warmCards(renderer) {
  const seen = new Set();
  for (const set of [unknown, ...Object.values(faces)]) for (const m of set) for (const t of [m.map, m.emissiveMap]) if (t && !seen.has(t)) { seen.add(t); renderer.initTexture(t); }
  for (const t of [bodies[0].glow.material.map]) renderer.initTexture(t);
}

/** How many bodies the deck in play has (20, or 21 with the Devil); the rest stay off the table. */
export function setDeckSize(n) {
  active = Math.min(n, MAX_CARDS);
  bodies.forEach((b, i) => { b.mesh.visible = i < active; });
}

export const bodyOf = (token) => byToken.get(token) || null;
/** Turns a body's face to `rank` (null shows a back on both sides, for a card nobody may see). */
export function setFace(body, rank) { body.rank = rank; body.mesh.material = rank ? faces[rank] : unknown; }
export function bind(body, token, rank = body.rank) {
  if (body.token) byToken.delete(body.token);
  body.token = token; byToken.set(token, body);
  if (rank !== body.rank) setFace(body, rank);
}

export function setGlow(body, opacity, color = 0xffb648) { body.glowTarget = opacity; body.glowColor.set(color); }
export function clearGlows() { for (const b of bodies) b.glowTarget = 0; }

function release(body) {
  if (body.holder == null) return;
  const h = hands[body.holder], i = h.indexOf(body);
  if (i >= 0) h.splice(i, 1);
  body.holder = null;
}

/* ---------- table placements ---------- */
const deckPos = (slot, out) => out.set(0, 0.004 + slot * CT * 1.05, 0);
// yaw jitter belongs to the slot, not the card, so swapping bodies between slots changes nothing visible
const deckQuat = (slot, out) => FACE_DOWN(Math.sin(slot * 12.9898) * 0.03, out);

let pileCount = 0;
/** Every card back into one face-down stack. Faces stay until the next deal so nothing flips mid-air. */
export function gatherToDeck({ dur = 0.55 } = {}) {
  pileCount = 0;
  for (const h of hands) h.length = 0;
  handUI.selected.clear(); handUI.hover = null;
  bodies.forEach((b, i) => {
    b.holder = null; b.glowTarget = 0; b.slot = i; b.pendingDelay = 0;
    b.mover.go(scene, deckPos(i, _v), deckQuat(i, _q), 1, { dur, arc: 0.06, delay: Math.random() * 0.18 * dur });
  });
}

/**
 * Deals off the top of the stack. `order` lists [view, card | null] in dealing order: a card
 * ({ token, rank }) for your own hand, null for a card dealt face down to someone else.
 * Returns the delay (s) each card leaves at, for the sound.
 */
export function deal(order, gap) {
  byToken.clear();
  const stack = bodies.slice(0, active).sort((a, b) => b.slot - a.slot);
  for (const b of stack) { b.token = null; setFace(b, null); }
  const delays = order.map(([view, card], i) => {
    const b = stack[i];
    if (card) bind(b, card.token, card.rank);
    b.holder = view; b.pendingDelay = 0.1 + i * gap; hands[view].push(b);
    return b.pendingDelay;
  });
  stack.slice(order.length).forEach((b, i) => toSpare(b, i));
  return delays;
}

/**
 * The bodies leaving `view`'s hand for a play, bound to the played tokens. Your own are found by
 * token; another seat's cards are anonymous backs, so any of them will do.
 */
export function takeFromHand(view, tokens) {
  return tokens.map((t) => {
    let b = byToken.get(t);
    if (!b) {
      const h = hands[view];
      b = h.splice(Math.floor(Math.random() * h.length), 1)[0] || bodies.find((x) => x.holder == null && x.token == null && x.mesh.visible);
      b.holder = view;
      bind(b, t, null);
    }
    release(b);
    handUI.selected.delete(t);
    return b;
  });
}
/** Everything a seat still holds, face down onto the pile (the seat is out). */
export function discardHand(view, delay = 0) {
  const h = hands[view].slice();
  h.forEach((b, i) => { release(b); toPile(b, delay + i * 0.07); });
}

export function toPile(body, delay = 0) {
  const i = pileCount++;
  release(body);
  body.mover.go(scene, _v.set((Math.random() - 0.5) * 0.18, 0.004 + i * CT * 1.1, (Math.random() - 0.5) * 0.14), FACE_DOWN((Math.random() - 0.5) * 1.2, _q), 1, { dur: 0.55, arc: 0.14, delay, ease: easeFling });
}
export function toSpare(body, i) {
  release(body);
  body.mover.go(scene, _v.set(0.4, 0.004 + i * CT * 1.05, -0.48), FACE_DOWN(0.5, _q), 1, { dur: 0.5, arc: 0.05 });
}
/** Lift a played card off the pile and hold it up, face to the player, close enough to read. */
export function toReveal(body, i, n, delay = 0) {
  const t = i - (n - 1) / 2;
  _o.position.set(t * 0.165, 0.3 - Math.abs(t) * 0.012, 0.56);
  _o.lookAt(camera.position);
  _o.rotateZ(-t * 0.05);
  body.mover.go(scene, _o.position, _o.quaternion, 1.3, { dur: 0.6, arc: 0.06, delay, ease: easeFling });
}
/** Lay revealed cards face up in front of the pile, clear of it so nothing interpenetrates. */
export function settleRevealed(body, i, n, dur = 0.5) {
  body.mover.go(scene, _v.set((i - (n - 1) / 2) * 0.13, 0.004 + i * CT * 1.1, 0.32), FACE_UP((Math.random() - 0.5) * 0.12, _q), 1, { dur, arc: 0.04, delay: i * 0.05 });
}

/**
 * Lays the table out at once from a snapshot: `byView` lists each view's hand (a card for yours,
 * null for a hidden one), `pile` the played tokens in order, `revealed` the cards a call turned over.
 */
export function placeTable(byView, pile, revealed) {
  byToken.clear();
  pileCount = 0;
  for (const h of hands) h.length = 0;
  const stack = bodies.slice(0, active);
  for (const b of stack) { b.token = null; b.holder = null; b.glowTarget = 0; b.pendingDelay = 0; setFace(b, null); }
  let k = 0;
  byView.forEach((cards, v) => cards.forEach((c) => {
    const b = stack[k++];
    if (c) bind(b, c.token, c.rank);
    b.holder = v; hands[v].push(b);
  }));
  for (const t of pile) {
    const b = stack[k++], r = revealed.find((c) => c.token === t);
    bind(b, t, r ? r.rank : null);
    if (!r) toPile(b);
  }
  revealed.forEach((c, i) => { const b = byToken.get(c.token); if (b) settleRevealed(b, i, revealed.length, 0.35); });
  stack.slice(k).forEach((b, i) => toSpare(b, i));
}

/* ---------- hands, laid out every frame ---------- */
const RANK_ORDER = { king: 0, queen: 1, ace: 2, joker: 3, devil: 4 };
const byDisplay = (a, b) => (RANK_ORDER[a.rank] ?? 9) - (RANK_ORDER[b.rank] ?? 9) || (a.token < b.token ? -1 : a.token > b.token ? 1 : 0);
const _mine = [];
/** Your hand in the order it is drawn, left to right. Reused array: read it, don't keep it. */
export function myHand() {
  _mine.length = 0;
  for (const b of hands[0]) _mine.push(b);
  return _mine.sort(byDisplay);
}

function hold(body, parent, pos, quat, scale, dealArc) {
  body.mover.smooth = body.mover.rotSmooth = 0.075;
  if (body.mesh.parent !== parent || body.pendingDelay) {
    body.mover.go(parent, pos, quat, scale, { dur: 0.48, arc: dealArc, delay: body.pendingDelay, ease: easeFling });
    body.pendingDelay = 0;
  } else body.mover.follow(parent, pos, quat, scale);
}

/**
 * Lays out your hand in camera space, sized to the viewport so it reads the same on a phone and a
 * monitor, and each other view's hand as a fan held over the table edge. `characters` is by view.
 * `up` (0..1) blends your hand from resting low by the table edge (0) to held up close to read (1).
 */
const HAND_LAYER = 0.0025, _X = new THREE.Vector3(1, 0, 0);
// [height as a share of the view, spacing in card widths, tilt back, how far the hand's centre sits
// below the bottom edge in card heights (negative: above it)], resting and held up
const DOWN = [0.15, 0.52, -0.62, -0.08], UP = [0.3, 0.74, -0.06, -0.6];
const mix = (k, i) => DOWN[i] + (UP[i] - DOWN[i]) * k;
export function layoutHands(characters, reserveBottomPx, up = 1) {
  const mine = myHand(), n = mine.length;
  if (n) {
    const d = 0.5;
    const hh = d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / camera.zoom, hw = hh * camera.aspect;
    let s = (mix(up, 0) * 2 * hh) / CH, spacing = CW * s * mix(up, 1);
    const total = CW * s + spacing * (n - 1), maxW = hw * 2 * 0.9;
    if (total > maxW) { const f = maxW / total; s *= f; spacing *= f; }
    const px = (2 * hh) / innerHeight, tilt = mix(up, 2);
    // held up, the hand clears the buttons under it; resting, it sinks to the edge of the view
    const baseY = -hh + reserveBottomPx * px * up - CH * s * mix(up, 3);
    for (let i = 0; i < n; i++) {
      const b = mine[i], t = i - (n - 1) / 2;
      const sel = handUI.selected.has(b.token), hov = handUI.hover === b.token && handUI.enabled;
      const lift = sel ? CH * s * 0.3 : hov ? CH * s * 0.1 : 0;
      // Every card shares one tilt and sits on its own layer of the tilted stack, so a lift slides it
      // within its layer: cards that overlap can never pass through each other. Resting and held-up
      // hands blend their sizes and tilt, never each card's pose, so every frame between is a stack too.
      _v.set(t * spacing, baseY - t * t * 0.0025 * s + lift, i * HAND_LAYER).applyAxisAngle(_X, tilt);
      _v.z -= d;
      quatE(tilt, 0, -t * 0.045, _q);
      hold(b, camera, _v, _q, s * (hov && !sel ? 1.04 : 1), 0.03);
      // the hovered card's hit area grows, so its own lift can't carry it out from under the pointer
      b.hit.scale.y = hov ? 1.3 : 1;
      b.mesh.castShadow = false;
      b.glowTarget = sel ? 0.95 : 0;
      b.glowColor.set(0xffb648);
    }
  }
  for (let view = 1; view < 4; view++) {
    const hand = hands[view], m = hand.length, ch = characters[view];
    for (let i = 0; i < m; i++) {
      const b = hand[i], t = i - (m - 1) / 2, a = t * 0.16;
      _v.set(Math.sin(a) * 0.15, (Math.cos(a) - 1) * 0.15, -i * 0.002);
      quatE(-0.42, Math.PI, a, _q);
      hold(b, ch.handAnchor, _v, _q, 0.78, 0.12);
      b.mesh.castShadow = true;
    }
  }
}

export function updateCards(dt) {
  const k = 1 - Math.exp(-dt * 10);
  for (const b of bodies) {
    b.mover.update(dt);
    const m = b.glow.material;
    m.opacity += (b.glowTarget - m.opacity) * k;
    m.color.lerp(b.glowColor, k);
    b.glow.visible = m.opacity > 0.01;
    if (!b.mesh.castShadow && b.mesh.parent === scene) b.mesh.castShadow = true;
  }
}

const _hits = [], _found = [];
/** The token of your hand card under the ray. Keeps the hovered card while the ray still touches it, so neighbours don't flicker. */
export function pickCard(raycaster, current = null) {
  _hits.length = 0;
  for (const b of hands[0]) _hits.push(b.hit);
  _found.length = 0;
  raycaster.intersectObjects(_hits, false, _found);
  for (const h of _found) if (h.object.userData.body.token === current) return current;
  return _found.length ? _found[0].object.userData.body.token : null;
}
