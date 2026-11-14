// Table gestures: wave, the finger, thumbs up, point and laugh, shrug, slow clap. A person picks one
// from the gesture button (or G, then 1 to 6); the server relays it to every seat, the sender too,
// and each client plays it as it arrives: your own arm in first person, anyone else's character at
// their seat with the gesture's icon by their name. Bots gesture too, from the same event stream
// as their lines, so nothing extra crosses the wire for them. A gesture is presentation only: it
// never touches the game, and a busy pair of hands (the revolver, a glass, a cup) refuses it.
import * as THREE from 'three';
import { $, pick, settings } from './util.js';
import { EMOTES as KINDS, EMOTE_BURST, EMOTE_RATE } from './net/protocol.js';
import * as ui from './ui.js';
import { audio } from './audio.js';
import { emote as charEmote, headWorld } from './render/characters.js';
import { armEmote, armFree } from './render/playerArm.js';
import { camera } from './render/core.js';

export const GESTURES = {
  wave: { icon: '👋', label: 'Wave' },
  flip: { icon: '🖕', label: 'Flip off' },
  thumbs: { icon: '👍', label: 'Thumbs up' },
  laugh: { icon: '🤣', label: 'Point & laugh' },
  shrug: { icon: '🤷', label: 'Shrug' },
  clap: { icon: '👏', label: 'Slow clap' },
};

// When each clap lands, in seconds into the clip (tools/models/lib/emotes.py: the beat's tempo,
// whether it is crisp, and STRIKE), and your own arm's (src/render/playerArm.js).
const CLAP_TEMPO = { brass: [0.95, 0.55], noctua: [1.08, 0.62], gristle: [1.1, 0.62] };
const clapBeats = (design) => {
  const [tempo, gap] = CLAP_TEMPO[design] ?? [1, 0.62];
  return [0, 1, 2].map((i) => 0.45 * tempo + gap * tempo * (i + 0.35));
};
const MY_CLAPS = [0.4, 0.95, 1.5];
const CLAP_GAIN = { brass: 0.8, noctua: 0.55, gristle: 1.2 };

// what a bot says back when a person gestures at it, and the gesture it may return
const REPLY = {
  brass: {
    wave: ['Greetings.', 'Salutation received.'], flip: ['Gesture logged.', 'Noted. Filed. Ignored.'], thumbs: ['Approval acknowledged.'],
    laugh: ['Humour module: offline.', 'Your mirth is noted.'], shrug: ['Uncertainty is rational.'], clap: ['Applause: one unit.'],
  },
  noctua: {
    wave: ['Darling.', 'Charmed, I\'m sure.'], flip: ['How vulgar. I adore it.', 'And to you, sweet thing.'], thumbs: ['Too kind.'],
    laugh: ['Laugh while you can, dear.'], shrug: ['Mm. A mystery suits you.'], clap: ['Oh, stop. Don\'t stop.'],
  },
  gristle: {
    wave: ['Ahoy!', 'Aye, aye.'], flip: ['Same to ye, bilge rat!', 'HAH! Cheeky.'], thumbs: ['Aye!'],
    laugh: ['Laugh it up, landlubber!'], shrug: ['Who knows, eh?'], clap: ['Har! Thank ye kindly.'],
  },
};
const RETURN = {
  wave: { brass: 'wave', noctua: 'wave', gristle: 'wave' },
  flip: { brass: 'shrug', noctua: 'laugh', gristle: 'flip' },
  thumbs: { brass: 'thumbs', noctua: 'thumbs', gristle: 'thumbs' },
  laugh: { brass: 'shrug', noctua: 'shrug', gristle: 'flip' },
  shrug: { brass: 'shrug', noctua: 'shrug', gristle: 'laugh' },
  clap: { brass: 'thumbs', noctua: 'wave', gristle: 'thumbs' },
};

const E = {
  T: null, open: false, bucket: { tokens: EMOTE_BURST, at: 0 },
  spent: new Map(),   // seat -> the round its bot last gestured in
  replied: new Map(), // seat -> when its bot last answered someone (ms)
  ordeal: false,      // a revolver or a drink is being played out: bots keep still
  aim: [null, null, null, null], // by view: { seat, until } while a bot gestures at someone
};
let btn, menu, note, noteTimer = 0;

/* ---------- the menu ---------- */

export function initEmotes(T, { onOpen } = {}) {
  E.T = T; E.onOpen = onOpen;
  btn = $('#emote-btn'); menu = $('#emote-menu'); note = $('#emote-note');
  menu.innerHTML = KINDS.map((k, i) => `<button type="button" role="menuitem" data-kind="${k}" title="${GESTURES[k].label} (${i + 1})"><kbd>${i + 1}</kbd><span class="ico" aria-hidden="true">${GESTURES[k].icon}</span><span class="nm">${GESTURES[k].label}</span></button>`).join('');
  btn.addEventListener('click', () => (E.open ? closeMenu() : openMenu()));
  menu.addEventListener('click', (e) => { const b = e.target.closest('button[data-kind]'); if (b) choose(b.dataset.kind); });
  // a tap anywhere else puts the menu away; typing a chat line does too
  addEventListener('pointerdown', (e) => { if (E.open && !menu.contains(e.target) && !btn.contains(e.target)) closeMenu(); }, true);
  $('#chat-input').addEventListener('focus', () => closeMenu());
  $('#chat-btn').addEventListener('click', () => closeMenu());
}

/** Shows the gesture button while you sit at a running table. */
export function syncEmotes(on) {
  btn.hidden = !on;
  if (!on) closeMenu();
}

function openMenu() {
  if (btn.hidden) return;
  E.open = true; menu.hidden = false; btn.setAttribute('aria-expanded', 'true');
  E.onOpen?.();
}
export function closeMenu() {
  if (!E.open) return;
  E.open = false; menu.hidden = true; btn.setAttribute('aria-expanded', 'false');
  if (menu.contains(document.activeElement)) document.activeElement.blur();
}

/** The window's key handler asks first: G opens the menu, then 1 to 6 picks and Escape or G closes it. True when the key was used. */
export function emoteKey(e) {
  if (btn.hidden || e.ctrlKey || e.metaKey || e.altKey) return false;
  if (E.open) {
    if (e.key >= '1' && e.key <= String(KINDS.length)) { e.preventDefault(); choose(KINDS[+e.key - 1]); return true; }
    if (e.key === 'Escape' || e.key === 'g' || e.key === 'G') { e.preventDefault(); closeMenu(); return true; }
    return false;
  }
  if ((e.key === 'g' || e.key === 'G') && !e.repeat && !settings.paused && !ui.topOverlay()) { e.preventDefault(); openMenu(); return true; }
  return false;
}

function hint(text) {
  note.textContent = text; note.classList.add('show');
  clearTimeout(noteTimer); noteTimer = setTimeout(() => note.classList.remove('show'), 1800);
}

/** The same budget as the server's (1 per 1.5 s, a burst of 2), so a refusal is said here, not dropped there. */
function spend(now) {
  const b = E.bucket;
  b.tokens = Math.min(EMOTE_BURST, b.tokens + ((now - b.at) * EMOTE_RATE) / 1000); b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function choose(kind) {
  closeMenu();
  const T = E.T;
  if (!T.game || T.phase !== 'playing') return;
  if (!armFree()) return hint('Your hand is busy.');
  if (!spend(performance.now())) return hint('One gesture at a time.');
  if (!T.send({ type: 'emote', kind })) hint('Not connected to the table.');
}

/* ---------- playing them ---------- */

/** A gesture the server relayed, yours included: it is played here as it arrives. */
export function emoteMessage({ seat, kind }) {
  const T = E.T;
  if (!T.game || !GESTURES[kind] || T.absent(seat)) return;
  if (T.isMe(seat)) {
    armEmote(kind);
    sound(T, seat, kind, null);
    replyTo(T, myTarget(T), kind);
    return;
  }
  perform(T, seat, kind);
}

/** A character at the table gestures (or, with its hands busy, only shows the icon). */
function perform(T, seat, kind) {
  const ch = T.char(seat);
  if (!ch) return;
  const moved = charEmote(ch, kind);
  ui.emoteBadge(T.view(seat), GESTURES[kind].icon);
  sound(T, seat, kind, moved ? T.design(seat) : null);
}

function sound(T, seat, kind, design) {
  const pan = T.pan(seat), mine = T.isMe(seat);
  if (kind === 'clap') for (const t of mine ? MY_CLAPS : clapBeats(design)) audio.clap(pan, t, mine ? 0.9 : CLAP_GAIN[design] ?? 0.8);
  else if (kind === 'wave') audio.whoosh(pan, 0.3);
  else if (kind === 'laugh') audio.chuckle(pan, design === 'gristle');
  else if (kind === 'flip') { audio.rustle(pan, 0.15); if (design === 'gristle' || mine) audio.whistle(pan, 0.45); }
  else audio.rustle(pan, 0.2);
}

/** Who you are looking at: the view whose head is nearest the middle of your sight, or null. */
function myTarget(T) {
  let best = 0.3, hit = null;
  const fwd = camera.getWorldDirection(_f), at = _h;
  for (let v = 1; v < 4; v++) {
    const seat = T.seatAt(v);
    if (T.absent(seat)) continue;
    headWorld(T.viewChars[v], at).sub(camera.position).normalize();
    const miss = Math.acos(Math.min(1, at.dot(fwd)));
    if (miss < best) { best = miss; hit = seat; }
  }
  return hit;
}
const _f = new THREE.Vector3(), _h = new THREE.Vector3();

/** A bot you gestured at may answer: a line, and now and then a gesture of its own back at you. */
function replyTo(T, seat, kind) {
  if (seat == null || !T.isBot(seat) || (T.game.alive && !T.game.alive[seat])) return;
  const now = performance.now();
  if (now - (E.replied.get(seat) ?? -1e9) < 6000 || Math.random() > 0.75) return;
  E.replied.set(seat, now);
  const d = T.design(seat), line = REPLY[d]?.[kind];
  if (line) setTimeout(() => ui.say(T.view(seat), pick(line)), 700 / settings.speed);
  if (Math.random() < 0.6) botEmote(T, seat, RETURN[kind][d] ?? kind, { at: T.me, delay: 1100 });
}

/* ---------- bots ---------- */

const roundOf = (T) => T.game?.round ?? T.game?.auction ?? 0;

/**
 * A bot gestures, at `at` (a seat) or straight ahead: at most once a round, never while a revolver
 * or a drink is being played out, and only now and then (`chance`). Returns whether it will.
 */
export function botEmote(T, seat, kind, { at = null, delay = 0, chance = 1, key = null } = {}) {
  if (seat == null || T.isMe(seat) || !T.isBot(seat) || T.absent(seat) || E.ordeal) return false;
  if (Math.random() >= chance) return false;
  const round = key ?? roundOf(T);
  if (E.spent.get(seat) === round) return false;
  E.spent.set(seat, round);
  const token = T.token();
  setTimeout(() => {
    if (token !== T.token() || E.ordeal || !T.game) return;
    const v = T.view(seat);
    E.aim[v] = at == null || at === seat ? null : { seat: at, until: performance.now() + 2600 / settings.speed };
    perform(T, seat, kind);
  }, delay / settings.speed);
  return true;
}

/** Picks one of `seats` (other than `not`) that is a bot still in the game, or null. */
export function aBot(T, seats, not = []) {
  const ok = seats.filter((s) => s != null && !not.includes(s) && T.isBot(s) && !T.absent(s) && (!T.game.alive || T.game.alive[s]));
  return ok.length ? pick(ok) : null;
}

/** Set while a revolver or a drink is being played out. */
export function setOrdeal(on) { E.ordeal = on; }

/** Where a gesturing bot in view `v` looks, or null to look where it otherwise would. */
export function emoteLook(v, out) {
  const a = E.aim[v], T = E.T;
  if (!a) return null;
  if (performance.now() > a.until || !T.game) { E.aim[v] = null; return null; }
  return T.isMe(a.seat) ? out.copy(camera.position) : headWorld(T.char(a.seat), out);
}

/** A new table: every bot may gesture again. */
export function resetEmotes() {
  E.spent.clear(); E.replied.clear(); E.ordeal = false; E.aim.fill(null);
  closeMenu();
}

/* ---------- when bots gesture (called from the modes, beside their lines) ---------- */

const others = (T, seat, out = []) => [0, 1, 2, 3].filter((s) => s !== seat && !T.absent(s) && !out.includes(s) && (!T.game.alive || T.game.alive[s]));

/** The first deal: a few of them wave at someone. */
export function greet(T) {
  for (let s = 0; s < 4; s++) if (T.isBot(s)) botEmote(T, s, 'wave', { at: pick(others(T, s)), delay: 400 + Math.random() * 2200, chance: 0.4 });
}
/** `accused` told the truth: the finger for whoever called them a liar. */
export function wrongCall(T, accused, caller) { botEmote(T, accused, 'flip', { at: caller, delay: 450, chance: 0.6 }); }
/** `liar` was caught: they shrug, and someone points and laughs (or slow-claps the caller). */
export function caught(T, liar, caller) {
  botEmote(T, liar, 'shrug', { at: caller, delay: 650, chance: 0.5 });
  const w = aBot(T, others(T, liar));
  if (w == null) return;
  if (w !== caller && Math.random() < 0.35) botEmote(T, w, 'clap', { at: caller, delay: 900, chance: 0.6 });
  else botEmote(T, w, 'laugh', { at: liar, delay: 800, chance: 0.55 });
}
/** `seat` lived through the revolver or the glass. */
export function survived(T, seat) { botEmote(T, seat, 'thumbs', { at: pick(others(T, seat)), delay: 250, chance: 0.5 }); }
/** `seat` drank the poison: someone points and laughs. */
export function poisoned(T, seat) { botEmote(T, aBot(T, others(T, seat)), 'laugh', { at: seat, delay: 500, chance: 0.5 }); }
/** The game's winner gets a slow clap from those still standing. */
export function applaud(T, winner, out = []) {
  for (const s of others(T, winner, out)) botEmote(T, s, 'clap', { at: winner, delay: 600 + Math.random() * 900, chance: 0.7, key: 'end' });
}
