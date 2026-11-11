import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/model/rules.js';
import * as AI from '../src/model/ai.js';

const personaFor = (seat) => [AI.PERSONAS.player, AI.PERSONAS.brass, AI.PERSONAS.noctua, AI.PERSONAS.gristle][seat];

function simulate(seed) {
  const rng = R.mulberry32(seed);
  const g = R.newGame({ rng });
  const mem = [0, 1, 2, 3].map(() => AI.newMemory());
  const log = { rounds: 0, challenges: 0, forced: 0, plays: 0 };
  for (let steps = 0; steps < 5000; steps++) {
    if (g.phase === 'over') return { g, log };
    if (g.phase === 'between') {
      R.startRound(g, rng);
      log.rounds++;
      const held = g.players.flatMap((p) => p.hand);
      assert.equal(held.length, R.alive(g).length * R.HAND_SIZE, 'every living seat holds a full hand');
      assert.equal(new Set(held.map((c) => c.id)).size, held.length, 'no card dealt twice');
      continue;
    }
    if (g.phase === 'roulette') { R.pullTrigger(g, g.pending.seat); continue; }
    const seat = g.turn;
    assert.ok(g.players[seat].alive, 'only living seats act');
    const opt = R.turnOptions(g);
    const view = R.publicView(g, seat);
    for (const p of view.plays) if (p.seat !== seat) assert.equal(p.own, null, 'view hides other seats\' cards');
    const act = AI.decide(view, personaFor(seat), mem[seat], rng);
    if (act.type === 'play') {
      const before = g.players[seat].hand.length;
      R.play(g, seat, act.cardIds);
      log.plays++;
      assert.equal(g.players[seat].hand.length, before - act.cardIds.length);
      assert.ok(act.cardIds.length >= 1 && act.cardIds.length <= 3);
    } else {
      if (opt.mustChallenge) log.forced++;
      const res = R.challenge(g, seat);
      log.challenges++;
      const truthful = res.cards.every((c) => R.matchesTable(c, g.tableRank));
      assert.equal(res.lie, !truthful);
      assert.equal(res.loser, truthful ? seat : res.accused, 'the wrong party pulls the trigger');
      for (const m of mem) AI.observeReveal(m, res.accused, res.lie);
    }
  }
  throw new Error(`game ${seed} did not finish`);
}

test('2000 simulated games all terminate with exactly one winner', () => {
  let forced = 0;
  for (let seed = 1; seed <= 2000; seed++) {
    const { g, log } = simulate(seed);
    assert.equal(R.alive(g).length, 1);
    assert.equal(R.winner(g), R.alive(g)[0].seat);
    forced += log.forced;
    for (const p of g.players) assert.ok(p.pulls <= R.CHAMBERS, 'nobody pulls past the loaded chamber');
  }
  assert.ok(forced > 0, 'the forced-call rule is exercised');
});

test('a seat dies exactly on its loaded chamber', () => {
  const g = R.newGame({ rng: R.mulberry32(7) });
  g.players[1].bullet = 2;
  const pull = () => { g.phase = 'roulette'; g.pending = { seat: 1 }; return R.pullTrigger(g, 1); };
  assert.equal(pull().fired, false);
  assert.equal(pull().fired, false);
  assert.equal(pull().fired, true);
  assert.equal(g.players[1].alive, false);
});

test('when nobody else holds cards, the next seat must call', () => {
  const g = R.newGame({ rng: R.mulberry32(3) });
  g.starter = 0; R.startRound(g, R.mulberry32(4));
  g.tableRank = 'sun';
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

test('illegal actions are rejected', () => {
  const g = R.newGame({ rng: R.mulberry32(9) });
  R.startRound(g, R.mulberry32(10));
  const s = g.turn, hand = g.players[s].hand;
  assert.throws(() => R.challenge(g, s), /nothing to challenge/);
  assert.throws(() => R.play(g, s, []), /1\.\.3/);
  assert.throws(() => R.play(g, s, hand.slice(0, 4).map((c) => c.id)), /1\.\.3/);
  assert.throws(() => R.play(g, (s + 1) % 4, [g.players[(s + 1) % 4].hand[0].id]), /not your turn/);
  assert.throws(() => R.play(g, s, [999]), /not in hand/);
});

test('AI always calls a claim that is impossible given its own hand', () => {
  const view = {
    seat: 1, tableRank: 'sun', round: 1,
    hand: [{ id: 1, rank: 'sun' }, { id: 2, rank: 'sun' }, { id: 3, rank: 'sun' }, { id: 4, rank: 'wild' }, { id: 5, rank: 'wild' }],
    players: [0, 1, 2, 3].map((seat) => ({ seat, alive: true, handCount: 3, pulls: 0 })),
    plays: [{ seat: 0, claim: 3, own: null }, { seat: 3, claim: 2, own: null }],
    options: { seat: 1, canPlay: true, canChallenge: true, mustChallenge: false, maxCards: 3 },
  };
  assert.equal(AI.suspicionOf(view, AI.PERSONAS.brass, {}), 1);
});
