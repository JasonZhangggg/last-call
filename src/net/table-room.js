// One Durable Object per room code. It owns the sockets and storage; the Room owns the table.
// Sockets use the Hibernation API: each carries its client id as a tag and an attachment, and the
// Room is saved after every change, so an idle lobby can sleep and wake up exactly where it was.
// While a game runs, the Room's pacing timer keeps the object awake (setTimeout blocks hibernation).
import { DurableObject } from 'cloudflare:workers';
import { Room } from './room.js';
import { CLOSE_FATAL, ERR, PING, PONG } from './protocol.js';

const KEY = 'room';
const IDLE_CLEANUP_MS = 60 * 60 * 1000;

export class TableRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get(KEY);
      if (!saved) return;
      this.room = this.makeRoom(saved);
      // After an eviction (deploy, crash) some saved connections are gone; let bots cover them.
      for (const id of this.room.connectedClients()) if (!this.open(id).length) this.room.disconnect(id);
    });
  }

  makeRoom(saved, code = null) {
    return new Room({
      code,
      send: (id, msg) => { const data = JSON.stringify(msg); for (const ws of this.open(id)) ws.send(data); },
      close: (id) => { for (const ws of this.open(id)) ws.close(CLOSE_FATAL, 'closed by room'); },
      onChange: () => this.persist(),
    }, saved);
  }

  open(id) { return this.ctx.getWebSockets(id).filter((ws) => ws.readyState === 1); }

  persist() {
    if (!this.room) return;
    if (this.room.isAbandoned() && this.room.phase !== 'lobby') return this.discard();
    this.ctx.storage.put(KEY, this.room.toJSON());
    if (this.room.connectedHumans() === 0) this.ctx.storage.setAlarm(Date.now() + IDLE_CLEANUP_MS);
  }

  async discard() {
    this.room?.disarm();
    this.room = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  /** Reserves this code for a new table. False if the code is already in use. */
  async claim(code) {
    if (this.room) return false;
    this.room = this.makeRoom(null, code);
    this.persist();
    return true;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    const id = crypto.randomUUID();
    this.ctx.acceptWebSocket(server, [id]);
    server.serializeAttachment({ id });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== 'string') return;
    if (data === PING) return ws.send(PONG);
    if (!this.room) {
      ws.send(JSON.stringify({ type: 'error', code: ERR.notFound, message: 'There is no table with that code.' }));
      return ws.close(CLOSE_FATAL, 'no such room');
    }
    this.room.receive(ws.deserializeAttachment().id, data);
  }

  async webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch { /* 1005/1006 cannot be echoed; the socket is gone anyway */ }
    this.room?.disconnect(ws.deserializeAttachment().id);
  }
  async webSocketError(ws) { this.room?.disconnect(ws.deserializeAttachment().id); }

  async alarm() {
    if (this.room && this.room.connectedHumans() === 0) await this.discard();
  }
}
