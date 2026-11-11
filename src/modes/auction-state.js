// The client's mirror of an auction table: the shape of the engine's `state.game` snapshot
// (src/net/engine-auction.js), advanced one message at a time. Pure, so it runs in node tests.

const asc = (xs) => xs.slice().sort((a, b) => a - b);
export const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/** Applies one server message to a snapshot-shaped game. Returns the game (mutated in place). */
export function reduceAuction(game, msg, me) {
  switch (msg.type) {
    case 'reveal':
      game.turned.push({ ...msg.card });
      game.deckCount = msg.deckCount;
      game.starter = msg.starter;
      if (msg.final) game.final = { ...msg.card };
      else { game.auction = msg.auction; game.card = { ...msg.card }; }
      break;
    case 'raise':
      game.bids[msg.seat].push(...msg.cards);
      game.handCounts = msg.handCounts.slice();
      if (msg.seat === me) {
        const left = game.hand.slice();
        for (const v of msg.cards) left.splice(left.indexOf(v), 1);
        game.hand = left;
      }
      break;
    case 'pass':
      game.bids[msg.seat] = [];
      game.passed[msg.seat] = true;
      game.handCounts = msg.handCounts.slice();
      if (msg.seat === me) game.hand = asc(game.hand.concat(msg.returned));
      break;
    case 'taken': {
      msg.paid.forEach((b, s) => { game.spent[s].push(...b); game.bids[s] = []; game.passed[s] = false; });
      const won = game.won[msg.seat];
      won.push({ ...msg.card });
      if (msg.spilled != null) {
        won.splice(won.findIndex((c) => c.kind === 'curio' && c.value === msg.spilled), 1);
        game.spilled[msg.seat].push(msg.spilled);
      }
      game.aleOwed[msg.seat] = msg.aleOwed;
      game.handCounts = msg.handCounts.slice();
      game.starter = msg.seat;
      game.card = null;
      break;
    }
    case 'scoring': {
      const { type: _t, ...result } = msg;
      game.scoring = structuredClone(result);
      break;
    }
  }
  return game;
}

/* ---------- reads over the mirror ---------- */
export const bidOf = (game, seat) => sum(game.bids[seat]);
export const highBid = (game) => Math.max(0, ...game.bids.map(sum));
/** The seat holding the highest bid this auction, or null before anyone bids. */
export function leader(game) {
  let best = null, top = 0;
  game.bids.forEach((b, s) => { const v = sum(b); if (v > top) { top = v; best = s; } });
  return best;
}
export const gildedCount = (game) => game.turned.filter((c) => c.kind === 'favour' || c.kind === 'scandal').length;
export const isDisgrace = (card) => card.kind === 'ale' || card.kind === 'debt' || card.kind === 'scandal';

/**
 * The fewest, then smallest, money cards from `hand` that lift `own` above `high`, or null.
 * Hands are at most 11 cards, so every subset (2048) is cheap to try.
 */
export function cheapestRaise(hand, own, high) {
  let best = null, bestSum = Infinity, bestN = Infinity;
  const n = hand.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    let s = 0, k = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) { s += hand[i]; k++; }
    if (own + s <= high) continue;
    if (s < bestSum || (s === bestSum && k < bestN)) { best = mask; bestSum = s; bestN = k; }
  }
  if (best == null) return null;
  return hand.filter((_, i) => best & (1 << i));
}
