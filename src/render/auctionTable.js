// The Gilded Bid's table pieces: 44 money cards (eleven per seat), the 16 status cards, a brass
// easel for the card up for auction, and a plaque counting the gilded cards turned. Every card is
// one instance of a single InstancedMesh over one atlas, so the whole table is a couple of draw
// calls. Each card still has its own Object3D proxy driven by a Mover, exactly like cards.js, and
// the proxies' world matrices are copied into the instances once per frame.
import * as THREE from 'three';
import { scene, camera, canvasTex } from './core.js';
import { mats, place as placeGeo, mergeGeometries } from './world.js';
import { CW, CH, CT } from './cards.js';
import { cardGlow } from './textures.js';
import { Mover, easeFling } from './motion.js';
import { quatE } from '../util.js';
import { ATLAS, CELL, auctionAtlas, moneyCell, statusCell, drawPlaque, plaqueCanvas } from './auctionArt.js';

export const MONEY = [1, 2, 3, 4, 6, 8, 10, 12, 15, 20, 25];
const SEATS = 4, NM = MONEY.length;
export const STATUS_BASE = SEATS * NM;
const COUNT = STATUS_BASE + 16;

/** Seat angle per view (0 is you), matching director.js VIEWS. */
const ANGLE = [Math.PI / 2, Math.PI + 0.52, -Math.PI / 2, -0.52];
// Where each view's rows sit on the felt (x, z). Other seats' bid rows run left to right as you see
// them, in front of the seat and clear of the easel, the candle and the tankards. Won rows run along
// the seat's edge, and the purses opened at the end lie where the seat leans over the felt.
const SPOTS = [
  { bid: [0.34, 0.56], won: [-0.36, 0.58], purse: [0.34, 0.56] },
  { bid: [-0.36, -0.14], won: [-0.62, -0.02], purse: [-0.46, -0.2] },
  { bid: [-0.26, -0.5], won: [0.3, -0.56], purse: [-0.3, -0.46] },
  { bid: [0.36, -0.14], won: [0.62, -0.02], purse: [0.46, -0.2] },
];
// Other seats' bids lie larger than life and square to you, so their numbers read across the table,
// a shade darker so the candle and the lamp don't bleach the ink off the pale notes.
const BID_SCALE = 1.4, BID_ROW_MAX = 0.44, BID_TINT = 0.8, SEAT_R = 1.32;
const DECK_AT = new THREE.Vector3(-0.36, 0, 0.26);
const SPENT_AT = new THREE.Vector3(0.0, 0, -0.27);
const EASEL_AT = new THREE.Vector3(0, 0, 0.34);
const EASEL_TILT = 0.62; // back from vertical
const EASEL_SCALE = 2.3;
const PLAQUE_AT = new THREE.Vector3(0.36, 0.004, 0.3);

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _c = new THREE.Color();
const _t = new THREE.Vector3(), _d = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const FACE_UP = (yaw, out) => quatE(-Math.PI / 2, yaw, 0, out);
const FACE_DOWN = (yaw, out) => quatE(Math.PI / 2, yaw, 0, out);
const jitter = (i, k = 1) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x) - 0.5; };

export const table = {
  mesh: null, easel: null, glow: null, plaque: null, plaqueTex: null, plaqueCanvas: null, gilded: -1,
  bodies: [], easelPose: { pos: new THREE.Vector3(), quat: new THREE.Quaternion() },
  ui: { selected: new Set(), hover: null, enabled: false },
};

/* ---------- geometry ---------- */
/** A thin rounded card. aSide marks each vertex as front (0), back (1) or edge (2) for the atlas lookup. */
function cardGeometry() {
  const r = 0.0085, w = CW / 2, h = CH / 2, s = new THREE.Shape();
  s.moveTo(-w + r, -h); s.lineTo(w - r, -h); s.quadraticCurveTo(w, -h, w, -h + r);
  s.lineTo(w, h - r); s.quadraticCurveTo(w, h, w - r, h);
  s.lineTo(-w + r, h); s.quadraticCurveTo(-w, h, -w, h - r);
  s.lineTo(-w, -h + r); s.quadraticCurveTo(-w, -h, -w + r, -h);
  const g = new THREE.ExtrudeGeometry(s, { depth: CT, bevelEnabled: false, curveSegments: 3 });
  g.translate(0, 0, -CT / 2);
  g.computeVertexNormals();
  const pos = g.attributes.position, nor = g.attributes.normal, n = pos.count;
  const uv = new Float32Array(n * 2), side = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const nz = nor.getZ(i), u = (pos.getX(i) + w) / CW, v = (pos.getY(i) + h) / CH;
    side[i] = nz > 0.5 ? 0 : nz < -0.5 ? 1 : 2;
    uv[i * 2] = side[i] === 1 ? 1 - u : u; uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  g.clearGroups();
  return g;
}

/** MeshStandardMaterial that reads its map from the atlas cell named per instance (aCells: front, back). */
function atlasMaterial(map) {
  // paper right under the hanging lamp blows out at full albedo, so the base colour is a shade darker
  const m = new THREE.MeshStandardMaterial({ map, emissiveMap: map, color: 0xd2cabe, emissive: 0xffffff, emissiveIntensity: 0.1, roughness: 0.62 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSide;\nattribute vec2 aCells;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
      {
        float cell = aSide < 0.5 ? aCells.x : aCells.y;
        vec2 local = aSide > 1.5 ? vec2(0.004, 0.5) : uv;
        vec2 cr = vec2(mod(cell, ${ATLAS.cols}.0), floor(cell / ${ATLAS.cols}.0));
        vec2 px = vec2(cr.x * ${ATLAS.cellW}.0 + ${ATLAS.pad}.0 + local.x * ${ATLAS.w}.0, cr.y * ${ATLAS.cellH}.0 + ${ATLAS.pad}.0 + (1.0 - local.y) * ${ATLAS.h}.0);
        vec2 auv = vec2(px.x / ${ATLAS.width}.0, 1.0 - px.y / ${ATLAS.height}.0);
        vMapUv = auv; vEmissiveMapUv = auv;
      }`);
    // the instance tint brightens or dims the card's own glow too, not just its lit colour
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor.rgb;\n#endif');
  };
  m.customProgramCacheKey = () => 'auction-atlas';
  return m;
}

function easelGeometry() {
  const len = CH * EASEL_SCALE * 0.92, c = Math.cos(EASEL_TILT), sn = Math.sin(EASEL_TILT), half = CW * EASEL_SCALE / 2;
  const rod = (r, l) => new THREE.CylinderGeometry(r, r * 1.15, l, 8);
  // a ledge for the card to rest on, two rails leaning back with it, and a strut down to the felt
  const parts = [placeGeo(new THREE.BoxGeometry(half * 2 + 0.03, 0.012, 0.03), [0, 0.018, 0.012])];
  for (const x of [-1, 1]) {
    parts.push(placeGeo(rod(0.005, len), [x * half * 0.76, 0.02 + (len / 2) * c, -(len / 2) * sn - 0.004], [-EASEL_TILT, 0, 0]));
    parts.push(placeGeo(rod(0.006, 0.03), [x * half * 0.9, 0.015, 0.012]));
  }
  const top = new THREE.Vector3(0, 0.02 + len * c * 0.75, -len * sn * 0.75 - 0.006), foot = new THREE.Vector3(0, 0, top.z - len * 0.42);
  const strut = rod(0.005, top.distanceTo(foot));
  parts.push(placeGeo(strut, [0, (top.y + foot.y) / 2, (top.z + foot.z) / 2], [Math.atan2(top.z - foot.z, top.y - foot.y), 0, 0]));
  return mergeGeometries(parts);
}

/* ---------- build ---------- */
export function buildAuctionTable() {
  const atlas = canvasTex(auctionAtlas());
  const geo = cardGeometry();
  const cells = new Float32Array(COUNT * 2);
  const aCells = new THREE.InstancedBufferAttribute(cells, 2);
  geo.setAttribute('aCells', aCells);
  const mesh = new THREE.InstancedMesh(geo, atlasMaterial(atlas), COUNT);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  table.mesh = mesh;

  const hitGeo = new THREE.PlaneGeometry(CW, CH * 1.3).translate(0, -CH * 0.15, CT / 2 + 0.0002);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  for (let i = 0; i < COUNT; i++) {
    const proxy = new THREE.Object3D();
    proxy.position.copy(DECK_AT);
    scene.add(proxy);
    const money = i < STATUS_BASE;
    const body = {
      i, proxy, mover: new Mover(proxy, scene), money,
      seat: money ? Math.floor(i / NM) : null, value: money ? MONEY[i % NM] : null,
      card: null, place: null, slot: 0, hidden: true, pendingDelay: 0,
      tint: new THREE.Color(1, 1, 1), tintTarget: new THREE.Color(1, 1, 1), hit: null,
    };
    if (money) {
      body.hit = new THREE.Mesh(hitGeo, hitMat); body.hit.userData.body = body; proxy.add(body.hit);
      setCells(body, moneyCell(body.value), CELL.moneyBack);
    } else setCells(body, CELL.statusBack, CELL.statusBack);
    mesh.setMatrixAt(i, ZERO);
    mesh.setColorAt(i, body.tint);
    table.bodies.push(body);
  }

  const easel = new THREE.Mesh(easelGeometry(), mats.brass);
  easel.position.copy(EASEL_AT); easel.castShadow = true; easel.receiveShadow = true; easel.visible = false;
  scene.add(easel); table.easel = easel;
  // the card's resting pose on the easel, in world space
  const len = CH * EASEL_SCALE;
  table.easelPose.pos.set(0, 0.024 + (len / 2) * Math.cos(EASEL_TILT), 0.006 - (len / 2) * Math.sin(EASEL_TILT)).add(EASEL_AT);
  quatE(-EASEL_TILT, 0, 0, table.easelPose.quat);

  const glow = new THREE.Mesh(new THREE.PlaneGeometry(CW * EASEL_SCALE * 1.55, CH * EASEL_SCALE * 1.4), new THREE.MeshBasicMaterial({ map: canvasTex(cardGlow(), { srgb: false }), color: 0xffb648, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.position.copy(table.easelPose.pos).addScaledVector(_v.set(0, Math.sin(EASEL_TILT), Math.cos(EASEL_TILT)), -0.01);
  glow.quaternion.copy(table.easelPose.quat); glow.renderOrder = -1; glow.visible = false;
  glow.userData = { target: 0, color: new THREE.Color(0xffb648) };
  scene.add(glow); table.glow = glow;

  table.plaqueCanvas = plaqueCanvas();
  drawPlaque(table.plaqueCanvas, 0);
  table.plaqueTex = canvasTex(table.plaqueCanvas);
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.0625), new THREE.MeshStandardMaterial({ map: table.plaqueTex, emissiveMap: table.plaqueTex, emissive: 0xffffff, emissiveIntensity: 0.22, roughness: 0.45, metalness: 0.2, transparent: true, alphaTest: 0.1 }));
  plaque.position.copy(PLAQUE_AT); plaque.quaternion.copy(quatE(-Math.PI / 2 + 0.5, -0.25, 0));
  plaque.position.y += 0.0625 / 2 * Math.sin(0.5);
  plaque.receiveShadow = true; plaque.visible = false;
  plaque.userData = { pulse: 0 };
  scene.add(plaque); table.plaque = plaque;
}

function setCells(body, front, back) {
  const a = table.mesh.geometry.attributes.aCells;
  a.setXY(body.i, front, back);
  a.needsUpdate = true;
}
/** Binds a status body to the card it now shows. */
export function setStatusFace(body, card) { body.card = card; setCells(body, card ? statusCell(card) : CELL.statusBack, CELL.statusBack); }

export function showTable(on) {
  table.mesh.visible = table.easel.visible = table.plaque.visible = on;
  table.glow.visible = false;
  if (!on) { table.ui.enabled = false; table.ui.selected.clear(); table.ui.hover = null; }
}

/** Fills `filled` of the four gilded seals; a change pulses the plaque. */
export function setGilded(filled, pulse = true) {
  if (filled === table.gilded) return;
  table.gilded = filled;
  drawPlaque(table.plaqueCanvas, filled);
  table.plaqueTex.needsUpdate = true;
  if (pulse) table.plaque.userData.pulse = 1;
}
export function setGlow(opacity, color) { table.glow.userData.target = opacity; if (color != null) table.glow.userData.color.set(color); }
export function setTint(body, r, g = r, b = r) { body.tintTarget.setRGB(r, g, b); }

/* ---------- places ---------- */
const easelWorld = (out) => out.copy(table.easelPose.pos);
/** World pose of slot k of n in a row of `kind` ('bid', 'won', 'purse') for a view. Returns the scale. */
export function rowPose(view, kind, k, n, outPos, outQuat) {
  const spot = SPOTS[view][kind];
  if (kind === 'bid' && view > 0) {
    // left to right, each note on top of the one before and far enough along that its numeral shows
    const w = CW * BID_SCALE, gap = n > 1 ? Math.min(w * 0.66, (BID_ROW_MAX - w) / (n - 1)) : 0;
    outPos.set(spot[0] + (k - (n - 1) / 2) * gap, 0.004 + k * CT * BID_SCALE * 1.3, spot[1]);
    FACE_UP(jitter(k * 7 + view, 3) * 0.05, outQuat);
    return BID_SCALE;
  }
  const a = ANGLE[view];
  _d.set(Math.cos(a), 0, Math.sin(a));
  _t.set(-_d.z, 0, _d.x); if (_t.x < 0) _t.negate();
  const gap = kind === 'won' ? 0.062 : kind === 'purse' ? 0.044 : 0.05;
  const off = (k - (n - 1) / 2) * gap;
  outPos.set(spot[0], 0.004 + k * CT * 1.3, spot[1]).addScaledVector(_t, off);
  if (kind === 'purse') outPos.addScaledVector(_d, 0.04);
  const yaw = Math.atan2(-_t.z, _t.x) * 0.6 + jitter(k * 7 + view, 3) * 0.08;
  FACE_UP(yaw, outQuat);
  return kind === 'won' ? 0.86 : 1.0;
}
function deckPose(slot, outPos, outQuat) {
  outPos.copy(DECK_AT).setY(0.004 + slot * CT * 1.05);
  return FACE_DOWN(jitter(slot, 1) * 0.05, outQuat);
}
function spentPose(i, outPos, outQuat, faceUp) {
  outPos.set(SPENT_AT.x + jitter(i, 1) * 0.12, 0.004 + (i % 60) * CT * 0.6, SPENT_AT.z + jitter(i, 2) * 0.1);
  return faceUp ? FACE_UP(jitter(i, 4) * 1.2, outQuat) : FACE_DOWN(jitter(i, 4) * 1.6, outQuat);
}

/**
 * Sends a body to a place. `place` is one of: 'deck' (slot), 'easel', 'bid'|'won'|'purse' (view, k, n),
 * 'spent', 'spilled', 'hand' (held: laid out every frame), 'off'.
 */
export function sendTo(body, place, { view = 0, k = 0, n = 1, dur = 0.5, arc = 0.08, delay = 0, snap = false, ease = easeFling } = {}) {
  body.place = place; body.view = view; body.slot = k;
  body.hidden = place === 'off';
  if (body.money && (place === 'bid' || place === 'hand' || place === 'purse')) body.tintTarget.setScalar(place === 'bid' && view > 0 ? BID_TINT : 1);
  if (place === 'hand') { body.pendingDelay = delay; body.handFresh = true; return; }
  let scale = 1;
  if (place === 'deck') deckPose(k, _v, _q);
  else if (place === 'easel') { easelWorld(_v); _q.copy(table.easelPose.quat); scale = EASEL_SCALE; }
  else if (place === 'spent' || place === 'spilled') spentPose(body.i, _v, _q, place === 'spilled');
  else if (place === 'off') { _v.set(0, -1, 0); _q.identity(); }
  else scale = rowPose(view, place, k, n, _v, _q);
  if (snap || place === 'off') body.mover.snap(scene, _v, _q, scale);
  else body.mover.go(scene, _v, _q, scale, { dur, arc, delay, ease });
}
/** A flight through a pose of your choosing (the flourish of a turned card, a won card held up). */
export function flyTo(body, pos, quat, scale, opts) { body.mover.go(scene, pos, quat, scale, { ease: easeFling, ...opts }); }
export const easelPoint = () => table.easelPose.pos;
/** Where a seat reaches to push its bid out: its row, drawn in toward the seat so the arm isn't at full stretch. */
export function bidPoint(view, out) {
  const s = SPOTS[view].bid, a = ANGLE[view], r = view ? 0.25 : 0;
  return out.set(s[0] + (Math.cos(a) * SEAT_R - s[0]) * r, 0.02, s[1] + (Math.sin(a) * SEAT_R - s[1]) * r);
}

/* ---------- held hands, laid out every frame ---------- */
function hold(body, parent, pos, quat, scale, arc) {
  body.mover.smooth = body.mover.rotSmooth = 0.075;
  if (body.mover.parent !== parent || body.handFresh) {
    body.mover.go(parent, pos, quat, scale, { dur: 0.48, arc, delay: body.pendingDelay, ease: easeFling });
    body.pendingDelay = 0; body.handFresh = false;
  } else body.mover.follow(parent, pos, quat, scale);
}

const _mine = [], _fan = [];
/** Your money in hand, lowest first. Reused array: read it, don't keep it. */
export function myHand(seat) {
  _mine.length = 0;
  for (let j = 0; j < NM; j++) { const b = table.bodies[seat * NM + j]; if (b.place === 'hand') _mine.push(b); }
  return _mine;
}

/**
 * Your hand in camera space, sized to the viewport; on a narrow portrait screen it splits into two
 * rows so every note stays a comfortable tap target. `up` (0..1) blends it from a low strip, corner
 * numbers showing, to held up to read and pick from, standing on the HUD band and kept short so the
 * felt and the other seats' bids stay in view above it. While your turn's controls are up they fill
 * the bottom `bandPx` of the screen; `band` (0..1) eases the resting strip onto them instead of under
 * them. Other seats hold theirs as a fan, face down.
 */
const HAND_TILT = -0.06, HAND_LAYER = 0.002, _X = new THREE.Vector3(1, 0, 0);
export function layoutHands(T, reservePx, up, band = 0, bandPx = 0) {
  const mine = myHand(T.me), n = mine.length, ui = table.ui;
  if (n) {
    const d = 0.5;
    const hh = d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / camera.zoom, hw = hh * camera.aspect;
    const rows = n > 6 && camera.aspect < 0.9 ? 2 : 1;
    const perRow = Math.ceil(n / rows);
    const down = 1 - up;
    let s = ((rows === 2 ? 0.12 : 0.13) + 0.04 * up) * 2 * hh / CH, spacing = CW * s * 0.74;
    const total = CW * s + spacing * (perRow - 1), maxW = hw * 2 * 0.92;
    if (total > maxW) { const f = maxW / total; s *= f; spacing *= f; }
    const px = (2 * hh) / innerHeight, ch = CH * s;
    // resting, the strip shows its corners above 0.45 of the reserve, or above the controls' band
    const floor = reservePx * 0.45 + (Math.max(bandPx, reservePx * 0.45) - reservePx * 0.45) * band;
    const baseY = -hh + reservePx * px + ch / 2 - down * (ch * ((rows === 2 ? 1.1 : 0.68) - 0.2 * band) + (reservePx - floor) * px);
    for (let i = 0; i < n; i++) {
      const b = mine[i], row = rows === 2 && i >= perRow ? 1 : 0, j = row ? i - perRow : i;
      const inRow = rows === 2 ? (row ? n - perRow : perRow) : n, t = j - (inRow - 1) / 2;
      const sel = ui.selected.has(b.value), hov = ui.hover === b.value && ui.enabled;
      const lift = sel ? ch * (rows === 2 ? 0.22 : 0.26) : hov ? ch * 0.08 : 0;
      // the back row sits higher, so its corner numbers show above the front row
      const y = baseY + (rows === 2 && row === 0 ? ch * 0.56 : 0) - t * t * 0.002 * s + lift;
      // One tilt for every note, each on its own layer of the tilted stack (the front row's above the
      // back row's), so a lift or a hover slides a note within its layer and no two can ever meet.
      _v.set(t * spacing, y, i * HAND_LAYER).applyAxisAngle(_X, HAND_TILT);
      _v.z -= d;
      quatE(HAND_TILT, 0, -t * 0.035, _q);
      hold(b, camera, _v, _q, s * (hov && !sel ? 1.04 : 1), 0.03);
      b.hit.scale.y = hov ? 1.25 : 1;
      if (sel) b.tintTarget.setRGB(1.25, 1.18, 1.0); else b.tintTarget.setRGB(1, 1, 1);
    }
  }
  for (let v = 1; v < 4; v++) {
    const seat = T.seatAt(v), ch = T.viewChars[v];
    _fan.length = 0;
    for (let j = 0; j < NM; j++) { const b = table.bodies[seat * NM + j]; if (b.place === 'hand') _fan.push(b); }
    const m = _fan.length, step = Math.min(0.14, 1.1 / Math.max(1, m));
    for (let i = 0; i < m; i++) {
      const b = _fan[i], t = i - (m - 1) / 2, a = t * step;
      _v.set(Math.sin(a) * 0.15, (Math.cos(a) - 1) * 0.15, -i * 0.0018);
      quatE(-0.42, Math.PI, a, _q);
      hold(b, ch.handAnchor, _v, _q, 0.72, 0.12);
    }
  }
}

/* ---------- per frame ---------- */
export function updateAuctionTable(dt) {
  const mesh = table.mesh;
  if (!mesh.visible) return;
  const k = 1 - Math.exp(-dt * 10);
  for (const b of table.bodies) {
    b.mover.update(dt);
    if (b.hidden) { mesh.setMatrixAt(b.i, ZERO); continue; }
    const p = b.proxy;
    p.updateMatrix();
    p.matrixWorld.multiplyMatrices(p.parent.matrixWorld, p.matrix);
    mesh.setMatrixAt(b.i, p.matrixWorld);
    if (!b.tint.equals(b.tintTarget)) {
      b.tint.lerp(b.tintTarget, k);
      if (Math.abs(b.tint.r - b.tintTarget.r) + Math.abs(b.tint.g - b.tintTarget.g) + Math.abs(b.tint.b - b.tintTarget.b) < 0.003) b.tint.copy(b.tintTarget);
      mesh.setColorAt(b.i, b.tint);
      mesh.instanceColor.needsUpdate = true;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  const g = table.glow, gm = g.material, u = g.userData;
  gm.opacity += (u.target - gm.opacity) * k;
  gm.color.lerp(u.color, k);
  g.visible = gm.opacity > 0.01;
  const pl = table.plaque, pu = pl.userData;
  if (pu.pulse > 0) { pu.pulse = Math.max(0, pu.pulse - dt * 1.4); pl.scale.setScalar(1 + Math.sin(pu.pulse * Math.PI) * 0.18); pl.material.emissiveIntensity = 0.22 + pu.pulse * 0.8; }
}

/* ---------- picking ---------- */
const _hits = [], _found = [];
/** The value of your money card under the ray. Keeps the hovered card while the ray still touches it. */
export function pickMoney(raycaster, seat, current = null) {
  _hits.length = 0;
  for (const b of myHand(seat)) _hits.push(b.hit);
  _found.length = 0;
  raycaster.intersectObjects(_hits, false, _found);
  for (const h of _found) if (h.object.userData.body.value === current) return current;
  return _found.length ? _found[0].object.userData.body.value : null;
}
