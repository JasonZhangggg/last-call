// Pure model for The Gilded Bid: hidden money hands, a face-down status deck, open bids. Same
// shape as rules.js and dice.js (plain data in, plain data out) so it simulates headlessly.
import { randInt, shuffleInPlace } from './rules.js';

export const VARIANTS = ['classic'];
export const MIN_SEATS = 3;
export const MAX_SEATS = 5;
export const MONEY = Object.freeze([1, 2, 3, 4, 6, 8, 10, 12, 15, 20, 25]);
export const CURIOS = 10;
export const GILDED_TO_END = 4;
export const DEBT_PENALTY = 5;

/** Every kind of status card: whether its border is gilded, and whether it is a disgrace. */
export const KINDS = Object.freeze({
  curio: { gilded: false, disgrace: false, count: CURIOS },
  favour: { gilded: true, disgrace: false, count: 3 },
  ale: { gilded: false, disgrace: true, count: 1 },
  debt: { gilded: false, disgrace: true, count: 1 },
  scandal: { gilded: true, disgrace: true, count: 1 },
});

export const isGilded = (c) => KINDS[c.kind].gilded;
export const isDisgrace = (c) => KINDS[c.kind].disgrace;
export const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const asc = (xs) => xs.slice().sort((a, b) => a - b);

/** The 16 status cards, unshuffled. A curio carries its value; every other card has value null. */
export function statusDeck() {
  const deck = [];
  for (const [kind, k] of Object.entries(KINDS)) {
    for (let i = 1; i <= k.count; i++) deck.push({ kind, value: kind === 'curio' ? i : null });
  }
  return deck;
}

/**
 * Phases:
 *   'reveal'   the top status card is turned over next
 *   'bidding'  game.turn raises or passes on game.card
 *   'settle'   the auction is decided: game.taker takes game.card, every bid still out is spent
 *   'scoring'  the 4th gilded card (game.final) is up; the purses are counted next
 *   'over'     game.result holds the scores
 * A player's bid is the money in front of them this auction; spent money is gone for good.
 */
export function newGame({ seats = 4, rng = Math.random, variant = 'classic' } = {}) {
  if (!VARIANTS.includes(variant)) throw new Error(`unknown variant ${variant}`);
  if (!Number.isInteger(seats) || seats < MIN_SEATS || seats > MAX_SEATS) throw new Error(`the auction needs ${MIN_SEATS} to ${MAX_SEATS} seats`);
  return {
    variant,
    phase: 'reveal',
    deck: shuffleInPlace(statusDeck(), rng),
    turned: [],
    auction: 0,
    card: null,
    final: null,
    starter: randInt(rng, 0, seats - 1),
    turn: null,
    taker: null,
    players: Array.from({ length: seats }, (_, seat) => ({
      seat, hand: MONEY.slice(), bid: [], passed: false, won: [], spent: [], spilled: [], aleOwed: false,
    })),
    result: null,
  };
}

const gildedTurned = (game) => game.turned.filter(isGilded).length;
export const highBid = (game) => Math.max(0, ...game.players.map((p) => sum(p.bid)));
const money = (p) => sum(p.hand);

function expect(game, phase) {
  if (game.phase !== phase) throw new Error(`not allowed in phase ${game.phase}`);
}

export function reveal(game) {
  expect(game, 'reveal');
  const card = game.deck.shift();
  game.turned.push(card);
  const final = gildedTurned(game) === GILDED_TO_END;
  if (final) {
    game.final = card;
    game.phase = 'scoring';
  } else {
    game.auction += 1;
    game.card = card;
    game.turn = game.starter;
    game.phase = 'bidding';
  }
  return { auction: game.auction, card: { ...card }, starter: game.starter, final, deckCount: game.deck.length };
}

export function turnOptions(game) {
  if (game.phase !== 'bidding') return null;
  const p = game.players[game.turn], ownBid = sum(p.bid), high = highBid(game);
  return { seat: game.turn, disgrace: isDisgrace(game.card), highBid: high, ownBid, canRaise: ownBid + money(p) > high };
}

function acting(game, seat) {
  const o = turnOptions(game);
  if (!o || o.seat !== seat) throw new Error('not your turn');
  return o;
}

function nextBidder(game, seat) {
  const n = game.players.length;
  for (let k = 1; k < n; k++) { const s = (seat + k) % n; if (!game.players[s].passed) return s; }
  return seat;
}

/** Adds money cards from the hand to the seat's bid. The new total must beat the highest bid. */
export function raise(game, seat, values) {
  const o = acting(game, seat);
  if (!Array.isArray(values) || values.length === 0) throw new Error('raise with at least one money card');
  const p = game.players[seat], left = p.hand.slice();
  for (const v of values) {
    const i = left.indexOf(v);
    if (i < 0) throw new Error(`money card ${v} is not in your hand`);
    left.splice(i, 1);
  }
  const bid = o.ownBid + sum(values);
  if (bid <= o.highBid) throw new Error(`a raise must beat the highest bid of ${o.highBid}`);
  p.hand = left;
  p.bid.push(...values);
  game.turn = nextBidder(game, seat);
  return { seat, cards: values.slice(), bid };
}

/** Takes the seat's bid back. A disgrace goes to the first seat to pass; anything else to the last one left. */
export function pass(game, seat) {
  const o = acting(game, seat);
  const p = game.players[seat], returned = p.bid;
  p.hand = asc(p.hand.concat(returned));
  p.bid = [];
  p.passed = true;
  const left = game.players.filter((x) => !x.passed);
  const taker = o.disgrace ? seat : left.length === 1 ? left[0].seat : null;
  if (taker == null) {
    game.turn = nextBidder(game, seat);
  } else {
    game.taker = taker;
    game.turn = null;
    game.phase = 'settle';
  }
  return { seat, returned };
}

function spill(p, curio) {
  p.won.splice(p.won.indexOf(curio), 1);
  p.spilled.push(curio.value);
  return curio.value;
}

/** The taker takes the card; every bid still on the table is spent. Spilled Ale costs the lowest curio. */
export function settle(game) {
  expect(game, 'settle');
  const t = game.players[game.taker], card = game.card;
  const paid = game.players.map((p) => {
    const b = p.bid;
    p.spent.push(...b);
    p.bid = [];
    p.passed = false;
    return b;
  });
  t.won.push(card);
  let spilled = null;
  if (card.kind === 'ale') {
    const curios = t.won.filter((c) => c.kind === 'curio');
    if (curios.length) spilled = spill(t, curios.reduce((a, b) => (b.value < a.value ? b : a)));
    else t.aleOwed = true;
  } else if (card.kind === 'curio' && t.aleOwed) {
    spilled = spill(t, card);
    t.aleOwed = false;
  }
  const seat = game.taker;
  game.starter = seat;
  game.taker = null;
  game.card = null;
  game.phase = 'reveal';
  return { seat, card: { ...card }, paid, spilled, aleOwed: t.aleOwed };
}

/** Curios, minus 5 for Bad Debt, doubled per favour, halved for the scandal. Halves are exact in floats. */
export function statusOf({ won }) {
  let s = sum(won.filter((c) => c.kind === 'curio').map((c) => c.value));
  if (won.some((c) => c.kind === 'debt')) s -= DEBT_PENALTY;
  s *= 2 ** won.filter((c) => c.kind === 'favour').length;
  if (won.some((c) => c.kind === 'scandal')) s /= 2;
  return s;
}

const topCurio = ({ won }) => Math.max(0, ...won.filter((c) => c.kind === 'curio').map((c) => c.value));

/**
 * Casts out every seat tied for the least money, then ranks the rest by status, money, and
 * highest curio. Seats equal on all three share a place; winner is the sole first place or null.
 */
export function score(game) {
  expect(game, 'scoring');
  const cash = game.players.map(money);
  const least = Math.min(...cash);
  const castOut = cash.map((m) => m === least);
  const status = game.players.map(statusOf);
  const top = game.players.map(topCurio);
  const key = (s) => [status[s], cash[s], top[s]];
  const beats = (a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] > kb[i];
    return false;
  };
  const contenders = game.players.map((p) => p.seat).filter((s) => !castOut[s]);
  const place = game.players.map((p) => (castOut[p.seat] ? null : 1 + contenders.filter((o) => beats(o, p.seat)).length));
  const first = contenders.filter((s) => place[s] === 1);
  game.result = {
    remaining: game.players.map((p) => p.hand.slice()),
    money: cash, castOut, status, topCurio: top, place,
    winner: first.length === 1 ? first[0] : null,
  };
  game.phase = 'over';
  return structuredClone(game.result);
}

export const winner = (game) => (game.phase === 'over' ? game.result.winner : null);

/** Everything a seat may know: its own hand, and everything face up on the table. */
export function publicView(game, seat) {
  return {
    seat,
    variant: game.variant,
    phase: game.phase,
    auction: game.auction,
    card: game.card && { ...game.card },
    starter: game.starter,
    turn: game.turn,
    deckCount: game.deck.length,
    turned: game.turned.map((c) => ({ ...c })),
    hand: game.players[seat].hand.slice(),
    players: game.players.map((p) => ({
      seat: p.seat, handCount: p.hand.length, bid: p.bid.slice(), passed: p.passed,
      won: p.won.map((c) => ({ ...c })), spent: p.spent.slice(), aleOwed: p.aleOwed,
    })),
    options: game.turn === seat ? turnOptions(game) : null,
  };
}
