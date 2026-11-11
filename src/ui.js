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

export function initUI() {
  icons = Object.fromEntries(Object.keys(RANK_STYLE).map((r) => [r, rankIcon(r)]));
  for (let seat = 1; seat < 4; seat++) {
    const el = document.createElement('div'); el.className = 'tag'; el.style.opacity = '0';
    el.innerHTML = `<div class="bubble"></div><div class="nm">${NAMES[seat]}</div><div class="meta"><span class="cnt"></span><span class="pips"></span></div><div class="status"></div>`;
    $('#tags').appendChild(el);
    tags[seat] = { el, bubble: el.querySelector('.bubble'), cnt: el.querySelector('.cnt'), pips: el.querySelector('.pips'), status: el.querySelector('.status'), timer: 0, lastPulls: 0, x: 0, y: 0 };
  }
  tags[0] = { pips: $('#me-pips'), lastPulls: 0 };
  $('#cards-demo').innerHTML = ['sun', 'moon', 'star', 'wild'].map((r) => `<figure><img src="${cardImage(r)}" alt="${RANK_STYLE[r].name} card"><figcaption>${RANK_STYLE[r].name}${r === 'wild' ? ' (matches all)' : ''}</figcaption></figure>`).join('');
  bindSettings();
  for (const o of document.querySelectorAll('.overlay [data-close]')) o.addEventListener('click', () => closeOverlay(o.closest('.overlay').id));
  const s = store.get('stats', null);
  if (s && s.played) $('#stats-line').textContent = `${s.wins} ${s.wins === 1 ? 'win' : 'wins'} in ${s.played} ${s.played === 1 ? 'game' : 'games'} · best streak ${s.best}`;
}

/* ---------- overlays ---------- */
const stack = [];
export function openOverlay(id) {
  const el = $(`#${id}`); el.hidden = false;
  requestAnimationFrame(() => el.classList.remove('fade'));
  if (!stack.includes(id)) stack.push(id);
  setTimeout(() => el.querySelector('.btn.primary, button')?.focus({ preventScroll: true }), 50);
}
export function closeOverlay(id) {
  const el = $(`#${id}`); el.classList.add('fade');
  const i = stack.indexOf(id); if (i >= 0) stack.splice(i, 1);
}
export const topOverlay = () => stack[stack.length - 1] || null;
export const isOpen = (id) => stack.includes(id);

/* ---------- settings ---------- */
function seg(id, value, onPick) {
  const root = $(`#${id}`);
  const sync = (v) => { for (const b of root.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === String(v))); };
  sync(value);
  root.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; sync(b.dataset.v); onPick(b.dataset.v); audio.uiClick(); });
}
function bindSettings() {
  for (const k of ['master', 'music', 'sfx', 'ambience']) {
    const el = $(`#vol-${k}`); el.value = audio.vol[k];
    el.addEventListener('input', () => audio.setVolume(k, +el.value));
  }
  seg('quality-seg', quality.mode, (v) => setQualityMode(v));
  settings.speed = store.get('speed', 1);
  seg('speed-seg', settings.speed, (v) => { settings.speed = +v; store.set('speed', +v); });
  rig.lookEnabled = store.get('look', true);
  seg('look-seg', rig.lookEnabled ? 'on' : 'off', (v) => { rig.lookEnabled = v === 'on'; store.set('look', rig.lookEnabled); });
  settings.reducedMotion = store.get('reducedMotion', settings.reducedMotion);
  seg('motion-seg', settings.reducedMotion ? 'on' : 'off', (v) => { settings.reducedMotion = v === 'on'; store.set('reducedMotion', settings.reducedMotion); });
  const sb = $('#sound-btn');
  const syncSound = () => { sb.textContent = audio.muted ? 'Sound off' : 'Sound on'; sb.setAttribute('aria-pressed', String(audio.muted)); };
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
  $('#table-name').textContent = RANK_STYLE[rank].plural.toUpperCase();
  $('#round-label').textContent = `Round ${round} · Table card`;
  $('#top').hidden = false;
  const tc = $('#table-card'); tc.classList.remove('pulse'); void tc.offsetWidth; tc.classList.add('pulse');
}
export function setClaim(html) { $('#claim').innerHTML = html || ''; }

function pipsHTML(pulls, fresh) { let s = ''; for (let i = 0; i < 6; i++) s += `<span class="pip${i < pulls ? ' spent' : ''}${fresh && i === pulls - 1 ? ' fresh' : ''}"></span>`; return s; }
/** Refresh every seat's counters from the model. `active` is the seat whose turn it is. */
export function refreshSeats(game, active) {
  for (const p of game.players) {
    const t = tags[p.seat], fresh = p.pulls !== t.lastPulls;
    if (fresh) { t.pips.innerHTML = pipsHTML(p.pulls, p.pulls > t.lastPulls); t.lastPulls = p.pulls; }
    if (p.seat === 0) {
      $('#me-odds').textContent = p.alive ? `Next pull: 1 in ${6 - p.pulls}` : 'Out';
      $('#me-card').classList.toggle('active', active === 0);
      continue;
    }
    const cnt = p.alive ? (p.hand.length ? '<i></i>'.repeat(p.hand.length) : 'No cards') : 'Out';
    if (t.cnt.innerHTML !== cnt) t.cnt.innerHTML = cnt;
    t.el.classList.toggle('out', !p.alive);
    t.el.classList.toggle('active', active === p.seat && p.alive);
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
  const k = t.placed ? 1 - Math.exp(-dt * 18) : 1;
  t.x += (x - t.x) * k; t.y += (y - t.y) * k; t.placed = true;
  t.el.style.transform = `translate3d(${t.x.toFixed(1)}px, ${t.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
  const op = visible && document.body.classList.contains('in-game') ? '' : '0';
  if (t.el.style.opacity !== op) t.el.style.opacity = op;
}

/* ---------- player actions ---------- */
export function showActions({ canPlay, canChallenge, selected, rank, lastSeat, lastClaim }) {
  $('#actions').hidden = false;
  const R = RANK_STYLE[rank];
  const play = $('#play-btn');
  play.disabled = !canPlay || selected < 1 || selected > 3;
  play.querySelector('.lbl').textContent = selected ? `Play ${selected} as ${selected === 1 ? R.name : R.plural}` : 'Pick cards';
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
    const key = (e) => { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); if (e.type === 'keydown') down(); else up(); } };
    function finish() {
      done = true; cancelAnimationFrame(raf);
      btn.removeEventListener('pointerdown', down); removeEventListener('pointerup', up); btn.removeEventListener('pointerleave', up);
      removeEventListener('keydown', key); removeEventListener('keyup', key);
      row.hidden = true; set(0); setHint('');
      cancelActiveTrigger = null;
      resolve();
    }
    cancelActiveTrigger = finish;
    btn.addEventListener('pointerdown', down); addEventListener('pointerup', up); btn.addEventListener('pointerleave', up);
    addEventListener('keydown', key); addEventListener('keyup', key);
    btn.focus({ preventScroll: true });
  });
}

/* ---------- first-game tips ---------- */
export function coach(key, html) {
  const seen = store.get('coach', {}); if (seen[key] || settings.autoplay) return;
  seen[key] = true; store.set('coach', seen);
  document.querySelector('.coach')?.remove();
  const el = document.createElement('div'); el.className = 'coach'; el.innerHTML = `${html}<small>Tap to dismiss</small>`;
  el.addEventListener('click', () => el.remove());
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 9000);
}
export const dismissCoach = () => document.querySelector('.coach')?.remove();

/* ---------- stats & end screen ---------- */
export function recordResult(won) {
  const s = store.get('stats', { played: 0, wins: 0, streak: 0, best: 0 });
  s.played++; if (won) { s.wins++; s.streak++; s.best = Math.max(s.best, s.streak); } else s.streak = 0;
  store.set('stats', s);
  $('#stats-line').textContent = `${s.wins} ${s.wins === 1 ? 'win' : 'wins'} in ${s.played} ${s.played === 1 ? 'game' : 'games'} · best streak ${s.best}`;
  return s;
}
export function showEnd({ won, rounds, survivors, recap }) {
  $('#end-title').textContent = won ? 'Last One Sitting' : 'Lights Out';
  $('#end-text').textContent = won
    ? `You outlasted the table in ${rounds} ${rounds === 1 ? 'round' : 'rounds'}. The Lantern pours you one on the house.`
    : `${survivors.join(' and ')} ${survivors.length === 1 ? 'keeps' : 'keep'} the table. You lasted ${rounds} ${rounds === 1 ? 'round' : 'rounds'}.`;
  $('#recap').innerHTML = recap.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
  openOverlay('end');
}
