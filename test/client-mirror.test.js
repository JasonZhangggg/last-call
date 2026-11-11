import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../src/net/room.js';
import { mulberry32 } from '../src/model/rules.js';
import { reduceDeck } from '../src/modes/deck-state.js';

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

// Plays a whole game with one person who acts only on its own prompts, and checks after every
// message that the client mirror equals the server's snapshot for that seat.
function playMirrored(variant, seed) {
  const clock = new FakeClock(), rng = mulberry32(seed);
  const inbox = [];
  const room = new Room({ code: 'TEST', clock, rng, randomToken: (() => { let n = 0; return () => `t${++n}`; })(), send: (id, m) => inbox.push(structuredClone(m)) });
  let me = null, game = null, checked = 0, over = null, volleys = 0;
  const act = (m) => {
    if (m.type === 'turn' && m.seat === me && m.options) {
      const o = m.options;
      if (o.mustChallenge || (o.canChallenge && rng() < 0.3)) return room.receive('c', { type: 'challenge' });
      const devil = game.hand.find((c) => c.rank === 'devil');
      const pick = devil && rng() < 0.5 ? [devil] : game.hand.filter((c) => c.rank !== 'devil').slice(0, Math.min(o.maxCards, 2));
      room.receive('c', { type: 'play', tokens: (pick.length ? pick : game.hand.slice(0, 1)).map((c) => c.token) });
    }
    if (m.type === 'roulette' && m.seat === me) room.receive('c', { type: 'pull' });
  };
  const drain = () => {
    while (inbox.length) {
      const m = inbox.shift();
      if (m.type === 'error') throw new Error(`refused: ${m.message}`);
      if (m.type === 'welcome') me = m.seat;
      if (m.type === 'over') over = m;
      if (m.type === 'challenge' && m.shooters.length > 1) volleys++;
      if (m.type === 'state') game = structuredClone(m.game);
      else if (game) reduceDeck(game, m, me);
      if (game && room.game && !['lobby', 'welcome', 'turn', 'roulette'].includes(m.type)) {
        const { starter: _a, ...want } = room.engine.snapshot(room.game, me);
        const { starter: _b, ...got } = game;
        assert.deepEqual(got, want, `mirror diverged after ${m.type}`);
        checked++;
      }
      act(m);
    }
  };
  room.receive('c', { type: 'hello', name: 'Ann' });
  room.receive('c', { type: 'setOptions', options: { variant } });
  for (const p of ['brass', 'noctua', 'gristle']) room.receive('c', { type: 'addBot', persona: p });
  room.receive('c', { type: 'start' });
  drain();
  for (let i = 0; i < 100_000 && !over; i++) { if (!clock.next()) break; drain(); }
  assert.ok(over, 'game finished');
  return { checked, volleys };
}

test('the deck mirror tracks the server snapshot through whole games', () => {
  let volleys = 0;
  for (let seed = 1; seed <= 12; seed++) {
    assert.ok(playMirrored('basic', seed).checked > 10);
    const devil = playMirrored('devil', seed);
    assert.ok(devil.checked > 10);
    volleys += devil.volleys;
  }
  assert.ok(volleys > 0, 'a Devil volley was mirrored');
});
