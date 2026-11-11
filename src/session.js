// The connection to a table: one transport at a time (a Room in this tab for solo play, or a
// WebSocket to a hosted table), the lobby as the server last described it, and the routing of
// every server message. Lobby, connection and `look` news is handled at once; game messages go to the
// director's queue, which plays them in order.
import { createLocalTransport, createSocketTransport, createRoomCode } from './net/client.js';
import { FATAL, TURN_SECONDS } from './net/protocol.js';
import { settings, store } from './util.js';
import { D, receive, setLobby, setLook, refused, resetDirector } from './director.js';

export const S = { transport: null, kind: null, lobby: null, code: null, down: false, hooks: {} };

/**
 * The solo Room's clock. It runs at the game-pace setting and stops while the game is paused, so
 * the table's pacing and the turn timer keep step with the animations in this tab.
 */
function soloClock() {
  let v = 0, last = performance.now(), seq = 0, tick = null;
  const timers = new Map();
  const rate = () => (settings.paused ? 0 : (settings.speed || 1) * (settings.autoplay ? 5 : 1));
  const sync = () => { const t = performance.now(); v += (t - last) * rate(); last = t; };
  const run = () => {
    tick = null; sync();
    const due = [...timers].filter(([, x]) => x.at <= v).sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
    for (const [id, x] of due) if (timers.delete(id)) x.fn();
    arm();
  };
  const arm = () => { if (tick == null && timers.size) tick = setTimeout(run, 25); };
  return {
    now() { sync(); return v; },
    setTimeout(fn, ms) { sync(); const id = ++seq; timers.set(id, { at: v + ms, fn }); arm(); return id; },
    clearTimeout(id) { timers.delete(id); },
    rate: () => rate() || 1,
  };
}

export function playSolo({ mode, variant }) {
  close();
  const clock = soloClock();
  const t = createLocalTransport({ name: store.get('name', '') || 'You', options: { mode, variant, turnSeconds: settings.autoplay ? TURN_SECONDS.max : 60 }, clock });
  open(t, 'local', clock.rate);
  t.send({ type: 'start' });
}

/** Asks the server for a fresh code and joins it as host. Throws when the server can't be reached. */
export async function host(name) {
  const code = await createRoomCode();
  join(code, name);
  return code;
}

export function join(code, name) {
  close();
  const t = createSocketTransport({ code, name });
  S.code = t.code;
  open(t, 'socket', () => 1);
}

function open(t, kind, timeScale) {
  S.transport = t; S.kind = kind; S.lobby = null; S.down = false;
  D.send = (m) => t.send(m);
  D.timeScale = timeScale;
  t.connect({
    onMessage: (msg) => { if (S.transport === t) route(msg); },
    onStatus: (status, detail) => { if (S.transport === t) onStatus(status, detail); },
  });
}

function route(msg) {
  switch (msg.type) {
    case 'welcome': D.me = msg.seat; S.code = msg.roomCode ?? S.code; return;
    case 'lobby': S.lobby = msg; setLobby(msg); return S.hooks.onLobby?.(msg);
    case 'look': return setLook(msg);
    case 'error':
      if (FATAL.has(msg.code)) return;
      refused(msg);
      return S.hooks.onRefused?.(msg);
    default: return receive(msg);
  }
}

function onStatus(status, detail) {
  if (status === 'reconnecting') S.down = true;
  if (status === 'open' && S.down) { S.down = false; S.hooks.onStatus?.('rejoined'); return; }
  if (status === 'closed') {
    const t = S.transport;
    S.transport = null;
    resetDirector();
    if (t) S.hooks.onStatus?.('closed', detail);
    return;
  }
  S.hooks.onStatus?.(status, detail);
}

export const send = (msg) => S.transport?.send(msg) ?? false;
export const isHost = () => S.lobby != null && S.lobby.host === D.me;

/** Leaves the table (if any) and forgets it. */
export function close() {
  const t = S.transport;
  S.transport = null; S.kind = null; S.lobby = null; S.code = null; S.down = false;
  D.send = () => false;
  t?.close();
  resetDirector();
}
