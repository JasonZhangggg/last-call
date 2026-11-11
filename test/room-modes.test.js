import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../src/net/room.js';
import { ENGINES } from '../src/net/engines.js';
import { ERR, SERVER_KEYS, parseClientMessage } from '../src/net/protocol.js';
import { mulberry32, DEVIL } from '../src/model/rules.js';

const MODES = Object.values(ENGINES).flatMap((e) => e.variants.map((variant) => ({ mode: e.mode, variant })));

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
  runUntil(done, maxSteps = 400_000) {
    for (let i = 0; i < maxSteps && !done(); i++) if (!this.next()) break;
  }
}

/**
 * A scripted person who decides only from the messages it receives. Each message is logged with
 * the server's true state at the moment it arrived (`truth`), so an audit can compare the two.
 */
class Player {
  constructor(table, name, { idle = false, think = 300, rng = Math.random } = {}) {
    Object.assign(this, { table, name, idle, think, rng });
    this.id = `client-${++table.ids}`;
    this.log = []; this.truth = [];
    this.seat = null; this.token = null; this.hand = new Map(); this.pending = null; this.over = null;
    table.clients.set(this.id, this);
  }
  hello(extra = {}) { this.table.room.receive(this.id, { type: 'hello', name: this.name, ...extra }); }
  send(msg) { this.table.room.receive(this.id, msg); }
  errors() { return this.log.filter((m) => m.type === 'error'); }
  last(type) { return this.log.filter((m) => m.type === type).at(-1); }
  receive(m) {
    this.log.push(m);
    this.truth.push(this.table.room.game ? structuredClone(this.table.room.game) : null);
    if (m.type === 'welcome') { this.seat = m.seat; this.token = m.resumeToken; }
    if (m.type === 'round' && m.hand) this.hand = new Map(m.hand.map((c) => [c.token, c.rank]));
    if (m.type === 'state' && m.game?.hand) this.hand = new Map(m.game.hand.map((c) => [c.token, c.rank]));
    if (m.type === 'played' && m.seat === this.seat) for (const t of m.tokens) this.hand.delete(t);
    if (m.type === 'over') this.over = m;
    if (['played', 'bid', 'challenge', 'shot', 'drink', 'over'].includes(m.type)) this.cancel();
    if (this.idle || m.seat !== this.seat) return;
    if (m.type === 'turn' && m.options) this.later(() => this.send(this.chooseTurn(m.options)));
    if (m.type === 'roulette') this.later(() => this.send({ type: 'pull' }));
  }
  chooseTurn(o) {
    if ('canBid' in o) {
      if (o.canBid && (!o.canChallenge || this.rng() < 0.75)) {
        const r = o.raises[Math.floor(this.rng() * o.raises.length)];
        return { type: 'bid', quantity: Math.min(o.maxQuantity, r.minQuantity + (this.rng() < 0.2 ? 1 : 0)), face: r.face };
      }
      return o.canSpotOn && this.rng() < 0.3 ? { type: 'spotOn' } : { type: 'challenge' };
    }
    if (!o.canPlay || (o.canChallenge && this.rng() < 0.3)) return { type: 'challenge' };
    const n = 1 + Math.floor(this.rng() * o.maxCards);
    const devil = [...this.hand.keys()].find((t) => this.hand.get(t) === DEVIL);
    const others = [...this.hand.keys()].filter((t) => t !== devil);
    if (devil && (!others.length || this.rng() < 0.3)) return { type: 'play', tokens: [devil] };
    return { type: 'play', tokens: others.slice(0, n) };
  }
  later(fn) { this.cancel(); this.pending = this.table.clock.setTimeout(() => { this.pending = null; fn(); }, this.think); }
  cancel() { if (this.pending) this.table.clock.clearTimeout(this.pending); this.pending = null; }
  disconnect() { this.cancel(); this.table.room.disconnect(this.id); }
}

function seatTable({ seed = 1, humans = 1, mode, variant, opts = {} }) {
  const clock = new FakeClock();
  const t = { clock, clients: new Map(), ids: 0, closed: [] };
  t.room = new Room({
    code: 'TEST', clock, rng: mulberry32(seed),
    send: (id, msg) => t.clients.get(id)?.receive(structuredClone(msg)),
    close: (id) => t.closed.push(id),
  });
  const rng = mulberry32(seed * 7919);
  const people = Array.from({ length: humans }, (_, i) => new Player(t, `P${i}`, { rng, ...(opts[i] || {}) }));
  for (const p of people) p.hello();
  people[0].send({ type: 'setOptions', options: { mode, variant } });
  for (const p of people.slice(1)) p.send({ type: 'setReady', ready: true });
  return { t, people, host: people[0] };
}

const finished = (people) => () => people.every((p) => p.over || p.table.room.seatOf(p.id) == null);

for (const { mode, variant } of MODES) {
  test(`${mode} ${variant}: full games with 1 to 4 people reach one winner and stop cleanly`, () => {
    const results = mode === 'deck' ? ['alive', 'kind', 'name', 'pulls'] : ['alive', 'drinks', 'kind', 'name'];
    for (let humans = 1; humans <= 4; humans++) {
      for (let seed = 1; seed <= 8; seed++) {
        const { t, people, host } = seatTable({ seed: seed * 10 + humans, humans, mode, variant });
        assert.deepEqual(host.last('lobby').options, { mode, variant, turnSeconds: 30, private: true });
        host.send({ type: 'start' });
        t.clock.runUntil(finished(people));
        for (const p of people) {
          assert.deepEqual(p.errors(), [], `seat ${p.seat} got no errors`);
          assert.ok(p.over, 'everyone sees the end');
          assert.equal(p.over.seats.filter((s) => s.alive).length, 1);
          assert.ok(p.over.seats[p.over.winner].alive);
          for (const s of p.over.seats) assert.deepEqual(Object.keys(s).sort(), results);
        }
        assert.equal(t.clock.pending, 0, 'no timers left behind');
      }
    }
  });
}

const FORBIDDEN_KEYS = new Set(['id', 'bullet', 'poison', 'hands', 'clientId', 'cardIds', 'deck', 'tokenOf', 'pending', 'queue', 'startFrom']);
const SNAPSHOT_KEYS = {
  deck: ['alive', 'hand', 'handCounts', 'plays', 'pulls', 'reveal', 'round', 'starter', 'tableRank', 'variant'],
  dice: ['alive', 'bids', 'dice', 'diceCounts', 'drinks', 'reveal', 'round', 'starter', 'variant'],
};
const OPTION_KEYS = {
  deck: ['canChallenge', 'canPlay', 'maxCards', 'mustChallenge'],
  dice: ['canBid', 'canChallenge', 'canSpotOn', 'maxQuantity', 'mustChallenge', 'raises'],
};
// The 'devil' variant shares its name with the Devil rank, so the variant fields may carry it.
const RANK_PATHS = [
  /^round\.tableRank$/, /^round\.hand\.\d+\.rank$/, /^challenge\.cards\.\d+\.rank$/,
  /^state\.game\.tableRank$/, /^state\.game\.hand\.\d+\.rank$/, /^state\.game\.reveal\.cards\.\d+\.rank$/,
  /^lobby\.options\.variant$/, /^state\.game\.variant$/,
];
const DICE_PATHS = [/^round\.dice$/, /^state\.game\.dice$/];
const CUP_PATHS = [/^challenge\.cups$/, /^state\.game\.reveal\.cups$/];

function walk(v, path, visit) {
  visit(v, path);
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, visit);
}

/** The cards a deck seat was shown, checked against the server's hand for that seat. */
function ownCardsTrue(cards, S, seat) {
  const tokenToCard = new Map(S.g.players[seat].hand.map((c) => [S.tokenOf[c.id], c]));
  for (const c of cards) assert.equal(tokenToCard.get(c.token)?.rank, c.rank, 'a seat is shown exactly its own cards');
  assert.equal(cards.length, tokenToCard.size);
}

/**
 * Walks one seat's whole log. Every message has exactly its documented keys, no hidden field
 * appears anywhere, and hidden values (ranks, dice, cups) appear only at the paths where that
 * seat may see them, with the values the server actually holds.
 */
function auditSeat(p, mode) {
  const engine = ENGINES[mode];
  const KEYS = { ...SERVER_KEYS, ...engine.messageKeys };
  const ranks = new Set(engine.ranks);
  const stats = { reveals: 0, multi: 0 };
  let owed = null;
  p.log.forEach((m, i) => {
    const S = p.truth[i];
    if (KEYS[m.type]) assert.deepEqual(Object.keys(m).filter((k) => k !== 'type').sort(), [...KEYS[m.type]].sort(), `${m.type} has exactly the documented fields`);
    if (m.type === 'turn' && m.options) assert.deepEqual(Object.keys(m.options).sort(), OPTION_KEYS[mode]);
    if (m.type === 'state' && m.game) assert.deepEqual(Object.keys(m.game).sort(), SNAPSHOT_KEYS[mode]);
    walk(m, m.type, (v, path) => {
      const key = path.split('.').at(-1);
      assert.ok(!FORBIDDEN_KEYS.has(key), `no ${key} field on the wire (${path})`);
      if (key === 'resumeToken') assert.equal(path, 'welcome.resumeToken', 'resume tokens only reach their owner');
      if (typeof v === 'string' && ranks.has(v)) assert.ok(RANK_PATHS.some((re) => re.test(path)), `rank leaked at ${path}`);
      if (key === 'dice') assert.ok(DICE_PATHS.some((re) => re.test(path)), `dice at ${path}`);
      if (key === 'cups') assert.ok(CUP_PATHS.some((re) => re.test(path)), `cups at ${path}`);
    });
    if (mode === 'deck') {
      if (m.type === 'round') ownCardsTrue(m.hand, S, p.seat);
      if (m.type === 'state' && m.game?.round) ownCardsTrue(m.game.hand, S, p.seat);
    } else {
      if (m.type === 'round') assert.deepEqual(m.dice, S.g.players[p.seat].dice, 'a seat is told its own dice');
      if (m.type === 'state' && m.game) assert.deepEqual(m.game.dice, S.g.players[p.seat].dice, 'a rebuild holds only your own dice');
      if (m.type === 'challenge') assert.deepEqual(m.cups, S.g.players.map((x) => x.dice), 'the reveal shows every true cup');
    }
    // A call announces who pays; the penalty prompts and results then follow in exactly that order.
    if (m.type === 'challenge') {
      stats.reveals++;
      owed = (m.shooters || m.drinkers).slice();
      if (owed.length > 1) stats.multi++;
    }
    if (m.type === 'roulette') assert.equal(m.seat, owed?.[0], 'the next shooter or drinker is prompted');
    if (m.type === 'shot' || m.type === 'drink') assert.equal(m.seat, owed.shift(), 'penalties resolve in order');
    if (m.type === 'round' || m.type === 'over') owed = null;
    if (m.type === 'state') owed = S?.g.pending ? [S.g.pending.seat, ...S.g.pending.queue] : null;
  });
  return stats;
}

for (const { mode, variant } of MODES) {
  test(`${mode} ${variant}: no seat learns hidden information, across many games with reconnects`, () => {
    let reveals = 0, multi = 0, rebuilds = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const humans = 1 + (seed % 4);
      const { t, people, host } = seatTable({ seed, humans, mode, variant, opts: { 1: { idle: seed % 5 === 0 } } });
      host.send({ type: 'start' });
      let dropped = false;
      t.clock.runUntil(() => {
        if (!dropped && humans > 1 && seed % 3 === 0 && people[1].log.some((m) => m.type === 'round' && m.round === 2)) {
          dropped = true; people[1].disconnect(); people[1].log.length = 0; people[1].truth.length = 0;
          people[1].hello({ resumeToken: people[1].token });
          rebuilds++;
        }
        return finished(people)();
      });
      for (const p of people) {
        assert.deepEqual(p.errors(), []);
        const s = auditSeat(p, mode);
        reveals += s.reveals; multi += s.multi;
      }
    }
    assert.ok(reveals > 300, `reveals were exercised (${reveals})`);
    assert.ok(rebuilds > 5, 'mid-game rebuilds were exercised');
    if (variant === 'devil' || variant === 'traditional') assert.ok(multi > 5, `several seats paid for one call (${multi})`);
    else assert.equal(multi, 0, 'one seat pays per call');
  });
}

/** Runs to the acting human's next turn prompt. */
function toTurn(t, p) {
  t.clock.runUntil(() => p.log.at(-1)?.type === 'turn' && p.log.at(-1).options && p.log.at(-1).seat === p.seat);
  return p.log.at(-1).options;
}

function refusedWithoutChange(t, p, msg, code) {
  const before = JSON.stringify(t.room.toJSON().game);
  p.send(msg);
  assert.equal(p.errors().at(-1)?.code, code, `${JSON.stringify(msg)} is refused`);
  assert.equal(JSON.stringify(t.room.toJSON().game), before, `${JSON.stringify(msg)} changes nothing`);
  p.log.pop(); p.truth.pop();
}

test('dice: illegal and out-of-turn actions get an error and change nothing', () => {
  const { t, people, host } = seatTable({ seed: 4, humans: 2, mode: 'dice', variant: 'basic', opts: { 0: { idle: true }, 1: { idle: true } } });
  host.send({ type: 'start' });
  refusedWithoutChange(t, host, { type: 'bid', quantity: 1, face: 2 }, ERR.notYourTurn);
  const o = toTurn(t, host);
  const other = people[1];
  refusedWithoutChange(t, other, { type: 'bid', quantity: 9, face: 6 }, ERR.notYourTurn);
  refusedWithoutChange(t, host, { type: 'bid', quantity: 2, face: 1 }, ERR.illegal);
  refusedWithoutChange(t, host, { type: 'bid', quantity: 0, face: 3 }, ERR.illegal);
  refusedWithoutChange(t, host, { type: 'bid', quantity: o.maxQuantity + 1, face: 3 }, ERR.illegal);
  refusedWithoutChange(t, host, { type: 'bid', quantity: 2.5, face: 3 }, ERR.badMessage);
  refusedWithoutChange(t, host, { type: 'bid', quantity: 2 }, ERR.badMessage);
  refusedWithoutChange(t, host, { type: 'play', tokens: ['x'] }, ERR.illegal);
  refusedWithoutChange(t, host, { type: 'pull' }, ERR.illegal);
  refusedWithoutChange(t, host, { type: 'spotOn' }, ERR.illegal);
  if (!o.canChallenge) refusedWithoutChange(t, host, { type: 'challenge' }, ERR.illegal);
  const minFor3 = o.raises.find((r) => r.face === 3).minQuantity;
  host.send({ type: 'bid', quantity: minFor3, face: 3 });
  assert.deepEqual(host.last('bid'), { type: 'bid', seat: host.seat, quantity: minFor3, face: 3 }, 'a legal bid goes through');
  toTurn(t, other);
  refusedWithoutChange(t, other, { type: 'bid', quantity: minFor3, face: 3 }, ERR.illegal);
  refusedWithoutChange(t, other, { type: 'bid', quantity: minFor3, face: 2 }, ERR.illegal);
  for (const p of people) p.idle = false;
  t.clock.runUntil(finished(people));
  assert.ok(people.every((p) => p.over));
});

test('deck: dice actions and a Devil played with other cards are refused without change', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { t, host } = seatTable({ seed, humans: 1, mode: 'deck', variant: 'devil', opts: { 0: { idle: true } } });
    host.send({ type: 'start' });
    toTurn(t, host);
    refusedWithoutChange(t, host, { type: 'bid', quantity: 3, face: 4 }, ERR.illegal);
    refusedWithoutChange(t, host, { type: 'spotOn' }, ERR.illegal);
    const devil = [...host.hand].find(([, r]) => r === DEVIL)?.[0];
    if (!devil) continue;
    const other = [...host.hand.keys()].find((tok) => tok !== devil);
    refusedWithoutChange(t, host, { type: 'play', tokens: [devil, other] }, ERR.illegal);
    host.send({ type: 'play', tokens: [devil] });
    assert.deepEqual(host.last('played').tokens, [devil], 'the Devil alone is a legal play');
    return;
  }
  assert.fail('no seed dealt the host the Devil');
});

test('protocol: bid and spotOn have their shapes checked at the boundary', () => {
  assert.ok(parseClientMessage({ type: 'bid', quantity: 3, face: 4 }).msg);
  assert.ok(parseClientMessage({ type: 'bid', quantity: '3', face: 4 }).error);
  assert.ok(parseClientMessage({ type: 'bid', face: 4 }).error);
  assert.ok(parseClientMessage({ type: 'spotOn' }).msg);
});

test('lobby: the host picks a mode and a variant; a mode change resets the variant', () => {
  const { host } = seatTable({ seed: 3, humans: 1, mode: 'dice', variant: 'traditional' });
  assert.deepEqual(host.last('lobby').options, { mode: 'dice', variant: 'traditional', turnSeconds: 30, private: true });
  host.send({ type: 'setOptions', options: { variant: 'devil' } });
  assert.equal(host.errors().at(-1).code, ERR.badOption, 'variants belong to their mode');
  host.send({ type: 'setOptions', options: { mode: 'deck' } });
  assert.equal(host.last('lobby').options.variant, 'basic');
  host.send({ type: 'setOptions', options: { variant: 'devil' } });
  assert.equal(host.last('lobby').options.variant, 'devil');
  host.send({ type: 'setOptions', options: { mode: 'dice', variant: 'traditional' } });
  assert.deepEqual([host.last('lobby').options.mode, host.last('lobby').options.variant], ['dice', 'traditional']);
});

test('dice: a room restored from its JSON mid-game plays on to the end', () => {
  const { t, people, host } = seatTable({ seed: 8, humans: 2, mode: 'dice', variant: 'traditional' });
  host.send({ type: 'start' });
  t.clock.runUntil(() => host.log.filter((m) => m.type === 'drink').length >= 2);
  const saved = JSON.parse(JSON.stringify(t.room.toJSON()));
  const clock2 = new FakeClock();
  clock2.t = t.clock.now() + 50;
  t.clock = clock2;
  t.room = new Room({ clock: clock2, rng: mulberry32(99), send: (id, msg) => t.clients.get(id)?.receive(structuredClone(msg)), close: () => {} }, saved);
  assert.ok(clock2.pending > 0, 'the saved timer is re-armed');
  t.clock.runUntil(finished(people));
  for (const p of people) { assert.ok(p.over); assert.deepEqual(p.errors(), []); }
});
