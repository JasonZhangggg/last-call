import html from '../dist/index.html';
import { TableRoom } from './net/table-room.js';
import { ROOM_CODE_RE, randomRoomCode } from './net/protocol.js';

export { TableRoom };

const page = () => new Response(html, {
  headers: {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'public, max-age=300',
    'x-content-type-options': 'nosniff',
  },
});

async function newRoom(env) {
  for (let i = 0; i < 8; i++) {
    const code = randomRoomCode();
    if (await env.ROOMS.getByName(code).claim(code)) return Response.json({ code }, { headers: { 'cache-control': 'no-store' } });
  }
  return Response.json({ error: 'no free room code, try again' }, { status: 503 });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/rooms') return request.method === 'POST' ? newRoom(env) : new Response('Method not allowed', { status: 405 });
    if (pathname.startsWith('/ws/')) {
      const code = pathname.slice(4).toUpperCase();
      if (!ROOM_CODE_RE.test(code)) return new Response('Unknown room', { status: 404 });
      return env.ROOMS.getByName(code).fetch(request);
    }
    return page();
  },
};
