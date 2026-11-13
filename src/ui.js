// DOM side of the game: HUD, menus, settings, stats and the hold-to-pull trigger.
import { $, settings, store, clamp } from './util.js';
import { RANK_STYLE, rankIcon, cardImage } from './render/textures.js';
import { audio } from './audio.js';
import { quality, setQualityMode } from './render/core.js';
import { rig } from './render/camera.js';
import { clearBlood } from './render/blood.js';


const tags = [];
let icons = {};
// Bottom edge of the top-centre HUD, kept fresh by a ResizeObserver so placeTag never reads layout per frame.
const hud = { bottom: 0 };

export function initUI() {
  icons = Object.fromEntries(Object.keys(RANK_STYLE).map((r) => [r, rankIcon(r)]));
  const ro = new ResizeObserver(measure);
  for (let seat = 1; seat < 4; seat++) {
    const el = document.createElement('div'); el.className = 'tag'; el.style.opacity = '0';
    el.innerHTML = `<div class="bubble"></div><div class="nm"><span></span></div><div class="meta panel-chip"><span class="cnt"></span><span class="pips"></span></div><div class="status"></div>`;
    $('#tags').appendChild(el);
    tags[seat] = { el, name: el.querySelector('.nm span'), bubble: el.querySelector('.bubble'), cnt: el.querySelector('.cnt'), pips: el.querySelector('.pips'), status: el.querySelector('.status'), timer: 0, lastPulls: 0, x: 0, y: 0, h: 44, bh: 0, below: false, px: NaN, py: NaN };
    ro.observe(el); ro.observe(tags[seat].bubble);
  }
  tags[0] = { pips: $('#me-pips'), lastPulls: 0 };
  ro.observe($('#top'));
  addEventListener('resize', measure);
  const note = { joker: ' (matches all)', devil: ' (Devil rules)' };
  $('#cards-demo').innerHTML = ['king', 'queen', 'ace', 'joker', 'devil'].map((r) => `<figure><img src="${cardImage(r)}" alt="${RANK_STYLE[r].name} card"><figcaption>${RANK_STYLE[r].name}${note[r] || ''}</figcaption></figure>`).join('');
  bindSettings();
  for (const o of document.querySelectorAll('.overlay [data-close]')) o.addEventListener('click', () => { audio.uiClick(); closeOverlay(o.closest('.overlay').id); });
  for (const b of document.querySelectorAll('.overlay .btn:not([data-close])')) b.addEventListener('click', () => audio.uiClick());
  addEventListener('keydown', trapFocus);
  // Start the sound on the first gesture anywhere, so the title has music and the sliders are audible.
  const unlock = () => { audio.init(); removeEventListener('pointerdown', unlock, true); removeEventListener('keydown', unlock, true); };
  addEventListener('pointerdown', unlock, true); addEventListener('keydown', unlock, true);
  showRecord(store.get('stats', null));
}

function measure() {
  const top = $('#top');
  hud.bottom = top.hidden ? 0 : top.getBoundingClientRect().bottom;
  for (let s = 1; s < 4; s++) { const t = tags[s]; t.h = t.el.offsetHeight; t.bh = t.bubble.offsetHeight; }
}

/* ---------- overlays ---------- */
// Someone typing a chat line keeps the keyboard: a sheet or the trigger turning up doesn't take it,
// so the Enter meant to send the line can't press a button instead.
const typing = () => document.activeElement?.id === 'chat-input';
const stack = [];
const openers = new Map();
const focusables = (root) => [...root.querySelectorAll('button:not([disabled]), input, [tabindex]:not([tabindex="-1"])')].filter((e) => e.offsetParent !== null);
export function openOverlay(id) {
  const el = $(`#${id}`); el.hidden = false;
  if (!stack.includes(id)) { stack.push(id); openers.set(id, document.activeElement); }
  void el.offsetWidth; // commit the unhidden, faded state so removing .fade transitions
  el.classList.remove('fade'); syncCovered();
  if (!typing()) (el.querySelector('.btn.primary:not([hidden]):not(:disabled)') || el.querySelector('button:not([hidden])'))?.focus({ preventScroll: true });
}
export function closeOverlay(id) {
  const el = $(`#${id}`); el.classList.add('fade');
  const i = stack.indexOf(id); if (i >= 0) stack.splice(i, 1);
  syncCovered();
  const back = openers.get(id); openers.delete(id);
  if (el.contains(document.activeElement)) {
    const under = topOverlay() && $(`#${topOverlay()}`);
    const target = back && back.isConnected && back.offsetParent !== null && (!under || under.contains(back)) ? back : under && focusables(under)[0];
    if (target) target.focus({ preventScroll: true }); else document.activeElement.blur();
  }
}
export const topOverlay = () => stack[stack.length - 1] || null;
// Sheets under the top overlay step back so two panels never read through each other.
function syncCovered() {
  const top = topOverlay();
  for (const o of document.querySelectorAll('.overlay')) o.classList.toggle('covered', top != null && o.id !== top && !o.classList.contains('fade'));
}
export const isOpen = (id) => stack.includes(id);

function trapFocus(e) {
  if (e.key !== 'Tab') return;
  const id = topOverlay(); if (!id) return;
  const list = focusables($(`#${id}`)); if (!list.length) return;
  const first = list[0], last = list[list.length - 1], cur = document.activeElement;
  if (!list.includes(cur)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
}

/* ---------- settings ---------- */
function seg(id, value, onPick) {
  const root = $(`#${id}`);
  const sync = (v) => { for (const b of root.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === String(v))); };
  sync(value);
  root.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; sync(b.dataset.v); onPick(b.dataset.v); audio.uiClick(); });
}
const PREVIEW = { master: () => audio.uiClick(), sfx: () => audio.card(), ambience: () => audio.clink(), music: () => {} };
function bindSettings() {
  for (const k of ['master', 'music', 'sfx', 'ambience']) {
    const el = $(`#vol-${k}`), out = el.parentElement.querySelector('output');
    const show = () => { out.textContent = `${Math.round(el.value * 100)}%`; el.style.setProperty('--fill', `${el.value * 100}%`); };
    el.value = audio.vol[k]; show();
    el.addEventListener('input', () => { audio.setVolume(k, +el.value); show(); });
    el.addEventListener('change', () => PREVIEW[k]());
  }
  seg('quality-seg', quality.mode, (v) => setQualityMode(v));
  settings.speed = store.get('speed', 1);
  seg('speed-seg', settings.speed, (v) => { settings.speed = +v; store.set('speed', +v); });
  rig.lookEnabled = store.get('look', true);
  seg('look-seg', rig.lookEnabled ? 'on' : 'off', (v) => { rig.lookEnabled = v === 'on'; store.set('look', rig.lookEnabled); });
  settings.reducedMotion = store.get('reducedMotion', settings.reducedMotion);
  document.body.classList.toggle('reduce-motion', settings.reducedMotion);
  seg('motion-seg', settings.reducedMotion ? 'on' : 'off', (v) => {
    settings.reducedMotion = v === 'on'; store.set('reducedMotion', settings.reducedMotion);
    document.body.classList.toggle('reduce-motion', settings.reducedMotion);
  });
  settings.blood = store.get('blood', true);
  seg('blood-seg', settings.blood ? 'on' : 'off', (v) => { settings.blood = v === 'on'; store.set('blood', settings.blood); if (!settings.blood) clearBlood(); });
  const sb = $('#sound-btn');
  const syncSound = () => sb.setAttribute('aria-pressed', String(!audio.muted));
  syncSound();
  sb.addEventListener('click', () => { audio.setMuted(!audio.muted); syncSound(); });
}

/* ---------- HUD ---------- */
export function setInGame(on) {
  document.body.classList.toggle('in-game', on);
  $('#me-card').hidden = !on; $('#pause-btn').hidden = !on;
  if (!on) { $('#top').hidden = true; for (let s = 1; s < 4; s++) tags[s].el.style.opacity = '0'; }
}
export function setTable(rank, round) {
  $('#table-icon').src = icons[rank];
  $('#table-icon').alt = `${RANK_STYLE[rank].name} symbol`;
  $('#table-name').textContent = RANK_STYLE[rank].plural.toUpperCase();
  $('#round-label').innerHTML = `Round ${round}<span class="sub"> · Table card</span>`;
  $('#top').hidden = false;
  const tc = $('#table-card'); tc.classList.remove('pulse'); void tc.offsetWidth; tc.classList.add('pulse');
}
export function setClaim(html, label = 'Last claim') { $('#claim').innerHTML = html ? `<span class="lbl">${label}</span>${html}` : ''; }
/** The top chip for modes without a table card: any icon, a small line and a big one. */
export function setTopChip({ icon, alt = '', eyebrow, name }) {
  $('#table-icon').src = icon; $('#table-icon').alt = alt;
  $('#table-name').textContent = name;
  $('#round-label').innerHTML = eyebrow;
  $('#top').hidden = false;
  const tc = $('#table-card'); tc.classList.remove('pulse'); void tc.offsetWidth; tc.classList.add('pulse');
}

function pipsHTML(pulls, fresh) { let s = ''; for (let i = 0; i < 6; i++) s += `<span class="pip${i < pulls ? ' spent' : ''}${fresh && i === pulls - 1 ? ' fresh' : ''}"></span>`; return s; }
/**
 * Refresh every seat's counters. `list` is by view (0 is you): { alive, cards, pulls }, and
 * optionally `cnt` (the tag's counter HTML), `odds` (your odds line) and `penalty` (your badge).
 * `active` is { view, gun } for the seat being prompted, or null.
 */
export function refreshSeats(list, active) {
  list.forEach((p, v) => {
    const t = tags[v], fresh = p.pulls !== t.lastPulls;
    if (fresh) { t.pips.innerHTML = pipsHTML(p.pulls, p.pulls > t.lastPulls); t.lastPulls = p.pulls; }
    const on = active?.view === v && p.alive, gun = on && active.gun, turn = on && !active.gun;
    if (v === 0) {
      $('#me-odds').innerHTML = p.alive ? p.odds ?? `Next pull: <b>1 in ${6 - p.pulls}</b>` : 'Out';
      const card = $('#me-card');
      card.classList.toggle('active', turn);
      card.classList.toggle('gun', gun);
      $('#me-turn').textContent = gun ? p.penalty || 'Revolver' : 'Your turn';
      return;
    }
    const cnt = p.alive ? p.cnt ?? (p.cards ? '<i></i>'.repeat(p.cards) : 'No cards') : 'Out';
    if (t.cnt.innerHTML !== cnt) t.cnt.innerHTML = cnt;
    t.el.classList.toggle('out', !p.alive);
    t.el.classList.toggle('active', turn);
    t.el.classList.toggle('gun', gun);
  });
}
/** Names over each view's head (view 0 is you), and whether that person is still connected. */
export function setSeatNames(names, connected) {
  for (let v = 1; v < 4; v++) {
    if (tags[v].name.textContent !== names[v]) tags[v].name.textContent = names[v];
    tags[v].el.classList.toggle('away', !connected[v]);
  }
}
export function resetSeats() { for (const t of tags) { t.lastPulls = -1; } }
export function setStatus(seat, html) { if (tags[seat]?.status) tags[seat].status.innerHTML = html || ''; }
export function say(seat, text, ms = 2400) {
  const t = tags[seat]; if (!text || !t?.bubble) return;
  t.bubble.textContent = text; t.bubble.classList.add('show');
  clearTimeout(t.timer); t.timer = setTimeout(() => t.bubble.classList.remove('show'), ms / settings.speed);
}
export function toast(text, kind = '') {
  const t = $('#toast-t'); t.className = 't'; void t.offsetWidth; t.textContent = text; t.className = `t show ${kind}`;
}
export function log(html) {
  const ul = $('#log'); const li = document.createElement('li'); li.innerHTML = html; ul.prepend(li);
  while (ul.children.length > 5) ul.lastChild.remove();
}
export const clearLog = () => { $('#log').innerHTML = ''; };
/** Screen effects the director can call instead of reaching into the DOM. */
export function flash() { const f = $('#flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
export function setBlackout(on) { $('#blackout').classList.toggle('on', on); if (!on) $('#bloodshot').classList.remove('on'); }
/** Your own fatal shot: the edges of your sight go red as the dark comes in. */
export function bloodshot() { if (settings.blood) $('#bloodshot').classList.add('on'); }
export const setTense = (on) => document.body.classList.toggle('tense', on);
// rewriting the same markup would still rebuild the hint's nodes and its layout
let hintHtml = '';
export function setHint(html) { html = html || ''; if (html !== hintHtml) $('#hint').innerHTML = hintHtml = html; }

/** Screen positions for the name tags, eased so they glide instead of jittering with the camera. */
export function placeTag(seat, x, y, visible, dt) {
  const t = tags[seat]; if (!t?.el) return;
  // Keep the tag clear of the top HUD, and drop the speech bubble under the tag when there's no room above.
  if (hud.bottom) y = Math.max(y, hud.bottom + 8 + t.h);
  const k = t.placed ? 1 - Math.exp(-dt * 18) : 1;
  t.x += (x - t.x) * k; t.y += (y - t.y) * k; t.placed = true;
  // a still tag keeps its style untouched: no new string and no style invalidation every frame
  const px = Math.round(t.x * 10), py = Math.round(t.y * 10);
  if (px !== t.px || py !== t.py) { t.px = px; t.py = py; t.el.style.transform = `translate3d(${px / 10}px, ${py / 10}px, 0) translate(-50%, -100%)`; }
  const below = t.y - t.h - t.bh - 12 < hud.bottom + 4;
  if (below !== t.below) { t.below = below; t.el.classList.toggle('below', below); }
  const op = visible && document.body.classList.contains('in-game') ? '' : '0';
  if (t.el.style.opacity !== op) t.el.style.opacity = op;
}

/* ---------- player actions ---------- */
export function showActions({ canPlay, canChallenge, selected, max, rank, last }) {
  $('#actions').hidden = false;
  const R = RANK_STYLE[rank];
  const play = $('#play-btn');
  play.disabled = !canPlay || selected < 1;
  play.querySelector('.lbl').textContent = !canPlay ? 'Play' : selected ? `Play ${selected} as ${selected === 1 ? R.name : R.plural}` : `Pick 1–${max} cards`;
  $('#liar-btn').disabled = !canChallenge;
  if (!canPlay && canChallenge) setHint(`${last}. Nobody else holds cards: call it.`);
  else if (!last) setHint(`Your lead. Pick 1–${max} cards and claim they're all <b>${R.plural}</b>.`);
  else setHint(`${last}. Play on, or call Liar.`);
}
export function hideActions() { $('#actions').hidden = true; setHint(''); }

/** Resolves true once the player has held the trigger button (or Space) for the full duration, false if cancelled. */
let cancelActiveTrigger = null;
export const cancelTrigger = () => cancelActiveTrigger?.();
export function awaitTrigger(hintHtml, holdMs = 750, label = 'Hold to pull the trigger') {
  return new Promise((resolve) => {
    const row = $('#trigger-row'), btn = $('#trigger-btn');
    row.hidden = false; setHint(hintHtml);
    btn.querySelector('.lbl').textContent = label;
    let start = 0, raf = 0, done = false;
    const set = (p) => btn.style.setProperty('--p', p.toFixed(3));
    const tick = () => {
      const p = clamp((performance.now() - start) / holdMs, 0, 1); set(p);
      if (p >= 1) return finish(true);
      raf = requestAnimationFrame(tick);
    };
    const down = (e) => { if (done || start) return; e?.preventDefault?.(); start = performance.now(); audio.cock(); raf = requestAnimationFrame(tick); };
    const up = () => { if (done) return; cancelAnimationFrame(raf); start = 0; set(0); };
    // Enter works as well as Space so keyboard users on the focused button aren't stuck.
    const key = (e) => {
      if ((e.code !== 'Space' && e.key !== 'Enter') || e.repeat) return;
      if (topOverlay()) return;
      e.preventDefault(); if (e.type === 'keydown') down(); else up();
    };
    function finish(pulled = true) {
      done = true; cancelAnimationFrame(raf);
      btn.removeEventListener('pointerdown', down); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); btn.removeEventListener('pointerleave', up);
      removeEventListener('keydown', key); removeEventListener('keyup', key);
      row.hidden = true; set(0); setHint('');
      cancelActiveTrigger = null;
      resolve(pulled);
    }
    cancelActiveTrigger = () => finish(false);
    btn.addEventListener('pointerdown', down); addEventListener('pointerup', up); addEventListener('pointercancel', up); btn.addEventListener('pointerleave', up);
    addEventListener('keydown', key); addEventListener('keyup', key);
    if (!typing()) btn.focus({ preventScroll: true });
  });
}

/* ---------- first-game tips ---------- */
export function coach(key, html) {
  const seen = store.get('coach', {}); if (seen[key] || settings.autoplay) return;
  seen[key] = true; store.set('coach', seen);
  document.querySelector('.coach')?.remove();
  const el = document.createElement('div'); el.className = 'coach'; el.setAttribute('role', 'status');
  el.innerHTML = `${html}<small>Tap to dismiss</small>`;
  el.addEventListener('click', () => el.remove());
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 9000);
}
export const dismissCoach = () => document.querySelector('.coach')?.remove();

/* ---------- stats & end screen ---------- */
function showRecord(s) {
  const text = s && s.played ? `<b>${s.wins}</b> ${s.wins === 1 ? 'win' : 'wins'} in <b>${s.played}</b> ${s.played === 1 ? 'game' : 'games'} · best streak <b>${s.best}</b>` : '';
  $('#stats-line').innerHTML = text;
  $('#end-record').innerHTML = text;
}
export function recordResult(won) {
  const s = store.get('stats', { played: 0, wins: 0, streak: 0, best: 0 });
  s.played++; if (won) { s.wins++; s.streak++; s.best = Math.max(s.best, s.streak); } else s.streak = 0;
  store.set('stats', s);
  showRecord(s);
  return s;
}
const listJoin = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
export function showEnd({ won, rounds, survivors, recap, online, kicker, title, text }) {
  const end = $('#end');
  end.classList.toggle('won', won); end.classList.toggle('lost', !won);
  $('#end-kicker').textContent = kicker ?? (won ? 'The house salutes you' : 'Closing time');
  $('#end-title').textContent = title ?? (won ? 'Last One Sitting' : 'Lights Out');
  $('#end-text').textContent = text ?? (won
    ? `You outlasted the table in ${rounds} ${rounds === 1 ? 'round' : 'rounds'}. The Lantern pours you one on the house.`
    : `${listJoin(survivors)} ${survivors.length === 1 ? 'keeps' : 'keep'} the table after ${rounds} ${rounds === 1 ? 'round' : 'rounds'}.`);
  $('#recap').innerHTML = recap.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
  $('#again-btn').textContent = online ? 'Back to the lobby' : 'Deal me in again';
  $('#menu-btn').textContent = online ? 'Leave the table' : 'Back to the door';
  openOverlay('end');
}

/* ---------- turn clock ---------- */
let clockRaf = 0;
/** The acting person's countdown: { deadline (performance.now ms), total ms }, or null to hide it. */
export function setCountdown(c) {
  cancelAnimationFrame(clockRaf);
  const el = $('#timer');
  if (!c) { el.hidden = true; return; }
  el.hidden = false;
  const bar = el.querySelector('i'), num = $('#timer-s');
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    // a paused solo table stops the room's clock too
    if (settings.paused) c.deadline += now - last;
    last = now;
    const left = Math.max(0, c.deadline - now);
    bar.style.transform = `scaleX(${(left / c.total).toFixed(4)})`;
    const sec = String(Math.ceil(left / 1000));
    if (num.textContent !== sec) num.textContent = sec;
    el.classList.toggle('low', left < 5500);
    if (left > 0) clockRaf = requestAnimationFrame(tick);
  };
  tick();
}

/** A small persistent line for the connection (reconnecting), or null to hide it. */
export function setNet(text) {
  const el = $('#net');
  el.hidden = !text;
  if (text) el.textContent = text;
}

/* ---------- lobby ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const segButtons = (items, value) => items.map(({ v, label }) => `<button type="button" data-v="${esc(v)}" aria-pressed="${String(v) === String(value)}">${esc(label)}</button>`).join('');
/** A segmented control whose buttons change with the table; `onPick(value)` fires on a click. */
function liveSeg(id, onPick) {
  $(`#${id}`).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.disabled || b.getAttribute('aria-pressed') === 'true') return;
    audio.uiClick(); onPick(b.dataset.v);
  });
}
function fillSeg(id, items, value, disabled = false) {
  const el = $(`#${id}`), html = segButtons(items, value);
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
  for (const b of el.querySelectorAll('button')) b.disabled = disabled;
  el.classList.toggle('locked', disabled);
}

let lobbyActions = null;
/** Binds the lobby's controls once. `actions` has addBot, removeBot(seat), setOptions(patch), ready(on), start, leave, copy. */
export function initLobby(actions) {
  lobbyActions = actions;
  liveSeg('mode-seg', (mode) => actions.setOptions({ mode }));
  liveSeg('variant-seg', (variant) => actions.setOptions({ variant }));
  liveSeg('timer-seg', (s) => actions.setOptions({ turnSeconds: +s }));
  $('#lobby-seats').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    audio.uiClick();
    if (b.dataset.remove != null) actions.removeBot(+b.dataset.remove);
    else if (b.dataset.add != null) actions.addBot();
  });
  $('#ready-btn').addEventListener('click', () => actions.ready($('#ready-btn').dataset.ready !== 'true'));
  $('#lobby-start-btn').addEventListener('click', () => actions.start());
  $('#lobby-leave-btn').addEventListener('click', () => actions.leave());
  $('#copy-link-btn').addEventListener('click', () => actions.copy());
}

/**
 * Draws the lobby from the server's `lobby` message. `catalog` gives labels; `modes` lists
 * { mode, variants, playable } in the order to offer them.
 */
export function renderLobby(L, me, { modes, label, variantLabel, note, connecting = false }) {
  $('#lobby-code').textContent = L?.roomCode || '····';
  $('#copy-link-btn').disabled = !L?.roomCode;
  if (!L) {
    $('#lobby-seats').innerHTML = `<li class="seat empty"><span class="nm">${connecting ? 'Finding the table…' : 'Not connected'}</span></li>`;
    for (const id of ['lobby-start-btn', 'ready-btn']) $(`#${id}`).hidden = true;
    return;
  }
  const host = L.host === me, opt = L.options;
  const rows = L.seats.map((x, s) => {
    const you = s === me, isHost = s === L.host;
    if (x.kind === 'empty') return `<li class="seat empty"><i class="dot"></i><span class="nm">Open seat</span><span class="st">Bot at the start</span>${host ? `<button class="mini" type="button" data-add="${s}">Add a bot</button>` : ''}</li>`;
    const bot = x.kind === 'bot';
    const tags = [you && 'You', isHost && 'Host', bot && 'Bot'].filter(Boolean).join(' · ');
    const st = bot ? 'Ready' : !x.connected ? 'Away' : isHost ? 'Hosting' : x.ready ? 'Ready' : 'Not ready';
    const removable = host && !you && (bot || !x.connected);
    return `<li class="seat${you ? ' me' : ''}${x.connected ? '' : ' away'}${bot || x.ready || isHost ? ' ready' : ''}"><i class="dot${x.connected ? ' on' : ''}"></i><span class="nm">${esc(x.name)}${tags ? ` <small>${tags}</small>` : ''}</span><span class="st">${st}</span>${removable ? `<button class="mini x" type="button" data-remove="${s}" aria-label="Remove ${esc(x.name)}">Remove</button>` : ''}</li>`;
  }).join('');
  // redraw only on change, so a focused button survives an unrelated lobby update
  if ($('#lobby-seats').dataset.html !== rows) { $('#lobby-seats').innerHTML = rows; $('#lobby-seats').dataset.html = rows; }
  fillSeg('mode-seg', modes.map((m) => ({ v: m.mode, label: label(m.mode) })), opt.mode, !host);
  const cur = modes.find((m) => m.mode === opt.mode);
  fillSeg('variant-seg', (cur?.variants || [opt.variant]).map((v) => ({ v, label: variantLabel(opt.mode, v) })), opt.variant, !host);
  fillSeg('timer-seg', [15, 30, 60, 90].map((v) => ({ v, label: `${v} s` })), opt.turnSeconds, !host);
  const waiting = L.seats.filter((x, s) => x.kind === 'human' && x.connected && s !== L.host && !x.ready).map((x) => x.name);
  const playable = !!cur?.playable;
  let line = note(opt.mode, opt.variant);
  if (!playable) line = `${label(opt.mode)} is coming in the next update.`;
  else if (host && waiting.length) line = `Waiting for ${waiting.map(esc).join(', ')} to be ready.`;
  else if (!host) line = L.phase === 'finished' ? 'The host can deal another game.' : `${esc(note(opt.mode, opt.variant))} The host deals when everyone is ready.`;
  $('#lobby-note').innerHTML = line;
  $('#lobby-note').classList.toggle('warn', !playable);
  const start = $('#lobby-start-btn'), ready = $('#ready-btn');
  start.hidden = !host; ready.hidden = host;
  start.disabled = !playable || waiting.length > 0;
  start.textContent = L.phase === 'finished' ? 'Deal another game' : 'Deal the cards';
  const mine = L.seats[me];
  ready.dataset.ready = String(!!mine?.ready);
  ready.textContent = mine?.ready ? 'Not ready yet' : 'I’m ready';
  ready.classList.toggle('primary', !mine?.ready);
  ready.classList.toggle('ghost', !!mine?.ready);
}

/* ---------- solo picker ---------- */
/** The solo sheet: mode and variant first, then Deal me in. `onStart({ mode, variant })`. */
export function initSolo({ modes, label, variantLabel, note }, onStart) {
  const pick = store.get('solo', { mode: 'deck', variant: 'basic' });
  const draw = () => {
    const cur = modes.find((m) => m.mode === pick.mode) || modes[0];
    if (!cur.variants.includes(pick.variant)) pick.variant = cur.variants[0];
    fillSeg('solo-mode-seg', modes.map((m) => ({ v: m.mode, label: label(m.mode) })), cur.mode);
    fillSeg('solo-variant-seg', cur.variants.map((v) => ({ v, label: variantLabel(cur.mode, v) })), pick.variant);
    $('#solo-note').textContent = cur.playable ? note(cur.mode, pick.variant) : `${label(cur.mode)} is coming in the next update.`;
    $('#solo-note').classList.toggle('warn', !cur.playable);
    $('#solo-start-btn').disabled = !cur.playable;
  };
  liveSeg('solo-mode-seg', (mode) => { pick.mode = mode; store.set('solo', pick); draw(); });
  liveSeg('solo-variant-seg', (variant) => { pick.variant = variant; store.set('solo', pick); draw(); });
  $('#solo-start-btn').addEventListener('click', () => onStart({ mode: pick.mode, variant: pick.variant }));
  draw();
}

/* ---------- host / join sheet ---------- */
let enterSubmit = null;
/** Opens the name sheet. kind 'host' or 'join'; `onGo({ name, code })` may return an error string. */
export function openEnter(kind, { code = '' } = {}, onGo) {
  const join = kind === 'join';
  $('#enter-h').textContent = join ? 'Join a table' : 'Host a table';
  $('#enter-lede').textContent = join ? 'Ask your host for the four-letter code.' : 'You will get a code to share with your friends. Bots fill any empty seats.';
  $('#code-field').hidden = !join;
  $('#enter-go').textContent = join ? 'Join' : 'Open a table';
  $('#enter-err').textContent = '';
  $('#name-input').value = store.get('name', '');
  $('#code-input').value = code;
  enterSubmit = onGo;
  openOverlay('enter');
  const focus = !$('#name-input').value ? '#name-input' : join && !code ? '#code-input' : null;
  if (focus) $(focus).focus({ preventScroll: true });
}
export function setEnterBusy(busy, err = '') {
  $('#enter-go').disabled = busy;
  $('#enter-err').textContent = err;
}
export function initEnter() {
  $('#code-input').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); });
  $('#enter-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#name-input').value.trim(), code = $('#code-input').value.trim();
    if (!name) return setEnterBusy(false, 'Tell the table your name.');
    if (!$('#code-field').hidden && code.length !== 4) return setEnterBusy(false, 'Table codes are four letters.');
    store.set('name', name);
    enterSubmit?.({ name, code });
  });
}

