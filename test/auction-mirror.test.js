import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../src/net/room.js';
import { mulberry32 } from '../src/model/rules.js';
import { reduceAuction, cheapestRaise, highBid, bidOf, sum } from '../src/modes/auction-state.js';

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

// Plays a whole game with one person who acts only on its own prompts, reading only the mirror,
// and checks after every message that the mirror equals the server's snapshot for that seat.
function playMirrored(seed, players = 4) {
  const clock = new FakeClock(), rng = mulberry32(seed);
  const inbox = [];
  const room = new Room({ code: 'TEST', clock, rng, randomToken: (() => { let n = 0; return () => `t${++n}`; })(), send: (id, m) => inbox.push(structuredClone(m)) });
  let me = null, game = null, checked = 0, over = null;
  const seen = { raise: 0, pass: 0, taken: 0, spilled: 0, scoring: 0, mine: 0 };
  const act = (m) => {
    if (m.type !== 'turn' || m.seat !== me || !m.options) return;
    const o = m.options;
    assert.equal(o.highBid, highBid(game), 'the mirror knows the high bid');
    assert.equal(o.ownBid, bidOf(game, me), 'the mirror knows your bid');
    assert.equal(o.canRaise, o.ownBid + sum(game.hand) > o.highBid, 'the mirror knows whether you can raise');
    seen.mine++;
    const cards = o.canRaise && rng() < 0.6 ? cheapestRaise(game.hand, o.ownBid, o.highBid) : null;
    room.receive('c', cards ? { type: 'raise', cards } : { type: 'pass' });
  };
  const drain = () => {
    while (inbox.length) {
      const m = inbox.shift();
      if (m.type === 'error') throw new Error(`refused: ${m.message}`);
      if (m.type === 'welcome') me = m.seat;
      if (m.type === 'over') over = m;
      if (m.type in seen) seen[m.type]++;
      if (m.type === 'taken' && m.spilled != null) seen.spilled++;
      if (m.type === 'state') game = structuredClone(m.game);
      else if (game) reduceAuction(game, m, me);
      if (game && room.game && !['lobby', 'welcome', 'turn'].includes(m.type)) {
        assert.deepEqual(game, room.engine.snapshot(room.game, me), `mirror diverged after ${m.type}`);
        checked++;
      }
      act(m);
    }
  };
  room.receive('c', { type: 'hello', name: 'Ann' });
  room.receive('c', { type: 'setOptions', options: { mode: 'auction', variant: 'classic', players } });
  for (const p of ['brass', 'noctua', 'gristle'].slice(0, players - 1)) room.receive('c', { type: 'addBot', persona: p });
  room.receive('c', { type: 'start' });
  drain();
  for (let i = 0; i < 200_000 && !over; i++) { if (!clock.next()) break; drain(); }
  assert.ok(over, 'game finished');
  return { checked, seen };
}

test('the auction mirror tracks the server snapshot through whole games', () => {
  const total = { raise: 0, pass: 0, taken: 0, spilled: 0, scoring: 0, mine: 0, checked: 0 };
  for (let seed = 1; seed <= 40; seed++) {
    const { checked, seen } = playMirrored(seed);
    assert.ok(checked > 20);
    total.checked += checked;
    for (const k of Object.keys(seen)) total[k] += seen[k];
  }
  assert.equal(total.scoring, 40, 'every game was scored');
  assert.ok(total.mine > 200, `you bid often (${total.mine})`);
  assert.ok(total.spilled > 3, `Spilled Ale cost someone a curio (${total.spilled})`);
});

test('the auction mirror tracks a three-player table, its empty seat sitting out', () => {
  for (let seed = 1; seed <= 15; seed++) assert.ok(playMirrored(seed, 3).checked > 20);
});

test('the cheapest raise is the smallest total that beats the high bid', () => {
  assert.deepEqual(cheapestRaise([1, 2, 3, 4, 6], 0, 5), [6]);
  assert.deepEqual(cheapestRaise([1, 2, 3, 4], 2, 7), [2, 4]);
  assert.equal(cheapestRaise([1, 2], 0, 3), null);
  assert.deepEqual(cheapestRaise([1, 2, 3, 4, 6, 8, 10, 12, 15, 20, 25], 0, 0), [1]);
});
