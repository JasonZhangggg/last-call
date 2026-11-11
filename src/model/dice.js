// Pure model for the Dice mode: dice under cups, bids, 1s wild, and the poison tray. Same shape
// as rules.js (plain data in, plain data out) so it simulates and tests headlessly.
import { randInt, nextAliveSeat, aliveAfter } from './rules.js';

export const VARIANTS = ['basic', 'traditional'];
export const DICE_PER_SEAT = 5;
export const FACES = 6;
export const WILD = 1;
export const BID_FACES = [2, 3, 4, 5, 6];
export const GLASSES = 6;

/**
 * Phases mirror the deck model:
 *   'between'  no round in progress
 *   'turn'     game.turn bids or calls
 *   'drink'    game.pending.seat drinks the next glass; pending.queue drinks after it, in order
 *   'over'     one seat left alive
 * pending.startFrom: once the queue is spent, the next round opens at the first living seat at
 * or after this one.
 */
export function newGame({ seats = 4, rng = Math.random, variant = 'basic' } = {}) {
  if (!VARIANTS.includes(variant)) throw new Error(`unknown variant ${variant}`);
  return {
    variant,
    players: Array.from({ length: seats }, (_, seat) => ({ seat, alive: true, dice: [], drinks: 0, poison: randInt(rng, 0, GLASSES - 1) })),
    round: 0,
    bids: [],
    turn: null,
    phase: 'between',
    pending: null,
    starter: randInt(rng, 0, seats - 1),
  };
}

export const alive = (game) => game.players.filter((p) => p.alive);
export const lastBid = (game) => game.bids[game.bids.length - 1] || null;
export const totalDice = (game) => game.players.reduce((n, p) => n + p.dice.length, 0);
export const countFace = (game, face) => game.players.reduce((n, p) => n + p.dice.filter((d) => d === face || d === WILD).length, 0);
export const beats = (bid, last) => !last || bid.quantity > last.quantity || (bid.quantity === last.quantity && bid.face > last.face);
const firstAliveFrom = (game, seat) => (game.players[seat].alive ? seat : nextAliveSeat(game, seat));

export function startRound(game, rng = Math.random) {
  if (game.phase !== 'between') throw new Error(`startRound in phase ${game.phase}`);
  for (const p of game.players) p.dice = p.alive ? Array.from({ length: DICE_PER_SEAT }, () => randInt(rng, 1, FACES)) : [];
  game.round += 1;
  game.bids = [];
  game.turn = game.starter;
  game.phase = 'turn';
  return { round: game.round, starter: game.starter, dice: game.players.map((p) => p.dice.slice()) };
}

/** For each bid face, the smallest quantity that raises the last bid, if the table holds it. */
function raises(game) {
  const last = lastBid(game), max = totalDice(game), out = [];
  for (const face of BID_FACES) {
    const minQuantity = !last ? 1 : face > last.face ? last.quantity : last.quantity + 1;
    if (minQuantity <= max) out.push({ face, minQuantity });
  }
  return out;
}

export function turnOptions(game) {
  if (game.phase !== 'turn') return null;
  const seat = game.turn, last = lastBid(game), r = raises(game);
  const canCall = !!last && last.seat !== seat;
  return {
    seat,
    canBid: r.length > 0,
    canChallenge: canCall,
    canSpotOn: canCall && game.variant === 'traditional',
    mustChallenge: r.length === 0,
    maxQuantity: totalDice(game),
    raises: r,
  };
}

function actingOptions(game, seat) {
  const o = turnOptions(game);
  if (!o || o.seat !== seat) throw new Error('not your turn');
  return o;
}

export function bid(game, seat, quantity, face) {
  const o = actingOptions(game, seat);
  if (!BID_FACES.includes(face)) throw new Error('bid face must be 2 to 6');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > o.maxQuantity) throw new Error(`bid quantity must be 1..${o.maxQuantity}`);
  const b = { seat, quantity, face };
  if (!beats(b, lastBid(game))) throw new Error('a bid must raise the last one');
  game.bids.push(b);
  game.turn = nextAliveSeat(game, seat);
  return b;
}

function reveal(game, seat, call, drinkers, startFrom, count) {
  const last = lastBid(game);
  const res = {
    caller: seat, bidder: last.seat, call, quantity: last.quantity, face: last.face,
    cups: game.players.map((p) => p.dice.slice()), count, callerRight: drinkers[0] !== seat, drinkers,
  };
  game.phase = 'drink';
  game.pending = { seat: drinkers[0], queue: drinkers.slice(1), startFrom };
  game.turn = null;
  return res;
}

/** Liar: the bid stands when the face plus the 1s reach the quantity. */
export function challenge(game, seat) {
  if (!actingOptions(game, seat).canChallenge) throw new Error('nothing to call');
  const last = lastBid(game), count = countFace(game, last.face);
  const loser = count >= last.quantity ? seat : last.seat;
  return reveal(game, seat, 'liar', [loser], loser, count);
}

/** Spot on (traditional): exactly right and everyone else drinks, otherwise the caller does. */
export function spotOn(game, seat) {
  const o = actingOptions(game, seat);
  if (!lastBid(game)) throw new Error('nothing to call');
  if (!o.canSpotOn) throw new Error('spot on is only in the traditional variant');
  const last = lastBid(game), count = countFace(game, last.face);
  if (count === last.quantity) return reveal(game, seat, 'spotOn', aliveAfter(game, seat), (seat + 1) % game.players.length, count);
  return reveal(game, seat, 'spotOn', [seat], seat, count);
}

export function drink(game, seat) {
  if (game.phase !== 'drink' || game.pending.seat !== seat) throw new Error('not your glass');
  const p = game.players[seat];
  const odds = 1 / (GLASSES - p.drinks);
  const poisoned = p.drinks === p.poison;
  p.drinks += 1;
  if (poisoned) { p.alive = false; p.dice = []; }
  const { queue, startFrom } = game.pending;
  if (alive(game).length <= 1) {
    game.pending = null;
    game.phase = 'over';
  } else if (queue.length) {
    game.pending = { seat: queue[0], queue: queue.slice(1), startFrom };
  } else {
    game.pending = null;
    game.starter = firstAliveFrom(game, startFrom);
    game.phase = 'between';
  }
  return { seat, poisoned, drinks: p.drinks, odds };
}

export const winner = (game) => (game.phase === 'over' ? alive(game)[0]?.seat ?? null : null);

/** Everything a seat may know: its own dice, the bids, and who is left. */
export function publicView(game, seat) {
  return {
    seat,
    variant: game.variant,
    round: game.round,
    dice: game.players[seat].dice.slice(),
    players: game.players.map((p) => ({ seat: p.seat, alive: p.alive, diceCount: p.dice.length, drinks: p.drinks })),
    bids: game.bids.map((b) => ({ ...b })),
    options: game.turn === seat ? turnOptions(game) : null,
  };
}
