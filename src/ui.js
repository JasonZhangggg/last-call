// DOM side of the game: HUD, menus, settings, stats and the hold-to-pull trigger.
import { $, settings, store, clamp } from './util.js';
import { RANK_STYLE, rankIcon, cardImage } from './render/textures.js';
import { audio } from './audio.js';
import { quality, setQualityMode } from './render/core.js';
import { rig } from './render/camera.js';

export const NAMES = ['You', 'Brass', 'Madame Noctua', 'Captain Gristle'];
const NUM = ['zero', 'one', 'two', 'three'];
export const claimText = (n, rank) => `${NUM[n][0].toUpperCase() + NUM[n].slice(1)} ${n === 1 ? RANK_STYLE[rank].name : RANK_STYLE[rank].plural}`;

const tags = [];
let icons = {};
// Bottom edge of the top-centre HUD, kept fresh by a ResizeObserver so placeTag never reads layout per frame.
const hud = { bottom: 0 };

export function initUI() {
  icons = Object.fromEntries(Object.keys(RANK_STYLE).map((r) => [r, rankIcon(r)]));
  const ro = new ResizeObserver(measure);
  for (let seat = 1; seat < 4; seat++) {
    const el = document.createElement('div'); el.className = 'tag'; el.style.opacity = '0';
    el.innerHTML = `<div class="bubble"></div><div class="nm"><span>${NAMES[seat]}</span></div><div class="meta panel-chip"><span class="cnt"></span><span class="pips"></span></div><div class="status"></div>`;
    $('#tags').appendChild(el);
    tags[seat] = { el, bubble: el.querySelector('.bubble'), cnt: el.querySelector('.cnt'), pips: el.querySelector('.pips'), status: el.querySelector('.status'), timer: 0, lastPulls: 0, x: 0, y: 0, h: 44, bh: 0, below: false };
    ro.observe(el); ro.observe(tags[seat].bubble);
  }
  tags[0] = { pips: $('#me-pips'), lastPulls: 0 };
  ro.observe($('#top'));
  addEventListener('resize', measure);
  $('#cards-demo').innerHTML = ['sun', 'moon', 'star', 'wild'].map((r) => `<figure><img src="${cardImage(r)}" alt="${RANK_STYLE[r].name} card"><figcaption>${RANK_STYLE[r].name}${r === 'wild' ? ' (matches all)' : ''}</figcaption></figure>`).join('');
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
const stack = [];
const openers = new Map();
const focusables = (root) => [...root.querySelectorAll('button:not([disabled]), input, [tabindex]:not([tabindex="-1"])')].filter((e) => e.offsetParent !== null);
export function openOverlay(id) {
  const el = $(`#${id}`); el.hidden = false;
  if (!stack.includes(id)) { stack.push(id); openers.set(id, document.activeElement); }
  void el.offsetWidth; // commit the unhidden, faded state so removing .fade transitions
  el.classList.remove('fade'); syncCovered();
  setTimeout(() => el.querySelector('.btn.primary:not([hidden]):not(:disabled), button:not([hidden])')?.focus({ preventScroll: true }), 50);
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
export function setClaim(html) { $('#claim').innerHTML = html ? `<span class="lbl">Last claim</span>${html}` : ''; }

function pipsHTML(pulls, fresh) { let s = ''; for (let i = 0; i < 6; i++) s += `<span class="pip${i < pulls ? ' spent' : ''}${fresh && i === pulls - 1 ? ' fresh' : ''}"></span>`; return s; }
/** Refresh every seat's counters from the model. `active` is the seat whose turn it is. */
export function refreshSeats(game, active) {
  const atGun = game.phase === 'roulette', turn = game.phase === 'turn';
  for (const p of game.players) {
    const t = tags[p.seat], fresh = p.pulls !== t.lastPulls;
    if (fresh) { t.pips.innerHTML = pipsHTML(p.pulls, p.pulls > t.lastPulls); t.lastPulls = p.pulls; }
    const on = active === p.seat && p.alive;
    if (p.seat === 0) {
      const left = 6 - p.pulls;
      $('#me-odds').innerHTML = p.alive ? `Next pull: <b>1 in ${left}</b>` : 'Out';
      const card = $('#me-card');
      card.classList.toggle('active', on && turn);
      card.classList.toggle('gun', on && atGun);
      $('#me-turn').textContent = atGun ? 'Revolver' : 'Your turn';
      continue;
    }
    const cnt = p.alive ? (p.hand.length ? '<i></i>'.repeat(p.hand.length) : 'No cards') : 'Out';
    if (t.cnt.innerHTML !== cnt) t.cnt.innerHTML = cnt;
    t.el.classList.toggle('out', !p.alive);
    t.el.classList.toggle('active', on && turn);
    t.el.classList.toggle('gun', on && atGun);
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
export function setHint(html) { $('#hint').innerHTML = html || ''; }

/** Screen positions for the name tags, eased so they glide instead of jittering with the camera. */
export function placeTag(seat, x, y, visible, dt) {
  const t = tags[seat]; if (!t?.el) return;
  // Keep the tag clear of the top HUD, and drop the speech bubble under the tag when there's no room above.
  if (hud.bottom) y = Math.max(y, hud.bottom + 8 + t.h);
  const k = t.placed ? 1 - Math.exp(-dt * 18) : 1;
  t.x += (x - t.x) * k; t.y += (y - t.y) * k; t.placed = true;
  t.el.style.transform = `translate3d(${t.x.toFixed(1)}px, ${t.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
  const below = t.y - t.h - t.bh - 12 < hud.bottom + 4;
  if (below !== t.below) { t.below = below; t.el.classList.toggle('below', below); }
  const op = visible && document.body.classList.contains('in-game') ? '' : '0';
  if (t.el.style.opacity !== op) t.el.style.opacity = op;
}

/* ---------- player actions ---------- */
export function showActions({ canPlay, canChallenge, selected, rank, lastSeat, lastClaim }) {
  $('#actions').hidden = false;
  const R = RANK_STYLE[rank];
  const play = $('#play-btn');
  play.disabled = !canPlay || selected < 1 || selected > 3;
  play.querySelector('.lbl').textContent = selected ? `Play ${selected} as ${selected === 1 ? R.name : R.plural}` : 'Pick 1–3 cards';
  $('#liar-btn').disabled = !canChallenge;
  if (lastSeat == null) setHint(`Your lead. Pick 1–3 cards and claim they're all <b>${R.plural}</b>.`);
  else setHint(`<b>${NAMES[lastSeat]}</b> claims ${claimText(lastClaim, rank).toLowerCase()}. Play on, or call Liar.`);
}
export function hideActions() { $('#actions').hidden = true; setHint(''); }

/** Resolves once the player has held the trigger button (or Space) for the full duration. */
let cancelActiveTrigger = null;
export const cancelTrigger = () => cancelActiveTrigger?.();
export function awaitTrigger(hintHtml, holdMs = 750) {
  return new Promise((resolve) => {
    const row = $('#trigger-row'), btn = $('#trigger-btn');
    row.hidden = false; setHint(hintHtml);
    let start = 0, raf = 0, done = false;
    const set = (p) => btn.style.setProperty('--p', p.toFixed(3));
    const tick = () => {
      const p = clamp((performance.now() - start) / holdMs, 0, 1); set(p);
      if (p >= 1) return finish();
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
    function finish() {
      done = true; cancelAnimationFrame(raf);
      btn.removeEventListener('pointerdown', down); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); btn.removeEventListener('pointerleave', up);
      removeEventListener('keydown', key); removeEventListener('keyup', key);
      row.hidden = true; set(0); setHint('');
      cancelActiveTrigger = null;
      resolve();
    }
    cancelActiveTrigger = finish;
    btn.addEventListener('pointerdown', down); addEventListener('pointerup', up); addEventListener('pointercancel', up); btn.addEventListener('pointerleave', up);
    addEventListener('keydown', key); addEventListener('keyup', key);
    btn.focus({ preventScroll: true });
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
export function showEnd({ won, rounds, survivors, recap }) {
  const end = $('#end');
  end.classList.toggle('won', won); end.classList.toggle('lost', !won);
  $('#end-kicker').textContent = won ? 'The house salutes you' : 'Closing time';
  $('#end-title').textContent = won ? 'Last One Sitting' : 'Lights Out';
  $('#end-text').textContent = won
    ? `You outlasted the table in ${rounds} ${rounds === 1 ? 'round' : 'rounds'}. The Lantern pours you one on the house.`
    : `${survivors.join(' and ')} ${survivors.length === 1 ? 'keeps' : 'keep'} the table. You lasted ${rounds} ${rounds === 1 ? 'round' : 'rounds'}.`;
  $('#recap').innerHTML = recap.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
  openOverlay('end');
}
