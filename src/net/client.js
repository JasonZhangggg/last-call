// Two transports with one interface, so the game screen never cares where the table lives:
//
//   const t = createLocalTransport({ name })                     // single player, Room in this tab
//   const t = createSocketTransport({ code, name })              // online, Room in a Durable Object
//   t.connect({ onMessage(msg), onStatus(status, detail) })
//   t.send({ type: 'play', tokens })                             // returns false if not connected
//   t.close()                                                    // leaves the table
//
// status: 'connecting' | 'open' | 'reconnecting' | 'closed'. 'closed' with detail { code } is
// final (bad room, full table, replaced by another tab, or close() was called).
// The transport sends `hello` itself, and on reconnect sends it again with the resume token, so
// the server answers with welcome + lobby + state; treat `state` as a full rebuild.
import { Room } from './room.js';
import { CLOSE_FATAL, FATAL, MAX_SEATS, PING, PONG, normalizeRoomCode } from './protocol.js';

const LOCAL_ID = 'local';
const PING_MS = 25_000;
const SILENCE_MS = 2 * PING_MS + 10_000;

/** Single player: a Room in this tab, the person in seat 0, a bot in every other seat options.players uses. Call send({ type: 'start' }) to deal. */
export function createLocalTransport({ name = 'You', bots = ['brass', 'noctua', 'gristle'], options = null, clock } = {}) {
  let room = null, handlers = null, closed = false;
  const deliver = (msg) => queueMicrotask(() => { if (!closed) handlers.onMessage?.(msg); });
  return {
    kind: 'local',
    connect(h) {
      handlers = h;
      room = new Room({ code: null, clock, send: (id, msg) => { if (id === LOCAL_ID) deliver(structuredClone(msg)); } });
      h.onStatus?.('open');
      room.receive(LOCAL_ID, { type: 'hello', name });
      if (options) room.receive(LOCAL_ID, { type: 'setOptions', options });
      for (const persona of bots.slice(0, (options?.players ?? MAX_SEATS) - 1)) room.receive(LOCAL_ID, { type: 'addBot', persona });
    },
    send(msg) {
      if (closed || !room) return false;
      room.receive(LOCAL_ID, msg);
      return true;
    },
    close() {
      if (closed || !room) return;
      room.receive(LOCAL_ID, { type: 'leave' });
      closed = true;
      handlers.onStatus?.('closed', { code: 'left' });
    },
  };
}

/** Asks the server for a fresh room code to host a table. */
export async function createRoomCode(origin = globalThis.location?.origin) {
  const res = await fetch(new URL('/api/rooms', origin), { method: 'POST' });
  if (!res.ok) throw new Error(`could not create a room (${res.status})`);
  return (await res.json()).code;
}

const tokenKey = (code) => `lastcall:resume:${code}`;
function storage() {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
}
const loadToken = (code) => { try { return storage()?.getItem(tokenKey(code)) || null; } catch { return null; } };
const saveToken = (code, token) => { try { storage()?.setItem(tokenKey(code), token); } catch { /* private mode */ } };
const dropToken = (code) => { try { storage()?.removeItem(tokenKey(code)); } catch { /* private mode */ } };

/** Online: WebSocket to /ws/<CODE>, reconnecting with backoff and reclaiming the seat by token. */
export function createSocketTransport({ code, name, url = null, WebSocketImpl = globalThis.WebSocket } = {}) {
  code = normalizeRoomCode(code);
  const target = url || `${globalThis.location?.protocol === 'https:' ? 'wss' : 'ws'}://${globalThis.location?.host}/ws/${code}`;
  let ws = null, handlers = null, attempt = 0, closed = false, retry = null, ping = null, fatal = null;
  let resumeToken = loadToken(code), lastHeard = 0;

  const status = (s, detail) => handlers.onStatus?.(s, detail);
  const stopPing = () => { clearInterval(ping); ping = null; };

  function open() {
    clearTimeout(retry); retry = null;
    status(attempt ? 'reconnecting' : 'connecting', { attempt });
    const sock = ws = new WebSocketImpl(target);
    sock.onopen = () => {
      attempt = 0;
      lastHeard = Date.now();
      sock.send(JSON.stringify({ type: 'hello', name, roomCode: code, resumeToken }));
      stopPing();
      ping = setInterval(() => {
        // A socket that died without a close frame (sleeping phone, dropped Wi-Fi) goes quiet; replace it.
        if (Date.now() - lastHeard > SILENCE_MS) return lost(sock, {});
        if (sock.readyState === 1) sock.send(PING);
      }, PING_MS);
      status('open');
    };
    sock.onmessage = (e) => {
      lastHeard = Date.now();
      if (e.data === PONG) return;
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'welcome') saveToken(code, resumeToken = msg.resumeToken);
      if (msg.type === 'error' && FATAL.has(msg.code)) fatal = msg.code;
      handlers.onMessage?.(msg);
    };
    sock.onclose = (e) => lost(sock, e);
  }

  function lost(sock, e) {
    if (sock !== ws) return;
    sock.onopen = sock.onmessage = sock.onclose = null;
    try { sock.close(); } catch { /* already closing */ }
    stopPing();
    ws = null;
    if (closed) return;
    if (e.code === CLOSE_FATAL || fatal) {
      closed = true;
      if (fatal !== 'replaced') dropToken(code);
      return status('closed', { code: fatal || 'refused' });
    }
    attempt++;
    const delay = Math.min(8000, 400 * 2 ** Math.min(attempt, 5)) * (0.6 + Math.random() * 0.4);
    status('reconnecting', { attempt, delay });
    retry = setTimeout(open, delay);
  }

  const kick = () => { if (!closed && !ws && retry) open(); };

  return {
    kind: 'socket',
    code,
    connect(h) {
      handlers = h;
      globalThis.addEventListener?.('online', kick);
      open();
    },
    send(msg) {
      if (!ws || ws.readyState !== 1) return false;
      ws.send(JSON.stringify(msg));
      return true;
    },
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(retry);
      stopPing();
      globalThis.removeEventListener?.('online', kick);
      if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'leave' }));
      ws?.close(1000, 'left');
      ws = null;
      dropToken(code);
      status('closed', { code: 'left' });
    },
  };
}
