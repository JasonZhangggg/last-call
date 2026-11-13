import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../src/model/auction.js';
import * as AI from '../src/model/auction-ai.js';
import { mulberry32 } from '../src/model/rules.js';

const C = (value) => ({ kind: 'curio', value });
const FAV = { kind: 'favour', value: null };
const ALE = { kind: 'ale', value: null };
const DEBT = { kind: 'debt', value: null };
const SCAN = { kind: 'scandal', value: null };
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/** A game whose face-down deck is exactly `cards`, top first, and whose first auction `starter` opens. */
function stacked(cards, { seats = 4, starter = 0 } = {}) {
  const g = A.newGame({ seats, rng: mulberry32(1) });
  g.deck = cards.map((c) => ({ ...c }));
  g.starter = starter;
  return g;
}

/** Plays one auction from its reveal: `script` is a list of [seat, values] raises and [seat] passes. */
function auction(g, script) {
  const rev = A.reveal(g);
  for (const [seat, values] of script) {
    if (values) A.raise(g, seat, values);
    else A.pass(g, seat);
  }
  return { rev, taken: A.settle(g) };
}

test('every seat starts with the same eleven money cards, 106 crowns', () => {
  const g = A.newGame({ seats: 4, rng: mulberry32(3) });
  for (const p of g.players) assert.deepEqual(p.hand, [1, 2, 3, 4, 6, 8, 10, 12, 15, 20, 25]);
  assert.equal(sum(A.MONEY), 106);
});

test('the status deck: curios 1 to 10, three favours, Spilled Ale, Bad Debt and Public Scandal', () => {
  const g = A.newGame({ seats: 4, rng: mulberry32(5) });
  assert.equal(g.deck.length, 16);
  const key = (c) => `${c.kind}:${c.value}`;
  const expected = [...Array.from({ length: 10 }, (_, i) => C(i + 1)), FAV, FAV, FAV, ALE, DEBT, SCAN].map(key).sort();
  assert.deepEqual(g.deck.map(key).sort(), expected);
  assert.equal(g.deck.filter(A.isGilded).length, 4, 'favours and the scandal are gilded');
  assert.deepEqual(g.deck.filter(A.isDisgrace).map((c) => c.kind).sort(), ['ale', 'debt', 'scandal']);
});

test('the deck is shuffled, and the first auction opens at a random seat', () => {
  const orders = new Set(), starters = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const g = A.newGame({ seats: 4, rng: mulberry32(seed) });
    orders.add(g.deck.map((c) => `${c.kind}${c.value}`).join());
    starters.add(g.starter);
  }
  assert.equal(orders.size, 40);
  assert.deepEqual([...starters].sort(), [0, 1, 2, 3]);
});

test('3 to 5 seats', () => {
  for (const seats of [3, 4, 5]) assert.equal(A.newGame({ seats, rng: mulberry32(1) }).players.length, seats);
  for (const seats of [2, 6]) assert.throws(() => A.newGame({ seats, rng: mulberry32(1) }));
});

test('a reveal turns the top card and opens bidding at the starter', () => {
  const g = stacked([C(7), FAV, FAV, FAV, SCAN], { starter: 2 });
  const rev = A.reveal(g);
  assert.deepEqual(rev, { auction: 1, card: C(7), starter: 2, final: false, deckCount: 4 });
  assert.equal(g.phase, 'bidding');
  assert.deepEqual(A.turnOptions(g), { seat: 2, disgrace: false, highBid: 0, ownBid: 0, canRaise: true });
});

test('bidding goes left; a raise adds cards and must beat the highest bid', () => {
  const g = stacked([C(7), FAV, FAV, FAV, SCAN], { starter: 3 });
  A.reveal(g);
  assert.deepEqual(A.raise(g, 3, [2]), { seat: 3, cards: [2], bid: 2 });
  assert.equal(A.turnOptions(g).seat, 0, 'seat 3 passes the bidding to seat 0');
  assert.throws(() => A.raise(g, 0, [1]), /beat/);
  assert.throws(() => A.raise(g, 0, [2]), /beat/, 'a tie does not beat');
  A.raise(g, 0, [1, 2]);
  A.raise(g, 1, [4]);
  A.raise(g, 2, [6]);
  assert.deepEqual(A.raise(g, 3, [3, 4]), { seat: 3, cards: [3, 4], bid: 9 }, 'a raise adds to the cards already out');
  assert.deepEqual(g.players[3].bid, [2, 3, 4]);
  assert.deepEqual(g.players[3].hand, [1, 6, 8, 10, 12, 15, 20, 25]);
});

test('a raise is refused, changing nothing, for cards not in hand, an empty raise, or out of turn', () => {
  const g = stacked([C(7), FAV, FAV, FAV, SCAN], { starter: 0 });
  A.reveal(g);
  A.raise(g, 0, [3]);
  const before = JSON.stringify(g);
  for (const bad of [[5], [3, 3], [], [4, 4], [30], ['4'], [4.5]]) assert.throws(() => A.raise(g, 1, bad));
  assert.throws(() => A.raise(g, 2, [10]), /turn/);
  assert.throws(() => A.pass(g, 3), /turn/);
  assert.throws(() => A.settle(g), /phase/);
  assert.throws(() => A.reveal(g), /phase/);
  assert.equal(JSON.stringify(g), before);
  A.raise(g, 1, [4]);
  A.pass(g, 2);
  A.pass(g, 3);
  assert.throws(() => A.raise(g, 0, [3]), /hand/, 'cards already bid are no longer in hand');
});

test('normal auction: passing takes your bid back; the last bidder pays everything bid and takes the card', () => {
  const g = stacked([C(9), C(1), FAV, FAV, FAV, SCAN], { starter: 1 });
  A.reveal(g);
  A.raise(g, 1, [2]);
  A.raise(g, 2, [3]);
  A.raise(g, 3, [4]);
  assert.deepEqual(A.pass(g, 0), { seat: 0, returned: [] });
  A.raise(g, 1, [6]);
  assert.deepEqual(A.pass(g, 2), { seat: 2, returned: [3] });
  assert.deepEqual(g.players[2].hand, A.MONEY, 'the returned card is back in hand');
  assert.equal(A.turnOptions(g).seat, 3, 'passed seats are skipped');
  A.raise(g, 3, [8]);
  assert.equal(A.turnOptions(g).seat, 1, 'seat 0 and 2 are out, so seat 1 is next');
  A.pass(g, 1);
  assert.equal(g.phase, 'settle');
  const t = A.settle(g);
  assert.deepEqual(t, { seat: 3, card: C(9), paid: [[], [], [], [4, 8]], spilled: null, aleOwed: false });
  assert.deepEqual(g.players[3].hand, [1, 2, 3, 6, 10, 12, 15, 20, 25]);
  assert.deepEqual(g.players[3].spent, [4, 8], 'money spent leaves the game');
  assert.deepEqual(g.players[1].hand, A.MONEY);
  assert.deepEqual(g.players[3].won, [C(9)]);
});

test('next starter: the seat that took the last card starts the next auction', () => {
  const g = stacked([C(9), C(1), FAV, FAV, FAV, SCAN], { starter: 1 });
  auction(g, [[1, [2]], [2], [3], [0]]);
  assert.equal(g.phase, 'reveal');
  assert.equal(A.reveal(g).starter, 1);
  A.raise(g, 1, [1]);
  A.raise(g, 2, [2]);
  A.pass(g, 3);
  A.pass(g, 0);
  A.pass(g, 1);
  A.settle(g);
  assert.equal(A.reveal(g).starter, 2);
});

test('if everyone else passes before anyone bids, the remaining seat takes the card for free', () => {
  const g = stacked([C(10), FAV, FAV, FAV, SCAN], { starter: 2 });
  const { taken } = auction(g, [[2], [3], [0]]);
  assert.deepEqual(taken, { seat: 1, card: C(10), paid: [[], [], [], []], spilled: null, aleOwed: false });
  assert.deepEqual(g.players[1].hand, A.MONEY);
});

test('a seat that cannot beat the high bid can only pass', () => {
  const g = stacked([C(10), FAV, FAV, FAV, SCAN], { starter: 0 });
  g.players[1].hand = [1, 2];
  A.reveal(g);
  A.raise(g, 0, [4]);
  assert.equal(A.turnOptions(g).canRaise, false);
  assert.throws(() => A.raise(g, 1, [1, 2]), /beat/);
  assert.deepEqual(A.pass(g, 1), { seat: 1, returned: [] });
});

test('disgrace auction: the first pass ends it; the passer takes the disgrace and its bid back, the rest pay', () => {
  const g = stacked([DEBT, FAV, FAV, FAV, SCAN], { starter: 0 });
  const rev = A.reveal(g);
  assert.equal(A.turnOptions(g).disgrace, true);
  assert.equal(rev.card.kind, 'debt');
  A.raise(g, 0, [1]);
  A.raise(g, 1, [2]);
  A.raise(g, 2, [3]);
  A.raise(g, 3, [4]);
  A.raise(g, 0, [6]);
  assert.deepEqual(A.pass(g, 1), { seat: 1, returned: [2] });
  assert.equal(g.phase, 'settle', 'one pass ends a disgrace auction');
  const t = A.settle(g);
  assert.deepEqual(t, { seat: 1, card: DEBT, paid: [[1, 6], [], [3], [4]], spilled: null, aleOwed: false });
  assert.deepEqual(g.players[1].hand, A.MONEY);
  assert.deepEqual(g.players[0].spent, [1, 6]);
  assert.deepEqual(g.players[1].won, [DEBT]);
  assert.equal(A.reveal(g).starter, 1, 'the seat that took the disgrace starts next');
});

test('disgrace auction: the starter passing first takes the disgrace and nobody pays', () => {
  const g = stacked([SCAN, FAV, FAV, FAV, C(3)], { starter: 3 });
  const { taken } = auction(g, [[3]]);
  assert.deepEqual(taken, { seat: 3, card: SCAN, paid: [[], [], [], []], spilled: null, aleOwed: false });
});

test('Spilled Ale discards one of your curios: the lowest, which never costs you status or a tie-break', () => {
  const g = stacked([C(4), C(8), ALE, FAV, FAV, FAV, SCAN], { starter: 0 });
  auction(g, [[0, [1]], [1], [2], [3]]);
  auction(g, [[0, [2]], [1], [2], [3]]);
  const { taken } = auction(g, [[0]]);
  assert.deepEqual(taken, { seat: 0, card: ALE, paid: [[], [], [], []], spilled: 4, aleOwed: false });
  assert.deepEqual(g.players[0].won, [C(8), ALE]);
  assert.deepEqual(g.players[0].spilled, [4]);
});

test('Spilled Ale with no curios carries over: the next curio you win is discarded', () => {
  const g = stacked([ALE, FAV, C(9), C(2), FAV, FAV, SCAN], { starter: 1 });
  let r = auction(g, [[1]]);
  assert.deepEqual([r.taken.seat, r.taken.spilled, r.taken.aleOwed], [1, null, true]);
  r = auction(g, [[1, [1]], [2], [3], [0]]);
  assert.equal(r.taken.card.kind, 'favour');
  assert.equal(r.taken.aleOwed, true, 'a favour does not clear the owed ale');
  r = auction(g, [[1, [2]], [2], [3], [0]]);
  assert.deepEqual([r.taken.card, r.taken.spilled, r.taken.aleOwed], [C(9), 9, false]);
  assert.deepEqual(g.players[1].won, [ALE, FAV]);
  r = auction(g, [[1, [3]], [2], [3], [0]]);
  assert.deepEqual([r.taken.spilled, g.players[1].won.at(-1)], [null, C(2)], 'only the next curio spills');
});

test('the 4th gilded card ends the game at once and is never auctioned', () => {
  const g = stacked([FAV, C(5), SCAN, FAV, C(6), FAV, C(1)], { starter: 0 });
  auction(g, [[0], [1], [2]]);
  auction(g, [[3, [1]], [0], [1], [2]]);
  auction(g, [[3]]);
  auction(g, [[3], [0], [1]]);
  auction(g, [[2, [1]], [3], [0], [1]]);
  const rev = A.reveal(g);
  assert.deepEqual(rev, { auction: 5, card: FAV, starter: 2, final: true, deckCount: 1 });
  assert.equal(g.phase, 'scoring');
  assert.equal(A.turnOptions(g), null);
  assert.throws(() => A.raise(g, 2, [1]));
  A.score(g);
  assert.equal(g.phase, 'over');
  assert.equal(g.players.flatMap((p) => p.won).filter((c) => c.kind === 'favour').length, 2, 'the final favour went to nobody');
});

test('status order: sum the curios, minus 5 for Bad Debt, x2 per favour, then half for the scandal, kept exact', () => {
  const cases = [
    { won: [C(3), C(4)], status: 7 },
    { won: [C(3), DEBT, FAV], status: -4 },
    { won: [C(3), C(4), SCAN], status: 3.5 },
    { won: [C(3), C(4), FAV, FAV, SCAN], status: 14 },
    { won: [C(1), C(2), DEBT, FAV, SCAN], status: -2 },
    { won: [DEBT, SCAN], status: -2.5 },
    { won: [C(9), DEBT, FAV, FAV, FAV, SCAN], status: 16 },
    { won: [C(5), FAV, ALE], status: 10 },
    { won: [], status: 0 },
  ];
  for (const { won, status } of cases) assert.equal(A.statusOf({ won }), status, JSON.stringify(won));
});

/** A finished game where each seat holds `won` and has `money` left. */
function scored(seats) {
  const g = A.newGame({ seats: seats.length, rng: mulberry32(2) });
  g.phase = 'scoring';
  seats.forEach((s, i) => { g.players[i].won = s.won; g.players[i].hand = s.hand; });
  return A.score(g);
}

test('scoring: every seat tied for the least money is cast out and cannot win, even with the best status', () => {
  const r = scored([
    { won: [C(10), C(9), FAV], hand: [1, 2] },
    { won: [C(1)], hand: [3] },
    { won: [C(2)], hand: [25] },
    { won: [C(8), C(7)], hand: [1, 2] },
  ]);
  assert.deepEqual(r.money, [3, 3, 25, 3]);
  assert.deepEqual(r.castOut, [true, true, false, true]);
  assert.deepEqual(r.status, [38, 1, 2, 15]);
  assert.deepEqual(r.place, [null, null, 1, null]);
  assert.equal(r.winner, 2);
  assert.deepEqual(r.remaining, [[1, 2], [3], [25], [1, 2]], 'every purse is shown at the end');
});

test('scoring: highest status among the rest wins, ties broken by money, then by the highest single curio', () => {
  let r = scored([
    { won: [C(6)], hand: [1] },
    { won: [C(2), C(4)], hand: [20] },
    { won: [C(1), C(5)], hand: [25] },
    { won: [C(3)], hand: [25, 15] },
  ]);
  assert.deepEqual(r.castOut, [true, false, false, false]);
  assert.equal(r.winner, 2, 'status 6 against 6: 25 crowns beat 20');
  assert.deepEqual(r.place, [null, 2, 1, 3]);
  r = scored([
    { won: [C(1)], hand: [1] },
    { won: [C(2), C(4)], hand: [10, 12] },
    { won: [C(1), C(5)], hand: [20, 2] },
    { won: [C(3), C(10), SCAN], hand: [15, 6, 1] },
  ]);
  assert.deepEqual(r.status, [1, 6, 6, 6.5]);
  assert.equal(r.winner, 3);
  r = scored([
    { won: [C(1)], hand: [1] },
    { won: [C(2), C(4)], hand: [10, 12] },
    { won: [C(1), C(5)], hand: [20, 2] },
    { won: [C(3)], hand: [4] },
  ]);
  assert.deepEqual(r.topCurio, [1, 4, 5, 3]);
  assert.equal(r.winner, 2, 'status and money tie at 6 and 22: the 5 curio beats the 4');
  assert.deepEqual(r.place, [null, 2, 1, 3]);
});

test('scoring: a dead heat on status, money and curios shares first place and names no single winner', () => {
  const r = scored([
    { won: [], hand: [10] },
    { won: [], hand: [10] },
    { won: [C(1)], hand: [2] },
    { won: [DEBT], hand: [8] },
  ]);
  assert.deepEqual(r.castOut, [false, false, true, false]);
  assert.deepEqual(r.place, [1, 1, null, 3]);
  assert.equal(r.winner, null);
});

test('scoring: when every seat ties for the least money, every seat is cast out and nobody wins', () => {
  const r = scored([
    { won: [C(10)], hand: [12] },
    { won: [C(3)], hand: [10, 2] },
    { won: [], hand: [6, 4, 2] },
    { won: [FAV], hand: [8, 3, 1] },
  ]);
  assert.deepEqual(r.castOut, [true, true, true, true]);
  assert.deepEqual(r.place, [null, null, null, null]);
  assert.equal(r.winner, null);
});

test('the public view holds only your own hand, plus everything on the table', () => {
  const g = stacked([C(7), FAV, FAV, FAV, SCAN], { starter: 0 });
  A.reveal(g);
  A.raise(g, 0, [3]);
  const v = A.publicView(g, 1);
  assert.deepEqual(v.hand, A.MONEY);
  assert.deepEqual(v.players[0], { seat: 0, absent: false, handCount: 10, bid: [3], passed: false, won: [], spent: [], aleOwed: false });
  assert.ok(!JSON.stringify(v).includes('"deck"'), 'the face-down deck is not in the view');
  assert.equal(v.deckCount, 4);
  assert.deepEqual(v.turned, [C(7)]);
  assert.equal(v.options.seat, 1);
  assert.equal(A.publicView(g, 2).options, null);
});

/* ---------- whole games and the bots ---------- */

const PERSONA_NAMES = ['brass', 'noctua', 'gristle', 'player'];
const purse = (p) => 106 - sum(p.spent);

/** Plays a game to the end with bots, checking the table's invariants after every step. */
function playOut(g, personaOf, rng, onDecide = () => {}) {
  const log = { auctions: 0 };
  for (let steps = 0; g.phase !== 'over'; steps++) {
    assert.ok(steps < 2000, 'the game ends');
    for (const p of g.players) assert.equal(sum(p.hand) + sum(p.bid) + sum(p.spent), 106, 'money is held, bid or spent');
    if (g.phase === 'reveal') { A.reveal(g); continue; }
    if (g.phase === 'settle') { A.settle(g); log.auctions++; continue; }
    if (g.phase === 'scoring') {
      assert.ok(A.isGilded(g.final));
      assert.equal(g.turned.filter(A.isGilded).length, 4, 'the game ends on the 4th gilded card');
      A.score(g);
      continue;
    }
    const seat = g.turn, view = A.publicView(g, seat);
    const act = AI.decide(view, AI.PERSONAS[personaOf(seat)], AI.newMemory(), rng);
    onDecide(view, act, personaOf(seat));
    if (act.type === 'raise') A.raise(g, seat, act.cards);
    else { assert.equal(act.type, 'pass'); A.pass(g, seat); }
  }
  return log;
}

/**
 * Bot-only games with personas rotating through the seats. Everything the tests below check is
 * collected in one pass: outcomes, per-persona tallies, and every raise that would leave the
 * bot tied with the poorest rival, or below it in an auction that is certainly the last.
 */
function botGames(seats, games) {
  const stats = Object.fromEntries(PERSONA_NAMES.map((n) => [n, { seats: 0, wins: 0, cast: 0, status: 0, raises: 0, passes: 0 }]));
  const out = { stats, results: [], auctions: 0, ties: [], lastAuctions: 0, lastBelow: [] };
  for (let seed = 1; seed <= games; seed++) {
    const rng = mulberry32(seed * 31 + seats);
    const g = A.newGame({ seats, rng });
    const who = (s) => PERSONA_NAMES[(s + seed) % 4];
    out.auctions += playOut(g, who, rng, (view, act, persona) => {
      stats[persona][act.type === 'raise' ? 'raises' : 'passes']++;
      if (act.type !== 'raise') return;
      const poorest = Math.min(...view.players.filter((p) => p.seat !== view.seat).map(purse));
      const after = purse(view.players[view.seat]) - (view.options.ownBid + sum(act.cards));
      if (after === poorest) out.ties.push({ seed, after });
      if (view.deckCount === 1 && 4 - view.turned.filter(A.isGilded).length === 1) {
        out.lastAuctions++;
        if (after <= poorest) out.lastBelow.push({ seed, after, poorest });
      }
    }).auctions;
    assert.ok(g.players.every((p) => p.bid.length === 0), 'no money is left on the table');
    out.results.push(g.result);
    g.result.castOut.forEach((c, s) => {
      const x = stats[who(s)];
      x.seats++; x.cast += c; x.wins += g.result.winner === s; x.status += g.result.status[s];
    });
  }
  return out;
}

test('three players at a four-seat table: the empty seat holds no money, never bids, and is never cast out', () => {
  let decided = 0, games = 0;
  for (const empty of [0, 1, 2, 3]) for (let seed = 1; seed <= 250; seed++) {
    const rng = mulberry32(seed * 13 + empty);
    const g = A.newGame({ seats: 4, rng, absent: [empty] });
    assert.notEqual(g.starter, empty);
    for (let steps = 0; g.phase !== 'over'; steps++) {
      assert.ok(steps < 2000, 'the game ends');
      const e = g.players[empty];
      assert.deepEqual([e.hand, e.bid, e.spent, e.won, e.passed], [[], [], [], [], true], 'the empty seat never takes part');
      if (g.phase === 'reveal') { A.reveal(g); continue; }
      if (g.phase === 'settle') { A.settle(g); continue; }
      if (g.phase === 'scoring') { A.score(g); continue; }
      assert.notEqual(g.turn, empty, 'the empty seat is never asked to bid');
      const view = A.publicView(g, g.turn);
      const act = AI.decide(view, AI.PERSONAS[PERSONA_NAMES[(g.turn + seed) % 4]], AI.newMemory(), rng);
      if (act.type === 'raise') A.raise(g, g.turn, act.cards); else A.pass(g, g.turn);
    }
    const r = g.result;
    games++;
    assert.deepEqual([r.castOut[empty], r.place[empty]], [false, null], 'the empty seat is never cast out or placed');
    assert.ok(r.castOut.some(Boolean), 'one of the three players is the poorest');
    if (r.winner != null) { decided++; assert.notEqual(r.winner, empty); }
  }
  assert.ok(decided >= games * 0.99, `nearly every game has one winner (${decided} of ${games})`);
});

test('the auction refuses fewer than three players', () => {
  assert.throws(() => A.newGame({ seats: 4, absent: [1, 3], rng: mulberry32(1) }), /3 to 5 players/);
  assert.throws(() => A.newGame({ seats: 2, rng: mulberry32(1) }), /3 to 5 players/);
});

test('with an empty seat, a normal auction ends when two of three pass, a disgrace when one passes', () => {
  const g = A.newGame({ seats: 4, rng: mulberry32(1), absent: [2] });
  g.deck = [C(5), DEBT, FAV, FAV, FAV, SCAN];
  g.starter = 1;
  A.reveal(g);
  assert.equal(g.turn, 1);
  A.raise(g, 1, [2]);
  assert.equal(g.turn, 3, 'bidding skips the empty seat');
  A.pass(g, 3);
  A.pass(g, 0);
  assert.equal(g.phase, 'settle');
  assert.equal(A.settle(g).seat, 1);
  assert.equal(g.players[2].passed, true, 'the empty seat stays out for the next auction');
  A.reveal(g);
  A.raise(g, 1, [1]);
  A.pass(g, 3);
  assert.equal(A.settle(g).seat, 3, 'the first to pass takes the disgrace');
});

const once = (f) => { let v; return () => (v ??= f()); };
const FOUR = once(() => botGames(4, 3000));

for (const [seats, run] of [[3, () => botGames(3, 1000)], [4, FOUR], [5, () => botGames(5, 1000)]]) {
  test(`${seats} seats: bot games end on the 4th gilded card with one winner or a defined tie`, () => {
    const { results, auctions } = run();
    let decided = 0;
    for (const r of results) {
      assert.ok(r.castOut.some(Boolean), 'someone is always the poorest');
      if (r.winner == null) {
        assert.ok(r.castOut.every(Boolean) || r.place.filter((x) => x === 1).length > 1, 'no winner only on an all-way cast-out or a dead heat');
      } else {
        decided++;
        assert.equal(r.castOut[r.winner], false);
        assert.deepEqual(r.place.filter((x) => x === 1), [1]);
      }
    }
    assert.ok(decided >= results.length * 0.995, `nearly every game has one winner (${decided} of ${results.length})`);
    assert.ok(auctions / results.length > 9 && auctions / results.length < 15, `auctions per game ${auctions / results.length}`);
  });
}

test('bot measurement: over 3000 four-seat games no persona is degenerate', (t) => {
  for (const [name, x] of Object.entries(FOUR().stats)) {
    const win = x.wins / x.seats, cast = x.cast / x.seats, raise = x.raises / (x.raises + x.passes);
    t.diagnostic(`${name}: win ${(100 * win).toFixed(1)}%, cast out ${(100 * cast).toFixed(1)}%, final status ${(x.status / x.seats).toFixed(2)}, raises ${(100 * raise).toFixed(0)}% of decisions`);
    assert.ok(win > 0.12 && win < 0.4, `${name} wins a fair share (${win})`);
    assert.ok(cast > 0.1 && cast < 0.4, `${name} is cast out sometimes, not always (${cast})`);
    assert.ok(raise > 0.3 && raise < 0.85, `${name} both raises and passes (${raise})`);
  }
});

test('a bot never bids into a tie for the least, nor below the poorest in the certain last auction', () => {
  const { ties, lastAuctions, lastBelow } = FOUR();
  assert.deepEqual(ties, [], 'paying a bid never ties the poorest rival');
  assert.deepEqual(lastBelow, [], 'the certain last auction keeps the bot above the poorest');
  assert.ok(lastAuctions > 50, `certain last auctions were seen (${lastAuctions})`);
});

/** A bot's choice opening the bidding on `card`, early in the game, with these hands at the table. */
function botChoice(card, hands, persona, seed) {
  const g = stacked([card, FAV, C(5), FAV, C(8), C(1), C(3), FAV, SCAN, C(2)], { starter: 0 });
  hands.forEach((hand, s) => { g.players[s].hand = hand; g.players[s].spent = A.MONEY.filter((v) => !hand.includes(v)); });
  A.reveal(g);
  return AI.decide(A.publicView(g, 0), AI.PERSONAS[persona], AI.newMemory(), mulberry32(seed)).type;
}

test('bots pay to dodge a disgrace when rich, and take it on the chin when poor', () => {
  const rich = A.MONEY.slice(), poor = [1, 2, 4], middling = [3, 6, 10, 12, 15];
  for (const persona of PERSONA_NAMES) for (let seed = 1; seed <= 30; seed++) {
    for (const card of [DEBT, ALE]) {
      assert.equal(botChoice(card, [rich, middling, middling, middling], persona, seed), 'raise', `${persona} pays to dodge ${card.kind}`);
      assert.equal(botChoice(card, [poor, middling, middling, middling], persona, seed), 'pass', `${persona} keeps its last crowns`);
    }
    assert.equal(botChoice(C(10), [rich, middling, middling, middling], persona, seed), 'raise', `${persona} bids on a 10 curio`);
    assert.equal(botChoice(C(10), [poor, middling, middling, middling], persona, seed), 'pass', `${persona} will not buy its way out of the game`);
  }
});

test('a curio that Spilled Ale will take is worth nothing to the bot that owes it', () => {
  for (const persona of PERSONA_NAMES) for (let seed = 1; seed <= 30; seed++) {
    const g = stacked([C(9), FAV, C(5), FAV, FAV, SCAN], { starter: 0 });
    g.players[0].won = [ALE];
    g.players[0].aleOwed = true;
    A.reveal(g);
    assert.equal(AI.decide(A.publicView(g, 0), AI.PERSONAS[persona], AI.newMemory(), mulberry32(seed)).type, 'pass');
  }
});

test('bot odds: what is still to come, from the cards turned so far', () => {
  const look = AI.outlook({ turned: [C(1), C(2), FAV], players: [{}, {}, {}, {}] });
  // 13 face-down cards, 3 of them gilded: the game ends on the last of the three.
  assert.equal(look.auctionsLeft, (3 * 14) / 4 - 1);
  assert.equal(look.curios, (55 - 3) * (3 / 4));
  assert.equal(look.favours, 2 * (2 / 3));
});
