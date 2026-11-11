import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../src/model/dice.js';
import * as DAI from '../src/model/dice-ai.js';
import { PERSONAS } from '../src/model/ai.js';
import { mulberry32 } from '../src/model/rules.js';

const personaFor = (seat) => [PERSONAS.player, PERSONAS.brass, PERSONAS.noctua, PERSONAS.gristle][seat];
const tally = (g, face) => g.players.flatMap((p) => p.dice).filter((d) => d === face || d === 1).length;

function simulate(seed, variant, seats) {
  const rng = mulberry32(seed);
  const g = D.newGame({ seats, rng, variant });
  const mem = g.players.map(() => DAI.newMemory());
  const log = { rounds: 0, bids: 0, liars: 0, spotOns: 0, forced: 0, multiDrink: 0 };
  let queue = [];
  for (let steps = 0; steps < 20000; steps++) {
    if (g.phase === 'over') return { g, log };
    if (g.phase === 'between') {
      assert.equal(queue.length, 0, 'every drinker drank before the reroll');
      D.startRound(g, rng);
      log.rounds++;
      for (const p of g.players) {
        assert.equal(p.dice.length, p.alive ? D.DICE_PER_SEAT : 0, 'living seats hold five dice, the dead none');
        for (const d of p.dice) assert.ok(Number.isInteger(d) && d >= 1 && d <= 6);
      }
      assert.ok(g.players[g.turn].alive, 'a living seat opens');
      continue;
    }
    if (g.phase === 'drink') {
      assert.equal(g.pending.seat, queue.shift(), 'drinkers drink in the announced order');
      D.drink(g, g.pending.seat);
      continue;
    }
    const seat = g.turn;
    const opt = D.turnOptions(g);
    const view = D.publicView(g, seat);
    assert.deepEqual(Object.keys(view).sort(), ['bids', 'dice', 'options', 'players', 'round', 'seat', 'variant']);
    assert.deepEqual(view.dice, g.players[seat].dice, 'the view holds only the seat\'s own dice');
    const act = DAI.decide(view, personaFor(seat), mem[seat], rng);
    if (opt.mustChallenge) log.forced++;
    if (act.type === 'bid') {
      const last = g.bids.at(-1);
      D.bid(g, seat, act.quantity, act.face);
      log.bids++;
      if (last) assert.ok(act.quantity > last.quantity || (act.quantity === last.quantity && act.face > last.face), 'every bid raises');
      continue;
    }
    const last = g.bids.at(-1);
    const count = tally(g, last.face);
    const res = act.type === 'spotOn' ? D.spotOn(g, seat) : D.challenge(g, seat);
    assert.equal(res.count, count, 'the reveal counts the face plus the 1s');
    if (act.type === 'spotOn') {
      log.spotOns++;
      assert.equal(res.callerRight, count === last.quantity);
      if (res.callerRight) { assert.equal(res.drinkers.length, D.alive(g).length - 1); log.multiDrink++; }
      else assert.deepEqual(res.drinkers, [seat]);
    } else {
      log.liars++;
      assert.deepEqual(res.drinkers, [count >= last.quantity ? seat : last.seat]);
    }
    queue = res.drinkers.slice();
    for (const m of mem) DAI.observeReveal(m, res);
  }
  throw new Error(`dice game ${seed} did not finish`);
}

for (const variant of D.VARIANTS) {
  test(`dice ${variant}: 3000 simulated games of 2 to 4 seats all end with exactly one winner`, () => {
    const total = { rounds: 0, bids: 0, liars: 0, spotOns: 0, forced: 0, multiDrink: 0 };
    for (let seed = 1; seed <= 3000; seed++) {
      const seats = 2 + (seed % 3);
      const { g, log } = simulate(seed, variant, seats);
      assert.equal(D.alive(g).length, 1);
      assert.equal(D.winner(g), D.alive(g)[0].seat);
      for (const p of g.players) assert.ok(p.drinks <= D.GLASSES, 'nobody drinks past the poisoned glass');
      for (const k of Object.keys(total)) total[k] += log[k];
    }
    assert.ok(total.bids > total.liars + total.spotOns, `bots mostly bid (${JSON.stringify(total)})`);
    assert.ok(total.liars > 1000, 'bots call liar');
    if (variant === 'traditional') assert.ok(total.spotOns > 300 && total.multiDrink > 50, `bots call spot on (${total.spotOns}, right ${total.multiDrink})`);
    else assert.equal(total.spotOns, 0, 'no spot on in basic');
  });
}

/** A rolled round with every cup fixed, so a rule can be pinned exactly. */
function rigged({ variant = 'basic', cups, starter = 0, dead = [] }) {
  const g = D.newGame({ seats: cups.length, rng: mulberry32(3), variant });
  for (const s of dead) g.players[s].alive = false;
  g.starter = starter;
  D.startRound(g, mulberry32(4));
  cups.forEach((dice, s) => { g.players[s].dice = dice.slice(); });
  for (const p of g.players) p.poison = 5;
  return g;
}
const CUPS = [[1, 3, 3, 5, 6], [2, 2, 3, 4, 6], [1, 1, 6, 6, 6], [3, 4, 4, 5, 5]];

test('every living seat rolls five dice at round start, and rerolls every round', () => {
  const g = D.newGame({ seats: 4, rng: mulberry32(1) });
  const rng = mulberry32(2);
  const r = D.startRound(g, rng);
  assert.deepEqual(r.dice, g.players.map((p) => p.dice));
  const first = structuredClone(r.dice);
  g.phase = 'between';
  D.startRound(g, rng);
  assert.notDeepEqual(g.players.map((p) => p.dice), first);
  const faces = new Map();
  for (let i = 0; i < 2000; i++) { g.phase = 'between'; D.startRound(g, rng); for (const d of g.players[0].dice) faces.set(d, (faces.get(d) || 0) + 1); }
  for (let f = 1; f <= 6; f++) assert.ok(faces.get(f) > 1500 && faces.get(f) < 1840, `face ${f} rolled ${faces.get(f)} of 10000`);
});

test('1s are wild: they count toward any bid face', () => {
  const g = rigged({ cups: CUPS });
  assert.equal(D.countFace(g, 6), 8, 'five 6s plus three 1s');
  assert.equal(D.countFace(g, 3), 7, 'four 3s plus three 1s');
  assert.equal(D.countFace(g, 2), 5);
});

test('the raise rule: higher quantity, or the same quantity with a higher face', () => {
  const g = rigged({ cups: CUPS });
  assert.equal(D.turnOptions(g).canChallenge, false, 'nothing to call before the opening bid');
  D.bid(g, 0, 1, 2);
  for (const [q, f, ok] of [[1, 2, false], [1, 3, true]]) {
    const h = structuredClone(g);
    if (ok) D.bid(h, 1, q, f); else assert.throws(() => D.bid(h, 1, q, f), /raise/);
  }
  D.bid(g, 1, 3, 4);
  const before = structuredClone(g);
  assert.throws(() => D.bid(g, 2, 3, 4), /raise/, 'the same bid');
  assert.throws(() => D.bid(g, 2, 3, 3), /raise/, 'same quantity, lower face');
  assert.throws(() => D.bid(g, 2, 2, 6), /raise/, 'lower quantity, higher face');
  assert.throws(() => D.bid(g, 2, 4, 1), /face/, '1s cannot be bid');
  assert.throws(() => D.bid(g, 2, 4, 7), /face/);
  assert.throws(() => D.bid(g, 2, 21, 6), /quantity/, 'more dice than the table holds');
  assert.throws(() => D.bid(g, 2, 3.5, 6), /quantity/);
  assert.throws(() => D.bid(g, 3, 5, 5), /not your turn/);
  assert.deepEqual(g, before, 'refused bids change nothing');
  D.bid(g, 2, 3, 5);
  D.bid(g, 3, 4, 2);
  assert.deepEqual(g.bids.map((b) => [b.seat, b.quantity, b.face]), [[0, 1, 2], [1, 3, 4], [2, 3, 5], [3, 4, 2]]);
  assert.equal(g.turn, 0);
  assert.deepEqual(D.turnOptions(g).raises, [
    { face: 2, minQuantity: 5 }, { face: 3, minQuantity: 4 }, { face: 4, minQuantity: 4 }, { face: 5, minQuantity: 4 }, { face: 6, minQuantity: 4 },
  ]);
});

test('turns skip dead seats and the opener can bid any quantity of at least 1', () => {
  const g = rigged({ cups: [[2, 2, 2, 2, 2], [], [3, 3, 3, 3, 3], [4, 4, 4, 4, 4]], dead: [1] });
  assert.equal(D.turnOptions(g).maxQuantity, 15, 'quantities run up to the dice on the table');
  assert.throws(() => D.bid(g, 0, 0, 3), /quantity/);
  D.bid(g, 0, 9, 3);
  assert.equal(g.turn, 2);
});

test('liar: the bid stands at count >= quantity and the caller drinks, else the bidder drinks', () => {
  const g = rigged({ cups: CUPS });
  D.bid(g, 0, 8, 6);
  const stands = D.challenge(g, 1);
  assert.deepEqual([stands.count, stands.callerRight, stands.drinkers], [8, false, [1]]);
  assert.deepEqual(stands.cups, CUPS, 'the reveal shows every cup');

  const h = rigged({ cups: CUPS });
  D.bid(h, 0, 9, 6);
  const falls = D.challenge(h, 1);
  assert.deepEqual([falls.count, falls.callerRight, falls.drinkers], [8, true, [0]]);
});

test('next round: the loser opens if alive, otherwise the next living seat', () => {
  const g = rigged({ cups: CUPS });
  D.bid(g, 0, 9, 6);
  D.challenge(g, 1);
  D.drink(g, 0);
  assert.equal(g.starter, 0, 'the surviving loser opens');

  const h = rigged({ cups: CUPS });
  D.bid(h, 0, 9, 6);
  D.challenge(h, 1);
  h.players[0].poison = 0;
  assert.equal(D.drink(h, 0).poisoned, true);
  assert.equal(h.starter, 1);
  assert.equal(h.phase, 'between');
});

test('a forced call: at the highest possible bid the next seat must call', () => {
  const g = rigged({ variant: 'basic', cups: [[6, 6, 6, 6, 6], [1, 1, 1, 1, 1]] });
  D.bid(g, 0, 10, 6);
  const o = D.turnOptions(g);
  assert.equal(o.canBid, false);
  assert.equal(o.mustChallenge, true);
  assert.deepEqual(o.raises, []);
  assert.throws(() => D.bid(g, 1, 10, 6), /raise/);
  assert.equal(DAI.decide(D.publicView(g, 1), PERSONAS.gristle, {}, mulberry32(1)).type, 'challenge');
});

test('traditional spot on: exact count makes every other living seat drink, in seat order after the caller', () => {
  const g = rigged({ variant: 'traditional', cups: CUPS, starter: 1, dead: [] });
  D.bid(g, 1, 8, 6);
  const res = D.spotOn(g, 2);
  assert.deepEqual([res.call, res.count, res.callerRight], ['spotOn', 8, true]);
  assert.deepEqual(res.drinkers, [3, 0, 1]);
  for (const s of [3, 0, 1]) {
    assert.equal(g.phase, 'drink');
    assert.throws(() => D.drink(g, 2), /not your glass/, 'the caller never drinks');
    D.drink(g, s);
  }
  assert.equal(g.phase, 'between');
  assert.equal(g.starter, 3, 'the first survivor after the caller opens');
});

test('traditional spot on: any other count makes the caller drink', () => {
  for (const q of [7, 9]) {
    const g = rigged({ variant: 'traditional', cups: CUPS });
    D.bid(g, 0, q, 6);
    const res = D.spotOn(g, 1);
    assert.equal(res.callerRight, false);
    assert.deepEqual(res.drinkers, [1]);
  }
});

test('spot on exists only in traditional, and never on the opening', () => {
  const g = rigged({ variant: 'basic', cups: CUPS });
  D.bid(g, 0, 3, 3);
  assert.equal(D.turnOptions(g).canSpotOn, false);
  const before = structuredClone(g);
  assert.throws(() => D.spotOn(g, 1), /spot on/);
  assert.deepEqual(g, before);
  const t = rigged({ variant: 'traditional', cups: CUPS });
  assert.equal(D.turnOptions(t).canSpotOn, false);
  assert.throws(() => D.spotOn(t, 0), /nothing to call/);
  assert.throws(() => D.challenge(t, 0), /nothing to call/);
});

test('the poison tray escalates like the revolver: one glass in six, never reshuffled', () => {
  const g = rigged({ cups: CUPS });
  g.players[1].poison = 3;
  const results = [];
  for (let i = 0; i < 4; i++) {
    g.phase = 'drink'; g.pending = { seat: 1, queue: [], startFrom: 1 };
    results.push(D.drink(g, 1));
  }
  assert.deepEqual(results.map((r) => r.poisoned), [false, false, false, true]);
  assert.deepEqual(results.map((r) => r.drinks), [1, 2, 3, 4]);
  assert.deepEqual(results.map((r) => r.odds), [1 / 6, 1 / 5, 1 / 4, 1 / 3]);
  assert.equal(g.players[1].alive, false);
  const seen = new Array(6).fill(0);
  for (let s = 1; s <= 6000; s++) seen[D.newGame({ seats: 2, rng: mulberry32(s) }).players[0].poison]++;
  for (const n of seen) assert.ok(n > 850 && n < 1150, `the poisoned glass is uniform (${seen})`);
});

test('a dead seat is out: no dice, no turns, and the last seat standing wins', () => {
  const g = rigged({ cups: [[2, 2, 2, 2, 2], [3, 3, 3, 3, 3]] });
  D.bid(g, 0, 10, 2);
  D.challenge(g, 1);
  g.players[0].poison = 0;
  D.drink(g, 0);
  assert.equal(g.phase, 'over');
  assert.equal(D.winner(g), 1);
  assert.deepEqual(g.players[0].dice, []);
  assert.throws(() => D.startRound(g), /startRound/);
});

test('bot odds: expected count is own matches plus a third of the unknown dice', () => {
  const g = rigged({ cups: CUPS });
  const view = D.publicView(g, 0);
  assert.equal(DAI.expectedCount(view, 6), 2 + 15 / 3, 'own 1 and 6 plus 15 unknown dice');
  assert.equal(DAI.probAtLeast(view, 2, 6), 1, 'two of my own dice already make it');
  assert.ok(Math.abs(DAI.probAtLeast(view, 3, 6) - (1 - (2 / 3) ** 15)) < 1e-9);
  assert.equal(DAI.probAtLeast(view, 21, 6), 0);
});

test('a bot always calls a bid it knows is impossible, and never calls one it knows stands', () => {
  const g = rigged({ cups: [[2, 2, 2, 2, 2], [3, 3, 3, 3, 3]] });
  D.bid(g, 0, 5, 3);
  const view = D.publicView(g, 1);
  const rng = mulberry32(5);
  for (const persona of Object.values(PERSONAS)) for (let i = 0; i < 100; i++) {
    assert.notEqual(DAI.decide(view, persona, {}, rng).type, 'challenge', 'my own five 3s make five 3s certain');
  }
  const h = rigged({ cups: [[2, 2, 2, 2, 2], [4, 4, 4, 4, 4]] });
  D.bid(h, 0, 6, 3);
  for (let i = 0; i < 50; i++) assert.equal(DAI.decide(D.publicView(h, 1), PERSONAS.brass, {}, rng).type, 'challenge', 'only five unknown dice: six 3s are impossible');
});
