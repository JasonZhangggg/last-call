// Two people at one hosted table, end to end: starts `wrangler dev` (local Durable Objects), opens
// two browser pages, hosts on one and joins by code on the other, adds a bot, plays a whole game
// with each page answering only its own prompts, and checks both saw the same public game.
//   npm run build && node scripts/e2e-online.mjs [--port 8799] [--size 640x360] [--out artifacts]
//   --presence-only stops after checking that the guest sees where the host looks and their cards held up.
// Exits 0 when the game finished and both pages agree; screenshots land in artifacts/online-*.png.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1] ?? true]] : a), []));
const PORT = +(args.port || 8799);
const [W, H] = String(args.size || '640x360').split('x').map(Number);
const ROOT = path.resolve('.');
const OUT = path.resolve(args.out || 'artifacts');
const BASE = `http://127.0.0.1:${PORT}`;
mkdirSync(OUT, { recursive: true });
if (!existsSync('dist/index.html')) throw new Error('run `npm run build` first');

const wrangler = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1'], { cwd: ROOT, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let wlog = '';
wrangler.stdout.on('data', (d) => { wlog += d; });
wrangler.stderr.on('data', (d) => { wlog += d; });
let browser = null;
async function finish(code, why) {
  if (why) console.error(why);
  try { await browser?.close(); } catch { /* already gone */ }
  try { process.kill(-wrangler.pid, 'SIGTERM'); } catch { /* already gone */ }
  process.exit(code);
}
process.on('unhandledRejection', (e) => finish(1, `e2e-online failed: ${e?.stack || e}`));

for (let i = 0; ; i++) {
  try { if ((await fetch(BASE + '/')).ok) break; } catch { /* not up yet */ }
  if (i > 120) await finish(1, `wrangler dev did not start:\n${wlog.slice(-2000)}`);
  await new Promise((r) => setTimeout(r, 500));
}
console.log(`  wrangler dev ready on ${BASE}`);

browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const problems = [];
async function openPage(label) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  page.on('pageerror', (e) => problems.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|fonts\.g|WebSocket/.test(m.text())) problems.push(`${label} console: ${m.text()}`); });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.includes('/build/three.module.js')) return route.fulfill({ path: path.join(ROOT, 'tools/vendor/three/build/three.module.js'), contentType: 'text/javascript' });
    if (u.includes('/examples/jsm/')) return route.fulfill({ path: path.join(ROOT, 'tools/vendor/three/examples/jsm', u.split('/examples/jsm/')[1]), contentType: 'text/javascript' });
    if (u.startsWith(BASE)) return route.continue();
    return route.abort();
  });
  // Record every frame the server sends, to compare what the two seats were told.
  await page.addInitScript(() => {
    window.__wire = []; window.__sockets = [];
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(...a) { super(...a); window.__sockets.push(this); this.addEventListener('message', (e) => { if (e.data !== 'pong') window.__wire.push(e.data); }); }
    };
  });
  return page;
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `online-${name}.png`) }).then(() => console.log(`  captured online-${name}.png`));
const vis = (page, id) => page.evaluate((id) => { const el = document.getElementById(id); return !!el && !el.hidden && !el.classList.contains('fade'); }, id);
const shown = (page, id) => page.waitForFunction((id) => { const el = document.getElementById(id); return !el.classList.contains('fade') && getComputedStyle(el).opacity === '1'; }, id);

const host = await openPage('host'), guest = await openPage('guest');
await host.goto(BASE + '/');
await host.waitForSelector('#title-menu:not([hidden])');
await host.click('#host-btn');
await shown(host, 'enter');
await host.fill('#name-input', 'Ann');
await host.click('#enter-go');
await shown(host, 'lobby');
await host.waitForFunction(() => /^[A-Z]{4}$/.test(document.getElementById('lobby-code').textContent));
const code = await host.textContent('#lobby-code');
assert.match(new URL(host.url()).search, new RegExp(`room=${code}`), 'the host URL carries the room');
console.log(`  hosted table ${code}`);

// a page loading beside a live table can starve on a software renderer
await guest.goto(`${BASE}/?room=${code}`, { timeout: 360000 });
await shown(guest, 'enter');
assert.equal(await guest.inputValue('#code-input'), code, 'the invite link fills the code');
await guest.fill('#name-input', 'Bea');
await guest.click('#enter-go');
await shown(guest, 'lobby');
await host.waitForFunction(() => document.querySelectorAll('#lobby-seats .seat:not(.empty)').length === 2);
await host.click('#lobby-seats [data-add]');
await host.waitForFunction(() => document.querySelectorAll('#lobby-seats .seat:not(.empty)').length === 3);
await guest.waitForFunction(() => document.querySelectorAll('#lobby-seats .seat:not(.empty)').length === 3);
assert.equal(await host.isDisabled('#lobby-start-btn'), true, 'start waits for the guest to be ready');
await shot(host, '01-lobby-host');
await guest.click('#ready-btn');
await host.waitForFunction(() => !document.getElementById('lobby-start-btn').disabled);
await shot(guest, '02-lobby-guest');
await host.click('#lobby-start-btn');
console.log('  dealt');

// Presence: the guest sees where the host looks and the host's cards held up, then put down.
await host.waitForFunction(() => window.__lastcall.cards.hands[0].length > 0 && window.__lastcall.D.mode?.handUp);
const hostSeat = await host.evaluate(() => window.__lastcall.D.me);
const seenFromGuest = () => guest.evaluate((s) => {
  const { D, T } = window.__lastcall, l = D.looks[s];
  return l && { yaw: l.yaw, hand: l.hand, inspect: T.char(s).env.inspect };
}, hostSeat);
await host.mouse.move(W * 0.08, H * 0.35, { steps: 4 });
await guest.waitForFunction((s) => window.__lastcall.D.looks[s]?.yaw > 0.3, hostSeat);
console.log(`  guest sees the host look left: ${JSON.stringify(await seenFromGuest())}`);
await host.keyboard.press('Space');
await guest.waitForFunction((s) => { const { D, T } = window.__lastcall; return D.looks[s]?.hand === 'up' && T.char(s).env.inspect > 0.9; }, hostSeat);
const raised = await seenFromGuest();
assert.ok(Math.abs(raised.yaw) < 0.1, 'holding the cards up centres the host\'s head');
console.log(`  guest sees the host read their cards: ${JSON.stringify(raised)}`);
await shot(guest, '03-guest-sees-host-reading');
await host.keyboard.press('Space');
await guest.waitForFunction((s) => { const { D, T } = window.__lastcall; return D.looks[s]?.hand === 'down' && T.char(s).env.inspect < 0.1; }, hostSeat);
assert.equal((await host.evaluate(() => window.__wire)).map((f) => JSON.parse(f)).some((m) => m.type === 'look' && m.seat === hostSeat), false, 'nobody is sent their own look');
if (args['presence-only']) {
  if (problems.length) await finish(1, 'PROBLEMS:\n' + problems.join('\n'));
  console.log('e2e-online: presence passed');
  await finish(0);
}

/** One step of a person at the table: act on this page's own prompt, if it has one. */
async function act(page, label, seen) {
  const s = await page.evaluate(() => {
    const D = window.__lastcall.D;
    const vis = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && !el.classList.contains('fade'); };
    return { end: vis('end'), out: vis('out'), actions: vis('actions'), trigger: vis('trigger-row'), play: !document.getElementById('play-btn').disabled, liar: !document.getElementById('liar-btn').disabled, timer: vis('timer'), reveal: !!D.watch && !!D.shown?.reveal, prompt: D.prompt && { seat: D.prompt.seat, type: D.prompt.type }, me: D.me };
  });
  if (s.end) return true;
  if (s.out) { await shot(page, `${label}-out`); await page.click('#watch-btn'); return false; }
  if (s.reveal && !seen.has('reveal')) { seen.add('reveal'); await shot(page, `${label}-reveal`); }
  if (s.trigger) {
    if (!seen.has('trigger')) { seen.add('trigger'); await shot(page, `${label}-roulette`); }
    await page.keyboard.down('Space'); await page.waitForTimeout(900); await page.keyboard.up('Space');
    return false;
  }
  if (s.actions) {
    if (!seen.has('turn')) { seen.add('turn'); assert.ok(s.timer, `${label} sees its turn clock`); await shot(page, `${label}-turn`); }
    if (s.liar && (!s.play || Math.random() < 0.3)) { await page.click('#liar-btn'); return false; }
    await page.keyboard.press('1');
    await page.waitForTimeout(150);
    if (await page.evaluate(() => !document.getElementById('play-btn').disabled)) await page.click('#play-btn');
  }
  return false;
}

const seen = { host: new Set(), guest: new Set() };
const done = { host: false, guest: false };
const deadline = Date.now() + 15 * 60_000;
while (!(done.host && done.guest)) {
  if (Date.now() > deadline) await finish(1, `game did not finish in time\n${problems.join('\n')}`);
  if (!done.host) done.host = await act(host, 'host', seen.host);
  if (!done.guest) done.guest = await act(guest, 'guest', seen.guest);
  // Drop the guest's connection once, mid-game: it must reclaim its seat and rebuild from `state`.
  if (!seen.guest.has('dropped') && await guest.evaluate(() => window.__lastcall.D.latest?.round >= 2)) {
    seen.guest.add('dropped');
    await guest.evaluate(() => window.__sockets.at(-1).close());
    await guest.waitForFunction(() => window.__wire.filter((f) => f.includes('"type":"welcome"')).length >= 2);
    await guest.waitForFunction(() => document.getElementById('net').hidden);
    console.log('  guest dropped and rejoined');
  }
  await new Promise((r) => setTimeout(r, 250));
}
await host.waitForTimeout(1200);
await shot(host, '90-end-host');
await shot(guest, '91-end-guest');

// Everything public must match frame for frame; only each seat's own hand differs.
const GAME = new Set(['round', 'played', 'challenge', 'shot', 'over']);
const publicLog = async (page) => (await page.evaluate(() => window.__wire)).map((f) => JSON.parse(f)).filter((m) => GAME.has(m.type)).map(({ hand, ...pub }) => JSON.stringify(pub));
const [a, b0] = [await publicLog(host), await publicLog(guest)];
assert.ok(seen.guest.has('dropped'), 'the guest reconnected mid-game');
// The guest missed what was sent while it was away; from its rebuild on, it must match the host.
const wire = (await guest.evaluate(() => window.__wire)).map((f) => JSON.parse(f));
const after = wire.slice(wire.findLastIndex((m) => m.type === 'state')).filter((m) => GAME.has(m.type)).length;
const b = a.slice(0, a.length - after).concat(b0.slice(b0.length - after));
assert.ok(a.length > 10, 'the host saw a game');
assert.ok(after > 3, 'the game went on after the rejoin');
assert.deepEqual(b, a, 'after the rejoin both seats received the same public game');
const view = (page) => page.evaluate(() => { const { D } = window.__lastcall; const g = D.latest; return { me: D.me, round: g.round, tableRank: g.tableRank, alive: g.alive, pulls: g.pulls, handCounts: g.handCounts, plays: g.plays, winner: D.result?.winner, endTitle: document.getElementById('end-title').textContent }; });
const [va, vb] = [await view(host), await view(guest)];
assert.notEqual(va.me, vb.me, 'two different seats');
for (const k of ['round', 'tableRank', 'alive', 'pulls', 'handCounts', 'plays', 'winner']) assert.deepEqual(vb[k], va[k], `both tables agree on ${k}`);
console.log(`  ${a.length} public messages identical on both pages; ${va.round} rounds; winner seat ${va.winner}; host sees "${va.endTitle}", guest sees "${vb.endTitle}"`);

// Rematch: both go back to the lobby, which is the finished table waiting for another deal.
await guest.click('#again-btn');
await shown(guest, 'lobby');
await host.click('#again-btn');
await shown(host, 'lobby');
assert.equal(await host.textContent('#lobby-start-btn'), 'Deal another game');
await shot(host, '92-rematch-lobby');

if (problems.length) await finish(1, 'PROBLEMS:\n' + problems.join('\n'));
console.log('e2e-online: passed');
await finish(0);
