import html from '../dist/index.html';
import { TableRoom } from './net/table-room.js';
import { ROOM_CODE_RE, randomRoomCode } from './net/protocol.js';

export { TableRoom };

// A returning visitor revalidates the 330 KB page against this tag and gets an empty 304 when the
// deploy hasn't changed it.
let etag;
async function page(request) {
  etag ??= crypto.subtle.digest('SHA-256', new TextEncoder().encode(html)).then((d) => `"${[...new Uint8Array(d).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')}"`);
  const tag = await etag;
  const headers = { 'cache-control': 'public, max-age=300', etag: tag, 'x-content-type-options': 'nosniff' };
  if (request.headers.get('if-none-match')?.split(',').some((t) => t.trim().replace(/^W\//, '') === tag)) return new Response(null, { status: 304, headers });
  return new Response(html, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } });
}

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
    return page(request);
  },
};
