// The dice table: plays dice-mode messages back as cups, dice, the poison tray, characters, sound
// and HUD. Handlers take (T, msg); they read the mirrored table as it stands after `msg` from
// T.game and never decide anything the server hasn't said.
import * as THREE from 'three';
import { $, pick, clamp, settings } from '../util.js';
import { smoothDamp } from '../render/motion.js';
import { audio } from '../audio.js';
import * as ui from '../ui.js';
import { react, tell, poseRightHand, glassGrip, straightGrip } from '../render/characters.js';
import { rigSip } from '../render/rig.js';
import { rig, focusOn, centerLook, lockLook } from '../render/camera.js';
import { camera } from '../render/core.js';
import { gun } from '../render/gun.js';
import { arm, armReach, armHide, shoulderWorld } from '../render/playerArm.js';
import { gatherToDeck, setDeckSize, MAX_CARDS } from '../render/cards.js';
import * as DT from '../render/diceTable.js';
import { BID_FACES, GLASSES } from '../model/dice.js';
import { reduceDice, lastBid, totalDice, matches } from './dice-state.js';
import { bindHand, releaseHand, setHandUp, handKey, stepHand, handUp, spaceHint } from './hand.js';

const LINES = {
  brass: {
    bid: ['Calculated.', 'The odds concur.', '', ''],
    liar: ['Improbable. Liar.', 'Your count does not compute. Liar.'],
    spotOn: ['Exactly. Spot on.', 'Precisely that many. Spot on.'],
    caught: ['A calculated bluff. Miscalculated.', 'Error noted.'],
    honest: ['As computed.', 'The dice concur.'],
    wrong: ['A rounding error.'],
    hold: ['Probability of toxin: acceptable.', 'Bottoms up, as you say.'],
    sip: ['Not poison. Merely terrible.', 'Recalibrating.'],
    others: ['Regrettable.', 'One fewer variable.'],
  },
  noctua: {
    bid: ['Naturally.', 'Would I lie, darling?', 'Mm.', ''],
    liar: ['Liar, darling.', 'Oh, I don\'t think so. Liar.'],
    spotOn: ['Exactly so, darling.', 'Spot on. I can feel it.'],
    caught: ['A lady keeps her secrets. Usually.', 'How rude of you to look.'],
    honest: ['You doubted me? Sweet.', 'Every pip true, darling.'],
    wrong: ['Hm. Pity.'],
    hold: ['To your health, darling.', 'One sip.'],
    sip: ['Vintage. Not lethal.', 'How tedious.'],
    others: ['Such a waste of a hat.', 'Oh dear.'],
  },
  gristle: {
    bid: ['Aye.', 'Hah!', 'Beat that.', ''],
    liar: ['LIAR!', 'Bilge! Liar!'],
    spotOn: ['Spot on, ye swab!', 'Dead on the mark!'],
    caught: ['Worth a try!', 'Blast and barnacles.'],
    honest: ['Ha! Honest as the tide!', 'Count \'em, ye doubter.'],
    wrong: ['Arr. Should\'ve trusted ye.'],
    hold: ['Down the hatch.', 'Yo ho.'],
    sip: ['HAH! Still breathing!', 'Tastes like bilge. Lovely.'],
    others: ['Fair winds, mate.', 'More rum for the rest of us.'],
  },
};
const NERVES = { brass: 0.12, noctua: 0.18, gristle: 0.3 };

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const FACE = ['', 'one', 'two', 'three', 'four', 'five', 'six'];
const FACES = ['', 'ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
const word = (n) => WORDS[n] ?? String(n);
/** "three fives", "one six". */
export const bidText = (q, f) => `${word(q)} ${q === 1 ? FACE[f] : FACES[f]}`;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const verb = (T, seat, you, other) => (T.isMe(seat) ? you : other);
const voice = (T, seat, kind) => { const l = LINES[T.design(seat)]?.[kind]; return l ? pick(l) : ''; };
const say = (T, seat, text) => { if (!T.isMe(seat) && text) ui.say(T.view(seat), text); };
const myCount = (T, face) => T.game.dice.filter((d) => matches(d, face)).length;

/** A die face as inline SVG, for the bid picker and the HUD. */
export function dieSVG(face, cls = '') {
  const P = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] }[face];
  const pips = P.map(([x, y]) => `<circle cx="${12 + x * 5.6}" cy="${12 + y * 5.6}" r="${face === 1 ? 3.4 : 2.3}" fill="${face === 1 ? '#8e1d14' : '#1c120c'}"/>`).join('');
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><rect x="1.2" y="1.2" width="21.6" height="21.6" rx="5.2" fill="#eee3c9" stroke="#8a6a40" stroke-width="1"/>${pips}</svg>`;
}
const dieURL = (face) => `data:image/svg+xml,${encodeURIComponent(dieSVG(face).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '))}`;

/* ---------- the arms ---------- */
const Y = new THREE.Vector3(0, 1, 0);
// a held glass sits where the hand's own pose puts it (ch.glassAt, arm.glassAt: in the grip frame)
const GLASS_H = 0.056;
// your arm's poses in camera space (set on entering): the glass held up before you, its base at
// HOLD_GLASS, the palm turned in and a little away so the glass shows inside the knuckles; and
// tipped back to your lips, the rim at LIPS_RIM
const HOLD = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
const LIPS = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
const HOLD_GLASS = new THREE.Vector3(0.075, -0.1, -0.34), HOLD_FROM = new THREE.Vector3(0.075 + 1, -0.1, -0.34 + 0.45);
const LIPS_RIM = new THREE.Vector3(0.01, -0.065, -0.1);
const MOUTH = new THREE.Vector3(0, -0.07, 0.12);
const LOOK_UP = new THREE.Vector3(0, 2.6, -0.2);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _gp = new THREE.Vector3(), _gq = new THREE.Quaternion(), AX = new THREE.Vector3(1, 0, 0);
const _w0 = new THREE.Vector3(), _q0 = new THREE.Quaternion(), _c = new THREE.Vector3();
const ROW_AT = new THREE.Vector3(0, 0.02, 0.1);
const _row = new THREE.Vector3();
// counted dice sit in the lamp's hot spot and are seen up close: toned down so the pips stay crisp
const DIM = new THREE.Color(0.42, 0.4, 0.38), LIT = new THREE.Color(0.92, 0.85, 0.72), WHITE = new THREE.Color(1, 1, 1);

/**
 * A character's drink, layered over their own pose each frame: `w` blends the right hand from
 * wherever it is to a glass held before the mouth, `tilt` raises it to the lips and tips the head back.
 * The tilt turns the hand at the wrist: the wrist rises toward the chin first and the glass tips
 * over it after, so the forearm only carries the wrist and never swings round the glass.
 */
const sips = new Map(); // view -> { ch, w, wT, tilt, tiltT }
function sipFor(ch, v) { let s = sips.get(v); if (!s) sips.set(v, s = { ch, w: 0, wT: 0, tilt: 0, tiltT: 0 }); s.ch = ch; return s; }
// the elbow at rest out to the side and down; drinking, it comes up and forward so the forearm rises
// in front of the chest instead of crossing through it
const ELBOW_REST = new THREE.Vector3(-1, -0.7, -0.1).normalize(), ELBOW_SIP = new THREE.Vector3(-0.55, -0.35, 0.75).normalize(), _pl = new THREE.Vector3();
const ease = (a, b, v) => { const u = clamp((v - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
// the glass's rim (upper-body space, from the mouth) held before the chest and at the lip, and its
// lean (base to rim) upright and tipped back toward the face, rim low, as it pours
const RIM_HOLD = new THREE.Vector3(-0.01, -0.1, 0.18), RIM_LIP = new THREE.Vector3(0, -0.005, 0.025);
const LEAN_HOLD = new THREE.Vector3(0, 1, 0), LEAN_POUR = new THREE.Vector3(0, -0.25, -1).normalize();
// how far the wrist may bend off the forearm to stand the glass up
const WRIST_GIVE = 0.25;
const _rim = new THREE.Vector3(), _lean = new THREE.Vector3();
function poseSip(s, dt) {
  // a rigged character plays its own drink; it only needs to know what is asked of it
  if (s.ch.rig) { rigSip(s.ch, s.wT, s.tiltT); return s.wT > 0 || s.tiltT > 0; }
  // critically damped, so the head tips back and the glass rises without a jolt at the start
  s.w = smoothDamp(s.w, s.wT, s, 'wv', 0.32, dt);
  s.tilt = smoothDamp(s.tilt, s.tiltT, s, 'tv', 0.34, dt);
  if (s.w < 0.002 && s.wT === 0) { s.w = s.wv = 0; return false; }
  const ch = s.ch, tilt = s.tilt;
  ch.head.rotation.x -= 0.55 * tilt;
  ch.neck.rotation.y *= 1 - 0.7 * s.w;
  ch.head.updateWorldMatrix(true, false);
  ch.upper.worldToLocal(ch.head.localToWorld(_a.copy(MOUTH)));
  // the arm swings up from an elbow out in front with the wrist straight, so the forearm rising is
  // what tips the glass, its rim carried from before the chest to the lip
  _w0.copy(ch.arm.pos); _q0.copy(ch.arm.quat);
  _rim.lerpVectors(RIM_HOLD, RIM_LIP, ease(0, 0.8, tilt)).add(_a);
  _lean.lerpVectors(LEAN_HOLD, LEAN_POUR, ease(0.15, 1, tilt)).normalize();
  straightGrip(ch, _rim, _lean, ELBOW_SIP, WRIST_GIVE, _gp, _gq);
  _gp.lerpVectors(_w0, _gp, s.w);
  // slerp into _q0, not _gq: slerpQuaternions copies its first argument into the target before reading the second
  _gq.copy(_q0.slerp(_gq, s.w));
  // the blend from the table pose would swing the glass through a tilt on the way up; turn the hand
  // so it keeps its lean, fully at the start and fading out as the drinking pose takes over
  _y.set(0, 1, 0).applyQuaternion(ch.glassAt.quat).applyQuaternion(_gq);
  _gq.premultiply(_q.setFromUnitVectors(_y, _lean).slerp(_q2.identity(), s.w));
  poseRightHand(ch, _gp, _gq, _pl.lerpVectors(ELBOW_REST, ELBOW_SIP, s.w), 1 - s.w);
  return true;
}

/* ---------- module state ---------- */
let pendingTurn = null; // your turn's options while the controls are up
const choice = { quantity: 1, face: 2 };
let peeking = false;
let held = null; // { v, i } the glass in someone's hand
let bound = null;
let clock = 0;
let myShake = null; // the world point your hand shakes your cup around, while it does
const shakeIn = { k: 0, v: {} }; // the shake's amplitude, eased in once the cup is up
const armQ = new THREE.Quaternion();
/** Where your palm goes to hold your cup in a pose: just over its closed end. */
const cupTop = (kind, out) => { DT.cupPose(0, kind, out, _q); return out.setY(out.y + DT.CUP_TOP + 0.016); };
const cupHands = new Set(); // views whose right hand rides their cup
const viewSeat = (T, v) => T.seatAt(v);

/* ---------- framing the count ---------- */
// a tall phone view shows the counted dice in short rows, so they can be zoomed in on
const rowLength = () => (camera.aspect < 0.8 ? 5 : 10);
let framing = false; // the head held on the count line
/**
 * Leans in and holds the head on the line of `n` counted dice, zoomed until the line spans most
 * of the view. The camera's springs carry the move, and unframeCount() eases back out.
 */
function frameCount(n) {
  const { halfWidth, halfDepth } = DT.rowFrame(n, rowLength(), _row);
  const d = rig.seat.distanceTo(_row) - 0.1, t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const down = rig.seat.y / d, pad = DT.DIE * DT.ROW_SCALE;
  const zoom = Math.min(0.78 * d * t * camera.aspect / (halfWidth + pad), 0.5 * d * t / (halfDepth * down + pad));
  framing = true;
  rig.zoomTarget = 1; rig.leanTarget = 0.4; centerLook(0.5);
  lockLook(true, _row, 1, clamp(zoom, 1.3, 3.2));
}
function unframeCount() {
  if (!framing) return;
  framing = false;
  rig.leanTarget = 0;
  lockLook(false);
}

/* ---------- HUD ---------- */
function bidChip(T) {
  const g = T.game, b = lastBid(g);
  const who = b ? `${T.isMe(b.seat) ? 'Your' : `${T.name(b.seat)}’s`} bid` : 'Open the bidding';
  ui.setTopChip({
    icon: dieURL(b ? b.face : 1), alt: b ? `${FACE[b.face]} face` : 'a die',
    eyebrow: `Round ${g.round}<span class="sub"> · ${who}</span>`,
    name: b ? bidText(b.quantity, b.face).toUpperCase() : 'NO BID YET',
  });
  $('#table-icon').classList.add('die');
  ui.setClaim(b ? `<b>${T.name(b.seat)}</b> ${verb(T, b.seat, 'bid', 'bids')} ${bidText(b.quantity, b.face)} · ${totalDice(g)} dice in play` : `${totalDice(g)} dice in play · ones are wild`, b ? 'Last bid' : 'New round');
  myDice(T);
}
function myDice(T) {
  const el = $('#me-dice'), g = T.game, b = lastBid(g), on = g.round > 0 && g.alive[T.me] && g.dice.length;
  el.hidden = !on;
  if (!on) return;
  const face = pendingTurn ? choice.face : b?.face;
  const html = g.dice.slice().sort((x, y) => x - y).map((d) => dieSVG(d, face && matches(d, face) ? 'hit' : '')).join('');
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
}

/* ---------- the deal ---------- */
async function round(T, msg) {
  const g = T.game, token = T.token();
  T.setActor(null); T.setWatch(null); peeking = false;
  focusOn(null); rig.zoomTarget = 1;
  bidChip(T);
  // dice come home, cups come down over them
  for (let v = 0; v < 4; v++) {
    const s = viewSeat(T, v), n = msg.diceCounts[s];
    if (!n) { DT.setDice(v, 0, null); DT.cupTo(v, 'off', { dur: 0.5, arc: 0.06 }); continue; }
    DT.setDice(v, n, null, { fly: true, dur: 0.45 });
    DT.cupTo(v, 'rest', { dur: 0.5, arc: 0.08, delay: 0.25 });
  }
  const mine = msg.diceCounts[T.me] > 0;
  await T.step(350);
  // your hand comes in over your cup as it lands
  if (mine) { rig.leanTarget = 0.35; armReach(cupTop('rest', _b)); }
  await T.step(450);
  const shakers = [];
  for (let v = 0; v < 4; v++) if (msg.diceCounts[viewSeat(T, v)]) shakers.push(v);
  if (mine) {
    await T.landed(arm.mover);
    DT.cupToHand(0, arm.grip);
    armQ.copy(arm.root.quaternion);
    arm.mover.go(arm.root.parent, cupTop('air', _b), armQ, 1, { dur: 0.32 });
    rig.leanTarget = 0;
  }
  // pick up and shake
  for (const v of shakers) {
    if (!v) continue;
    cupHands.add(v); react(T.char(viewSeat(T, v)), 'reach');
    DT.cupTo(v, 'air', { dur: 0.32, delay: v * 0.05 });
  }
  await T.step(330);
  for (const v of shakers) { DT.setDice(v, 0, null); if (v) DT.setShake(v, true); }
  if (mine) myShake = cupTop('air', new THREE.Vector3());
  audio.rattle?.(0, 1.05);
  for (const v of shakers) if (v) audio.rattle?.(T.pan(viewSeat(T, v)) * 0.8, 0.95, 0.6);
  await T.step(1050);
  // slam
  myShake = null;
  if (mine) arm.mover.go(arm.root.parent, cupTop('rest', _b), armQ, 1, { dur: 0.16, ease: (u) => u * u });
  for (const v of shakers) { DT.setShake(v, false); DT.cupTo(v, 'rest', { dur: 0.16, ease: (u) => u * u }); }
  await T.step(170);
  if (token !== T.token()) return;
  audio.slam?.(0);
  rig.shake = Math.max(rig.shake, 0.08);
  for (const v of shakers) {
    const s = viewSeat(T, v);
    DT.setDice(v, msg.diceCounts[s], T.isMe(s) ? g.dice : null);
  }
  T.refresh();
  await T.step(260);
  for (const v of shakers) if (v) { cupHands.delete(v); react(T.char(viewSeat(T, v)), 'reach', false); }
  if (mine) armHide();
  ui.toast(`Round ${msg.round}`, 'gold');
  ui.log(`Round ${msg.round}: <b>${totalDice(g)}</b> dice on the table.`);
  // everyone peeks under their own cup
  if (g.alive[T.me]) { peeking = true; DT.cupTo(0, 'peek', { dur: 0.5 }); audio.cupLift?.(0); }
  shakers.filter((v) => v).forEach((v, k) => setTimeout(() => {
    if (token !== T.token()) return;
    DT.cupTo(v, 'glance', { dur: 0.35 });
    setTimeout(() => { if (token === T.token()) DT.cupTo(v, 'rest', { dur: 0.3 }); }, 750);
  }, 200 + k * 260));
  myDice(T);
  await T.step(1100);
  if (msg.round === 1 && g.alive[T.me]) ui.coach('dice', 'Bid how many dice on the whole table show a face. <b>Ones are wild.</b> Raise the bid, or call <b>Liar</b>.');
}

/* ---------- turns ---------- */
function turn(T, msg) {
  T.setActor(msg.seat);
  if (!T.isMe(msg.seat)) {
    T.focusSeat(msg.seat, 0.45);
    ui.setStatus(T.view(msg.seat), '<span class="dots">thinking</span>');
    return;
  }
  focusOn(null);
  if (!msg.options) return;
  pendingTurn = msg.options;
  if (settings.autoplay) return;
  if (!peeking && T.game.alive[T.me]) setPeek(true);
  defaultChoice(T);
  syncControls(T);
  if (msg.options.mustChallenge) ui.toast('No bid can top that. Call it.', 'small');
  else if (msg.options.canChallenge) ui.coach('liar-dice', 'Think there aren’t that many on the table? Call <b>Liar</b>. Whoever is wrong drinks from their tray.');
}

const raiseFor = (face) => pendingTurn?.raises.find((r) => r.face === face) || null;
function defaultChoice(T) {
  const o = pendingTurn; if (!o?.raises.length) return;
  let best = null;
  for (const r of o.raises) {
    const have = myCount(T, r.face), q = Math.max(r.minQuantity, Math.min(have, o.maxQuantity));
    const score = have - (q - r.minQuantity) * 0.01 - (q > have ? (q - have) * 1.5 : 0) + r.face * 0.01;
    if (!best || score > best.score) best = { score, face: r.face, quantity: q };
  }
  choice.face = best.face; choice.quantity = best.quantity;
}
function setChoice(T, { face = choice.face, quantity = choice.quantity }) {
  const o = pendingTurn, r = raiseFor(face);
  if (!o || !r) return;
  const q = clamp(quantity, r.minQuantity, o.maxQuantity);
  if (face === choice.face && q === choice.quantity) return;
  choice.face = face; choice.quantity = q;
  audio.select(); syncControls(T);
}

function syncControls(T) {
  const o = pendingTurn; if (!o) return;
  const g = T.game, b = lastBid(g), canBid = o.canBid && !o.mustChallenge;
  $('#dice-actions').hidden = false;
  $('.bid-pick').hidden = !canBid;
  const r = raiseFor(choice.face);
  $('#qty-n').textContent = String(choice.quantity);
  $('#qty-down').disabled = !r || choice.quantity <= r.minQuantity;
  $('#qty-up').disabled = !r || choice.quantity >= o.maxQuantity;
  for (const btn of document.querySelectorAll('#face-pick button')) {
    const f = +btn.dataset.face;
    btn.disabled = !raiseFor(f);
    btn.setAttribute('aria-pressed', String(f === choice.face));
  }
  const bid = $('#bid-btn');
  bid.hidden = !canBid;
  bid.disabled = !r;
  bid.querySelector('.lbl').textContent = innerWidth < 720 ? `Bid ${choice.quantity} × ${choice.face}` : `Bid ${bidText(choice.quantity, choice.face)}`;
  bid.setAttribute('aria-label', `Bid ${bidText(choice.quantity, choice.face)}`);
  $('#dice-liar-btn').disabled = !o.canChallenge;
  $('#spot-btn').hidden = g.variant !== 'traditional';
  $('#spot-btn').disabled = !o.canSpotOn;
  const have = myCount(T, choice.face);
  if (!b) ui.setHint(`Your opening bid. You hold <b>${have}</b> that count as ${FACES[choice.face]}. ${spaceHint()}`);
  else if (o.mustChallenge) ui.setHint(`<b>${T.name(b.seat)}</b> bid ${bidText(b.quantity, b.face)}. Nothing tops it: call it.`);
  else {
    // what you hold of the bid's face decides a call; the picker's face, if another, is your raise
    const count = (f) => `<b>${myCount(T, f)}</b> ${f === 1 ? FACES[1] : `that count as ${FACES[f]}`}`;
    const pick = choice.face === b.face ? '' : ` Your pick: ${count(choice.face)}.`;
    ui.setHint(`<b>${T.name(b.seat)}</b> bid ${bidText(b.quantity, b.face)}. You hold ${count(b.face)}. Raise, or call.${pick} ${spaceHint()}`);
  }
  myDice(T);
}
function hideControls() { $('#dice-actions').hidden = true; }

function clearPrompt(T) {
  pendingTurn = null;
  hideControls();
  ui.dismissCoach();
  for (let v = 1; v < 4; v++) ui.setStatus(v, '');
  if (T?.game?.round) myDice(T);
}

function submitBid(T) {
  const o = pendingTurn; if (!o?.canBid || !raiseFor(choice.face)) return;
  if (T.send({ type: 'bid', quantity: choice.quantity, face: choice.face })) { hideControls(); ui.setHint(''); }
}
function submitCall(T, type) {
  const o = pendingTurn; if (!o) return;
  if (type === 'challenge' ? !o.canChallenge : !o.canSpotOn) return;
  if (T.send({ type })) { hideControls(); ui.setHint(''); }
}

/** P or a click on your cup: covers the dice you are looking at, else tips the cup or sets it down. */
const togglePeek = () => (handUp() ? setHandUp(false) : setPeek(!peeking));
function setPeek(on) {
  if (peeking === on) return;
  peeking = on;
  DT.cupTo(0, on ? 'peek' : 'rest', { dur: on ? 0.45 : 0.3 });
  if (on) audio.cupLift?.(0); else audio.cupDown?.(0);
}

async function bid(T, msg) {
  const { seat, quantity, face } = msg, me = T.isMe(seat);
  T.setActor(seat);
  if (!me) {
    ui.setStatus(T.view(seat), '');
    say(T, seat, `${cap(bidText(quantity, face))}. ${voice(T, seat, 'bid')}`.trim());
    if (Math.random() < (NERVES[T.design(seat)] ?? 0.15)) setTimeout(() => tell(T.char(seat)), 380);
    react(T.char(seat), 'lean'); setTimeout(() => react(T.char(seat), 'lean', false), 500);
  }
  audio.bidKnock?.(T.pan(seat));
  ui.log(`<b>${T.name(seat)}</b> ${verb(T, seat, 'bid', 'bids')} ${bidText(quantity, face)}.`);
  bidChip(T);
  T.refresh();
  await T.step(900);
}

/* ---------- the call ---------- */
async function challenge(T, msg) {
  const { caller, bidder, call, forced, quantity, face, cups, count, callerRight } = msg, g = T.game, token = T.token();
  const spot = call === 'spotOn';
  T.refresh();
  if (T.isMe(caller) && callerRight) T.recap.caught++;
  if (T.isMe(bidder) && !spot && !callerRight) T.recap.held++;
  T.setActor(caller);
  if (!T.isMe(caller)) { react(T.char(caller), 'lean'); say(T, caller, forced ? 'Nothing tops that. Lift them.' : voice(T, caller, spot ? 'spotOn' : 'liar')); }
  ui.toast(T.isMe(caller) ? (spot ? 'SPOT ON!' : 'LIAR!') : `${T.name(caller)}: ${spot ? 'SPOT ON!' : 'LIAR!'}`, 'liar');
  audio.sting(); audio.setTension(0.5); rig.shake = Math.max(rig.shake, 0.22);
  const onSpot = T.isMe(bidder) ? caller : bidder;
  T.focusSeat(onSpot, 0.6);
  rig.zoomTarget = 1.08;
  ui.log(spot
    ? `<b>${T.name(caller)}</b> ${verb(T, caller, 'say', 'says')} ${bidText(quantity, face)} is spot on.`
    : `<b>${T.name(caller)}</b> ${verb(T, caller, 'call', 'calls')} <b>${T.isMe(bidder) ? 'you' : T.name(bidder)}</b> a liar.`);
  await T.step(950);

  // every cup comes up
  peeking = false;
  for (let v = 0; v < 4; v++) {
    const s = viewSeat(T, v), n = g.diceCounts[s];
    if (!n) continue;
    if (!T.isMe(s)) DT.setDice(v, n, cups[s]);
    DT.cupTo(v, 'off', { dur: 0.55, arc: 0.1, delay: v * 0.09 });
  }
  audio.reveal(); audio.cupLift?.(0);
  T.setWatch(ROW_AT);
  focusOn(ROW_AT, 0.7); rig.zoomTarget = 1.14;
  await T.step(800);

  // the count: every match flies into a line in front of you, lit as it lands
  const hits = [];
  for (let v = 0; v < 4; v++) {
    const s = viewSeat(T, v);
    for (let i = 0; i < g.diceCounts[s]; i++) {
      const d = DT.dieFace(v, i);
      if (matches(d, face)) hits.push([v, i, d]); else DT.dieGlow(v, i, 0, DIM);
    }
  }
  const gap = Math.min(0.2, 1.9 / Math.max(1, hits.length)), per = rowLength();
  if (hits.length) frameCount(hits.length);
  ui.setClaim(`Counting ${FACES[face]}, ones wild: <b>0</b> of ${quantity}`, 'The count');
  hits.forEach(([v, i, d], k) => {
    DT.rowPose(k, hits.length, d, _a, _q, per);
    DT.dieTo(v, i, _a, _q, { dur: 0.5, arc: 0.12, delay: k * gap }, DT.ROW_SCALE);
    setTimeout(() => {
      if (token !== T.token()) return;
      DT.dieGlow(v, i, 0.6, LIT);
      audio.diceTick?.(k, Math.min(quantity, 20));
      ui.setClaim(`Counting ${FACES[face]}, ones wild: <b>${k + 1}</b> of ${quantity}`, 'The count');
    }, (k * gap + 0.45) * 1000 / Math.sqrt(settings.speed || 1));
  });
  await T.step(hits.length * gap * 1000 + 700);

  const bidderName = T.isMe(bidder) ? 'You' : T.name(bidder), callerName = T.isMe(caller) ? 'You' : T.name(caller);
  const counted = `${cap(word(count))} ${count === 1 ? FACE[face] : FACES[face]}`;
  ui.setClaim(`${counted} against a bid of ${quantity}`, 'The count');
  if (spot) {
    ui.toast(callerRight ? `${counted}. Spot on!` : `${counted}, not ${quantity}.`, callerRight ? 'truth' : 'small');
    ui.log(callerRight ? `Exactly ${count}. Everyone but <b>${callerName}</b> drinks.` : `${counted}. <b>${callerName}</b> ${verb(T, caller, 'were', 'was')} off.`);
    if (!T.isMe(caller)) setTimeout(() => say(T, caller, voice(T, caller, callerRight ? 'honest' : 'wrong')), 700);
  } else {
    const stands = !callerRight;
    ui.toast(stands ? `${counted}. The bid stands.` : `Only ${word(count)}. ${T.isMe(bidder) ? 'Caught bluffing.' : `${T.name(bidder)} was bluffing.`}`, stands ? 'truth' : 'small');
    ui.log(stands ? `${counted}. <b>${callerName}</b> ${verb(T, caller, 'were', 'was')} wrong.` : `Only ${word(count)}. <b>${bidderName}</b> ${verb(T, bidder, 'were', 'was')} bluffing.`);
    if (!T.isMe(bidder)) say(T, bidder, voice(T, bidder, stands ? 'honest' : 'caught'));
    if (!T.isMe(caller) && stands) setTimeout(() => say(T, caller, voice(T, caller, 'wrong')), 900);
  }
  audio.verdict(spot ? !callerRight : callerRight);
  await T.step(1500);
  if (!T.isMe(caller)) react(T.char(caller), 'lean', false);
  T.setWatch(null); rig.zoomTarget = 1; unframeCount();
}

/* ---------- the poison tray ---------- */
const nextGlass = (T, seat) => Math.min(GLASSES - 1, T.game.drinks[seat]);

async function roulette(T, msg) {
  const { seat } = msg, token = T.token();
  T.setActor(seat);
  await pickUpGlass(T, seat);
  if (!T.isMe(seat)) return;
  if (settings.autoplay) return;
  const left = GLASSES - T.game.drinks[seat];
  ui.awaitTrigger(left === 1 ? 'The last glass. It is the poisoned one.' : `One glass in ${left} is poisoned. Hold to drink.`, 750, 'Hold to drink').then((ok) => {
    if (!ok || token !== T.token() || T.prompt?.seat !== T.me) return;
    T.send({ type: 'pull' });
  });
}

/** The loser reaches into their tray and lifts glass `i`. Idempotent per glass. */
async function pickUpGlass(T, seat, i = nextGlass(T, seat)) {
  const v = T.view(seat);
  if (held && held.v === v && held.i === i) return;
  const human = T.isMe(seat), ch = T.char(seat);
  audio.setTension(1); ui.setTense(true);
  ui.toast(`${human ? 'You' : T.name(seat)} ${verb(T, seat, 'reach', 'reaches')} for a glass`, 'small');
  held = { v, i };
  DT.glassWorld(v, i, _b);
  if (human) {
    focusOn(null); centerLook(0.5); rig.zoomTarget = 1.04; setPeek(false);
    rig.leanTarget = 0.5;
    // the open hand comes round the glass where it stands and closes on it
    arm.grasp = 'glass';
    armReach(glassGrip(arm.glassAt, _b, shoulderWorld(_c), _a, _q, arm.hand.userData.fore), _q);
    await T.landed(arm.mover);
    DT.takeGlass(v, i, arm.grip, arm.glassAt.pos, arm.glassAt.quat, 0.12);
    audio.glassPick?.(0);
    rig.leanTarget = 0;
    // kept inside a narrow (portrait) view, like the raised revolver
    const halfW = -HOLD.pos.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect / camera.zoom;
    arm.mover.go(camera, _a.copy(HOLD.pos).setX(Math.min(HOLD.pos.x, halfW * 0.4)), HOLD.quat, 1, { dur: 0.65 });
    await T.landed(arm.mover);
  } else {
    T.setWatch(null); T.focusSeat(seat, 0.8); rig.zoomTarget = 1.25;
    ch.grasp = 'glass';
    glassGrip(ch.glassAt, _b, ch.arm.upper.getWorldPosition(_c), ch.reachTarget, ch.reachQuat, ch.arm.handMesh.userData.fore); react(ch, 'reach');
    await reached(T, ch);
    DT.takeGlass(v, i, ch.grip, ch.glassAt.pos, ch.glassAt.quat, 0.12);
    audio.glassPick?.(T.pan(seat));
    const s = sipFor(ch, v); s.wT = 1; s.tiltT = 0;
    react(ch, 'reach', false); react(ch, 'tremble');
    setTimeout(() => say(T, seat, voice(T, seat, 'hold')), 300);
    await T.step(700);
  }
  startHeartbeat(T);
}

let beating = false;
function startHeartbeat(T) {
  if (beating) return;
  beating = true;
  const token = T.token();
  let rate = 1;
  const beat = () => { if (!beating || token !== T.token()) return; audio.heartbeat(rate); rate = Math.min(2.2, rate + 0.15); setTimeout(beat, 900 / rate); };
  beat();
}

async function drink(T, msg) {
  const { seat, poisoned } = msg, human = T.isMe(seat), v = T.view(seat), ch = T.char(seat);
  const i = Math.max(0, msg.drinks - 1);
  if (!held || held.v !== v) await pickUpGlass(T, seat, i);
  T.setActor(seat);
  beating = false;
  // to the lips, head back
  if (human) {
    arm.mover.go(camera, LIPS.pos, LIPS.quat, 1, { dur: 0.55 });
    focusOn(LOOK_UP, 0.42);
  } else {
    const s = sipFor(ch, v); s.tiltT = 1;
    rig.zoomTarget = 1.3;
  }
  audio.gulp?.(T.pan(seat));
  await T.step(1000);
  DT.table.heldLiquid.visible = false;
  if (poisoned) DT.table.heldLiquid.material.color.setHex(0x3f8a1c);
  T.refresh();
  if (!poisoned) {
    if (human) {
      T.recap.survived++;
      focusOn(null);
      setTimeout(() => audio.relief(), 250);
      ui.toast('Just liquor.', 'gold');
    } else {
      sipFor(ch, v).tiltT = 0;
      react(ch, 'tremble', false); react(ch, 'relief');
      setTimeout(() => say(T, seat, voice(T, seat, 'sip')), 400);
      ui.toast(`${T.name(seat)} survives`, 'gold');
    }
    ui.log(`<b>${human ? 'You' : T.name(seat)}</b> ${verb(T, seat, 'drain', 'drains')} a glass. Not the poisoned one.`);
    await T.step(700);
    await putBackGlass(T, seat, i);
    if (!human) react(ch, 'relief', false);
    settle(T);
    await T.step(350);
    return;
  }
  // the poisoned glass
  audio.poison?.(T.pan(seat));
  rig.shake = Math.max(rig.shake, human ? 0.6 : 0.3);
  ui.log(`<b>${human ? 'You' : T.name(seat)}</b> ${verb(T, seat, 'drink', 'drinks')} the poisoned glass.`);
  if (human) {
    ui.toast('POISON', 'liar');
    rig.rollTarget = 0.32; focusOn(null);
    await T.step(500);
    ui.setBlackout(true);
    audio.setTension(0);
    await T.step(400);
    DT.dropHeld(v, i, 'gone'); held = null;
    armHide(); arm.grasp = 'gun'; rig.rollTarget = 0;
    DT.setDice(0, 0, null);
    myDice(T);
    await T.step(1300);
    if (T.game.alive.filter(Boolean).length > 1) T.eliminated();
    return settle(T);
  }
  react(ch, 'flinch');
  ui.toast(`${T.name(seat)} is poisoned`, 'liar');
  await T.step(450);
  const s = sipFor(ch, v); s.tiltT = 0; s.wT = 0;
  react(ch, 'tremble', false); react(ch, 'out');
  DT.spillHeld(v);
  DT.setDice(v, 0, null);
  const witnesses = T.game.alive.map((a, x) => (a && !T.isMe(x) && x !== seat ? x : null)).filter((x) => x != null);
  if (witnesses.length) { const w = pick(witnesses); setTimeout(() => say(T, w, voice(T, w, 'others')), 1500); }
  audio.glassDown?.(T.pan(seat), 0.5);
  rig.zoomTarget = 1.12; T.focusSeat(seat, 0.45);
  await T.landed(DT.table.heldMover); DT.dropHeld(v, i, 'spilled'); ch.grasp = 'gun';
  await T.step(1600);
  held = null;
  settle(T);
  await T.step(400);
}

/** Waits for a character's hand to arrive where it reached (a hand that never gets there stops waiting). */
async function reached(T, ch) { for (let t = 0; t < 1200 && ch.env.reach < 0.95; t += 30) await T.step(30); }

/** The hand carries the empty glass back over its slot and turns it down into it. */
async function putBackGlass(T, seat, i) {
  const v = T.view(seat), ch = T.char(seat), human = T.isMe(seat);
  DT.glassWorld(v, i, _b).y += 0.03;
  if (human) {
    armReach(glassGrip(arm.glassAt, _b, shoulderWorld(_c), _a, _q, arm.hand.userData.fore), _q);
    await T.landed(arm.mover);
  } else {
    sipFor(ch, v).wT = 0;
    glassGrip(ch.glassAt, _b, ch.arm.upper.getWorldPosition(_c), ch.reachTarget, ch.reachQuat, ch.arm.handMesh.userData.fore); react(ch, 'reach');
    await reached(T, ch);
  }
  DT.returnGlass(v, i, 0.3);
  await T.landed(DT.table.heldMover);
  audio.glassDown?.(T.pan(seat));
  DT.dropHeld(v, i, 'empty'); held = null;
  if (human) { armHide(); arm.grasp = 'gun'; } else { react(ch, 'reach', false); ch.grasp = 'gun'; }
}

function settle(T) {
  beating = false;
  audio.setTension(0); ui.setTense(false);
  rig.zoomTarget = 1; rig.rollTarget = 0; rig.leanTarget = 0; focusOn(null);
  T.setActor(null);
}

/* ---------- rebuild ---------- */
function rebuild(T, { fresh }) {
  const g = T.game;
  setHandUp(false); unframeCount(); glancing.fill(false);
  beating = false; pendingTurn = null; held = null; peeking = false; myShake = null;
  hideControls();
  cupHands.clear();
  for (const s of sips.values()) { s.w = s.wT = s.tilt = s.tiltT = s.wv = s.tv = 0; }
  DT.dropHeld(null);
  armHide(); arm.grasp = 'gun';
  for (let v = 1; v < 4; v++) T.viewChars[v].grasp = 'gun';
  audio.setTension(0); ui.setTense(false);
  rig.leanTarget = 0; rig.zoomTarget = 1; rig.rollTarget = 0; focusOn(null);
  for (let s = 0; s < 4; s++) if (!T.isMe(s)) react(T.char(s), 'out', !g.alive[s] && !T.absent(s));
  const revealed = g.reveal && g.bids.length;
  for (let v = 0; v < 4; v++) {
    const s = viewSeat(T, v), n = T.absent(s) ? 0 : fresh ? 5 : g.diceCounts[s];
    DT.setSeatEmpty(v, T.absent(s));
    DT.setGlasses(v, g.drinks[s]);
    DT.setShake(v, false);
    const faces = T.isMe(s) ? g.dice : revealed ? g.reveal.cups[s] : null;
    DT.setDice(v, g.round || fresh ? n : 0, faces);
    DT.cupSnap(v, !n ? 'off' : revealed ? 'off' : T.isMe(s) && g.round ? 'peek' : 'rest');
    if (T.isMe(s) && g.round && n && !revealed) peeking = true;
  }
  if (revealed) {
    const { face } = g.reveal;
    let k = 0;
    const hits = [];
    for (let v = 0; v < 4; v++) for (let i = 0; i < g.diceCounts[viewSeat(T, v)]; i++) if (matches(DT.dieFace(v, i), face)) hits.push([v, i]); else DT.dieGlow(v, i, 0, DIM);
    for (const [v, i] of hits) { DT.rowPose(k++, hits.length, DT.dieFace(v, i), _a, _q, rowLength()); DT.dieTo(v, i, _a, _q, { dur: 0.01 }, DT.ROW_SCALE); DT.dieGlow(v, i, 0.6, LIT); }
  }
  if (g.round) bidChip(T);
  else { ui.setClaim(''); $('#me-dice').hidden = true; }
}

/* ---------- looking at your dice ---------- */
const _look = new THREE.Vector3();
const glancing = [false, false, false, false];
/**
 * Another person looking at their dice (their `look` hand is up, which main.js hands each character
 * as target.inspect) tips their cup toward them. Only a cup resting over its dice is moved; the round's
 * own flights (shake, reveal, the glass) own it otherwise.
 */
function glanceRemotes(T) {
  const g = T.game;
  for (let v = 1; v < 4; v++) {
    const s = viewSeat(T, v), free = !!g?.round && !g.reveal && g.diceCounts[s] > 0 && !cupHands.has(v) && held?.v !== v;
    const want = free && T.viewChars[v].target.inspect === 1;
    if (want === glancing[v]) continue;
    if (free) DT.cupTo(v, want ? 'glance' : 'rest', { dur: want ? 0.45 : 0.3 });
    glancing[v] = want;
  }
}

/* ---------- the mode ---------- */
function bindControls() {
  const faces = $('#face-pick');
  faces.innerHTML = BID_FACES.map((f) => `<button type="button" data-face="${f}" aria-label="${FACES[f]}" aria-pressed="false">${dieSVG(f)}</button>`).join('');
  faces.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && !b.disabled) setChoice(bound, { face: +b.dataset.face }); });
  $('#qty-down').addEventListener('click', () => setChoice(bound, { quantity: choice.quantity - 1 }));
  $('#qty-up').addEventListener('click', () => setChoice(bound, { quantity: choice.quantity + 1 }));
  $('#bid-btn').addEventListener('click', () => submitBid(bound));
  $('#dice-liar-btn').addEventListener('click', () => submitCall(bound, 'challenge'));
  $('#spot-btn').addEventListener('click', () => submitCall(bound, 'spotOn'));
  addEventListener('resize', () => { if (pendingTurn && bound) syncControls(bound); });
}

export const diceMode = {
  mode: 'dice',
  ready: true,
  reduce: reduceDice,
  newRecap: () => ({ caught: 0, held: 0, survived: 0 }),
  enter(T) {
    held = null; peeking = false;
    glassGrip(arm.glassAt, HOLD_GLASS, HOLD_FROM, HOLD.pos, HOLD.quat);
    LIPS.quat.setFromAxisAngle(AX, 1.05).multiply(HOLD.quat);
    _y.copy(Y).applyAxisAngle(AX, 1.05);
    LIPS.pos.copy(LIPS_RIM).addScaledVector(_y, -GLASS_H).sub(_a.copy(arm.glassAt.pos).applyQuaternion(LIPS.quat));
    if (!bound) { bound = T; bindControls(); }
    document.body.classList.add('mode-dice');
    gun.obj.visible = false;
    gatherToDeck({ dur: 0.01 }); setDeckSize(0);
    const angles = [Math.atan2(rig.seat.z, rig.seat.x), ...[1, 2, 3].map((v) => { const p = T.viewChars[v].group.position; return Math.atan2(p.z, p.x); })];
    DT.layoutSeats(angles);
    DT.showDiceTable(true);
    bindHand({
      holding: () => diceMode.pointerEnabled() && T.game.diceCounts[T.me] > 0,
      blocked: () => held?.v === 0,
      // a call lifts every cup itself; don't set yours down a beat before it goes
      onUp: (up) => { if (up || !T.game.reveal) setPeek(up); },
      lockAt: () => [DT.cupWorld(0, _look), 0.8, 1.55],
      labels: ['Look at your dice', 'Cover your dice'],
    });
  },
  exit() {
    releaseHand(); unframeCount(); glancing.fill(false);
    beating = false; pendingTurn = null; held = null; peeking = false; myShake = null;
    hideControls(); cupHands.clear(); sips.clear();
    $('#me-dice').hidden = true; $('#table-icon').classList.remove('die');
    document.body.classList.remove('mode-dice');
    DT.dropHeld(null); DT.showDiceTable(false);
    armHide(); arm.grasp = 'gun';
    if (bound) for (let v = 1; v < 4; v++) bound.viewChars[v].grasp = 'gun';
    gun.obj.visible = true;
    setDeckSize(MAX_CARDS); gatherToDeck();
  },
  rebuild,
  on: { round, bid, challenge, drink, turn, roulette },
  clearPrompt,
  reprompt(T, msg) { if (T.isMe(msg.seat) && msg.type === 'turn' && msg.options) { pendingTurn = msg.options; if (!settings.autoplay) syncControls(T); } },
  refused(T, msg) {
    if (!pendingTurn || !T.isMe(T.prompt?.seat)) return;
    ui.toast(msg.message, 'small');
    syncControls(T);
  },
  isOut: (T, seat) => !T.game.alive[seat],
  seatHud(T) {
    const g = T.game;
    return [0, 1, 2, 3].map((v) => {
      const s = T.seatAt(v), n = g.diceCounts[s], left = GLASSES - g.drinks[s];
      return {
        alive: g.alive[s], cards: n, pulls: g.drinks[s], penalty: 'Poison',
        cnt: n ? '<i class="d"></i>'.repeat(n) : 'No dice',
        odds: left === 1 ? 'Next glass: <b>poisoned</b>' : `Next glass: <b>1 in ${left}</b>`,
      };
    });
  },
  auto(T, msg) {
    if (msg.type === 'roulette') return { type: 'pull' };
    const o = msg.options;
    if (!o) return null;
    const b = lastBid(T.game);
    if (b) {
      const unseen = totalDice(T.game) - T.game.dice.length, expect = myCount(T, b.face) + unseen / 3;
      if (o.canSpotOn && Math.abs(expect - b.quantity) < 0.5 && Math.random() < 0.25) return { type: 'spotOn' };
      if (o.mustChallenge || (o.canChallenge && (b.quantity > expect + 1 || Math.random() < 0.12))) return { type: o.canChallenge ? 'challenge' : 'spotOn' };
    }
    const r = o.raises.reduce((best, x) => (myCount(T, x.face) - x.minQuantity > myCount(T, best.face) - best.minQuantity ? x : best), o.raises[0]);
    return { type: 'bid', quantity: r.minQuantity, face: r.face };
  },
  summary(T, msg, stats) {
    const survivors = msg.seats.map((x, s) => (x.alive && !T.isMe(s) ? T.name(s) : null)).filter(Boolean);
    const r = T.recap;
    return {
      rounds: T.game.round, survivors,
      recap: [[r.caught, 'Calls you won'], [r.held, 'Bids that held'], stats ? [stats.streak, 'Win streak'] : [r.survived, 'Glasses survived']],
    };
  },
  /* input */
  pointerEnabled: () => !!bound?.game?.round && !!bound.game.alive[bound.me] && !held && !bound.game.reveal,
  pick: (raycaster) => (DT.rayHitsMyCup(raycaster) ? 'cup' : null),
  hover() {},
  select() { togglePeek(); },
  handUp,
  keydown(T, e) {
    if (handKey(e)) return true;
    if (!pendingTurn) {
      if ((e.key === 'p' || e.key === 'P') && diceMode.pointerEnabled()) { togglePeek(); return true; }
      return false;
    }
    const k = e.key;
    if (k >= '2' && k <= '6') { setChoice(T, { face: +k }); return true; }
    if (k === 'ArrowUp' || k === 'ArrowRight' || k === '+' || k === '=') { e.preventDefault(); setChoice(T, { quantity: choice.quantity + 1 }); return true; }
    if (k === 'ArrowDown' || k === 'ArrowLeft' || k === '-') { e.preventDefault(); setChoice(T, { quantity: choice.quantity - 1 }); return true; }
    if (k === 'Enter') { e.preventDefault(); submitBid(T); return true; }
    if (k === 'l' || k === 'L') { submitCall(T, 'challenge'); return true; }
    if (k === 's' || k === 'S') { submitCall(T, 'spotOn'); return true; }
    if (k === 'p' || k === 'P') { togglePeek(); return true; }
    return false;
  },
  frame(T, reservePx, dt = 1 / 60) {
    clock += dt;
    // the offset moves the arm's spring target, never a flight's: a target that jumps near a
    // flight's end drags the hand with it in one frame
    shakeIn.k = myShake && !arm.mover.flying ? smoothDamp(shakeIn.k, 1, shakeIn.v, 'k', 0.08, dt) : 0;
    if (!shakeIn.k) shakeIn.v.k = 0;
    if (myShake && shakeIn.k) {
      const p = clock * 26, k = shakeIn.k;
      arm.mover.pos.copy(myShake).add(_a.set(Math.sin(p * 0.5) * 0.02 * k, Math.abs(Math.sin(p * 0.5)) * 0.05 * k, Math.cos(p * 0.25) * 0.012 * k));
    }
    for (const v of cupHands) {
      const ch = T.viewChars[v];
      DT.cupWorld(v, ch.reachTarget); ch.reachTarget.y += 0.118;
    }
    for (const [v, s] of sips) if (!poseSip(s, dt)) sips.delete(v);
    stepHand(dt);
    glanceRemotes(T);
  },
};
