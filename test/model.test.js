import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/model/rules.js';
import * as AI from '../src/model/ai.js';

const personaFor = (seat) => [AI.PERSONAS.player, AI.PERSONAS.brass, AI.PERSONAS.noctua, AI.PERSONAS.gristle][seat];
const countRanks = (cards) => cards.reduce((m, c) => ({ ...m, [c.rank]: (m[c.rank] || 0) + 1 }), {});

function simulate(seed, variant = 'basic', seats = 4) {
  const rng = R.mulberry32(seed);
  const g = R.newGame({ rng, variant, seats });
  const mem = g.players.map(() => AI.newMemory());
  const log = { rounds: 0, challenges: 0, forced: 0, plays: 0, devils: 0, devilVolleys: 0 };
  let volley = null;
  for (let steps = 0; steps < 5000; steps++) {
    if (g.phase === 'over') return { g, log };
    if (g.phase === 'between') {
      assert.equal(volley?.length ?? 0, 0, 'every shooter shot before the next deal');
      R.startRound(g, rng);
      log.rounds++;
      const held = g.players.flatMap((p) => p.hand);
      assert.equal(held.length, R.alive(g).length * R.HAND_SIZE, 'every living seat holds a full hand');
      assert.equal(new Set(held.map((c) => c.id)).size, held.length, 'no card dealt twice');
      assert.ok(g.players[g.turn].alive, 'a living seat opens the round');
      continue;
    }
    if (g.phase === 'roulette') {
      assert.equal(g.pending.seat, volley.shift(), 'shooters fire in the announced order');
      R.pullTrigger(g, g.pending.seat);
      continue;
    }
    const seat = g.turn;
    assert.ok(g.players[seat].alive, 'only living seats act');
    const opt = R.turnOptions(g);
    const view = R.publicView(g, seat);
    for (const p of view.plays) if (p.seat !== seat) assert.equal(p.own, null, 'view hides other seats\' cards');
    const act = AI.decide(view, personaFor(seat), mem[seat], rng);
    if (act.type === 'play') {
      const before = g.players[seat].hand.length;
      const p = R.play(g, seat, act.cardIds);
      log.plays++;
      if (p.cards.some((c) => c.rank === R.DEVIL)) { log.devils++; assert.equal(p.cards.length, 1, 'the Devil is played alone'); }
      assert.equal(g.players[seat].hand.length, before - act.cardIds.length);
      assert.ok(act.cardIds.length >= 1 && act.cardIds.length <= 3);
    } else {
      if (opt.mustChallenge) log.forced++;
      const living = R.alive(g).length;
      const res = R.challenge(g, seat);
      log.challenges++;
      const truthful = res.cards.every((c) => R.matchesTable(c, g.tableRank));
      assert.equal(res.lie, !truthful);
      const devil = res.cards.some((c) => c.rank === R.DEVIL);
      if (devil && living >= 3) {
        log.devilVolleys++;
        assert.equal(res.shooters.length, living - 1, 'everyone but the accused shoots');
        assert.ok(!res.shooters.includes(res.accused));
      } else {
        assert.deepEqual(res.shooters, [truthful ? seat : res.accused], 'the wrong party pulls the trigger');
      }
      volley = res.shooters.slice();
      for (const m of mem) AI.observeReveal(m, res.accused, res.lie);
    }
  }
  throw new Error(`game ${seed} did not finish`);
}

for (const variant of ['basic', 'devil']) {
  test(`${variant}: 3000 simulated games of 2 to 4 seats all terminate with exactly one winner`, () => {
    let forced = 0, devils = 0, volleys = 0;
    for (let seed = 1; seed <= 3000; seed++) {
      const seats = 2 + (seed % 3);
      const { g, log } = simulate(seed, variant, seats);
      assert.equal(R.alive(g).length, 1);
      assert.equal(R.winner(g), R.alive(g)[0].seat);
      forced += log.forced; devils += log.devils; volleys += log.devilVolleys;
      for (const p of g.players) assert.ok(p.pulls <= R.CHAMBERS, 'nobody pulls past the loaded chamber');
    }
    assert.ok(forced > 0, 'the forced-call rule is exercised');
    if (variant === 'devil') assert.ok(devils > 100 && volleys > 20, `the Devil is played (${devils}) and volleys happen (${volleys})`);
    else assert.equal(devils, 0, 'no Devil without the variant');
  });
}

test('the deck holds 6 Kings, 6 Queens, 6 Aces and 2 Jokers; the Devil variant adds one Devil', () => {
  assert.deepEqual(countRanks(R.createDeck()), { king: 6, queen: 6, ace: 6, joker: 2 });
  assert.deepEqual(countRanks(R.createDeck('devil')), { king: 6, queen: 6, ace: 6, joker: 2, devil: 1 });
  assert.deepEqual(R.TABLE_RANKS, ['king', 'queen', 'ace']);
  assert.equal(R.newGame({ variant: 'devil', rng: R.mulberry32(1) }).deck.length, 21);
});

test('Jokers match every table rank, the Devil matches none', () => {
  for (const t of R.TABLE_RANKS) {
    assert.ok(R.matchesTable({ rank: 'joker' }, t));
    assert.ok(R.matchesTable({ rank: t }, t));
    assert.ok(!R.matchesTable({ rank: R.DEVIL }, t));
  }
  assert.ok(!R.matchesTable({ rank: 'queen' }, 'king'));
});

test('round start draws the table rank uniformly from King, Queen and Ace', () => {
  const seen = { king: 0, queen: 0, ace: 0 };
  const rng = R.mulberry32(42);
  for (let i = 0; i < 3000; i++) { const g = R.newGame({ rng }); R.startRound(g, rng); seen[g.tableRank]++; }
  for (const r of R.TABLE_RANKS) assert.ok(seen[r] > 850 && seen[r] < 1150, `${r} drawn ${seen[r]} of 3000`);
});

test('a seat dies exactly on its loaded chamber', () => {
  const g = R.newGame({ rng: R.mulberry32(7) });
  g.players[1].bullet = 2;
  const pull = () => { g.phase = 'roulette'; g.pending = { seat: 1, queue: [], startFrom: 1 }; return R.pullTrigger(g, 1); };
  assert.equal(pull().fired, false);
  assert.equal(pull().fired, false);
  assert.equal(pull().fired, true);
  assert.equal(g.players[1].alive, false);
});

test('when nobody else holds cards, the next seat must call', () => {
  const g = R.newGame({ rng: R.mulberry32(3) });
  g.starter = 0; R.startRound(g, R.mulberry32(4));
  g.tableRank = 'king';
  for (const s of [2, 3]) g.players[s].hand = [];
  const card = g.players[0].hand[0];
  g.players[0].hand = [card];
  R.play(g, 0, [card.id]);
  assert.equal(g.turn, 1);
  const opt = R.turnOptions(g);
  assert.equal(opt.mustChallenge, true);
  assert.equal(opt.canPlay, false);
  assert.throws(() => R.play(g, 1, [g.players[1].hand[0].id]));
});

test('seats with empty hands are skipped', () => {
  const g = R.newGame({ rng: R.mulberry32(3) });
  g.starter = 0; R.startRound(g, R.mulberry32(4));
  g.players[1].hand = [];
  R.play(g, 0, [g.players[0].hand[0].id]);
  assert.equal(g.turn, 2);
});

/** A dealt round with hands and the table rank fixed, so a rule can be pinned exactly. */
function rigged({ variant = 'basic', tableRank = 'king', hands, starter = 0, dead = [] }) {
  const g = R.newGame({ rng: R.mulberry32(5), variant });
  for (const s of dead) g.players[s].alive = false;
  g.starter = starter;
  R.startRound(g, R.mulberry32(6));
  g.tableRank = tableRank;
  let id = 100;
  hands.forEach((ranks, s) => { g.players[s].hand = ranks.map((rank) => ({ id: id++, rank })); });
  for (const p of g.players) p.bullet = 5;
  return g;
}
const idsOf = (g, seat, ...ranks) => ranks.map((r) => g.players[seat].hand.find((c) => c.rank === r).id);

test('a truthful play makes the caller shoot, a lie makes the accused shoot', () => {
  const g = rigged({ hands: [['king', 'joker', 'ace'], ['queen'], ['queen'], ['queen']] });
  R.play(g, 0, idsOf(g, 0, 'king', 'joker'));
  const res = R.challenge(g, 1);
  assert.equal(res.lie, false);
  assert.deepEqual(res.shooters, [1]);

  const h = rigged({ hands: [['king', 'ace'], ['queen'], ['queen'], ['queen']] });
  R.play(h, 0, idsOf(h, 0, 'king', 'ace'));
  const lie = R.challenge(h, 1);
  assert.equal(lie.lie, true);
  assert.deepEqual(lie.shooters, [0]);
});

test('after a shot the survivor starts the next round, or the next living seat if they died', () => {
  const g = rigged({ hands: [['ace'], ['queen'], ['queen'], ['queen']] });
  R.play(g, 0, idsOf(g, 0, 'ace'));
  R.challenge(g, 1);
  g.players[0].bullet = 0;
  assert.equal(R.pullTrigger(g, 0).fired, true);
  assert.equal(g.phase, 'between');
  assert.equal(g.starter, 1);

  const h = rigged({ hands: [['ace'], ['queen'], ['queen'], ['queen']], starter: 0 });
  R.play(h, 0, idsOf(h, 0, 'ace'));
  R.challenge(h, 1);
  R.pullTrigger(h, 0);
  assert.equal(h.starter, 0, 'the shooter survived and starts');
});

test('devil: the Devil is only ever played on its own', () => {
  const g = rigged({ variant: 'devil', hands: [['devil', 'king', 'ace'], ['queen'], ['queen'], ['queen']] });
  const before = structuredClone(g);
  assert.throws(() => R.play(g, 0, idsOf(g, 0, 'devil', 'king')), /Devil/);
  assert.deepEqual(g, before, 'a refused play changes nothing');
  R.play(g, 0, idsOf(g, 0, 'devil'));
  assert.equal(g.plays.at(-1).cards[0].rank, R.DEVIL);
});

test('devil: a revealed Devil with 4 alive makes every seat but the accused shoot, in seat order after the accused', () => {
  const g = rigged({ variant: 'devil', starter: 2, hands: [['queen'], ['queen'], ['devil', 'king'], ['queen']] });
  R.play(g, 2, idsOf(g, 2, 'devil'));
  const res = R.challenge(g, 3);
  assert.equal(res.lie, true);
  assert.deepEqual(res.shooters, [3, 0, 1], 'the caller shoots too, and the accused does not');
  for (const s of [3, 0, 1]) {
    assert.equal(g.phase, 'roulette');
    assert.equal(g.pending.seat, s);
    assert.throws(() => R.pullTrigger(g, 2), /not your trigger/, 'the accused never pulls');
    R.pullTrigger(g, s);
  }
  assert.equal(g.phase, 'between');
  assert.equal(g.starter, 3, 'the first survivor after the accused starts');
});

test('devil: dead seats are skipped, and a seat killed in the volley does not start', () => {
  const g = rigged({ variant: 'devil', starter: 0, dead: [2], hands: [['devil', 'ace'], ['queen'], [], ['queen']] });
  R.play(g, 0, idsOf(g, 0, 'devil'));
  const res = R.challenge(g, 1);
  assert.deepEqual(res.shooters, [1, 3]);
  g.players[1].bullet = 0;
  assert.equal(R.pullTrigger(g, 1).fired, true);
  assert.equal(g.phase, 'roulette', 'the volley continues after a death');
  assert.equal(R.pullTrigger(g, 3).fired, false);
  assert.equal(g.starter, 3);
});

test('devil: if the whole volley dies the accused wins', () => {
  const g = rigged({ variant: 'devil', starter: 0, dead: [3], hands: [['devil', 'ace'], ['queen'], ['queen'], []] });
  R.play(g, 0, idsOf(g, 0, 'devil'));
  assert.deepEqual(R.challenge(g, 1).shooters, [1, 2]);
  g.players[1].bullet = 0; g.players[2].bullet = 0;
  R.pullTrigger(g, 1);
  R.pullTrigger(g, 2);
  assert.equal(g.phase, 'over');
  assert.equal(R.winner(g), 0);
});

test('devil: with only 2 seats alive the Devil is an ordinary lie', () => {
  const g = rigged({ variant: 'devil', starter: 0, dead: [2, 3], hands: [['devil', 'ace'], ['queen'], [], []] });
  R.play(g, 0, idsOf(g, 0, 'devil'));
  const res = R.challenge(g, 1);
  assert.equal(res.lie, true);
  assert.deepEqual(res.shooters, [0]);
});

test('illegal actions are rejected and change nothing', () => {
  const g = R.newGame({ rng: R.mulberry32(9) });
  assert.throws(() => R.play(g, 0, [0]), /not your turn/, 'nothing to play before the deal');
  R.startRound(g, R.mulberry32(10));
  const s = g.turn, hand = g.players[s].hand;
  const before = structuredClone(g);
  assert.throws(() => R.challenge(g, s), /nothing to challenge/);
  assert.throws(() => R.play(g, s, []), /1\.\.3/);
  assert.throws(() => R.play(g, s, hand.slice(0, 4).map((c) => c.id)), /1\.\.3/);
  assert.throws(() => R.play(g, (s + 1) % 4, [g.players[(s + 1) % 4].hand[0].id]), /not your turn/);
  assert.throws(() => R.play(g, s, [999]), /not in hand/);
  assert.throws(() => R.pullTrigger(g, s), /not your trigger/);
  assert.throws(() => R.startRound(g), /startRound/);
  assert.deepEqual(g, before);
  R.play(g, s, [hand[0].id]);
  assert.throws(() => R.challenge(g, s), /not your turn/, 'nobody calls their own play');
});

test('AI always calls a claim that is impossible given its own hand', () => {
  const view = {
    seat: 1, tableRank: 'king', round: 1, variant: 'basic',
    hand: [{ id: 1, rank: 'king' }, { id: 2, rank: 'king' }, { id: 3, rank: 'king' }, { id: 4, rank: 'joker' }, { id: 5, rank: 'joker' }],
    players: [0, 1, 2, 3].map((seat) => ({ seat, alive: true, handCount: 3, pulls: 0 })),
    plays: [{ seat: 0, claim: 3, own: null }, { seat: 3, claim: 2, own: null }],
    options: { seat: 1, canPlay: true, canChallenge: true, mustChallenge: false, maxCards: 3 },
  };
  assert.equal(AI.suspicionOf(view, AI.PERSONAS.brass, {}), 1);
});
