// The Gilded Bid table: plays auction messages back as money cards pushed forward and pulled back,
// status cards turned onto the easel and carried off by whoever takes them, and a final count of
// purses and status. Handlers read the mirrored table (T.game) as it stands after `msg`.
import * as THREE from 'three';
import { $, pick, settings } from '../util.js';
import { audio } from '../audio.js';
import * as ui from '../ui.js';
import { camera } from '../render/core.js';
import { react, tell } from '../render/characters.js';
import { rig, focusOn } from '../render/camera.js';
import { gun } from '../render/gun.js';
import { setDeckSize, gatherToDeck } from '../render/cards.js';
import { table, MONEY, STATUS_BASE, showTable, setGilded, setGlow, setTint, setStatusFace, sendTo, flyTo, layoutHands, pickMoney, easelPoint, bidPoint } from '../render/auctionTable.js';
import { statusName, statusCell, cellThumb, CELL } from '../render/auctionArt.js';
import { reduceAuction, sum, highBid, bidOf, leader, gildedCount, isDisgrace, cheapestRaise } from './auction-state.js';

const NM = MONEY.length;
const LINES = {
  brass: {
    raise: ['Raising.', 'Adjusting the offer.', 'Acceptable expenditure.', '', ''],
    pass: ['Withdrawn.', 'Beyond tolerance.', ''],
    win: ['Acquired.', 'Inventory updated.'],
    stuck: ['An undesirable acquisition.', 'Recalculating standing.'],
    dodge: ['Avoided.', ''],
    out: ['Insufficient funds. Noted.'],
    winner: ['Optimal outcome.'],
  },
  noctua: {
    raise: ['Mm, mine.', 'Darling, keep up.', 'A little more.', '', ''],
    pass: ['Keep it, sweet.', 'Not my taste.', ''],
    win: ['How lovely.', 'It suits me.'],
    stuck: ['How vulgar.', 'Nobody saw that.'],
    dodge: ['Better you than me, darling.', ''],
    out: ['Poor? Me? How droll.'],
    winner: ['Was there ever any doubt?'],
  },
  gristle: {
    raise: ['More!', 'Hah, outbid ye!', 'Aye, I\'ll pay.', '', ''],
    pass: ['Bah. Take it.', 'Too rich for me.', ''],
    win: ['Mine, by thunder!', 'Into the sea chest.'],
    stuck: ['Blast and barnacles!', 'Arr, that stings.'],
    dodge: ['Hah! Dodged it.', ''],
    out: ['Skint. Story o\' me life.'],
    winner: ['Drinks are on me! Well. On ye.'],
  },
};
const voice = (T, seat, kind) => { const l = LINES[T.design(seat)]?.[kind]; return l ? pick(l) : ''; };
const say = (T, seat, text) => { if (text && !T.isMe(seat)) ui.say(T.view(seat), text); };
const verb = (T, seat, you, other) => (T.isMe(seat) ? you : other);
const Name = (T, seat) => (T.isMe(seat) ? 'You' : T.name(seat));
/** Exact status, halves shown as ½. */
export const fmtStatus = (x) => { const neg = x < 0, a = Math.abs(x), whole = Math.floor(a); return `${neg ? '−' : ''}${whole || a % 1 === 0 ? whole : ''}${a % 1 ? '½' : ''}`; };
const cardLabel = (c) => (c.kind === 'curio' ? `${statusName(c)} (${c.value})` : statusName(c));
const GLOW = { curio: 0xffc66a, favour: 0xffd27a, ale: 0xff5a3a, debt: 0xff5a3a, scandal: 0xff6a3a };

let me = null;
let pending = null; // your turn's options while the controls are up
let entered = false;
const _o = new THREE.Object3D(), LOOK_DOWN = new THREE.Vector3(0, -0.32, 0.25);

/* ---------- which body is which ---------- */
const moneyBody = (seat, v) => table.bodies[seat * NM + MONEY.indexOf(v)];
/** The body for the i-th turned card: curios and disgraces have their own; favours go in turn order. */
function statusBodyOf(game, i) {
  const c = game.turned[i];
  if (c.kind === 'curio') return table.bodies[STATUS_BASE + c.value - 1];
  if (c.kind === 'favour') return table.bodies[STATUS_BASE + 10 + game.turned.slice(0, i).filter((x) => x.kind === 'favour').length];
  return table.bodies[STATUS_BASE + { ale: 13, debt: 14, scandal: 15 }[c.kind]];
}
const lastTurned = (game) => statusBodyOf(game, game.turned.length - 1);

/**
 * Where every card belongs according to the mirror, and a flight for each one that isn't there.
 * Favours look alike, so a favour already in a seat's row stays put rather than trading places.
 */
function layoutAll(T, { snap = false, dur = 0.5, stagger = 0.02 } = {}) {
  const g = T.game;
  let d = 0;
  const go = (b, place, view = 0, k = 0, n = 1) => {
    if (!snap && b.place === place && b.view === view && b.slot === k && b.n === n) return;
    b.n = n;
    sendTo(b, place, { view, k, n, snap, dur, delay: (d += stagger) - stagger });
  };
  for (let s = 0; s < 4; s++) {
    const v = T.view(s), res = g.scoring?.remaining[s];
    for (const value of MONEY) {
      const b = moneyBody(s, value);
      if (res) { const k = res.indexOf(value); if (k >= 0) go(b, 'purse', v, k, res.length); else go(b, 'spent'); continue; }
      if (g.spent[s].includes(value)) go(b, 'spent');
      else if (g.bids[s].includes(value)) go(b, 'bid', v, g.bids[s].indexOf(value), g.bids[s].length);
      else go(b, 'hand', v);
    }
  }
  const turned = new Set();
  g.turned.forEach((c, i) => { const b = statusBodyOf(g, i); turned.add(b); if (b.card !== c) setStatusFace(b, c); });
  const onEasel = (g.card || g.final) ? lastTurned(g) : null;
  if (onEasel) go(onEasel, 'easel');
  const favours = [...turned].filter((b) => b.card.kind === 'favour' && b !== onEasel), used = new Set();
  const favFor = (s) => {
    const v = T.view(s);
    let b = favours.find((x) => !used.has(x) && x.place === 'won' && x.view === v) || favours.find((x) => !used.has(x));
    used.add(b);
    return b;
  };
  for (let s = 0; s < 4; s++) {
    const v = T.view(s), won = g.won[s];
    won.forEach((c, k) => {
      const b = c.kind === 'favour' ? favFor(s) : c.kind === 'curio' ? table.bodies[STATUS_BASE + c.value - 1] : table.bodies[STATUS_BASE + { ale: 13, debt: 14, scandal: 15 }[c.kind]];
      if (b) go(b, 'won', v, k, won.length);
    });
    for (const value of g.spilled[s]) go(table.bodies[STATUS_BASE + value - 1], 'spilled');
  }
  let slot = 0;
  for (let i = STATUS_BASE; i < table.bodies.length; i++) {
    const b = table.bodies[i];
    if (turned.has(b)) continue;
    if (b.card) setStatusFace(b, null);
    go(b, 'deck', 0, slot++, 0);
  }
}

/* ---------- HUD ---------- */
function wonSummary(g, s) {
  const w = g.won[s];
  if (!w.length && !g.aleOwed[s]) return '<span class="w none">nothing won</span>';
  const c = sum(w.filter((x) => x.kind === 'curio').map((x) => x.value)), f = w.filter((x) => x.kind === 'favour').length;
  let h = `<span class="w" title="curios">✦${c}</span>`;
  if (f) h += `<span class="w" title="favours">×${2 ** f}</span>`;
  if (w.some((x) => x.kind === 'debt')) h += '<span class="w bad" title="Bad Debt">−5</span>';
  if (w.some((x) => x.kind === 'scandal')) h += '<span class="w bad" title="Public Scandal">½</span>';
  if (g.aleOwed[s]) h += '<span class="w bad" title="Spilled Ale: your next curio is discarded">ale</span>';
  return `<span class="won">${h}</span>`;
}
/** What each seat's tag (and your own card) says: its bid or purse, and what it has won. */
function seatLine(T, s) {
  const g = T.game, sc = g.scoring, bid = g.card && g.bids[s].length ? `<span class="bid">bid ${bidOf(g, s)}</span>` : '';
  if (T.isMe(s)) {
    const purse = sc ? sc.money[s] : sum(g.hand);
    return `<span class="auc me"><span>Purse <b>${purse}</b>${sc?.castOut[s] ? ' · <span class="passed">cast out</span>' : bid ? ` · ${bid}` : ''}</span>${wonSummary(g, s)}</span>`;
  }
  const state = sc ? `purse <b>${sc.money[s]}</b>` : g.card && g.passed[s] ? '<span class="passed">passed</span>' : bid;
  return `<span class="auc">${state}${wonSummary(g, s)}</span>`;
}
/** The seat tags and the high-bid line. */
function hud(T) {
  if (!T.game) return;
  T.refresh();
  const g = T.game;
  if (!g.card) { ui.setClaim(''); return; }
  const hi = highBid(g), lead = leader(g);
  if (isDisgrace(g.card)) ui.setClaim(hi ? `<b>${hi}</b> · ${Name(T, lead)} · first to pass takes it` : 'First to pass takes it', 'Disgrace');
  else ui.setClaim(hi ? `<b>${hi}</b> · ${Name(T, lead)}` : 'No bids yet', 'High bid');
}
/** The top chip: the card up for auction (or the last turned) and the gilded count. */
function top(T) {
  const g = T.game, c = g.final || g.card || g.turned[g.turned.length - 1], n = gildedCount(g);
  if (!c) return ui.setTopChip({ icon: cellThumb(CELL.statusBack), alt: '', eyebrow: 'The Gilded Bid', name: 'OPENING' });
  ui.setTopChip({
    icon: cellThumb(statusCell(c)), alt: statusName(c),
    eyebrow: g.final ? `Gilded ${n} of 4<span class="sub"> · the end</span>` : `Auction ${g.auction}<span class="sub"> · Gilded ${n} of 4</span>`,
    name: (c.kind === 'curio' ? `${statusName(c)} · ${c.value}` : statusName(c)).toUpperCase(),
  });
}

/* ---------- your turn ---------- */
function syncControls(T) {
  const o = pending; if (!o) return;
  const g = T.game, picked = [...table.ui.selected], add = sum(picked), total = o.ownBid + add;
  const legal = picked.length > 0 && total > o.highBid;
  $('#auction-actions').hidden = false;
  const bid = $('#auction-bid-btn');
  bid.disabled = !legal;
  bid.querySelector('.lbl').textContent = legal ? `Bid ${total}` : !o.canRaise ? 'Can\'t raise' : picked.length ? `Beat ${o.highBid}` : 'Pick money';
  $('#auction-pass-btn').querySelector('.lbl').textContent = o.disgrace ? 'Pass · take it' : 'Pass';
  $('#auction-min-btn').disabled = !o.canRaise;
  const card = `<b>${statusName(g.card)}</b>`;
  const lead = leader(g), hi = o.highBid ? `High bid <b>${o.highBid}</b> (${Name(T, lead)})` : 'No bids yet';
  const yours = o.ownBid ? ` · yours ${o.ownBid}` : '';
  const pickTxt = add ? ` · picked <b>+${add}</b> = <b>${total}</b>` : '';
  if (!o.canRaise) ui.setHint(o.disgrace ? `You can't outbid the table. Pass and take ${card}.` : `You can't beat ${o.highBid}. Pass to take your money back.`);
  else if (o.disgrace) ui.setHint(`Avoid ${card}: raise, or pass and take it. ${hi}${yours}${pickTxt}`);
  else ui.setHint(`${hi}${yours}${pickTxt}`);
}
function toggle(T, value) {
  if (!pending?.canRaise || !table.ui.enabled) return;
  if (!T.game.hand.includes(value)) return;
  if (table.ui.selected.has(value)) table.ui.selected.delete(value); else table.ui.selected.add(value);
  audio.select(); syncControls(T);
}
function pickMin(T) {
  if (!pending?.canRaise) return;
  const c = cheapestRaise(T.game.hand, pending.ownBid, pending.highBid);
  if (!c) return;
  table.ui.selected = new Set(c);
  audio.select(); syncControls(T);
}
function submitBid(T) {
  const o = pending; if (!o) return;
  const cards = [...table.ui.selected].sort((a, b) => a - b);
  if (!cards.length || o.ownBid + sum(cards) <= o.highBid) return;
  if (T.send({ type: 'raise', cards })) { table.ui.enabled = false; $('#auction-actions').hidden = true; ui.setHint(''); }
}
function submitPass(T) {
  if (!pending) return;
  if (T.send({ type: 'pass' })) { table.ui.enabled = false; table.ui.selected.clear(); $('#auction-actions').hidden = true; ui.setHint(''); }
}

/* ---------- handlers ---------- */
async function reveal(T, msg) {
  const g = T.game, c = msg.card, body = lastTurned(g), n = gildedCount(g);
  T.setActor(null); T.setWatch(easelPoint());
  for (let s = 1; s < 4; s++) ui.setStatus(s, '');
  setGlow(0);
  // the top card of the stack; any face-down body there looks the same, so the swap can't be seen
  // trade slots with the body lying there, so the stack keeps no hole and nothing jumps
  if (body.place === 'deck' && body.slot !== msg.deckCount) {
    const top = table.bodies.find((b) => b.place === 'deck' && !b.money && b.slot === msg.deckCount);
    if (top) sendTo(top, 'deck', { k: body.slot, snap: true });
    sendTo(body, 'deck', { k: msg.deckCount, snap: true });
  }
  setStatusFace(body, c);
  body.place = 'flight';
  audio.deal();
  _o.position.set(0, 0.36, 0.62); _o.lookAt(camera.position); _o.rotateZ(c.kind === 'curio' ? 0.06 : -0.06);
  flyTo(body, _o.position, _o.quaternion, 1.55, { dur: 0.62, arc: 0.12 });
  focusOn(easelPoint(), 0.5); rig.zoomTarget = 1.06;
  await T.step(380);
  audio.reveal();
  await T.landed(body.mover);
  const gilded = c.kind === 'favour' || c.kind === 'scandal';
  if (gilded) { setGilded(n); gildChime(n === 4); }
  setGlow(isDisgrace(c) ? 0.8 : gilded ? 0.8 : 0.35, GLOW[c.kind]);
  top(T);
  if (msg.final) {
    ui.toast('The fourth gilded card. The bidding is over.', 'liar');
    ui.log(`<b>${statusName(c)}</b> turns: the fourth gilded card. The evening ends.`);
    audio.sting(); rig.shake = Math.max(rig.shake, 0.12);
    await T.step(700);
    sendTo(body, 'easel', { dur: 0.55, arc: 0.04 });
    await T.step(1300);
    T.setWatch(null); rig.zoomTarget = 1;
    return;
  }
  if (isDisgrace(c)) {
    ui.toast(`Disgrace: ${statusName(c)}`, 'liar');
    audio.tone({ freq: 146.8, type: 'sawtooth', dur: 0.7, gain: 0.03, lp: 700, verb: 0.4 });
    ui.coach('disgrace', 'A <b>disgrace</b> runs in reverse: the first to pass takes it and keeps their money. Everyone else pays what they bid.');
  } else ui.toast(c.kind === 'favour' ? "Patron's Favour: doubles your status" : `Curio: ${cardLabel(c)}`, c.kind === 'favour' ? 'gold' : 'truth');
  ui.log(`Up for auction: <b>${cardLabel(c)}</b>. ${Name(T, msg.starter)} ${verb(T, msg.starter, 'open', 'opens')}.`);
  await T.step(250);
  sendTo(body, 'easel', { dur: 0.5, arc: 0.05 });
  await T.landed(body.mover);
  T.setWatch(null); rig.zoomTarget = 1; focusOn(null);
  hud(T);
  if (g.auction === 1) ui.coach('auction', 'Tap money cards to build a bid that beats the high bid, then <b>Bid</b>. <b>Pass</b> takes your money back.');
  await T.step(600);
}

function gildChime(last) {
  const notes = last ? [392, 494, 587, 740] : [659, 880, 1175];
  notes.forEach((f, i) => audio.tone({ freq: f, type: 'triangle', dur: 0.9, gain: 0.035, t: i * 0.06, verb: 0.6 }));
}
function gavel() {
  audio.noise({ dur: 0.06, type: 'lowpass', freq: 420, gain: 0.5, attack: 0.001, verb: 0.25 });
  audio.tone({ freq: 140, type: 'sine', dur: 0.12, gain: 0.08 });
}

function turn(T, msg) {
  T.setActor(msg.seat);
  hud(T);
  if (!T.isMe(msg.seat)) {
    T.focusSeat(msg.seat, 0.4);
    ui.setStatus(T.view(msg.seat), '<span class="dots">thinking</span>');
    return;
  }
  // tip the head down so the card on the easel rises clear of your raised hand
  focusOn(LOOK_DOWN, 0.5);
  if (!msg.options) return;
  pending = msg.options;
  table.ui.selected.clear();
  table.ui.enabled = msg.options.canRaise;
  syncControls(T);
}

async function raise(T, msg) {
  const { seat, cards } = msg, g = T.game, v = T.view(seat), n = g.bids[seat].length, pan = T.pan(seat);
  ui.setStatus(v, '');
  if (T.isMe(seat)) table.ui.selected.clear();
  const ch = T.isMe(seat) ? null : T.char(seat);
  if (ch) { bidPoint(v, ch.reachTarget); react(ch, 'reach'); }
  let d = 0;
  g.bids[seat].forEach((value, k) => {
    const b = moneyBody(seat, value), fresh = cards.includes(value);
    b.n = n;
    sendTo(b, 'bid', { view: v, k, n, dur: fresh ? 0.55 : 0.35, arc: fresh ? 0.1 : 0.02, delay: fresh ? (d += 0.08) - 0.08 + (ch ? 0.18 : 0) : 0 });
    if (fresh) setTimeout(() => audio.card(pan), (d + 0.4) * 1000);
  });
  say(T, seat, voice(T, seat, 'raise'));
  ui.log(`<b>${Name(T, seat)}</b> ${verb(T, seat, 'raise', 'raises')} to <b>${msg.bid}</b>.`);
  hud(T);
  await T.step(520 + 80 * cards.length);
  if (ch) react(ch, 'reach', false);
  await T.step(200);
}

async function pass(T, msg) {
  const { seat, returned } = msg, g = T.game, v = T.view(seat);
  ui.setStatus(v, T.isMe(seat) ? '' : 'passes');
  const ch = T.isMe(seat) ? null : T.char(seat);
  if (ch && returned.length) { bidPoint(v, ch.reachTarget); react(ch, 'reach'); }
  returned.forEach((value, i) => sendTo(moneyBody(seat, value), 'hand', { view: v, delay: 0.15 + i * 0.07 }));
  if (returned.length) audio.card(T.pan(seat));
  const disgrace = g.card && isDisgrace(g.card);
  if (!disgrace) say(T, seat, voice(T, seat, 'pass'));
  ui.log(`<b>${Name(T, seat)}</b> ${verb(T, seat, 'pass', 'passes')}${returned.length ? ` and ${verb(T, seat, 'take', 'takes')} back ${sum(returned)}` : ''}.`);
  hud(T);
  await T.step(520);
  if (ch) react(ch, 'reach', false);
  await T.step(220);
}

async function taken(T, msg) {
  const { seat, card, paid, spilled } = msg, g = T.game, v = T.view(seat), me = T.isMe(seat);
  const body = table.bodies.find((b) => b.place === 'easel' || b.place === 'flight') || null;
  const disgrace = isDisgrace(card), ch = me ? null : T.char(seat);
  T.setActor(seat); T.focusSeat(seat, 0.45);
  for (let s = 1; s < 4; s++) ui.setStatus(s, '');
  gavel();
  setGlow(0);
  const spent = paid.flat().length;
  // the card goes first, then the money still on the table is swept off it
  if (body) {
    const k = g.won[seat].findIndex((c) => c.kind === card.kind && c.value === card.value);
    const n = g.won[seat].length + (spilled != null && card.kind === 'curio' ? 1 : 0);
    sendTo(body, 'won', { view: v, k: k < 0 ? n - 1 : k, n, dur: 0.75, arc: 0.1 });
  }
  if (ch) { if (disgrace) { react(ch, 'flinch'); tell(ch, 1); } else react(ch, 'lean'); }
  const what = statusName(card), cost = sum(paid[seat]);
  if (disgrace) {
    ui.toast(me ? `You take ${what}` : `${T.name(seat)} takes ${what}`, me ? 'liar' : 'small');
    ui.log(`<b>${Name(T, seat)}</b> ${verb(T, seat, 'take', 'takes')} <b>${what}</b>.${spent ? ` The rest pay ${sum(paid.flat())}.` : ''}`);
    say(T, seat, voice(T, seat, 'stuck'));
    const dodger = paid.findIndex((p, s) => s !== seat && p.length);
    if (dodger >= 0 && !T.isMe(dodger)) setTimeout(() => say(T, dodger, voice(T, dodger, 'dodge')), 700);
    if (!me) T.recap.dodged++;
  } else {
    ui.toast(`${me ? 'You take' : `${T.name(seat)} takes`} ${what}${cost ? ` for ${cost}` : ' for nothing'}`, me ? 'gold' : 'small');
    ui.log(`<b>${Name(T, seat)}</b> ${verb(T, seat, 'take', 'takes')} <b>${cardLabel(card)}</b> for ${cost || 'nothing'}.`);
    say(T, seat, voice(T, seat, 'win'));
  }
  await T.step(450);
  let d = 0;
  // spent money turns face down in the air: it needs more lift than half its length to clear the felt
  paid.forEach((p, s) => p.forEach((value) => { const b = moneyBody(s, value); setTint(b, 0.85); sendTo(b, 'spent', { dur: 0.5, arc: 0.11, delay: (d += 0.06) - 0.06 }); }));
  for (let i = 0; i < Math.min(spent, 6); i++) setTimeout(() => audio.deal(T.pan(seat)), i * 60 + 200);
  hud(T);
  await T.step(500 + 60 * spent);
  if (spilled != null) {
    const sb = table.bodies[STATUS_BASE + spilled - 1];
    ui.toast(`Spilled Ale: ${me ? 'your' : `${T.name(seat)}'s`} ${statusName({ kind: 'curio', value: spilled })} is ruined`, 'liar');
    ui.log(`Spilled Ale ruins <b>${Name(T, seat) === 'You' ? 'your' : `${T.name(seat)}'s`}</b> ${statusName({ kind: 'curio', value: spilled })}.`);
    setTint(sb, 0.55, 0.45, 0.42);
    sendTo(sb, 'spilled', { dur: 0.6, arc: 0.12 });
    audio.noise({ dur: 0.35, type: 'lowpass', freq: 900, gain: 0.18, verb: 0.2 });
    await T.step(600);
  } else if (msg.aleOwed && card.kind === 'ale') {
    ui.toast(`${me ? 'Your' : `${T.name(seat)}'s`} next curio will be spilled`, 'small');
  }
  layoutAll(T, { dur: 0.35 });
  if (ch) react(ch, 'lean', false);
  T.setActor(null); focusOn(null);
  await T.step(300);
}

async function scoring(T, msg) {
  const g = T.game, token = T.token();
  ui.setClaim(''); setGlow(0);
  T.setActor(null);
  ui.toast('The purses are opened', 'gold');
  // each seat's remaining money is laid out face up, you last so the camera ends on the table
  const order = [1, 2, 3, 0].map((v) => T.seatAt(v));
  for (const s of order) {
    const v = T.view(s), res = msg.remaining[s];
    if (!T.isMe(s)) T.focusSeat(s, 0.35); else focusOn(null);
    res.forEach((value, k) => { const b = moneyBody(s, value); b.n = res.length; sendTo(b, 'purse', { view: v, k, n: res.length, dur: 0.5, arc: 0.08, delay: k * 0.05 }); });
    audio.shuffle();
    hud(T);
    await T.step(750);
  }
  focusOn(null);
  const castOut = msg.castOut.map((x, s) => (x ? s : null)).filter((s) => s != null);
  const least = Math.min(...msg.money);
  ui.toast(castOut.length === 1 ? `${castOut.map((s) => (T.isMe(s) ? 'You are' : `${T.name(s)} is`))[0]} the poorest. Cast out.` : `${castOut.length} tie for poorest. All cast out.`, 'liar');
  audio.sting();
  for (const s of castOut) {
    const v = T.view(s);
    ui.setStatus(v, `cast out · ${least}`);
    for (const value of msg.remaining[s]) setTint(moneyBody(s, value), 0.5, 0.42, 0.4);
    for (let k = STATUS_BASE; k < table.bodies.length; k++) { const b = table.bodies[k]; if (b.place === 'won' && b.view === v) setTint(b, 0.5, 0.42, 0.4); }
    if (!T.isMe(s)) { react(T.char(s), 'out'); say(T, s, voice(T, s, 'out')); }
  }
  ui.log(`Cast out for having the least money (${least}): <b>${castOut.map((s) => Name(T, s)).join(', ')}</b>.`);
  T.refresh();
  await T.step(1400);
  // the status of everyone still in the running, counted up together
  const live = [0, 1, 2, 3].filter((s) => !msg.castOut[s]);
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    for (const s of live) {
      const x = msg.status[s] * (i / steps), shown = i === steps ? msg.status[s] : Math.round(x);
      if (T.isMe(s)) ui.setHint(`Your status <b>${fmtStatus(shown)}</b>`);
      else ui.setStatus(T.view(s), `status <b>${fmtStatus(shown)}</b>`);
    }
    if (i % 2) audio.tone({ freq: 520 + i * 30, type: 'triangle', dur: 0.05, gain: 0.02 });
    await T.step(70);
  }
  const w = msg.winner;
  if (w != null) {
    const v = T.view(w);
    for (let k = STATUS_BASE; k < table.bodies.length; k++) { const b = table.bodies[k]; if (b.place === 'won' && b.view === v) setTint(b, 1.45, 1.3, 1.0); }
    T.setActor(w); T.focusSeat(w, 0.5);
    if (T.isMe(w)) ui.setHint(`You win with <b>${fmtStatus(msg.status[w])}</b> status`);
    else ui.setStatus(v, `<b>wins</b> · status <b>${fmtStatus(msg.status[w])}</b>`);
    ui.toast(`${T.isMe(w) ? 'You win' : `${T.name(w)} wins`} with ${fmtStatus(msg.status[w])} status`, 'gold');
    ui.log(`<b>${Name(T, w)}</b> ${verb(T, w, 'win', 'wins')} with <b>${fmtStatus(msg.status[w])}</b> status.`);
    if (!T.isMe(w)) { react(T.char(w), 'lean'); say(T, w, voice(T, w, 'winner')); }
    gildChime(true);
  } else ui.toast('A dead heat: no winner tonight', 'small');
  await T.step(1600);
  if (token === T.token() && w != null && !T.isMe(w)) react(T.char(w), 'lean', false);
}

/* ---------- rebuild ---------- */
function rebuild(T, { fresh }) {
  const g = T.game;
  me = T.me;
  pending = null;
  table.ui.enabled = false; table.ui.selected.clear(); table.ui.hover = null;
  $('#auction-actions').hidden = true; ui.setHint('');
  setGlow(0);
  rig.zoomTarget = 1; rig.rollTarget = 0; focusOn(null);
  for (const b of table.bodies) setTint(b, 1);
  setGilded(gildedCount(g), false);
  for (let s = 0; s < 4; s++) if (!T.isMe(s)) react(T.char(s), 'out', !!g.scoring?.castOut[s]);
  // coming in, money is dealt off the top of the stack, not out of wherever it was parked
  if (!entered) for (const b of table.bodies) if (b.money) sendTo(b, 'deck', { k: table.bodies.length - STATUS_BASE + b.i, snap: true });
  layoutAll(T, { snap: !entered, dur: fresh ? 0.6 : 0.4, stagger: fresh ? 0.012 : 0 });
  entered = true;
  if (g.scoring) g.scoring.castOut.forEach((x, s) => ui.setStatus(T.view(s), x ? 'cast out' : `status <b>${fmtStatus(g.scoring.status[s])}</b>`));
  else for (let s = 1; s < 4; s++) ui.setStatus(s, '');
  hud(T); top(T);
  if (g.card) setGlow(isDisgrace(g.card) || g.card.kind === 'favour' ? 0.8 : 0.35, GLOW[g.card.kind]);
}

/* ---------- the mode ---------- */
let bound = null;
export const auctionMode = {
  mode: 'auction',
  ready: true,
  table, // read by scripts/verify.mjs
  reduce: reduceAuction,
  newRecap: () => ({ dodged: 0 }),
  enter(T) {
    me = T.me;
    gun.obj.visible = false;
    setDeckSize(0);
    showTable(true);
    document.body.classList.add('mode-auction');
    if (!bound) {
      bound = T;
      $('#auction-bid-btn').addEventListener('click', () => submitBid(bound));
      $('#auction-pass-btn').addEventListener('click', () => submitPass(bound));
      $('#auction-min-btn').addEventListener('click', () => pickMin(bound));
    }
  },
  exit() {
    pending = null; entered = false;
    showTable(false);
    for (const b of table.bodies) { sendTo(b, 'off'); b.card = null; }
    $('#auction-actions').hidden = true;
    gun.obj.visible = true;
    setDeckSize(20); gatherToDeck();
    document.body.classList.remove('mode-auction');
    ui.setClaim('');
  },
  rebuild,
  on: { reveal, raise, pass, taken, scoring, turn },
  clearPrompt(T) {
    if (pending) focusOn(null);
    pending = null;
    table.ui.enabled = false; table.ui.selected.clear();
    $('#auction-actions').hidden = true;
    ui.dismissCoach();
    for (let v = 1; v < 4; v++) if (T.game && !T.game.passed[T.seatAt(v)]) ui.setStatus(v, '');
  },
  reprompt(T, msg) { if (T.isMe(msg.seat) && msg.options) { pending = msg.options; table.ui.enabled = msg.options.canRaise; syncControls(T); } },
  refused(T, msg) {
    if (!pending || !T.isMe(T.prompt?.seat)) return;
    ui.toast(msg.message, 'small');
    table.ui.enabled = pending.canRaise;
    syncControls(T);
  },
  isOut: (T, seat) => !!T.game?.scoring?.castOut[seat],
  seatHud(T) {
    const g = T.game;
    return [0, 1, 2, 3].map((v) => {
      const s = T.seatAt(v), line = seatLine(T, s);
      // your own card keeps its purse line when cast out; other tags dim and strike through
      return { alive: v === 0 || !g.scoring?.castOut[s], cards: g.handCounts[s], pulls: 0, cnt: line, odds: line };
    });
  },
  auto(T, msg) {
    const o = msg.options;
    if (!o || globalThis.__auctionHold) return null;
    if (!o.canRaise) return { type: 'pass' };
    const c = cheapestRaise(T.game.hand, o.ownBid, o.highBid);
    const keen = !c ? 0 : o.disgrace ? 0.5 : sum(c) <= 18 ? 0.65 : 0.3;
    return c && Math.random() < keen ? { type: 'raise', cards: c } : { type: 'pass' };
  },
  summary(T, msg) {
    const g = T.game, r = g.scoring, mine = r && r.place[T.me], won = msg.winner === T.me;
    const winner = msg.winner == null ? null : T.name(msg.winner);
    const ws = msg.winner == null ? null : fmtStatus(r.status[msg.winner]);
    let kicker = 'Closing time', title = 'Outbid', text;
    if (won) { kicker = 'The house salutes you'; title = 'Gilded'; text = `You finish with ${fmtStatus(r.status[T.me])} status and ${r.money[T.me]} crowns to spare.`; }
    else if (r?.castOut[T.me]) { title = 'Cast Out'; text = `You were the poorest at the table with ${r.money[T.me]} crowns.${winner ? ` ${winner} takes the evening with ${ws} status.` : ''}`; }
    else if (winner) text = `${winner} takes the evening with ${ws} status. You finished ${['', 'first', 'second', 'third', 'fourth'][mine] || 'behind'} with ${fmtStatus(r.status[T.me])}.`;
    else { title = 'A Dead Heat'; text = 'Nobody could be separated at the top. The house keeps the evening.'; }
    return {
      rounds: g.auction, survivors: winner ? [winner] : [], kicker, title, text,
      recap: [[r ? fmtStatus(r.status[T.me]) : 0, 'Your status'], [r ? r.money[T.me] : 0, 'Crowns kept'], [T.recap.dodged, 'Disgraces dodged']],
    };
  },
  /* input */
  pointerEnabled: () => table.ui.enabled,
  pick: (raycaster, current) => (me == null ? null : pickMoney(raycaster, me, current)),
  hover(value) { table.ui.hover = value; },
  select: (T, value) => toggle(T, value),
  keydown(T, e) {
    if (!pending) return false;
    const idx = e.key === '0' ? 9 : e.key === '-' ? 10 : e.key >= '1' && e.key <= '9' ? +e.key - 1 : -1;
    if (idx >= 0) { const v = T.game.hand[idx]; if (v != null) toggle(T, v); return true; }
    if (e.key === 'Enter') { e.preventDefault(); submitBid(T); return true; }
    if (e.key === 'p' || e.key === 'P') { submitPass(T); return true; }
    if (e.key === 'r' || e.key === 'R') { pickMin(T); return true; }
    if (e.key === 'Backspace') { table.ui.selected.clear(); syncControls(T); return true; }
    return false;
  },
  frame(T, reservePx) {
    if (!T.game) return;
    layoutHands(T, reservePx);
  },
};
