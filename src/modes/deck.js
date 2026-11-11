// The card table: plays deck-mode messages back as cards, the revolver, characters, sound and HUD.
// Handlers take (T, msg) where T is the director's table context; they read the mirrored table as
// it stands after `msg` from T.game and never decide anything the server hasn't said.
import * as THREE from 'three';
import { pick, settings } from '../util.js';
import { audio } from '../audio.js';
import * as ui from '../ui.js';
import { hands, handUI, gatherToDeck, deal, takeFromHand, discardHand, toPile, toReveal, settleRevealed, setGlow, clearGlows, setDeckSize, bodyOf, setFace, myHand, layoutHands, pickCard, placeTable } from '../render/cards.js';
import { react, tell } from '../render/characters.js';
import { rig, focusOn, centerLook } from '../render/camera.js';
import { gun, gunHome, gunToCharacter, gunSlideTo, slideSpotFor, gunToGrip, gunSetDown, gunDrop, spinDrum, cockHammer, fire } from '../render/gun.js';
import { arm, armReach, armRaise, armHide } from '../render/playerArm.js';
import { RANK_STYLE } from '../render/textures.js';
import { createDeck, HAND_SIZE, CHAMBERS } from '../model/rules.js';
import { reduceDeck, pileCount, lastPlay } from './deck-state.js';

const LINES = {
  brass: {
    claim: ['Calculated.', 'Verifiable.', 'Proceed.', '', ''],
    liar: ['Inconsistency detected. Liar.', 'Your numbers do not add up. Liar.'],
    caught: ['An acceptable risk. Recalculating.', 'Error noted.'],
    honest: ['As computed.', 'I do not bluff. Often.'],
    click: ['Fortune favours the machine.', 'Recalibrating.'],
    wrong: ['A rounding error.'],
    others: ['Regrettable.', 'One fewer variable.'],
    devil: ['Probability: unfavourable.'],
  },
  noctua: {
    claim: ['Naturally.', 'Would I lie, darling?', 'Mm.', '', ''],
    liar: ['Liar, darling.', 'Oh, I don\'t think so. Liar.'],
    caught: ['A lady keeps her secrets. Usually.', 'How rude of you to look.'],
    honest: ['You doubted me? Sweet.', 'Every word true, darling.'],
    click: ['How tedious.', 'Not tonight.'],
    wrong: ['Hm. Pity.'],
    others: ['Such a waste of a hat.', 'Oh dear.'],
    devil: ['How very dramatic.'],
  },
  gristle: {
    claim: ['Aye.', 'Read \'em and weep.', 'Hah!', '', ''],
    liar: ['LIAR!', 'Bilge! Liar!'],
    caught: ['Worth a try!', 'Blast and barnacles.'],
    honest: ['Ha! Honest as the tide!', 'Pay up, ye doubter.'],
    click: ['HAH! Still breathing!', 'Not today, ye barrel.'],
    wrong: ['Arr. Should\'ve trusted ye.'],
    others: ['Fair winds, mate.', 'More rum for the rest of us.'],
    devil: ['The Devil\'s own luck, that.'],
  },
};
// How often each character flickers after a play. The client never knows whether a play was a lie,
// so a flicker here is nerves, not a tell.
const NERVES = { brass: 0.12, noctua: 0.18, gristle: 0.3 };

const NUM = ['zero', 'one', 'two', 'three'];
/** "two Kings", "one Queen". */
export const claimText = (n, rank) => `${NUM[n]} ${n === 1 ? RANK_STYLE[rank].name : RANK_STYLE[rank].plural}`;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const verb = (T, seat, you, other) => (T.isMe(seat) ? you : other);
const truthful = (rank, tableRank) => rank === tableRank || rank === 'joker';

const CENTER = new THREE.Vector3(0, 0, 0);
const REVEAL_AT = new THREE.Vector3(0, 0.3, 0.56);
const _g = new THREE.Vector3();
const voice = (T, seat, kind) => { const l = LINES[T.design(seat)]?.[kind]; return l ? pick(l) : ''; };
const say = (T, seat, text) => { if (!T.isMe(seat)) ui.say(T.view(seat), text); };

let holder = null; // the seat holding the revolver, or null when it lies on the table
let beating = false;
let pendingTurn = null; // your turn's options while the controls are up

/* ---------- deal ---------- */
async function round(T, msg) {
  const game = T.game;
  T.setActor(null); T.setWatch(CENTER);
  ui.setClaim(''); clearGlows(); handUI.selected.clear();
  gatherToDeck();
  await T.step(650);
  audio.shuffle();
  await T.step(700);
  setDeckSize(createDeck(game.variant).length);
  const seats = [];
  for (let k = 0; k < 4; k++) { const s = (msg.starter + k) % 4; if (msg.handCounts[s]) seats.push(s); }
  const order = [];
  for (let r = 0; r < HAND_SIZE; r++) for (const s of seats) if (r < msg.handCounts[s]) order.push([T.view(s), T.isMe(s) ? game.hand[r] : null, s]);
  const gap = 0.065 / settings.speed;
  const delays = deal(order.map(([v, c]) => [v, c]), gap);
  order.forEach(([, , s], i) => audio.deal(T.pan(s), delays[i] + 0.05));
  T.refresh();
  await T.step(order.length * 65 + 700);
  ui.setTable(msg.tableRank, msg.round);
  audio.tableCard();
  ui.toast(`Table card: ${RANK_STYLE[msg.tableRank].plural}`, 'gold');
  ui.log(`Round ${msg.round}: the table card is <b>${RANK_STYLE[msg.tableRank].plural}</b>.`);
  T.setWatch(null);
  await T.step(1500);
  if (msg.round === 1 && game.alive[T.me]) ui.coach('lead', 'Play 1–3 cards face down and claim they match the table card. You may lie.');
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
  if (msg.options.mustChallenge) ui.toast('Nobody else holds cards. You have to call.', 'small');
  handUI.selected.clear();
  handUI.enabled = msg.options.canPlay;
  syncControls(T);
  if (msg.options.canChallenge && !msg.options.mustChallenge) ui.coach('liar', 'Think the last player lied? Call <b>Liar</b>. Whoever is wrong faces the revolver.');
}

function syncControls(T) {
  const o = pendingTurn; if (!o) return;
  const lp = lastPlay(T.game);
  ui.showActions({
    canPlay: o.canPlay, canChallenge: o.canChallenge, selected: handUI.selected.size, max: o.maxCards,
    rank: T.game.tableRank, last: lp ? `<b>${T.name(lp.seat)}</b> ${verb(T, lp.seat, 'claim', 'claims')} ${claimText(lp.claim, T.game.tableRank)}` : null,
  });
}

function clearPrompt(T) {
  pendingTurn = null;
  handUI.enabled = false;
  ui.dismissCoach();
  for (let v = 1; v < 4; v++) ui.setStatus(v, '');
}

function toggleCard(T, token) {
  if (!pendingTurn?.canPlay || !handUI.enabled) return;
  if (!hands[0].some((b) => b.token === token)) return;
  if (handUI.selected.has(token)) handUI.selected.delete(token);
  else if (handUI.selected.size < pendingTurn.maxCards) handUI.selected.add(token);
  else return;
  audio.select(); syncControls(T);
}
function submitPlay(T) {
  if (!pendingTurn?.canPlay || !handUI.selected.size) return;
  const tokens = [...handUI.selected];
  if (tokens.length > 1 && tokens.some((t) => bodyOf(t)?.rank === 'devil')) return ui.toast('The Devil is played alone.', 'small');
  if (T.send({ type: 'play', tokens })) { handUI.enabled = false; ui.hideActions(); }
}
function submitChallenge(T) {
  if (!pendingTurn?.canChallenge) return;
  if (T.send({ type: 'challenge' })) { handUI.enabled = false; ui.hideActions(); }
}

async function played(T, msg) {
  const { seat } = msg, game = T.game, me = T.isMe(seat);
  const bodies = takeFromHand(T.view(seat), msg.tokens);
  handUI.selected.clear();
  if (T.recap.pendingBluff && !me) { T.recap.bluffs++; T.recap.pendingBluff = false; }
  if (me) T.recap.pendingBluff = bodies.some((b) => !truthful(b.rank, game.tableRank));
  const gap = 0.09 / settings.speed, pan = T.pan(seat);
  bodies.forEach((b, i) => { toPile(b, i * gap); setTimeout(() => audio.card(pan), (i * gap + 0.22) * 1000); });
  if (!me && Math.random() < (NERVES[T.design(seat)] ?? 0.15)) setTimeout(() => tell(T.char(seat)), 380);
  const claim = claimText(msg.claim, game.tableRank);
  say(T, seat, `${cap(claim)}. ${voice(T, seat, 'claim')}`.trim());
  ui.setClaim(`<b>${T.name(seat)}</b> ${verb(T, seat, 'claim', 'claims')} ${claim} · pile of ${pileCount(game)}`);
  ui.log(`<b>${T.name(seat)}</b> ${verb(T, seat, 'play', 'plays')} ${claim}.`);
  T.refresh();
  await T.step(950);
}

/* ---------- the call ---------- */
/**
 * The Liar call, staged in three beats: the accusation (the camera snaps its attention to whoever
 * is on the spot), the reveal (the cards rise and turn to you one by one), the verdict (each card
 * lights green or red as you read it). A revealed Devil with three or more alive turns the verdict
 * into a volley: everyone but the accused faces their own revolver.
 */
async function challenge(T, msg) {
  const { caller, accused, forced, lie, cards, shooters } = msg, game = T.game;
  const token = T.token();
  T.refresh();
  if (T.isMe(accused)) T.recap.pendingBluff = false;
  if (T.isMe(caller) && lie) T.recap.caught++;
  T.setActor(caller);
  if (!T.isMe(caller)) { react(T.char(caller), 'lean'); say(T, caller, forced ? 'Nobody else holds a card. Show them.' : voice(T, caller, 'liar')); }
  ui.toast(T.isMe(caller) ? (forced ? 'Show me.' : 'LIAR!') : `${T.name(caller)}: LIAR!`, forced && T.isMe(caller) ? 'small' : 'liar');
  audio.sting(); audio.setTension(0.5); rig.shake = Math.max(rig.shake, 0.22);
  const onSpot = T.isMe(accused) ? caller : accused;
  T.focusSeat(onSpot, 0.6);
  rig.zoomTarget = 1.08;
  ui.log(`<b>${T.name(caller)}</b> ${verb(T, caller, 'call', 'calls')} <b>${T.isMe(accused) ? 'you' : T.name(accused)}</b> a liar.`);
  await T.step(950);

  const bodies = cards.map((c) => { const b = bodyOf(c.token); if (b) setFace(b, c.rank); return b; }).filter(Boolean);
  const matches = cards.map((c) => truthful(c.rank, game.tableRank));
  T.setWatch(REVEAL_AT);
  focusOn(REVEAL_AT, 0.75); rig.zoomTarget = 1.12;
  const stagger = 0.12 / settings.speed;
  bodies.forEach((b, i) => toReveal(b, i, bodies.length, i * stagger));
  audio.reveal();
  await T.step(800 + bodies.length * 120);
  bodies.forEach((b, i) => setTimeout(() => { if (token === T.token()) setGlow(b, 0.9, matches[i] ? 0x7fd06a : 0xff4a30); }, i * stagger * 1000));
  audio.verdict(lie);
  const devil = cards.some((c) => c.rank === 'devil');
  if (lie) rig.shake = Math.max(rig.shake, devil ? 0.35 : 0.12);
  const accusedName = T.isMe(accused) ? 'You' : T.name(accused);
  if (shooters.length > 1) {
    ui.toast('The Devil’s card. Everyone else pulls.', 'liar');
    ui.log(`<b>${accusedName}</b> played the <b>Devil</b>. Everyone else faces the revolver.`);
    for (const s of shooters) if (!T.isMe(s)) setTimeout(() => say(T, s, voice(T, s, 'devil')), 700 + Math.random() * 600);
  } else {
    if (lie) ui.toast(T.isMe(accused) ? 'Caught lying.' : `${T.name(accused)} was lying.`, 'small');
    else ui.toast(T.isMe(accused) ? 'You told the truth.' : `${T.name(accused)} told the truth.`, 'truth');
    ui.log(lie ? `The cards don't match. <b>${accusedName}</b> ${verb(T, accused, 'were', 'was')} lying.` : `Every card matches. <b>${T.isMe(caller) ? 'You' : T.name(caller)}</b> ${verb(T, caller, 'were', 'was')} wrong.`);
    if (!T.isMe(accused)) say(T, accused, voice(T, accused, lie ? 'caught' : 'honest'));
    if (!T.isMe(caller) && !lie) setTimeout(() => say(T, caller, voice(T, caller, 'wrong')), 900);
  }
  await T.step(1600);
  if (!T.isMe(caller)) react(T.char(caller), 'lean', false);
  bodies.forEach((b, i) => settleRevealed(b, i, bodies.length));
  T.setWatch(null); rig.zoomTarget = 1;
}

/* ---------- the revolver ---------- */
async function roulette(T, msg) {
  const { seat } = msg, token = T.token();
  T.setActor(seat);
  const odds = CHAMBERS - T.game.pulls[seat];
  await buildUp(T, seat);
  if (T.isMe(seat)) {
    if (settings.autoplay) return;
    ui.awaitTrigger(`One chamber in ${odds === 1 ? 'one. It is loaded' : odds} is loaded. Hold to pull.`).then((pulled) => {
      if (!pulled || token !== T.token() || T.prompt?.seat !== T.me) return;
      cockHammer();
      T.send({ type: 'pull' });
    });
  } else {
    cockHammer(); audio.cock();
    // the slow push-in is the pause before the pull
    rig.zoomTarget = 1.42;
  }
}

/** The revolver comes up, the drum spins, the heart starts pounding. */
async function buildUp(T, seat) {
  if (holder === seat) return;
  const human = T.isMe(seat), ch = T.char(seat), token = T.token();
  audio.setTension(1); ui.setTense(true);
  ui.toast(`${human ? 'You' : T.name(seat)} ${verb(T, seat, 'pick', 'picks')} up the revolver`, 'small');
  if (human) { rig.rollTarget = 0.05; focusOn(null); centerLook(0.5); rig.zoomTarget = 1.05; }
  else { T.setWatch(null); T.focusSeat(seat, 0.8); rig.zoomTarget = 1.3; react(ch, 'tremble'); }
  if (holder != null) await putDownGun(T, holder);
  holder = seat;
  await takeUpGun(T, seat);
  spinDrum(12); audio.spin();
  await T.step(1050);
  beating = true;
  let rate = 1;
  const beat = () => { if (!beating || token !== T.token()) return; audio.heartbeat(rate); rate = Math.min(2.2, rate + 0.15); setTimeout(beat, 900 / rate); };
  beat();
}

/**
 * The revolver slides across the felt to `seat`, a hand picks it up and raises it to the temple.
 * Characters without a gripping hand yet (older art) get it flown to the temple instead.
 */
async function takeUpGun(T, seat) {
  const ch = T.char(seat);
  if (T.isMe(seat)) {
    gunSlideTo(slideSpotFor(rig.seat.x, rig.seat.z, _g)); rig.leanTarget = 1;
    await T.step(220);
    armReach(_g);
    await T.landed(arm.mover); await T.landed(gun.mover);
    gunToGrip(arm.grip); rig.leanTarget = 0;
    await T.landed(gun.mover);
    armRaise();
    await T.landed(arm.mover);
  } else if (ch.grip) {
    ch.group.getWorldPosition(_g);
    gunSlideTo(slideSpotFor(_g.x, _g.z, _g));
    await T.landed(gun.mover);
    ch.reachTarget.copy(_g); react(ch, 'reach');
    await T.step(500);
    gunToGrip(ch.grip); react(ch, 'reach', false); react(ch, 'aim');
    await T.landed(gun.mover);
    await T.step(450);
  } else {
    gunToCharacter(ch);
    await T.step(1100);
  }
}

/** The arm comes down, the revolver goes back on the felt and slides home. */
async function putDownGun(T, seat) {
  const ch = T.char(seat);
  holder = null;
  if (T.isMe(seat)) {
    armReach(slideSpotFor(rig.seat.x, rig.seat.z, _g)); rig.leanTarget = 0.6;
    await T.landed(arm.mover);
    gunSetDown(); rig.leanTarget = 0;
    await T.landed(gun.mover);
    armHide(); gunHome({ slide: true });
  } else if (ch.grip) {
    react(ch, 'aim', false);
    await T.step(500);
    gunSetDown();
    await T.landed(gun.mover);
    gunHome({ slide: true });
  } else gunHome();
}

/** Click or bang, the reactions, and the table settling back. */
async function shot(T, msg) {
  const { seat, fired } = msg, human = T.isMe(seat), ch = T.char(seat);
  if (holder !== seat) { await buildUp(T, seat); cockHammer(); }
  beating = false;
  T.setActor(seat);
  if (!fired) {
    fire(false); audio.click(); rig.shake = 0.2;
    if (!human) { react(ch, 'flinch'); react(ch, 'tremble', false); react(ch, 'relief'); setTimeout(() => say(T, seat, voice(T, seat, 'click')), 500); rig.zoomTarget = 1.2; }
    else { T.recap.survived++; setTimeout(() => audio.relief(), 350); }
    ui.toast('*click*', 'gold');
    ui.log(`<b>${human ? 'You' : T.name(seat)}</b> ${verb(T, seat, 'pull', 'pulls')} the trigger. Empty chamber.`);
    T.refresh();
    await T.step(900);
    if (!human) react(ch, 'relief', false);
    await putDownGun(T, seat);
  } else {
    fire(true); audio.bang(); rig.shake = 1;
    ui.flash();
    ui.log(`<b>${human ? 'You' : T.name(seat)}</b> ${verb(T, seat, 'were', 'was')} not so lucky.`);
    T.refresh();
    if (human) {
      ui.toast('BANG', 'liar');
      ui.setBlackout(true);
      audio.setTension(0);
      discardHand(0, 0.3);
      holder = null;
      await T.step(2400);
      armHide(); gunHome();
      if (T.game.alive.filter(Boolean).length > 1) T.eliminated();
      return settle(T);
    }
    react(ch, 'tremble', false); react(ch, 'out');
    ui.toast(`${T.name(seat)} is out`, 'liar');
    discardHand(T.view(seat), 0.5);
    const witnesses = T.game.alive.map((a, s) => (a && !T.isMe(s) && s !== seat ? s : null)).filter((s) => s != null);
    if (witnesses.length) { const w = pick(witnesses); setTimeout(() => say(T, w, voice(T, w, 'others')), 1600); }
    // let the shot land; the revolver falls from the limp hand while the camera eases out
    await T.step(ch.grip ? 350 : 650);
    holder = null;
    if (ch.grip) gunDrop(); else gunHome();
    rig.zoomTarget = 1.12; T.focusSeat(seat, 0.45);
    await T.step(1550);
    if (ch.grip) gunHome({ slide: true });
  }
  settle(T);
  await T.step(500);
}

function settle(T) {
  audio.setTension(0); ui.setTense(false);
  rig.zoomTarget = 1; rig.rollTarget = 0; focusOn(null);
  T.setActor(null);
}

/* ---------- rebuild ---------- */
/** Puts the table exactly as T.game says, at once: for a new game, a reconnect, or a tab coming back. */
function rebuild(T, { fresh }) {
  const game = T.game;
  beating = false; holder = null; pendingTurn = null;
  handUI.enabled = false; handUI.selected.clear();
  setDeckSize(createDeck(game.variant).length);
  clearGlows(); armHide(); gunHome(); gun.cockTarget = 0;
  audio.setTension(0); ui.setTense(false);
  rig.leanTarget = 0; rig.zoomTarget = 1; rig.rollTarget = 0; focusOn(null);
  for (let s = 0; s < 4; s++) if (!T.isMe(s)) react(T.char(s), 'out', !game.alive[s]);
  if (fresh || !game.round) {
    gatherToDeck();
    ui.setClaim('');
    return;
  }
  const byView = [[], [], [], []];
  for (let s = 0; s < 4; s++) {
    const v = T.view(s);
    for (let i = 0; i < game.handCounts[s]; i++) byView[v].push(T.isMe(s) ? game.hand[i] : null);
  }
  const pile = game.plays.flatMap((p) => p.tokens);
  const shown = game.reveal ? game.reveal.cards : [];
  placeTable(byView, pile, shown);
  if (game.reveal) shown.forEach((c) => { const b = bodyOf(c.token); if (b) setGlow(b, 0.9, truthful(c.rank, game.tableRank) ? 0x7fd06a : 0xff4a30); });
  ui.setTable(game.tableRank, game.round);
  const lp = lastPlay(game);
  ui.setClaim(lp ? `<b>${T.name(lp.seat)}</b> ${verb(T, lp.seat, 'claim', 'claims')} ${claimText(lp.claim, game.tableRank)} · pile of ${pileCount(game)}` : '');
}

/* ---------- the mode ---------- */
let bound = null;
export const deckMode = {
  mode: 'deck',
  ready: true,
  reduce: reduceDeck,
  newRecap: () => ({ caught: 0, bluffs: 0, survived: 0, pendingBluff: false }),
  enter(T) {
    holder = null;
    if (!bound) {
      bound = T;
      document.getElementById('play-btn').addEventListener('click', () => submitPlay(bound));
      document.getElementById('liar-btn').addEventListener('click', () => submitChallenge(bound));
    }
  },
  exit() {
    beating = false; holder = null; pendingTurn = null;
    handUI.enabled = false; clearGlows(); armHide(); gunHome(); gatherToDeck();
  },
  rebuild,
  on: { round, played, challenge, shot, turn, roulette },
  clearPrompt,
  reprompt(T, msg) { if (T.isMe(msg.seat) && msg.type === 'turn' && msg.options) { pendingTurn = msg.options; syncControls(T); } },
  refused(T, msg) {
    if (!pendingTurn || !T.isMe(T.prompt?.seat)) return;
    ui.toast(msg.message, 'small');
    handUI.enabled = pendingTurn.canPlay;
    syncControls(T);
  },
  isOut: (T, seat) => !T.game.alive[seat],
  /** Per view, what the name tags and your own card show. */
  seatHud(T) {
    const g = T.game;
    return [0, 1, 2, 3].map((v) => { const s = T.seatAt(v); return { alive: g.alive[s], cards: g.handCounts[s], pulls: g.pulls[s] }; });
  },
  auto(T, msg) {
    if (msg.type === 'roulette') return { type: 'pull' };
    const o = msg.options;
    if (!o) return null;
    if (o.mustChallenge || (o.canChallenge && Math.random() < 0.3)) return { type: 'challenge' };
    const hand = T.game.hand, devil = hand.find((c) => c.rank === 'devil');
    const cards = devil && Math.random() < 0.4 ? [devil] : hand.filter((c) => c.rank !== 'devil').slice(0, 1 + Math.floor(Math.random() * Math.min(2, o.maxCards)));
    return { type: 'play', tokens: (cards.length ? cards : hand.slice(0, 1)).map((c) => c.token) };
  },
  summary(T, msg, stats) {
    const survivors = msg.seats.map((x, s) => (x.alive && !T.isMe(s) ? T.name(s) : null)).filter(Boolean);
    const r = T.recap;
    return {
      rounds: T.game.round, survivors,
      recap: [[r.caught, 'Liars caught'], [r.bluffs + (r.pendingBluff ? 1 : 0), 'Bluffs that passed'], stats ? [stats.streak, 'Win streak'] : [r.survived, 'Empty chambers']],
    };
  },
  /* input */
  pointerEnabled: () => handUI.enabled,
  pick: (raycaster, current) => pickCard(raycaster, current),
  hover(token) { handUI.hover = token; },
  select: (T, token) => toggleCard(T, token),
  keydown(T, e) {
    if (!handUI.enabled && !pendingTurn) return false;
    if (e.key >= '1' && e.key <= '9') { const b = myHand()[+e.key - 1]; if (b) toggleCard(T, b.token); return true; }
    if (e.key === 'Enter') { e.preventDefault(); submitPlay(T); return true; }
    if (e.key === 'l' || e.key === 'L') { submitChallenge(T); return true; }
    return false;
  },
  frame(T, reservePx) { layoutHands(T.viewChars, reservePx); },
};
