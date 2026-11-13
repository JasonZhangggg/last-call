import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../src/net/room.js';
import { mulberry32 } from '../src/model/rules.js';
import { reduceDice, lastBid } from '../src/modes/dice-state.js';

class FakeClock {
  t = 1_000_000; seq = 0; q = new Map();
  now() { return this.t; }
  setTimeout(fn, ms) { const id = ++this.seq; this.q.set(id, { at: this.t + ms, fn }); return id; }
  clearTimeout(id) { this.q.delete(id); }
  next() {
    let best = null;
    for (const [id, x] of this.q) if (!best || x.at < best[1].at || (x.at === best[1].at && id < best[0])) best = [id, x];
    if (!best) return false;
    this.q.delete(best[0]);
    this.t = Math.max(this.t, best[1].at);
    best[1].fn();
    return true;
  }
}

// Plays a whole dice game with one person who acts only on its own prompts, and checks after every
// message that the client mirror equals the server's snapshot for that seat.
function playMirrored(variant, seed, players = 4) {
  const clock = new FakeClock(), rng = mulberry32(seed);
  const inbox = [];
  const room = new Room({ code: 'TEST', clock, rng, randomToken: (() => { let n = 0; return () => `t${++n}`; })(), send: (id, m) => inbox.push(structuredClone(m)) });
  let me = null, game = null, checked = 0, over = null;
  const calls = { liar: 0, spotOn: 0, poisoned: 0, mine: 0 };
  const act = (m) => {
    if (m.type === 'turn' && m.seat === me && m.options) {
      const o = m.options;
      if (o.canSpotOn && rng() < 0.15) return room.receive('c', { type: 'spotOn' });
      if (o.mustChallenge || (o.canChallenge && rng() < 0.3)) return room.receive('c', { type: 'challenge' });
      const r = o.raises[Math.floor(rng() * o.raises.length)];
      room.receive('c', { type: 'bid', quantity: r.minQuantity + (rng() < 0.3 && r.minQuantity < o.maxQuantity ? 1 : 0), face: r.face });
    }
    if (m.type === 'roulette' && m.seat === me) room.receive('c', { type: 'pull' });
  };
  const drain = () => {
    while (inbox.length) {
      const m = inbox.shift();
      if (m.type === 'error') throw new Error(`refused: ${m.message}`);
      if (m.type === 'welcome') me = m.seat;
      if (m.type === 'over') over = m;
      if (m.type === 'challenge') calls[m.call]++;
      if (m.type === 'drink' && m.poisoned) { calls.poisoned++; if (m.seat === me) calls.mine++; }
      if (m.type === 'state') game = structuredClone(m.game);
      else if (game) reduceDice(game, m, me);
      if (game && room.game && !['lobby', 'welcome', 'turn', 'roulette'].includes(m.type)) {
        const { starter: _a, ...want } = room.engine.snapshot(room.game, me);
        const { starter: _b, ...got } = game;
        assert.deepEqual(got, want, `mirror diverged after ${m.type}`);
        if (m.type === 'bid') assert.deepEqual(lastBid(game), { seat: m.seat, quantity: m.quantity, face: m.face });
        checked++;
      }
      act(m);
    }
  };
  room.receive('c', { type: 'hello', name: 'Ann' });
  room.receive('c', { type: 'setOptions', options: { mode: 'dice', variant, players } });
  for (const p of ['brass', 'noctua', 'gristle'].slice(0, players - 1)) room.receive('c', { type: 'addBot', persona: p });
  room.receive('c', { type: 'start' });
  drain();
  for (let i = 0; i < 100_000 && !over; i++) { if (!clock.next()) break; drain(); }
  assert.ok(over, 'game finished');
  return { checked, calls };
}

test('the dice mirror tracks the server snapshot through whole games', () => {
  const total = { liar: 0, spotOn: 0, poisoned: 0, mine: 0 };
  for (let seed = 1; seed <= 12; seed++) {
    for (const variant of ['basic', 'traditional']) {
      const r = playMirrored(variant, seed);
      assert.ok(r.checked > 10, `${variant} seed ${seed} checked ${r.checked}`);
      if (variant === 'basic') assert.equal(r.calls.spotOn, 0, 'no Spot On in the classic rules');
      for (const k of Object.keys(total)) total[k] += r.calls[k];
    }
  }
  assert.ok(total.liar > 0 && total.spotOn > 0, 'both calls were mirrored');
  assert.ok(total.mine > 0, 'your own poisoned glass was mirrored');
  assert.equal(total.poisoned, 12 * 2 * 3, 'every game ends with three seats poisoned');
});

test('the dice mirror tracks two- and three-player tables, their empty seats sitting out', () => {
  for (let seed = 1; seed <= 6; seed++) for (const players of [2, 3]) {
    assert.ok(playMirrored('basic', seed, players).checked > 5);
    assert.ok(playMirrored('traditional', seed, players).checked > 5);
  }
});
