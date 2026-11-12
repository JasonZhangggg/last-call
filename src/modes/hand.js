// What you hold to read, shared by every mode: playing cards (deck), money (auction), the dice
// under your cup (dice). It rests while you look around; Space (or the look button) brings it up
// close with the head held still, and Space again puts it down and frees the head. With a mouse,
// moving onto a resting hand of cards brings it up too, and moving well above it puts it back.
// `k` is the blend a mode's layout eases along, so the hand rises and settles instead of jumping.
// Online, `up` is what the other seats see your character do (main.js sends it in `look`).
import { $ } from '../util.js';
import { smoothDamp } from '../render/motion.js';
import { lockLook } from '../render/camera.js';
import { audio } from '../audio.js';

// Pointer heights, -1 at the top of the view and 1 at the bottom: onto a resting hand raises it, up
// into the top third lowers a hand the pointer raised, and the pointer must come back above the
// strip before it can raise the hand again, so nothing flickers at an edge.
const HOVER_RAISE = 0.72, HOVER_DROP = -0.3, HOVER_REARM = 0.45;
const NONE = () => false, NO_LOCK = () => [];
const IDLE = { holding: NONE, blocked: NONE, nudge: NONE, onUp: null, lockAt: NO_LOCK, hover: false, labels: ['Look at your cards', 'Put cards down'] };
const hand = { up: false, k: 0, v: {}, btn: null, byHover: false, armed: true, ...IDLE };
const can = () => hand.holding() && !hand.blocked();

export const handUp = () => hand.up;
/** The prompt's reminder, hidden while the hand is already up. */
export const spaceHint = () => `<span class="kb"${hand.up ? ' hidden' : ''}><kbd>Space</kbd> ${hand.labels[0].toLowerCase()}</span>`;

/**
 * A mode takes the hand on enter. holding: you have something to read. blocked: Space belongs to
 * something else right now (the revolver, the glass). nudge: your turn is waiting on the hand.
 * onUp(up): the mode's own piece follows (the cup tips back). lockAt: [pos, weight, zoom] for
 * camera.lockLook, where the held view frames. hover: a mouse over the resting hand raises it.
 */
export function bindHand(opts) {
  if (!hand.btn) {
    hand.btn = $('#cards-btn');
    hand.btn.addEventListener('click', (e) => { e.currentTarget.blur(); setHandUp(!hand.up); });
  }
  Object.assign(hand, IDLE, opts, { armed: true });
}
export function releaseHand() {
  setHandUp(false);
  Object.assign(hand, IDLE, { k: 0 });
  if (hand.btn) hand.btn.hidden = true;
}

export function setHandUp(up, byHover = false) {
  if (up && !can()) return;
  if (hand.up === up) return;
  hand.up = up;
  hand.byHover = up && byHover;
  if (!up && !byHover) hand.armed = false;
  lockLook(up, ...(up ? hand.lockAt() : []));
  hand.onUp?.(up);
  const kb = document.querySelector('#hint .kb'); if (kb) kb.hidden = up;
  if (!hand.onUp) audio.card(0);
  syncHandButton();
}

export function syncHandButton() {
  const btn = hand.btn;
  if (!btn) return;
  const show = can();
  if (btn.hidden !== !show) btn.hidden = !show;
  btn.classList.toggle('nudge', hand.nudge() && !hand.up);
  btn.setAttribute('aria-pressed', String(hand.up));
  const label = hand.labels[+hand.up];
  if (btn.firstChild.textContent !== label) btn.firstChild.textContent = label;
}

/** Space toggles the hand unless something else owns it. Returns whether the key was taken. */
export function handKey(e) {
  if (e.code !== 'Space' || hand.blocked()) return false;
  e.preventDefault();
  if (!e.repeat) setHandUp(!hand.up);
  return true;
}

/** A mouse moved over the table, at height ny (-1 top, 1 bottom). */
export function handPointer(ny) {
  if (!hand.hover) return;
  if (ny < HOVER_REARM) hand.armed = true;
  if (!hand.up && hand.armed && ny > HOVER_RAISE && can()) { hand.armed = false; setHandUp(true, true); }
  else if (hand.up && hand.byHover && ny < HOVER_DROP) setHandUp(false, true);
}

/** Per frame: drops a hand you no longer hold, keeps the button honest, returns the eased blend. */
export function stepHand(dt) {
  if (hand.up && !can()) setHandUp(false);
  if (hand.btn && hand.btn.hidden === can()) syncHandButton();
  hand.k = smoothDamp(hand.k, +hand.up, hand.v, 'k', 0.2, dt);
  return hand.k;
}
