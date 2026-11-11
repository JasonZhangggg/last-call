// The event player. The server (a Room in this tab, or a Durable Object) owns the rules; the director
// plays its messages back in order, one at a time, through the active mode's renderer, so no two
// animations overlap and none is skipped. Every await goes through T.step(), so a rebuild or leaving
// the table cancels the flow cleanly.
//
// Two cursors over one stream: D.latest is the table as of the last message received (used to rebuild
// at any moment), D.shown the table as of the message being played (what the renderer reads).
// Seats are absolute on the wire; views are relative, 0 being you at the camera and 1..3 the
// characters left to right, so the table turns to put you in your own chair.
import * as THREE from 'three';
import { wait, settings } from './util.js';
import { audio } from './audio.js';
import * as ui from './ui.js';
import { headWorld, resetCharacter, SEAT_RADIUS } from './render/characters.js';
import { rig, focusOn } from './render/camera.js';
import { MODES } from './modes/index.js';

export const VIEWS = [
  { pan: 0 },
  { angle: Math.PI + 0.52, pan: -0.6 },
  { angle: -Math.PI / 2, pan: 0 },
  { angle: -0.52, pan: 0.6 },
];
export const DESIGNS = ['brass', 'noctua', 'gristle'];
const BACKLOG = 6;

const ABORT = Symbol('abort');
export const D = {
  me: null, info: [], options: null, hooks: {},
  mode: null, latest: null, shown: null, latestPrompt: null, result: null,
  prompt: null, phase: 'idle',
  queue: [], busy: false, token: 0,
  actor: null, watch: null, // view in the spotlight, and a world point everyone looks at instead
  characters: {}, viewChars: [null, null, null, null], designOf: [],
  send: () => false, timeScale: () => 1,
  recap: null, out: false, recorded: false,
};
const _h = new THREE.Vector3();

/* ---------- seats and views ---------- */
const view = (seat) => (seat - D.me + 4) % 4;
const seatAt = (v) => (v + D.me) % 4;

/** Everything a mode renderer may use. Handlers receive it as their first argument. */
export const T = {
  get me() { return D.me; },
  get game() { return D.shown; },
  get prompt() { return D.prompt; },
  get recap() { return D.recap; },
  get viewChars() { return D.viewChars; },
  get rushing() { return D.queue.length > 2; },
  view, seatAt,
  isMe: (seat) => seat === D.me,
  name: (seat) => (seat === D.me ? 'You' : D.info[seat]?.name || `Seat ${seat + 1}`),
  char: (seat) => D.viewChars[view(seat)],
  design: (seat) => D.designOf[seat],
  pan: (seat) => VIEWS[view(seat)].pan,
  async step(ms, token = D.token) {
    await wait(D.queue.length > 2 ? ms * 0.5 : ms);
    if (token !== D.token) throw ABORT;
  },
  /** Waits for a flight to land, so a hand never closes on a thing that hasn't arrived when frames run late. */
  async landed(mover) { const token = D.token; while (mover.flying) await T.step(20, token); },
  token: () => D.token,
  send: (msg) => D.send(msg),
  setActor(seat) { D.actor = seat == null ? null : view(seat); },
  setWatch(point) { D.watch = point; },
  focusSeat(seat, weight = 0.45) { if (seat == null || seat === D.me) focusOn(null); else focusOn(headWorld(T.char(seat), _h), weight); },
  refresh() { if (D.mode && D.shown) ui.refreshSeats(D.mode.seatHud(T), D.prompt ? { view: view(D.prompt.seat), gun: D.prompt.type !== 'turn' } : null); },
  /** Your seat is out: the screen goes dark, then you choose to watch the rest or leave. */
  eliminated() { D.out = true; ui.hideActions(); ui.setCountdown(null); D.hooks.onOut?.(); },
};

/* ---------- the queue ---------- */

/** Feeds one server message (any game message, including `state`). */
export function receive(msg) {
  const at = performance.now();
  if (msg.type === 'state') {
    // a full rebuild supersedes everything not yet shown
    D.queue.length = 0; D.token++;
    ui.cancelTrigger();
    D.latest = msg.game ? structuredClone(msg.game) : null;
    D.latestPrompt = msg.prompt ? { ...msg.prompt, at } : null;
    D.result = msg.result;
  } else {
    if (msg.type === 'over') D.result = msg;
    if (msg.type === 'turn' || msg.type === 'roulette') D.latestPrompt = { ...msg, type: msg.type, at };
    else D.latestPrompt = null;
    if (D.latest) MODES[D.options?.mode]?.reduce(D.latest, msg, D.me);
  }
  D.queue.push({ msg, at });
  pump();
}

async function pump() {
  if (D.busy) return;
  D.busy = true;
  while (D.queue.length) {
    const { msg, at } = D.queue.shift();
    try {
      await play(msg, at);
    } catch (e) {
      if (e === ABORT) continue;
      console.error('Could not play', msg.type, e);
      D.queue.length = 0;
      // start over from what has arrived, unless that is what just failed
      if (D.latest && msg.type !== 'state') D.queue.push({ msg: snapshotMessage(), at: performance.now() });
    }
  }
  D.busy = false;
}

/** A `state` built from what has arrived, for catching up without replaying every animation. */
function snapshotMessage() {
  const p = D.latestPrompt;
  const left = p?.timeoutMs == null ? null : Math.max(0, p.timeoutMs - (performance.now() - p.at) * D.timeScale());
  return { type: 'state', phase: D.result ? 'finished' : 'playing', game: structuredClone(D.latest), prompt: p ? { type: p.type, seat: p.seat, timeoutMs: left, options: p.options } : null, result: D.result };
}

/** Back from a hidden tab with a long backlog: jump straight to the present. */
export function catchUp() {
  if (D.queue.length < BACKLOG || !D.latest) return;
  D.queue.length = 0; D.token++;
  ui.cancelTrigger();
  D.queue.push({ msg: snapshotMessage(), at: performance.now() });
  pump();
}

async function play(msg, at) {
  const mode = D.mode;
  if (msg.type === 'state') return playState(msg, at);
  if (!mode || !D.shown) return;
  if (msg.type === 'turn' || msg.type === 'roulette') return playPrompt(msg, at);
  if (msg.type === 'over') return playOver(msg);
  clearPrompt();
  mode.reduce(D.shown, msg, D.me);
  await mode.on[msg.type]?.(T, msg);
}

function clearPrompt() {
  if (!D.prompt) return;
  D.prompt = null;
  ui.setCountdown(null); ui.hideActions(); ui.cancelTrigger();
  D.mode?.clearPrompt?.(T);
}

async function playPrompt(msg, at) {
  const same = D.prompt && D.prompt.type === msg.type && D.prompt.seat === msg.seat;
  const deadline = msg.timeoutMs == null ? null : at + msg.timeoutMs / D.timeScale();
  D.prompt = { type: msg.type, seat: msg.seat, options: msg.options, deadline, total: msg.timeoutMs };
  const mine = msg.seat === D.me;
  ui.setCountdown(mine && deadline != null ? { deadline, total: Math.max(msg.timeoutMs / D.timeScale(), deadline - performance.now()) } : null);
  T.refresh();
  // The server re-sends a prompt when a person and a bot swap control of a seat: only the clock changes.
  if (same) return D.mode.reprompt?.(T, msg);
  await D.mode.on[msg.type]?.(T, msg);
  if (mine && settings.autoplay && D.prompt?.seat === D.me) {
    const token = D.token;
    await T.step(250, token);
    const act = D.mode.auto(T, msg);
    if (act) { D.mode.clearPrompt?.(T); T.send(act); }
  }
}

/* ---------- table lifecycle ---------- */

export function setLobby(lobby) {
  D.info = lobby.seats;
  D.options = lobby.options;
  if (D.mode) ui.setSeatNames([0, 1, 2, 3].map((v) => T.name(seatAt(v))), [0, 1, 2, 3].map((v) => D.info[seatAt(v)]?.connected !== false));
}

async function playState(msg) {
  D.result = msg.result;
  if (msg.phase === 'lobby' || !msg.game) {
    leaveTable();
    return D.hooks.onLobby?.();
  }
  const mode = MODES[D.options.mode];
  if (!mode?.ready) {
    leaveTable();
    return ui.toast('That game is coming in the next update.', 'small');
  }
  const fresh = msg.phase === 'playing' && (msg.game.round ?? msg.game.auction) === 0;
  if (D.mode !== mode || fresh || D.phase === 'idle') enterTable(mode);
  D.phase = msg.phase;
  D.shown = structuredClone(msg.game);
  D.prompt = null; D.actor = null; D.watch = null;
  ui.setCountdown(null); ui.hideActions();
  D.out = D.me != null && mode.isOut?.(T, D.me) && !fresh;
  D.hooks.onTable?.();
  await mode.rebuild(T, { fresh });
  T.refresh();
  if (msg.phase === 'finished' && msg.result) return playOver(msg.result);
  if (msg.prompt) await playPrompt({ type: msg.prompt.type, ...msg.prompt }, performance.now());
}

/** Seats you in your chair, puts each other seat's character on its view, and opens the mode's table. */
function enterTable(mode) {
  if (D.mode && D.mode !== mode) D.mode.exit(T);
  D.mode = mode;
  D.recap = mode.newRecap?.() || {};
  D.out = false; D.recorded = false;
  const others = [1, 2, 3].map(seatAt), taken = new Set();
  D.designOf = [];
  for (const s of others) {
    const p = D.info[s]?.persona;
    if (DESIGNS.includes(p) && !taken.has(p)) { D.designOf[s] = p; taken.add(p); }
  }
  for (const s of others) if (!D.designOf[s]) { const d = DESIGNS.find((x) => !taken.has(x)); D.designOf[s] = d; taken.add(d); }
  for (const s of others) {
    const v = view(s), ch = D.characters[D.designOf[s]];
    seatCharacter(ch, VIEWS[v].angle);
    resetCharacter(ch);
    D.viewChars[v] = ch;
  }
  ui.resetSeats(); ui.clearLog(); ui.setClaim(''); ui.closeOverlay('end'); ui.closeOverlay('out');
  ui.setSeatNames([0, 1, 2, 3].map((v) => T.name(seatAt(v))), [0, 1, 2, 3].map((v) => D.info[seatAt(v)]?.connected !== false));
  for (let s = 1; s < 4; s++) ui.setStatus(s, '');
  ui.setInGame(true);
  ui.setBlackout(false);
  rig.introTarget = 1; rig.zoomTarget = 1; rig.rollTarget = 0;
  mode.enter(T);
}

function seatCharacter(ch, angle) {
  ch.group.position.set(Math.cos(angle) * SEAT_RADIUS, 0, Math.sin(angle) * SEAT_RADIUS);
  ch.group.lookAt(0, 0, 0);
  ch.group.updateMatrixWorld(true);
  ch.tagAnchor = ch.head.getWorldPosition(ch.tagAnchor || new THREE.Vector3()).add(_h.set(0, 0.27, 0));
}

/** Leaves the table: cancels the flow and puts the room back to its idle look. */
export function leaveTable() {
  D.token++; D.queue.length = 0;
  D.prompt = null; D.actor = null; D.watch = null; D.shown = null;
  ui.cancelTrigger(); ui.hideActions(); ui.setCountdown(null); ui.dismissCoach();
  audio.setTension(0); ui.setTense(false); ui.setBlackout(false);
  focusOn(null); rig.zoomTarget = 1; rig.rollTarget = 0; rig.leanTarget = 0;
  if (D.mode) D.mode.exit(T);
  D.mode = null; D.phase = 'idle';
  for (const ch of Object.values(D.characters)) resetCharacter(ch);
  ui.setInGame(false);
}

/** Forget the table entirely (closing the connection). */
export function resetDirector() {
  leaveTable();
  D.latest = null; D.latestPrompt = null; D.result = null; D.me = null; D.info = []; D.options = null;
}

async function playOver(msg) {
  clearPrompt();
  D.result = msg; D.phase = 'finished';
  D.actor = null;
  ui.closeOverlay('out');
  await T.step(400);
  const seated = D.me != null && msg.seats[D.me];
  const won = msg.winner === D.me;
  // a reconnect to a finished table shows the result again but must not count it twice
  const stats = seated && !D.recorded ? ui.recordResult(won) : null;
  D.recorded = true;
  won ? audio.win() : audio.lose();
  const summary = D.mode.summary(T, msg, stats);
  ui.setBlackout(false); ui.setTense(false);
  D.hooks.onOver?.({ won, ...summary });
}

/** A refusal from the server for something you tried (a stale click, an illegal play). */
export function refused(msg) { D.mode?.refused?.(T, msg); }

/** Where character `v` (a view) should look this frame. */
export function lookTargetFor(v, camera, out) {
  if (D.watch) return out.copy(D.watch);
  const a = D.actor;
  if (a == null || a === v) return a === v && D.prompt?.type === 'turn' ? out.set(0, 0, 0) : out.copy(camera.position);
  if (a === 0) return out.copy(camera.position);
  return headWorld(D.viewChars[a], out);
}

