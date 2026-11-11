// A table of up to four seats, as a pure state machine. Everything outside it is injected, so the
// same Room runs inside a Durable Object and in the browser for single-player:
//   send(clientId, msg)   deliver one server message to one connection
//   close(clientId)       end a connection the room no longer serves (optional)
//   clock                 { now(), setTimeout(fn, ms), clearTimeout(handle) }
//   rng, randomToken      game randomness and opaque ids (crypto by default)
//   onChange()            called after every state change, for persistence (optional)
//
// Phases: 'lobby' -> 'playing' -> 'finished' -> ('playing' again on rematch).
// While playing, the Room waits on exactly one timer: either 'advance' (the pause after an event
// has elapsed, move the game on) or 'auto' (a bot, a timeout, or a forced call acts for the
// prompted seat). The timer is serialized, so a restored Room carries on where it stopped.
import { ENGINES } from './engines.js';
import { DEFAULT_OPTIONS, ERR, FATAL, MAX_SEATS, TURN_SECONDS, cleanName, cryptoRng, parseClientMessage, randomToken } from './protocol.js';

export const START_DELAY_MS = 500;
export const ROULETTE_SECONDS = 20;

const EMPTY = Object.freeze({ kind: 'empty' });
const realClock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h) };

const HOST_ONLY = new Set(['start', 'addBot', 'removeBot', 'setOptions']);
const SETUP = new Set(['setReady', 'setOptions', 'start', 'addBot', 'removeBot']);
const GAME = new Set(['play', 'challenge', 'pull']);

class Refusal extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const refuse = (code, message) => { throw new Refusal(code, message); };

export class Room {
  constructor(deps, saved = null) {
    this.send = deps.send;
    this.closeClient = deps.close || (() => {});
    this.clock = deps.clock || realClock;
    this.rng = deps.rng || cryptoRng;
    this.mint = deps.randomToken || (() => randomToken());
    this.onChange = deps.onChange || (() => {});
    this.engines = deps.engines || ENGINES;
    this.timerHandle = null;
    const s = saved || {
      code: deps.code ?? null, phase: 'lobby', options: { ...DEFAULT_OPTIONS },
      seats: Array.from({ length: MAX_SEATS }, () => EMPTY), host: null,
      game: null, memory: [], prompt: null, timer: null, pausedAt: null, result: null,
    };
    Object.assign(this, s);
    this.runClock();
  }

  toJSON() {
    const { code, phase, options, seats, host, game, memory, prompt, timer, pausedAt, result } = this;
    return structuredClone({ code, phase, options, seats, host, game, memory, prompt, timer, pausedAt, result });
  }

  get engine() { return this.engines[this.options.mode]; }

  /* ---------- entry points (each ends in onChange) ---------- */

  receive(clientId, raw) {
    const { msg, error } = parseClientMessage(raw);
    try {
      if (error) refuse(ERR.badMessage, error);
      this.dispatch(clientId, msg);
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      this.send(clientId, { type: 'error', code: e.code, message: e.message });
      if (FATAL.has(e.code)) this.closeClient(clientId);
    }
    this.onChange();
  }

  disconnect(clientId) {
    const s = this.seatOf(clientId);
    if (s == null) return;
    this.seats[s] = { ...this.seats[s], connected: false };
    this.afterControlChange(s);
    this.onChange();
  }

  /* ---------- queries ---------- */

  seatOf(clientId) {
    const i = this.seats.findIndex((x) => x.kind === 'human' && x.connected && x.clientId === clientId);
    return i < 0 ? null : i;
  }
  connectedHumans() { return this.connectedClients().length; }
  connectedClients() { return this.seats.filter((x) => x.kind === 'human' && x.connected).map((x) => x.clientId); }
  /** No person holds or can reclaim a seat: the host may discard the room. */
  isAbandoned() { return !this.seats.some((x) => x.kind === 'human' && !x.left); }
  pendingTimer() { return this.timer ? { ...this.timer } : null; }

  controlled(s) { const x = this.seats[s]; return x.kind === 'human' && x.connected; }

  /* ---------- message handling ---------- */

  dispatch(clientId, msg) {
    if (msg.type === 'hello') return this.hello(clientId, msg);
    const seat = this.seatOf(clientId);
    if (seat == null) refuse(ERR.notSeated, 'Say hello first.');
    if (HOST_ONLY.has(msg.type) && seat !== this.host) refuse(ERR.notHost, 'Only the host can do that.');
    if (SETUP.has(msg.type) && this.phase === 'playing') refuse(ERR.wrongPhase, 'The game is already running.');
    if (GAME.has(msg.type)) return this.humanAction(seat, msg);
    switch (msg.type) {
      case 'setReady': this.seats[seat] = { ...this.seats[seat], ready: msg.ready }; return this.broadcastLobby();
      case 'setOptions': return this.setOptions(msg.options);
      case 'addBot': return this.addBot(msg.persona);
      case 'removeBot': return this.removeBot(msg.seat);
      case 'start': return this.start();
      case 'leave': return this.leave(seat, clientId);
    }
  }

  hello(clientId, { name, resumeToken }) {
    if (this.seatOf(clientId) != null) refuse(ERR.alreadySeated, 'You already have a seat.');
    const back = resumeToken ? this.seats.findIndex((x) => x.kind === 'human' && !x.left && x.resumeToken === resumeToken) : -1;
    if (back >= 0) return this.reclaim(back, clientId);
    if (this.phase === 'playing') refuse(ERR.inProgress, 'That game has already started.');
    let s = this.seats.findIndex((x) => x.kind === 'empty');
    if (s < 0) s = this.seats.findLastIndex((x) => x.kind === 'bot');
    if (s < 0) refuse(ERR.roomFull, 'That table is full.');
    this.seats[s] = {
      kind: 'human', name: cleanName(name) || `Player ${s + 1}`, clientId,
      resumeToken: this.mint(), connected: true, ready: false, left: false,
    };
    if (this.host == null) this.host = s;
    this.welcome(s);
    this.broadcastLobby();
  }

  reclaim(s, clientId) {
    const old = this.seats[s];
    if (old.connected && old.clientId !== clientId) {
      this.send(old.clientId, { type: 'error', code: ERR.replaced, message: 'This seat was opened somewhere else.' });
      this.closeClient(old.clientId);
    }
    this.seats[s] = { ...old, clientId, connected: true };
    this.welcome(s);
    this.afterControlChange(s);
  }

  welcome(s) {
    const x = this.seats[s];
    this.send(x.clientId, { type: 'welcome', seat: s, roomCode: this.code, resumeToken: x.resumeToken });
    this.send(x.clientId, this.lobbyMessage());
    this.send(x.clientId, this.stateMessage(s));
  }

  leave(s, clientId) {
    if (this.phase === 'playing') this.seats[s] = { ...this.seats[s], connected: false, left: true, resumeToken: null };
    else this.seats[s] = EMPTY;
    this.closeClient(clientId);
    this.afterControlChange(s);
  }

  /** A seat gained or lost its person: fix the host, the clock, and who drives a live prompt. */
  afterControlChange(s) {
    if (this.host === s && !this.controlled(s)) this.host = this.nextHost(s);
    else if (this.host == null && this.controlled(s)) this.host = s;
    this.runClock();
    this.reconcilePrompt();
    this.broadcastLobby();
  }

  /** A person drives a prompt with a deadline; a bot drives it with think time. Idempotent. */
  reconcilePrompt() {
    const p = this.prompt;
    if (this.phase !== 'playing' || !p || this.connectedHumans() === 0) return;
    const human = this.controlled(p.seat);
    if (human === (p.deadline != null)) return;
    const now = this.clock.now();
    if (human) {
      p.deadline = now + this.limitMs(p);
      this.arm('auto', p.deadline - now);
    } else {
      const left = p.deadline - now;
      p.deadline = null;
      this.arm('auto', Math.min(left, this.engine.thinkMs(p, this.rng)));
    }
    this.broadcastPrompt();
  }

  nextHost(from) {
    for (let k = 1; k <= MAX_SEATS; k++) { const s = (from + k) % MAX_SEATS; if (this.controlled(s)) return s; }
    return null;
  }

  /* ---------- lobby ---------- */

  setOptions(patch) {
    const next = { ...this.options, ...patch };
    const engine = this.engines[next.mode];
    if (!engine) refuse(ERR.badOption, `Unknown mode ${next.mode}.`);
    if (patch.mode && patch.mode !== this.options.mode && !patch.variant) next.variant = engine.variants[0];
    if (!engine.variants.includes(next.variant)) refuse(ERR.badOption, `Unknown variant ${next.variant}.`);
    if (next.turnSeconds < TURN_SECONDS.min || next.turnSeconds > TURN_SECONDS.max) refuse(ERR.badOption, `Turn time must be ${TURN_SECONDS.min} to ${TURN_SECONDS.max} seconds.`);
    if (next.mode !== this.options.mode) { this.game = null; this.result = null; }
    this.options = next;
    this.broadcastLobby();
  }

  freeBots() {
    const used = new Set(this.seats.filter((x) => x.kind === 'bot').map((x) => x.persona));
    return this.engine.bots.filter((b) => !used.has(b.persona));
  }

  addBot(persona) {
    const s = this.seats.findIndex((x) => x.kind === 'empty');
    if (s < 0) refuse(ERR.roomFull, 'No empty seat.');
    const free = this.freeBots();
    const bot = persona ? free.find((b) => b.persona === persona) : free[0];
    if (!bot) refuse(ERR.illegal, persona ? `${persona} is unavailable.` : 'No bots left.');
    this.seats[s] = { kind: 'bot', name: bot.name, persona: bot.persona };
    this.broadcastLobby();
  }

  removeBot(s) {
    const x = this.seats[s];
    if (x.kind !== 'bot' && !(x.kind === 'human' && !x.connected)) refuse(ERR.illegal, 'Only a bot or an absent player can be removed.');
    this.seats[s] = EMPTY;
    this.broadcastLobby();
  }

  start() {
    const waiting = this.seats.filter((x, s) => x.kind === 'human' && x.connected && s !== this.host && !x.ready);
    if (waiting.length) refuse(ERR.notReady, `Waiting for ${waiting.map((x) => x.name).join(', ')}.`);
    for (let s = 0; s < MAX_SEATS; s++) if (this.seats[s].kind === 'empty') {
      const bot = this.freeBots()[0];
      if (bot) this.seats[s] = { kind: 'bot', name: bot.name, persona: bot.persona };
    }
    if (this.seats.some((x) => x.kind === 'empty')) refuse(ERR.illegal, 'Not enough players to fill the table.');
    this.phase = 'playing';
    this.result = null;
    this.game = this.engine.newGame({ seats: MAX_SEATS, rng: this.rng, options: this.options });
    this.memory = this.seats.map(() => ({}));
    this.prompt = null;
    this.pausedAt = null;
    this.broadcastLobby();
    this.broadcastState();
    this.arm('advance', START_DELAY_MS);
  }

  /* ---------- the game ---------- */

  limitMs(p) {
    if (p.forced) return this.engine.thinkMs(p, this.rng);
    return (p.kind === 'roulette' ? ROULETTE_SECONDS : this.options.turnSeconds) * 1000;
  }

  advance() {
    const st = this.engine.stage(this.game);
    if (st.kind === 'deal') {
      const ev = this.engine.startRound(this.game, this.rng, this.mint);
      this.broadcast(ev);
      return this.arm('advance', this.engine.pace(ev, this.rng));
    }
    if (st.kind === 'over') return this.finish(st.winner);
    const p = this.prompt = { kind: st.kind, seat: st.seat, forced: !!st.forced, deadline: null };
    if (this.controlled(p.seat)) {
      p.deadline = this.clock.now() + this.limitMs(p);
      this.arm('auto', p.deadline - this.clock.now());
    } else {
      this.arm('auto', this.engine.thinkMs(p, this.rng));
    }
    this.broadcastPrompt();
  }

  /** A bot acts for the prompted seat: its own turn, a timeout, a forced call, or an absent player. */
  auto() {
    const s = this.prompt.seat, x = this.seats[s];
    this.act(s, this.engine.botDecide(this.game, s, x.kind === 'bot' ? x.persona : null, this.memory[s], this.rng));
  }

  humanAction(seat, msg) {
    const p = this.prompt;
    if (this.phase !== 'playing' || !p || p.seat !== seat) refuse(ERR.notYourTurn, 'It is not your move.');
    const action = msg.type === 'play' ? { type: 'play', tokens: msg.tokens } : { type: msg.type };
    let ev;
    try { ev = this.engine.applyAction(this.game, seat, action); } catch (e) { refuse(ERR.illegal, e.message); }
    this.commit(ev);
  }

  act(seat, action) { this.commit(this.engine.applyAction(this.game, seat, action)); }

  commit(ev) {
    this.prompt = null;
    for (const m of this.memory) this.engine.observe(m, ev);
    this.broadcast(ev);
    this.arm('advance', this.engine.pace(ev, this.rng));
  }

  finish(winner) {
    this.disarm();
    const res = this.engine.results(this.game);
    this.result = { type: 'over', winner, seats: this.seats.map((x, s) => ({ name: x.name ?? null, kind: x.kind, ...res[s] })) };
    this.phase = 'finished';
    this.prompt = null;
    this.broadcastAll(() => this.result);
    this.seats = this.seats.map((x) => (x.kind === 'human' ? (x.left ? EMPTY : { ...x, ready: false }) : x));
    if (this.host != null && !this.controlled(this.host)) this.host = this.nextHost(this.host);
    this.broadcastLobby();
  }

  /* ---------- the one timer ---------- */

  arm(job, ms) {
    if (this.timerHandle != null) this.clock.clearTimeout(this.timerHandle);
    this.timerHandle = null;
    this.timer = { job, due: this.clock.now() + Math.max(0, ms) };
    this.runClock();
  }

  disarm() {
    if (this.timerHandle != null) this.clock.clearTimeout(this.timerHandle);
    this.timerHandle = null;
    this.timer = null;
  }

  /** Runs the timer while someone is watching; with nobody connected the table holds its breath. */
  runClock() {
    const now = this.clock.now();
    const run = this.phase === 'playing' && this.connectedHumans() > 0;
    if (!run) {
      if (this.timerHandle != null) { this.clock.clearTimeout(this.timerHandle); this.timerHandle = null; }
      if (this.phase === 'playing' && this.pausedAt == null) this.pausedAt = now;
      return;
    }
    if (this.pausedAt != null) {
      const shift = now - this.pausedAt;
      if (this.timer) this.timer.due += shift;
      if (this.prompt?.deadline != null) this.prompt.deadline += shift;
      this.pausedAt = null;
    }
    if (this.timer && this.timerHandle == null) this.timerHandle = this.clock.setTimeout(() => this.fire(), Math.max(0, this.timer.due - now));
  }

  fire() {
    const { job } = this.timer;
    this.timerHandle = null;
    this.timer = null;
    if (job === 'advance') this.advance();
    else this.auto();
    this.onChange();
  }

  /* ---------- outgoing ---------- */

  broadcastAll(build) {
    this.seats.forEach((x, s) => { if (x.kind === 'human' && x.connected) this.send(x.clientId, build(s)); });
  }
  broadcast(ev) { this.broadcastAll((s) => this.engine.redact(ev, s, this.game)); }
  broadcastLobby() { const m = this.lobbyMessage(); this.broadcastAll(() => m); }
  broadcastState() { this.broadcastAll((s) => this.stateMessage(s)); }
  broadcastPrompt() { this.broadcastAll((s) => ({ type: this.prompt.kind, ...this.promptBody(s) })); }

  promptBody(s) {
    const p = this.prompt;
    const human = this.controlled(p.seat) && p.deadline != null;
    return {
      seat: p.seat,
      timeoutMs: human ? Math.max(0, p.deadline - this.clock.now()) : null,
      options: s === p.seat && p.kind === 'turn' ? this.engine.turnOptions(this.game, s) : null,
    };
  }

  lobbyMessage() {
    return {
      type: 'lobby', roomCode: this.code, phase: this.phase, host: this.host, options: { ...this.options },
      seats: this.seats.map((x) => ({
        kind: x.kind, name: x.name ?? null, connected: x.kind === 'bot' || (x.kind === 'human' && x.connected),
        ready: x.kind === 'bot' || !!x.ready, persona: x.kind === 'bot' ? x.persona : null,
      })),
    };
  }

  stateMessage(s) {
    return {
      type: 'state', phase: this.phase,
      game: this.game ? this.engine.snapshot(this.game, s) : null,
      prompt: this.prompt && this.phase === 'playing' ? { type: this.prompt.kind, ...this.promptBody(s) } : null,
      result: this.result,
    };
  }
}
