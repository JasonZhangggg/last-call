// Runs a game: asks the model what happens, then stages it (cards, camera, characters, sound, HUD).
// Every await goes through step(), so leaving the table cancels the whole flow cleanly.
import * as THREE from 'three';
import * as R from './model/rules.js';
import * as AI from './model/ai.js';
import { wait, pick, rand, settings } from './util.js';
import { audio } from './audio.js';
import * as ui from './ui.js';
import { views, handUI, gatherToDeck, toPile, toSpare, toReveal, settleRevealed, dealTo, setGlow, clearGlows } from './render/cards.js';
import { react, resetCharacter, tell, headWorld } from './render/characters.js';
import { rig, focusOn, centerLook } from './render/camera.js';
import { gunHome, gunToCharacter, gunToPlayer, spinDrum, cockHammer, fire } from './render/gun.js';
import { RANK_STYLE } from './render/textures.js';

export const SEATS = [
  { name: 'You', persona: AI.PERSONAS.player },
  { name: 'Brass', design: 'brass', angle: Math.PI + 0.52, persona: AI.PERSONAS.brass, pan: -0.6 },
  { name: 'Madame Noctua', design: 'noctua', angle: -Math.PI / 2, persona: AI.PERSONAS.noctua, pan: 0 },
  { name: 'Captain Gristle', design: 'gristle', angle: -0.52, persona: AI.PERSONAS.gristle, pan: 0.6 },
];

const LINES = {
  1: {
    claim: ['Calculated.', 'Verifiable.', 'Proceed.', '', ''],
    liar: ['Inconsistency detected. Liar.', 'Your numbers do not add up. Liar.'],
    caught: ['An acceptable risk. Recalculating.', 'Error noted.'],
    honest: ['As computed.', 'I do not bluff. Often.'],
    click: ['Fortune favours the machine.', 'Recalibrating.'],
    wrong: ['A rounding error.'],
    others: ['Regrettable.', 'One fewer variable.'],
  },
  2: {
    claim: ['Naturally.', 'Would I lie, darling?', 'Mm.', '', ''],
    liar: ['Liar, darling.', 'Oh, I don\'t think so. Liar.'],
    caught: ['A lady keeps her secrets. Usually.', 'How rude of you to look.'],
    honest: ['You doubted me? Sweet.', 'Every word true, darling.'],
    click: ['How tedious.', 'Not tonight.'],
    wrong: ['Hm. Pity.'],
    others: ['Such a waste of a hat.', 'Oh dear.'],
  },
  3: {
    claim: ['Aye.', 'Read \'em and weep.', 'Hah!', '', ''],
    liar: ['LIAR!', 'Bilge! Liar!'],
    caught: ['Worth a try!', 'Blast and barnacles.'],
    honest: ['Ha! Honest as the tide!', 'Pay up, ye doubter.'],
    click: ['HAH! Still breathing!', 'Not today, ye barrel.'],
    wrong: ['Arr. Should\'ve trusted ye.'],
    others: ['Fair winds, mate.', 'More rum for the rest of us.'],
  },
};

const ABORT = Symbol('abort');
export const D = {
  game: null, token: 0, actor: null, characters: [], memory: [], pending: null,
  watch: null, // world point everyone looks at, overriding the actor (the pile, the revolver)
  recap: null, running: false,
};
const _h = new THREE.Vector3();

async function step(ms, token) {
  await wait(ms);
  if (token !== D.token) throw ABORT;
}
const voice = (seat, kind) => { const l = LINES[seat]?.[kind]; return l ? pick(l) : ''; };

export function setCharacters(chars) { D.characters = chars; }

export async function runGame() {
  const token = ++D.token;
  D.running = true;
  const game = D.game = R.newGame();
  D.memory = SEATS.map(() => AI.newMemory());
  D.recap = { caught: 0, bluffs: 0, survived: 0, pendingBluff: false };
  D.actor = null; D.watch = null;
  ui.resetSeats(); ui.refreshSeats(game, null); ui.clearLog(); ui.setClaim('');
  for (let s = 1; s < 4; s++) { resetCharacter(D.characters[s]); ui.setStatus(s, ''); }
  ui.setInGame(true);
  rig.introTarget = 1; rig.zoomTarget = 1; rig.rollTarget = 0;
  gunHome();
  document.getElementById('blackout').classList.remove('on');
  try {
    await step(500, token);
    while (game.phase !== 'over' && game.players[0].alive) {
      if (game.phase === 'between') await dealRound(token);
      else if (game.phase === 'roulette') await roulette(game.pending.seat, token);
      else await takeTurn(token);
    }
    await step(400, token);
    finish();
  } catch (e) {
    if (e === ABORT) return;
    console.error('Game flow failed', e);
    abortGame();
    ui.toast('The dealer fumbled the deck. Take a seat again.', 'small');
    rig.introTarget = 0; ui.openOverlay('title');
  } finally {
    if (token === D.token) D.running = false;
  }
}

/** Leave mid-game: cancels pending awaits and puts the table back. */
export function abortGame() {
  D.token++; D.running = false;
  D.pending?.reject?.(ABORT); D.pending = null;
  ui.cancelTrigger(); ui.hideActions(); handUI.enabled = false;
  audio.setTension(0); document.body.classList.remove('tense');
  for (let s = 1; s < 4; s++) resetCharacter(D.characters[s]);
  D.actor = null; D.watch = null;
  focusOn(null); rig.zoomTarget = 1; rig.rollTarget = 0;
  gunHome(); gatherToDeck(); clearGlows();
  ui.setInGame(false);
}

/* ---------- deal ---------- */
async function dealRound(token) {
  const game = D.game;
  D.actor = null; D.watch = new THREE.Vector3(0, 0, 0);
  ui.setClaim(''); clearGlows(); handUI.selected.clear();
  gatherToDeck();
  await step(650, token);
  audio.shuffle();
  await step(700, token);
  const { deal, unused, tableRank } = R.startRound(game);
  deal.forEach(({ seat, card }, i) => {
    dealTo(views.get(card.id), seat, i * 0.065);
    audio.deal(SEATS[seat].pan || 0, i * 0.065 + 0.05);
  });
  unused.forEach((c, i) => toSpare(views.get(c.id), i));
  ui.refreshSeats(game, null);
  await step(deal.length * 65 + 600, token);
  ui.setTable(tableRank, game.round);
  audio.tableCard();
  ui.toast(`Table card: ${RANK_STYLE[tableRank].plural}`, 'gold');
  ui.log(`Round ${game.round}: the table card is <b>${RANK_STYLE[tableRank].plural}</b>.`);
  D.watch = null;
  await step(1500, token);
  if (game.round === 1) ui.coach('lead', 'Each turn, play 1–3 cards face down and claim they match the table card. You may lie.');
}

/* ---------- turns ---------- */
async function takeTurn(token) {
  const game = D.game, seat = game.turn, opt = R.turnOptions(game);
  D.actor = seat;
  ui.refreshSeats(game, seat);
  const human = seat === 0 && !settings.autoplay;
  let action;
  if (opt.mustChallenge) {
    if (human) { ui.toast('Nobody else holds cards. You have to call.', 'small'); await step(1400, token); }
    else { ui.setStatus(seat, 'must call'); await step(900, token); ui.setStatus(seat, ''); }
    action = { type: 'challenge', forced: true };
  } else if (human) {
    action = await humanTurn(opt, token);
  } else {
    if (seat !== 0) focusOn(headWorld(D.characters[seat], _h), 0.45);
    ui.setStatus(seat, '<span class="dots">thinking</span>');
    await step(rand(900, 1800), token);
    ui.setStatus(seat, '');
    action = AI.decide(R.publicView(game, seat), SEATS[seat].persona, D.memory[seat], Math.random);
  }
  if (action.type === 'play') await stagePlay(seat, action.cardIds, token);
  else await stageChallenge(seat, !!action.forced, token);
}

function humanTurn(opt, token) {
  focusOn(null);
  handUI.selected.clear(); handUI.enabled = true;
  D.pending = { opt };
  syncHumanControls();
  if (opt.canChallenge) ui.coach('liar', 'Think the last player lied? Call <b>Liar</b>. Whoever is wrong faces the revolver.');
  return new Promise((resolve, reject) => {
    D.pending.resolve = resolve; D.pending.reject = reject;
  }).finally(() => { handUI.enabled = false; ui.hideActions(); ui.dismissCoach(); if (token === D.token) D.pending = null; });
}
export function syncHumanControls() {
  const p = D.pending; if (!p?.opt) return;
  const lp = R.lastPlay(D.game);
  ui.showActions({ canPlay: p.opt.canPlay, canChallenge: p.opt.canChallenge, selected: handUI.selected.size, rank: D.game.tableRank, lastSeat: lp ? lp.seat : null, lastClaim: lp?.claim });
}
export function toggleCard(id) {
  if (!D.pending?.opt || !handUI.enabled) return;
  if (!D.game.players[0].hand.some((c) => c.id === id)) return;
  if (handUI.selected.has(id)) handUI.selected.delete(id);
  else if (handUI.selected.size < 3) handUI.selected.add(id);
  else return;
  audio.select(); syncHumanControls();
}
export function submitPlay() {
  const p = D.pending; if (!p?.resolve || !p.opt.canPlay) return;
  const ids = [...handUI.selected]; if (ids.length < 1 || ids.length > 3) return;
  p.resolve({ type: 'play', cardIds: ids });
}
export function submitChallenge() {
  const p = D.pending; if (!p?.resolve || !p.opt.canChallenge) return;
  p.resolve({ type: 'challenge' });
}

async function stagePlay(seat, cardIds, token) {
  const game = D.game;
  const play = R.play(game, seat, cardIds);
  handUI.selected.clear();
  const lie = play.cards.some((c) => !R.matchesTable(c, game.tableRank));
  play.cards.forEach((c, i) => toPile(views.get(c.id), i * 0.09));
  play.cards.forEach((_, i) => setTimeout(() => audio.card(SEATS[seat].pan || 0), 120 + i * 90));
  const claim = ui.claimText(play.claim, game.tableRank);
  if (seat !== 0) {
    ui.say(seat, `${claim}. ${voice(seat, 'claim')}`.trim());
    if (AI.showsTell(SEATS[seat].persona, lie, Math.random)) setTimeout(() => tell(D.characters[seat]), 380);
  }
  if (seat === 0) D.recap.pendingBluff = lie;
  ui.setClaim(`<b>${SEATS[seat].name}</b> claims ${claim.toLowerCase()} · pile of ${game.plays.reduce((n, p) => n + p.claim, 0)}`);
  ui.log(`<b>${SEATS[seat].name}</b> ${seat === 0 ? 'play' : 'plays'} ${claim.toLowerCase()}.`);
  ui.refreshSeats(game, seat);
  await step(950, token);
  if (seat !== 0 && D.recap.pendingBluff) { D.recap.bluffs++; D.recap.pendingBluff = false; }
}

async function stageChallenge(caller, forced, token) {
  const game = D.game;
  const res = R.challenge(game, caller);
  for (const m of D.memory) AI.observeReveal(m, res.accused, res.lie);
  if (res.accused === 0) D.recap.pendingBluff = false;
  if (caller === 0 && res.lie) D.recap.caught++;
  D.actor = caller;
  const accusedName = res.accused === 0 ? 'you' : SEATS[res.accused].name;
  if (caller !== 0) { react(D.characters[caller], 'lean'); ui.say(caller, forced ? 'Nobody else holds a card. Show them.' : voice(caller, 'liar')); }
  ui.toast(caller === 0 ? (forced ? 'Show me.' : 'LIAR!') : `${SEATS[caller].name}: LIAR!`, forced && caller === 0 ? 'small' : 'liar');
  audio.sting(); audio.setTension(0.5); rig.shake = Math.max(rig.shake, 0.25);
  ui.log(`<b>${SEATS[caller].name}</b> ${caller === 0 ? 'call' : 'calls'} <b>${accusedName}</b> a liar.`);
  await step(1150, token);

  D.watch = new THREE.Vector3(0, 0.25, 0.14);
  focusOn(D.watch, 0.35);
  res.cards.forEach((c, i) => toReveal(views.get(c.id), i, res.cards.length));
  audio.reveal();
  await step(1000, token);
  res.cards.forEach((c) => setGlow(views.get(c.id), 0.9, R.matchesTable(c, game.tableRank) ? 0x7fd06a : 0xff4a30));
  audio.verdict(res.lie);
  if (res.lie) ui.toast(res.accused === 0 ? 'Caught lying.' : `${SEATS[res.accused].name} was lying.`, 'small');
  else ui.toast(res.accused === 0 ? 'You told the truth.' : `${SEATS[res.accused].name} told the truth.`, 'truth');
  ui.log(res.lie ? `The cards don't match. <b>${SEATS[res.accused].name}</b> ${res.accused === 0 ? 'were' : 'was'} lying.` : `Every card matches. <b>${SEATS[caller].name}</b> ${caller === 0 ? 'were' : 'was'} wrong.`);
  if (res.accused !== 0) ui.say(res.accused, voice(res.accused, res.lie ? 'caught' : 'honest'));
  if (caller !== 0 && !res.lie) setTimeout(() => ui.say(caller, voice(caller, 'wrong')), 900);
  await step(1700, token);
  if (caller !== 0) react(D.characters[caller], 'lean', false);
  res.cards.forEach((c, i) => settleRevealed(views.get(c.id), i, res.cards.length));
  D.watch = null;
}

/* ---------- the revolver ---------- */
async function roulette(seat, token) {
  const game = D.game, human = seat === 0, p = game.players[seat];
  D.actor = seat;
  ui.refreshSeats(game, seat);
  audio.setTension(1); document.body.classList.add('tense');
  ui.toast(`${SEATS[seat].name} ${human ? 'pick' : 'picks'} up the revolver`, 'small');
  const ch = D.characters[seat];
  if (human) { gunToPlayer(); rig.rollTarget = 0.05; focusOn(null); centerLook(); }
  else { gunToCharacter(ch); D.watch = null; focusOn(headWorld(ch, _h), 0.8); rig.zoomTarget = 1.35; react(ch, 'tremble'); }
  await step(1100, token);
  spinDrum(12); audio.spin();
  await step(1000, token);
  let beating = true, rate = 1;
  const beat = () => { if (!beating || token !== D.token) return; audio.heartbeat(rate); rate = Math.min(2.2, rate + 0.15); setTimeout(beat, 900 / rate); };
  beat();
  try {
    if (human && !settings.autoplay) {
      const odds = 6 - p.pulls;
      await ui.awaitTrigger(`One chamber in ${odds === 1 ? 'one. It is loaded' : odds} is loaded. Hold to pull.`);
      if (token !== D.token) throw ABORT;
      cockHammer();
      await step(260, token);
    } else {
      cockHammer(); audio.cock();
      await step(rand(900, 1900), token);
    }
  } finally { beating = false; }

  const shot = R.pullTrigger(game, seat);
  if (!shot.fired) {
    fire(false); audio.click(); rig.shake = 0.35;
    if (!human) { react(ch, 'flinch'); react(ch, 'tremble', false); react(ch, 'relief'); setTimeout(() => ui.say(seat, voice(seat, 'click')), 500); }
    else { D.recap.survived++; setTimeout(() => audio.relief(), 350); }
    ui.toast('*click*', 'gold');
    ui.log(`<b>${SEATS[seat].name}</b> ${human ? 'pull' : 'pulls'} the trigger. Empty chamber.`);
    ui.refreshSeats(game, seat);
    await step(1500, token);
    if (!human) react(ch, 'relief', false);
  } else {
    fire(true); audio.bang(); rig.shake = 1;
    const fl = document.getElementById('flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
    ui.log(`<b>${SEATS[seat].name}</b> ${human ? 'were' : 'was'} not so lucky.`);
    ui.refreshSeats(game, seat);
    if (human) {
      ui.toast('BANG', 'liar');
      document.getElementById('blackout').classList.add('on');
      audio.setTension(0);
      await step(2400, token);
      return;
    }
    react(ch, 'tremble', false); react(ch, 'out');
    ui.toast(`${SEATS[seat].name} is out`, 'liar');
    for (const c of [...views.values()]) if (c.seat === seat) toPile(c);
    const witness = [1, 2, 3].filter((s) => s !== seat && game.players[s].alive);
    if (witness.length) setTimeout(() => ui.say(pick(witness), voice(pick(witness), 'others')), 1600);
    await step(2300, token);
  }
  audio.setTension(0); document.body.classList.remove('tense');
  gunHome(); rig.zoomTarget = 1; rig.rollTarget = 0; focusOn(null);
  D.actor = null;
  await step(700, token);
}

/* ---------- end ---------- */
function finish() {
  const game = D.game, won = game.players[0].alive;
  D.actor = null; ui.hideActions();
  const stats = ui.recordResult(won);
  won ? audio.win() : audio.lose();
  const survivors = game.players.filter((p) => p.alive && p.seat !== 0).map((p) => SEATS[p.seat].name);
  ui.showEnd({
    won, rounds: game.round, survivors,
    recap: [[D.recap.caught, 'Liars caught'], [D.recap.bluffs, 'Bluffs that passed'], [stats.streak, 'Win streak']],
  });
  ui.setInGame(false);
}

/** Where each character should look this frame. */
export function lookTargetFor(seat, camera, out) {
  if (D.watch) return out.copy(D.watch);
  const a = D.actor;
  if (a == null || a === seat) return a === seat && D.game?.phase === 'turn' ? out.set(0, 0, 0) : out.copy(camera.position);
  if (a === 0) return out.copy(camera.position);
  return headWorld(D.characters[a], out);
}
