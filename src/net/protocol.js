// Wire protocol for Last Call multiplayer. One JSON object per WebSocket text frame, each with a
// `type`. Seats are absolute indices 0..3; a client rotates them so its own seat sits at the
// player position. Card identity is an opaque per-round `token`; a seat only ever receives a
// `rank` for cards in its own hand and for cards turned over by a challenge.
//
// Client to server
//   hello      { name, roomCode?, resumeToken? }  first message on every connection
//   setReady   { ready }                          lobby or finished
//   setOptions { options: Partial<Options> }      host only, lobby or finished
//   start      {}                                 host only, lobby or finished (rematch)
//   addBot     { persona? }                       host only, lobby or finished
//   removeBot  { seat }                           host only; also clears a disconnected human
//   play       { tokens: string[] }               acting seat, turn prompt
//   challenge  {}                                 acting seat, turn prompt
//   pull       {}                                 acting seat, roulette prompt
//   leave      {}                                 the server closes the socket after it
//
// Server to client
//   welcome   { seat, roomCode, resumeToken }     you hold `seat`; keep the token to reclaim it
//   lobby     { roomCode, phase, host, options, seats: SeatInfo[] }   any roster/option change
//   state     { phase, game, prompt, result }     full rebuild, sent right after welcome
//   round     { round, tableRank, starter, hand: Card[], handCounts }   your hand only
//   turn      { seat, timeoutMs, options }        options only for the acting seat, else null
//   played    { seat, tokens, claim, handCounts }
//   challenge { caller, accused, forced, cards: Card[], lie, loser }
//   roulette  { seat, timeoutMs, options }        options is always null
//   shot      { seat, fired, pulls }
//   over      { winner, seats: [{ name, kind, alive, pulls }] }
//   error     { code, message }                   see ERR; codes in FATAL end the connection
//
//   SeatInfo  { kind: 'human'|'bot'|'empty', name, connected, ready, persona }  persona: bots only
//   Card      { token, rank }                     rank names come from the active engine
//   Options   { mode, variant, turnSeconds, private }
//   timeoutMs milliseconds left when the message was sent (relative, so client clocks don't
//             matter); null when a bot is acting for the seat.
//   prompt    in `state`: { type: 'turn'|'roulette', seat, timeoutMs, options } or null
//   game      in `state`: the engine snapshot for your seat (deck: round, tableRank, starter,
//             hand, handCounts, plays: [{ seat, claim, tokens }], alive, pulls, reveal)
//
// Treat `turn` and `roulette` as "set the current prompt": the server re-sends them for the same
// seat when control moves between a person and a bot, with a fresh timeoutMs.
//
// The literal text frame "ping" is answered with "pong" without waking the Durable Object.

export const MAX_SEATS = 4;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
export const NAME_MAX = 16;
export const TURN_SECONDS = { min: 10, max: 120 };
export const MAX_FRAME = 2048;
export const PING = 'ping';
export const PONG = 'pong';
/** WebSocket close code for a connection the server will not take back (bad room, full, replaced). */
export const CLOSE_FATAL = 4001;

export const DEFAULT_OPTIONS = Object.freeze({ mode: 'deck', variant: 'basic', turnSeconds: 30, private: true });

export const ERR = Object.freeze({
  badMessage: 'bad-message',
  notSeated: 'not-seated',
  alreadySeated: 'already-seated',
  notFound: 'not-found',
  roomFull: 'room-full',
  inProgress: 'in-progress',
  replaced: 'replaced',
  notHost: 'not-host',
  wrongPhase: 'wrong-phase',
  notReady: 'not-ready',
  notYourTurn: 'not-your-turn',
  illegal: 'illegal',
  badOption: 'bad-option',
});
export const FATAL = new Set([ERR.notFound, ERR.roomFull, ERR.inProgress, ERR.replaced]);

/** Top-level keys of every server message, so tests can assert the server sends nothing else. */
export const SERVER_KEYS = Object.freeze({
  welcome: ['seat', 'roomCode', 'resumeToken'],
  lobby: ['roomCode', 'phase', 'host', 'options', 'seats'],
  state: ['phase', 'game', 'prompt', 'result'],
  turn: ['seat', 'timeoutMs', 'options'],
  roulette: ['seat', 'timeoutMs', 'options'],
  over: ['winner', 'seats'],
  error: ['code', 'message'],
});

export const normalizeRoomCode = (raw) => String(raw ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, ROOM_CODE_LENGTH);

export function randomRoomCode(randomInt = cryptoInt) {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

export function cleanName(raw) {
  const s = String(raw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, NAME_MAX).join('');
}

function cryptoInt(n) {
  const b = new Uint32Array(1);
  globalThis.crypto.getRandomValues(b);
  return b[0] % n;
}
export function randomToken(bytes = 12) {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}
export const cryptoRng = () => {
  const b = new Uint32Array(1);
  globalThis.crypto.getRandomValues(b);
  return b[0] / 4294967296;
};

const isStr = (v, max) => typeof v === 'string' && v.length <= max;
const optStr = (v, max) => v === undefined || v === null || isStr(v, max);
const isSeat = (v) => Number.isInteger(v) && v >= 0 && v < MAX_SEATS;

const CLIENT = {
  hello: (m) => isStr(m.name, 64) && optStr(m.roomCode, 16) && optStr(m.resumeToken, 64),
  setReady: (m) => typeof m.ready === 'boolean',
  setOptions: (m) => !!m.options && typeof m.options === 'object' && !Array.isArray(m.options) && validOptionShape(m.options),
  start: () => true,
  addBot: (m) => optStr(m.persona, 32),
  removeBot: (m) => isSeat(m.seat),
  play: (m) => Array.isArray(m.tokens) && m.tokens.length >= 1 && m.tokens.length <= 8 && m.tokens.every((t) => isStr(t, 64)),
  challenge: () => true,
  pull: () => true,
  leave: () => true,
};

function validOptionShape(o) {
  for (const [k, v] of Object.entries(o)) {
    if (k === 'mode' || k === 'variant') { if (!isStr(v, 32)) return false; }
    else if (k === 'turnSeconds') { if (!Number.isInteger(v)) return false; }
    else if (k === 'private') { if (typeof v !== 'boolean') return false; }
    else return false;
  }
  return true;
}

/** Parses a frame (string) or an already-decoded object. Returns { msg } or { error }. */
export function parseClientMessage(raw) {
  let m = raw;
  if (typeof raw === 'string') {
    if (raw.length > MAX_FRAME) return { error: 'message too large' };
    try { m = JSON.parse(raw); } catch { return { error: 'not JSON' }; }
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { error: 'not an object' };
  const check = Object.hasOwn(CLIENT, m.type) ? CLIENT[m.type] : null;
  if (!check) return { error: `unknown message type ${String(m.type).slice(0, 32)}` };
  if (!check(m)) return { error: `malformed ${m.type}` };
  return { msg: m };
}
