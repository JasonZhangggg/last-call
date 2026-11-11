// Pure game model for Last Call. No rendering, no timers: every function takes the game
// and returns plain data, so the rules can be simulated and tested headlessly.

export const JOKER = 'joker';
export const DEVIL = 'devil';
export const TABLE_RANKS = ['king', 'queen', 'ace'];
export const RANKS = [...TABLE_RANKS, JOKER, DEVIL];
export const VARIANTS = ['basic', 'devil'];
export const DECK_COUNTS = { king: 6, queen: 6, ace: 6, joker: 2 };
const VARIANT_COUNTS = { basic: DECK_COUNTS, devil: { ...DECK_COUNTS, devil: 1 } };
export const HAND_SIZE = 5;
export const CHAMBERS = 6;
export const MAX_PLAY = 3;
export const TRUE_CARDS_PER_RANK = DECK_COUNTS.king + DECK_COUNTS.joker;
/** With this many seats alive, a revealed Devil makes everyone but the accused shoot. */
export const DEVIL_VOLLEY_MIN_ALIVE = 3;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
export function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

export function createDeck(variant = 'basic') {
  const counts = VARIANT_COUNTS[variant];
  if (!counts) throw new Error(`unknown variant ${variant}`);
  const deck = [];
  for (const [rank, n] of Object.entries(counts)) for (let i = 0; i < n; i++) deck.push({ id: deck.length, rank });
  return deck;
}

export const matchesTable = (card, tableRank) => card.rank === tableRank || card.rank === JOKER;

/**
 * Game phases:
 *   'between'  no round in progress (start, or after a roulette resolved)
 *   'turn'     game.turn is the seat to act
 *   'roulette' game.pending.seat must pull the trigger; pending.queue shoots after it, in order
 *   'over'     one seat left alive
 *
 * pending.startFrom: once the queue is spent, the next round opens at the first living seat at or
 * after this one. A lone shooter passes its own seat (it starts again if it lived); a Devil
 * volley passes the seat after the accused.
 */
export function newGame({ seats = 4, rng = Math.random, variant = 'basic' } = {}) {
  return {
    variant,
    deck: createDeck(variant),
    players: Array.from({ length: seats }, (_, seat) => ({ seat, alive: true, hand: [], pulls: 0, bullet: randInt(rng, 0, CHAMBERS - 1) })),
    round: 0,
    tableRank: null,
    plays: [],
    turn: null,
    phase: 'between',
    pending: null,
    starter: randInt(rng, 0, seats - 1),
  };
}

export const alive = (game) => game.players.filter((p) => p.alive);
export const lastPlay = (game) => game.plays[game.plays.length - 1] || null;

export function nextAliveSeat(game, seat) {
  const n = game.players.length;
  for (let k = 1; k <= n; k++) { const s = (seat + k) % n; if (game.players[s].alive) return s; }
  return seat;
}

/** Living seats in seat order, starting after `seat` and leaving it out. */
export function aliveAfter(game, seat) {
  const n = game.players.length, out = [];
  for (let k = 1; k < n; k++) { const s = (seat + k) % n; if (game.players[s].alive) out.push(s); }
  return out;
}

const firstAliveFrom = (game, seat) => (game.players[seat].alive ? seat : nextAliveSeat(game, seat));

function nextSeatToAct(game, from) {
  const n = game.players.length;
  for (let k = 1; k <= n; k++) {
    const s = (from + k) % n, p = game.players[s];
    if (p.alive && p.hand.length > 0) return s;
  }
  return null;
}

/** Deals a new round. Returns the deal so a presenter can animate it. */
export function startRound(game, rng = Math.random) {
  if (game.phase !== 'between') throw new Error(`startRound in phase ${game.phase}`);
  const order = shuffleInPlace(game.deck.slice(), rng);
  for (const p of game.players) p.hand = [];
  const seats = [];
  for (let k = 0; k < game.players.length; k++) { const s = (game.starter + k) % game.players.length; if (game.players[s].alive) seats.push(s); }
  let i = 0;
  const deal = [];
  for (let r = 0; r < HAND_SIZE; r++) for (const s of seats) { const c = order[i++]; game.players[s].hand.push(c); deal.push({ seat: s, card: c }); }
  game.round += 1;
  game.tableRank = TABLE_RANKS[Math.floor(rng() * TABLE_RANKS.length)];
  game.plays = [];
  game.turn = game.starter;
  game.phase = 'turn';
  return { deal, unused: order.slice(i), tableRank: game.tableRank, starter: game.starter };
}

/** What the seat to act may do. */
export function turnOptions(game) {
  if (game.phase !== 'turn') return null;
  const seat = game.turn, me = game.players[seat], lp = lastPlay(game);
  const othersHold = game.players.some((p) => p.seat !== seat && p.alive && p.hand.length > 0);
  const mustChallenge = !!lp && !othersHold;
  return {
    seat,
    canPlay: !mustChallenge && me.hand.length > 0,
    canChallenge: !!lp && lp.seat !== seat,
    mustChallenge,
    maxCards: Math.min(MAX_PLAY, me.hand.length),
  };
}

export function play(game, seat, cardIds) {
  const opt = turnOptions(game);
  if (!opt || opt.seat !== seat) throw new Error('not your turn');
  if (!opt.canPlay) throw new Error('cannot play now');
  const ids = [...new Set(cardIds)];
  if (ids.length < 1 || ids.length > opt.maxCards) throw new Error(`must play 1..${opt.maxCards} cards`);
  const me = game.players[seat];
  const cards = ids.map((id) => me.hand.find((c) => c.id === id));
  if (cards.some((c) => !c)) throw new Error('card not in hand');
  if (cards.length > 1 && cards.some((c) => c.rank === DEVIL)) throw new Error('the Devil is played alone');
  me.hand = me.hand.filter((c) => !ids.includes(c.id));
  const p = { seat, cards, claim: cards.length };
  game.plays.push(p);
  const next = nextSeatToAct(game, seat);
  // nobody else holds cards: the next living seat must call this play
  game.turn = next === null || next === seat ? nextAliveSeat(game, seat) : next;
  return p;
}

export function challenge(game, seat) {
  const opt = turnOptions(game);
  if (!opt || opt.seat !== seat) throw new Error('not your turn');
  if (!opt.canChallenge) throw new Error('nothing to challenge');
  const lp = lastPlay(game), accused = lp.seat;
  const lie = lp.cards.some((c) => !matchesTable(c, game.tableRank));
  const volley = lp.cards.some((c) => c.rank === DEVIL) && alive(game).length >= DEVIL_VOLLEY_MIN_ALIVE;
  const shooters = volley ? aliveAfter(game, accused) : [lie ? accused : seat];
  const startFrom = volley ? (accused + 1) % game.players.length : shooters[0];
  game.phase = 'roulette';
  game.pending = { seat: shooters[0], queue: shooters.slice(1), startFrom };
  game.turn = null;
  return { caller: seat, accused, cards: lp.cards, lie, shooters };
}

export function pullTrigger(game, seat) {
  if (game.phase !== 'roulette' || game.pending.seat !== seat) throw new Error('not your trigger');
  const p = game.players[seat];
  const fired = p.pulls === p.bullet;
  p.pulls += 1;
  if (fired) { p.alive = false; p.hand = []; }
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
  return { seat, fired, pulls: p.pulls, oddsBefore: 1 / (CHAMBERS - p.pulls + 1), next: game.pending?.seat ?? null };
}

export const winner = (game) => (game.phase === 'over' ? alive(game)[0]?.seat ?? null : null);

/** Everything a seat is allowed to know. AI decisions read only this. */
export function publicView(game, seat) {
  return {
    seat,
    variant: game.variant,
    tableRank: game.tableRank,
    round: game.round,
    hand: game.players[seat].hand.map((c) => ({ ...c })),
    players: game.players.map((p) => ({ seat: p.seat, alive: p.alive, handCount: p.hand.length, pulls: p.pulls })),
    plays: game.plays.map((pl) => ({ seat: pl.seat, claim: pl.claim, own: pl.seat === seat ? pl.cards.map((c) => ({ ...c })) : null })),
    options: game.turn === seat ? turnOptions(game) : null,
  };
}
