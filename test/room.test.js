import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, ROULETTE_SECONDS } from '../src/net/room.js';
import { deckEngine } from '../src/net/engine-deck.js';
import { ERR, SERVER_KEYS, parseClientMessage } from '../src/net/protocol.js';
import { mulberry32 } from '../src/model/rules.js';

const RANKS = new Set(deckEngine.ranks);
const KEYS = { ...SERVER_KEYS, ...deckEngine.messageKeys };

class FakeClock {
  t = 1_000_000; seq = 0; q = new Map();
  now() { return this.t; }
  setTimeout(fn, ms) { const id = ++this.seq; this.q.set(id, { at: this.t + ms, fn }); return id; }
  clearTimeout(id) { this.q.delete(id); }
  get pending() { return this.q.size; }
  next() {
    let best = null;
    for (const [id, x] of this.q) if (!best || x.at < best[1].at || (x.at === best[1].at && id < best[0])) best = [id, x];
    if (!best) return false;
    this.q.delete(best[0]);
    this.t = Math.max(this.t, best[1].at);
    best[1].fn();
    return true;
  }
  advance(ms) {
    const end = this.t + ms;
    for (;;) {
      let soonest = Infinity;
      for (const x of this.q.values()) soonest = Math.min(soonest, x.at);
      if (soonest > end) break;
      this.next();
    }
    this.t = end;
  }
  runUntil(done, maxSteps = 200_000) {
    for (let i = 0; i < maxSteps && !done(); i++) if (!this.next()) break;
  }
}

/** A scripted person at the table. It decides only from the messages it receives. */
class Player {
  constructor(table, name, { idle = false, think = 300, rng = Math.random } = {}) {
    Object.assign(this, { table, name, idle, think, rng });
    this.id = `client-${++table.ids}`;
    this.log = [];
    this.seat = null; this.token = null; this.hand = []; this.pending = null; this.over = null;
    table.clients.set(this.id, this);
  }
  hello(extra = {}) { this.table.room.receive(this.id, { type: 'hello', name: this.name, ...extra }); }
  send(msg) { this.table.room.receive(this.id, msg); }
  errors() { return this.log.filter((m) => m.type === 'error'); }
  last(type) { return this.log.filter((m) => m.type === type).at(-1); }
  receive(m) {
    this.log.push(m);
    if (m.type === 'welcome') { this.seat = m.seat; this.token = m.resumeToken; }
    if (m.type === 'round') this.hand = m.hand.map((c) => c.token);
    if (m.type === 'state' && m.game) this.hand = m.game.hand.map((c) => c.token);
    if (m.type === 'played' && m.seat === this.seat) this.hand = this.hand.filter((t) => !m.tokens.includes(t));
    if (m.type === 'over') this.over = m;
    if (['played', 'challenge', 'shot', 'over'].includes(m.type)) this.cancel();
    if (this.idle || m.seat !== this.seat) return;
    if (m.type === 'turn' && m.options) this.later(() => this.send(this.chooseTurn(m.options)));
    if (m.type === 'roulette') this.later(() => this.send({ type: 'pull' }));
  }
  chooseTurn(o) {
    if (!o.canPlay || (o.canChallenge && this.rng() < 0.3)) return { type: 'challenge' };
    const n = 1 + Math.floor(this.rng() * o.maxCards);
    return { type: 'play', tokens: this.hand.slice(0, n) };
  }
  later(fn) { this.cancel(); this.pending = this.table.clock.setTimeout(() => { this.pending = null; fn(); }, this.think); }
  cancel() { if (this.pending) this.table.clock.clearTimeout(this.pending); this.pending = null; }
  disconnect() { this.cancel(); this.table.room.disconnect(this.id); }
}

function makeTable(seed = 1) {
  const clock = new FakeClock();
  const table = { clock, clients: new Map(), ids: 0, closed: [] };
  table.room = new Room({
    code: 'TEST', clock, rng: mulberry32(seed),
    send: (id, msg) => table.clients.get(id)?.receive(structuredClone(msg)),
    close: (id) => table.closed.push(id),
  });
  return table;
}

function seatTable({ seed = 1, humans = 1, opts = {} } = {}) {
  const t = makeTable(seed);
  const rng = mulberry32(seed * 7919);
  const people = Array.from({ length: humans }, (_, i) => new Player(t, `P${i}`, { rng, ...(opts[i] || {}) }));
  for (const p of people) p.hello();
  for (const p of people.slice(1)) p.send({ type: 'setReady', ready: true });
  return { t, people, host: people[0] };
}

const finished = (people) => () => people.every((p) => p.over || p.table.room.seatOf(p.id) == null);

test('full games with 1 to 4 people and bots all reach one winner and stop cleanly', () => {
  for (let humans = 1; humans <= 4; humans++) {
    for (let seed = 1; seed <= 15; seed++) {
      const { t, people, host } = seatTable({ seed: seed * 10 + humans, humans });
      host.send({ type: 'start' });
      t.clock.runUntil(finished(people));
      for (const p of people) {
        assert.deepEqual(p.errors(), [], `seat ${p.seat} got no errors`);
        assert.ok(p.over, 'everyone sees the end');
        assert.equal(p.over.seats.filter((s) => s.alive).length, 1);
        assert.ok(p.over.seats[p.over.winner].alive);
      }
      const lobby = host.last('lobby');
      assert.equal(lobby.phase, 'finished');
      assert.equal(lobby.seats.filter((s) => s.kind === 'human').length, humans);
      assert.equal(lobby.seats.filter((s) => s.kind === 'bot').length, 4 - humans, 'bots fill the empty seats');
      assert.equal(t.clock.pending, 0, 'no timers left behind');
    }
  }
});

const ALLOWED_RANK_PATHS = [
  /^round\.tableRank$/, /^round\.hand\.\d+\.rank$/, /^challenge\.cards\.\d+\.rank$/,
  /^state\.game\.tableRank$/, /^state\.game\.hand\.\d+\.rank$/, /^state\.game\.reveal\.cards\.\d+\.rank$/,
];
const FORBIDDEN_KEYS = new Set(['id', 'bullet', 'hands', 'clientId', 'cardIds', 'deck']);

function walk(v, path, visit) {
  visit(v, path);
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, visit);
}

function auditSeat(p) {
  const rounds = new Map();
  let round = null;
  for (const m of p.log) {
    if (KEYS[m.type]) assert.deepEqual(Object.keys(m).filter((k) => k !== 'type').sort(), [...KEYS[m.type]].sort(), `${m.type} has exactly the documented fields`);
    walk(m, m.type, (v, path) => {
      const key = path.split('.').at(-1);
      assert.ok(!FORBIDDEN_KEYS.has(key), `no ${key} field on the wire (${path})`);
      if (key === 'resumeToken') assert.equal(path, 'welcome.resumeToken', 'resume tokens only reach their owner');
      if (typeof v === 'string' && RANKS.has(v)) assert.ok(ALLOWED_RANK_PATHS.some((re) => re.test(path)), `rank leaked at ${path}`);
      if (/\.(hand|cards)\.\d+$/.test(path)) assert.deepEqual(Object.keys(v).sort(), ['rank', 'token'], `card at ${path} is { token, rank }`);
    });
    if (m.type === 'round') rounds.set(m.round, round = { hand: new Map(m.hand.map((c) => [c.token, c.rank])), plays: [] });
    if (m.type === 'state' && m.game?.round) {
      const g = m.game;
      round = rounds.get(g.round) || { hand: new Map(), plays: [] };
      for (const c of g.hand) round.hand.set(c.token, c.rank);
      round.plays = g.plays.map((pl) => ({ seat: pl.seat, tokens: pl.tokens }));
      rounds.set(g.round, round);
    }
    if (m.type === 'played') round.plays.push(m);
    if (m.type === 'challenge') {
      const lastPlay = round.plays.at(-1);
      assert.equal(lastPlay.seat, m.accused);
      assert.deepEqual(m.cards.map((c) => c.token), lastPlay.tokens, 'the reveal shows exactly the last play');
    }
  }
  return rounds;
}

test('no seat ever learns a rank it should not, across many games', () => {
  let games = 0, reveals = 0;
  const everyToken = new Set();
  for (let seed = 1; seed <= 160; seed++) {
    const humans = 1 + (seed % 4);
    const { t, people, host } = seatTable({ seed, humans, opts: { 1: { idle: seed % 5 === 0 } } });
    host.send({ type: 'start' });
    let dropped = false;
    t.clock.runUntil(() => {
      if (!dropped && humans > 1 && seed % 3 === 0 && people[1].log.some((m) => m.type === 'round' && m.round === 2)) {
        dropped = true; people[1].disconnect(); people[1].log.length = 0;
        people[1].hello({ resumeToken: people[1].token });
      }
      return finished(people)();
    });
    games++;
    const bySeat = people.map((p) => auditSeat(p));
    // Each seat's hand per round is its own: disjoint from every other person's hand, and every
    // card a seat plays came from that seat's hand, never from someone else's.
    for (const [r, hostRound] of bySeat[0]) {
      const owner = new Map();
      people.forEach((p, i) => {
        for (const tok of bySeat[i].get(r)?.hand.keys() ?? []) { assert.ok(!owner.has(tok), 'no token in two hands'); owner.set(tok, p.seat); }
      });
      for (const pl of hostRound.plays) for (const tok of pl.tokens) if (owner.has(tok)) assert.equal(owner.get(tok), pl.seat, 'played cards come from the player\'s own hand');
    }
    const seenTokens = new Set();
    for (const round of bySeat[0].values()) for (const tok of round.hand.keys()) { assert.ok(!seenTokens.has(tok), 'tokens are fresh every round'); seenTokens.add(tok); }
    for (const tok of seenTokens) { assert.ok(!everyToken.has(tok), 'tokens never repeat across games, so they cannot encode the card'); everyToken.add(tok); }
    // The reveal a person sees matches what the accused was told about those same cards.
    for (const p of people) for (const m of p.log) if (m.type === 'challenge') {
      reveals++;
      const accused = people.find((q) => q.seat === m.accused);
      if (!accused) continue;
      const theirRound = accused.log.filter((x) => x.type === 'round' || x.type === 'state').reverse()
        .find((x) => (x.type === 'round' ? x.hand : x.game?.hand || []).some((c) => c.token === m.cards[0].token));
      if (!theirRound) continue;
      const told = new Map((theirRound.type === 'round' ? theirRound.hand : theirRound.game.hand).map((c) => [c.token, c.rank]));
      for (const c of m.cards) assert.equal(told.get(c.token), c.rank, 'the reveal agrees with the owner\'s hand');
    }
  }
  assert.equal(games, 160);
  assert.ok(reveals > 500, `reveals were exercised (${reveals})`);
});

test('illegal and out-of-turn actions get an error, and the game carries on', () => {
  const { t, people, host } = seatTable({ seed: 4, humans: 2, opts: { 0: { idle: true }, 1: { idle: true } } });
  const guest = people[1];
  guest.send({ type: 'start' });
  assert.equal(guest.errors().at(-1).code, ERR.notHost);
  host.send({ type: 'start' });
  host.send({ type: 'addBot' });
  assert.equal(host.errors().at(-1).code, ERR.wrongPhase);
  host.send({ type: 'play', tokens: ['nope'] });
  assert.equal(host.errors().at(-1).code, ERR.notYourTurn, 'nothing to play during the deal');
  t.clock.runUntil(() => people.some((p) => p.last('turn')?.options));
  const actor = people.find((p) => p.last('turn')?.options);
  const other = people.find((p) => p !== actor);
  other.send({ type: 'play', tokens: other.hand.slice(0, 1) });
  assert.equal(other.errors().at(-1).code, ERR.notYourTurn);
  actor.send({ type: 'play', tokens: ['not-a-card'] });
  assert.equal(actor.errors().at(-1).code, ERR.illegal);
  actor.send({ type: 'play', tokens: actor.hand.slice(0, 4) });
  assert.equal(actor.errors().at(-1).code, ERR.illegal, 'more than three cards');
  if (!actor.last('turn').options.canChallenge) {
    actor.send({ type: 'challenge' });
    assert.equal(actor.errors().at(-1).code, ERR.illegal, 'nothing to challenge yet');
  }
  actor.send({ type: 'pull' });
  assert.equal(actor.errors().at(-1).code, ERR.illegal);
  actor.send('{not json');
  assert.equal(actor.errors().at(-1).code, ERR.badMessage);
  actor.send({ type: 'teleport' });
  assert.equal(actor.errors().at(-1).code, ERR.badMessage);
  const stranger = new Player(t, 'Lurker');
  stranger.send({ type: 'play', tokens: ['x'] });
  assert.equal(stranger.errors().at(-1).code, ERR.notSeated);
  stranger.hello();
  assert.equal(stranger.errors().at(-1).code, ERR.inProgress);
  assert.ok(t.closed.includes(stranger.id), 'a refused join is closed');

  const before = actor.hand.length;
  actor.send({ type: 'play', tokens: actor.hand.slice(0, 1) });
  assert.equal(actor.last('played').seat, actor.seat, 'a legal play still goes through');
  assert.equal(actor.hand.length, before - 1);
  for (const p of people) p.idle = false;
  t.clock.runUntil(finished(people));
  assert.ok(people.every((p) => p.over));
});

test('protocol rejects malformed client messages at the boundary', () => {
  assert.ok(parseClientMessage({ type: 'hello', name: 'A' }).msg);
  assert.ok(parseClientMessage({ type: 'hello' }).error);
  assert.ok(parseClientMessage({ type: 'play', tokens: [] }).error);
  assert.ok(parseClientMessage({ type: 'play', tokens: [3] }).error);
  assert.ok(parseClientMessage({ type: 'removeBot', seat: 4 }).error);
  assert.ok(parseClientMessage({ type: 'setOptions', options: { mode: 'deck', evil: 1 } }).error);
  assert.ok(parseClientMessage({ type: '__proto__' }).error);
  assert.ok(parseClientMessage('x'.repeat(5000)).error);
});

test('the host role passes to the next person when the host leaves', () => {
  const { t, people, host } = seatTable({ humans: 3 });
  assert.equal(host.last('lobby').host, host.seat);
  host.send({ type: 'leave' });
  assert.ok(t.closed.includes(host.id));
  const lobby = people[1].last('lobby');
  assert.equal(lobby.host, people[1].seat);
  assert.equal(lobby.seats[host.seat].kind, 'empty');
  people[2].send({ type: 'start' });
  assert.equal(people[2].errors().at(-1).code, ERR.notHost);
  people[1].send({ type: 'start' });
  assert.equal(people[1].last('lobby').phase, 'playing');

  people[1].send({ type: 'leave' });
  assert.equal(people[2].last('lobby').host, people[2].seat, 'and again mid-game');
  assert.equal(people[2].last('lobby').seats[people[1].seat].connected, false, 'a bot covers the seat that left');
  t.clock.runUntil(() => people[2].over);
  assert.ok(people[2].over);
});

test('a disconnected player is covered by a bot, and the resume token reclaims the seat', () => {
  const { t, people, host } = seatTable({ seed: 11, humans: 2, opts: { 1: { idle: true } } });
  const guest = people[1];
  host.send({ type: 'start' });
  t.clock.runUntil(() => guest.last('turn')?.options);
  assert.ok(guest.last('turn').timeoutMs > 0, 'a person gets a deadline');
  const handBefore = guest.hand.slice();
  const t0 = t.clock.now();
  guest.disconnect();
  const covered = host.log.filter((m) => m.type === 'turn' && m.seat === guest.seat).at(-1);
  assert.equal(covered.timeoutMs, null, 'everyone sees a bot take the turn');
  assert.equal(host.last('lobby').seats[guest.seat].connected, false);
  t.clock.runUntil(() => host.log.some((m) => (m.type === 'played' || m.type === 'challenge') && t.clock.now() > t0 && (m.seat === guest.seat || m.caller === guest.seat)));
  assert.ok(t.clock.now() - t0 <= 1800, `the bot moves on its own think time (${t.clock.now() - t0} ms)`);

  const back = new Player(t, 'P1 again', { idle: true });
  back.hello({ resumeToken: guest.token });
  assert.equal(back.last('welcome').seat, guest.seat, 'same seat');
  assert.equal(back.last('welcome').resumeToken, guest.token);
  const state = back.last('state');
  assert.equal(state.phase, 'playing');
  assert.ok(state.game.hand.every((c) => RANKS.has(c.rank)));
  const played = host.log.filter((m) => m.type === 'played' && m.seat === guest.seat).flatMap((m) => m.tokens);
  const stillHeld = handBefore.filter((tok) => !played.includes(tok));
  if (state.game.round === host.last('round').round && guest.last('round').round === state.game.round) {
    assert.deepEqual(state.game.hand.map((c) => c.token).sort(), stillHeld.sort(), 'the rebuilt hand is what was left');
  }
  assert.equal(host.last('lobby').seats[guest.seat].connected, true);
  back.idle = false;
  t.clock.runUntil(() => back.over || host.over);
  assert.ok(host.over);
  assert.deepEqual(back.errors(), []);
});

test('reclaiming from a second tab replaces the first connection', () => {
  const { t, host } = seatTable();
  const tab = new Player(t, 'P0');
  tab.hello({ resumeToken: host.token });
  assert.equal(tab.last('welcome').seat, host.seat);
  assert.equal(host.errors().at(-1).code, ERR.replaced);
  assert.ok(t.closed.includes(host.id));
});

test('deadlines act for an idle player: a turn after turnSeconds, the trigger after the roulette limit', () => {
  const { t, people, host } = seatTable({ seed: 21, humans: 1, opts: { 0: { idle: true } } });
  host.send({ type: 'setOptions', options: { turnSeconds: 12 } });
  assert.equal(host.last('lobby').options.turnSeconds, 12);
  host.send({ type: 'start' });
  let turns = 0, roulettes = 0;
  t.clock.runUntil(() => {
    const prompt = host.log.at(-1);
    if (prompt.seat === host.seat && (prompt.type === 'turn' || prompt.type === 'roulette') && prompt.timeoutMs) {
      const start = t.clock.now(), n = host.log.length;
      t.clock.runUntil(() => host.log.length > n);
      const elapsed = t.clock.now() - start;
      const expected = prompt.type === 'turn' ? (prompt.options.mustChallenge ? null : 12_000) : ROULETTE_SECONDS * 1000;
      if (expected) assert.equal(elapsed, expected, `${prompt.type} auto-acts at its deadline`);
      if (prompt.type === 'turn') turns++; else roulettes++;
    }
    return host.over || (turns >= 2 && roulettes >= 1);
  });
  assert.ok(turns >= 2, `idle turns were auto-played (${turns})`);
  assert.deepEqual(host.errors(), []);
  void people;
});

test('with nobody connected the table pauses, and resumes on return', () => {
  const { t, host } = seatTable({ seed: 5 });
  host.send({ type: 'start' });
  t.clock.advance(20_000);
  const seen = host.log.length;
  host.disconnect();
  assert.equal(t.clock.pending, 0, 'no timers while empty');
  t.clock.advance(600_000);
  const back = new Player(t, 'P0');
  back.hello({ resumeToken: host.token });
  assert.equal(back.last('state').phase, 'playing');
  assert.ok(t.clock.pending > 0, 'the game picks up again');
  t.clock.runUntil(() => back.over);
  assert.ok(back.over);
  assert.ok(seen > 0);
});

test('a room restored from its JSON mid-game plays on to the end', () => {
  const { t, people, host } = seatTable({ seed: 8, humans: 2 });
  host.send({ type: 'start' });
  t.clock.advance(40_000);
  const saved = JSON.parse(JSON.stringify(t.room.toJSON()));
  const clock2 = new FakeClock();
  clock2.t = t.clock.now() + 50;
  t.clock = clock2;
  t.room = new Room({ clock: clock2, rng: mulberry32(99), send: (id, msg) => t.clients.get(id)?.receive(structuredClone(msg)), close: () => {} }, saved);
  assert.ok(clock2.pending > 0, 'the saved timer is re-armed');
  t.clock.runUntil(finished(people));
  for (const p of people) { assert.ok(p.over); assert.deepEqual(p.errors(), []); }
});

test('lobby: options, bots, joining full tables, and a rematch', () => {
  const t = makeTable(3);
  const a = new Player(t, '  Ann\u0007<b> the Bold and Beautiful  ');
  a.hello();
  assert.equal(a.last('lobby').seats[0].name, 'Annb the Bold an', 'names are cleaned and capped');
  assert.deepEqual(a.last('lobby').options, { mode: 'deck', variant: 'basic', turnSeconds: 30, private: true });
  a.send({ type: 'setOptions', options: { turnSeconds: 5 } });
  assert.equal(a.errors().at(-1).code, ERR.badOption);
  a.send({ type: 'setOptions', options: { mode: 'dice' } });
  assert.equal(a.errors().at(-1).code, ERR.badOption);
  a.send({ type: 'setOptions', options: { private: false } });
  assert.equal(a.last('lobby').options.private, false);
  a.send({ type: 'addBot', persona: 'gristle' });
  a.send({ type: 'addBot', persona: 'gristle' });
  assert.equal(a.errors().at(-1).code, ERR.illegal, 'each persona sits once');
  a.send({ type: 'addBot' }); a.send({ type: 'addBot' });
  assert.deepEqual(a.last('lobby').seats.map((s) => s.persona), [null, 'gristle', 'brass', 'noctua']);
  const b = new Player(t, 'Bea');
  b.hello();
  assert.equal(b.last('welcome').seat, 3, 'a newcomer takes a bot\'s seat');
  b.send({ type: 'setOptions', options: { private: true } });
  assert.equal(b.errors().at(-1).code, ERR.notHost);
  a.send({ type: 'start' });
  assert.equal(a.errors().at(-1).code, ERR.notReady);
  b.send({ type: 'setReady', ready: true });
  for (const name of ['C', 'D']) { const p = new Player(t, name); p.hello(); }
  const e = new Player(t, 'E');
  e.hello();
  assert.equal(e.errors().at(-1).code, ERR.roomFull);
  const people = [...t.clients.values()].filter((p) => p.seat != null);
  for (const p of people.slice(1)) p.send({ type: 'setReady', ready: true });
  a.send({ type: 'start' });
  t.clock.runUntil(finished(people));
  assert.ok(people.every((p) => p.over));
  for (const p of people) p.over = null;
  for (const p of people.slice(1)) p.send({ type: 'setReady', ready: true });
  a.send({ type: 'start' });
  assert.equal(a.last('lobby').phase, 'playing', 'rematch from the finished table');
  t.clock.runUntil(finished(people));
  assert.ok(people.every((p) => p.over));
});

test('the local transport seats you with three bots and plays a whole game', async () => {
  const { createLocalTransport } = await import('../src/net/client.js');
  const clock = new FakeClock();
  const log = [], statuses = [];
  let hand = [], seat = null;
  const t = createLocalTransport({ name: 'Solo', clock });
  t.connect({
    onStatus: (s) => statuses.push(s),
    onMessage: (m) => {
      log.push(m);
      if (m.type === 'welcome') seat = m.seat;
      if (m.type === 'round') hand = m.hand.map((c) => c.token);
      if (m.type === 'played' && m.seat === seat) hand = hand.filter((x) => !m.tokens.includes(x));
      if (m.type === 'turn' && m.options) t.send(m.options.canPlay ? { type: 'play', tokens: hand.slice(0, 1) } : { type: 'challenge' });
      if (m.type === 'roulette' && m.seat === seat) t.send({ type: 'pull' });
    },
  });
  const settle = () => new Promise((r) => setImmediate(r));
  await settle();
  assert.deepEqual(log.slice(0, 3).map((m) => m.type), ['welcome', 'lobby', 'state']);
  assert.deepEqual(log.filter((m) => m.type === 'lobby').at(-1).seats.map((s) => s.persona), [null, 'brass', 'noctua', 'gristle']);
  t.send({ type: 'start' });
  for (let i = 0; i < 100_000 && !log.some((m) => m.type === 'over'); i++) { await settle(); if (!clock.next()) await settle(); }
  assert.ok(log.some((m) => m.type === 'over'));
  assert.deepEqual(log.filter((m) => m.type === 'error'), []);
  t.close();
  assert.deepEqual(statuses, ['open', 'closed']);
  assert.equal(clock.pending, 0);
});

test('the room ends cleanly when everyone leaves', () => {
  const { t, people, host } = seatTable({ seed: 2, humans: 2 });
  host.send({ type: 'start' });
  t.clock.advance(15_000);
  for (const p of people) p.send({ type: 'leave' });
  assert.ok(t.room.isAbandoned());
  assert.equal(t.room.connectedHumans(), 0);
  assert.equal(t.clock.pending, 0);
});
