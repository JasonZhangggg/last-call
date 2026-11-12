// Table chat. One panel: it sits in the lobby sheet while people wait, and floats under the HUD
// buttons during a game, opened from the chat button (or T or /). The button counts lines you
// haven't had on screen; in the lobby it brings the panel into view. Another person's line is also
// said by their character. Chat text only ever reaches the page through textContent.
// Online tables only: a solo table is you and the bots.
import { $ } from './util.js';
import { CHAT_HISTORY, cleanChat } from './net/protocol.js';
import { S, send } from './session.js';
import { D, sayChat } from './director.js';

const C = { lines: [], unread: 0, open: false, docked: false, onScreen: false, sent: '' };
let root, list, input, btn, badge, slot;

export function initChat() {
  root = $('#chat'); list = $('#chat-list'); input = $('#chat-input'); btn = $('#chat-btn'); badge = $('#chat-badge'); slot = $('#lobby-chat');
  btn.addEventListener('click', () => (C.open && !C.docked ? closeChat() : openChat()));
  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = cleanChat(input.value);
    if (!text) return;
    if (!send({ type: 'chat', text })) return note('Not connected to the table.');
    C.sent = text;
    input.value = '';
  });
  // Game keys (Space, Enter, numbers, letters, Escape) all listen on the window: none of them hear typing.
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (C.docked) input.blur(); else closeChat();
  });
  input.addEventListener('keyup', (e) => e.stopPropagation());
  new MutationObserver(syncChat).observe($('#lobby'), { attributes: true, attributeFilter: ['class'] });
  // the lobby sheet scrolls, so a docked panel can be out of view
  new IntersectionObserver(([e]) => {
    C.onScreen = e.intersectionRatio >= 0.6;
    if (C.onScreen && C.unread) syncChat();
  }, { threshold: [0, 0.6, 1] }).observe(root);
  globalThis.visualViewport?.addEventListener('resize', fitAboveKeyboard);
  syncChat();
}

/** An on-screen keyboard shrinks the visible area: the list gives up height so the input stays in view. */
function fitAboveKeyboard() {
  const vv = globalThis.visualViewport;
  if (root.hidden || C.docked || !vv) { root.style.maxHeight = ''; return; }
  root.style.maxHeight = `${Math.max(100, vv.height + vv.offsetTop - root.getBoundingClientRect().top - 8)}px`;
}

/** The window's key handler asks first. True when the key opened or closed the chat. */
export function chatKey(e) {
  if (btn.hidden) return false;
  if ((e.key === 't' || e.key === 'T' || e.key === '/') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); openChat(); return true; }
  if (e.key === 'Escape' && C.open && !C.docked) { e.preventDefault(); closeChat(); return true; }
  return false;
}

function openChat() {
  if (!C.docked) { C.open = true; syncChat(); }
  // docked, the focus scrolls the lobby sheet to the panel
  input.focus({ preventScroll: !C.docked });
}
function closeChat() {
  C.open = false;
  if (root.contains(document.activeElement)) document.activeElement.blur();
  syncChat();
}

/** Shows, docks or hides the panel to match the table: call when the connection or the lobby changes. */
export function syncChat() {
  const on = S.kind === 'socket' && S.lobby != null;
  const docked = on && !$('#lobby').classList.contains('fade');
  if (docked !== C.docked) { C.docked = docked; (docked ? slot : document.body).appendChild(root); }
  root.classList.toggle('docked', docked);
  root.hidden = !on || (!docked && !C.open);
  btn.hidden = !on;
  btn.classList.toggle('docked', docked);
  btn.setAttribute('aria-expanded', String(!root.hidden));
  if (C.unread && !root.hidden && (!docked || C.onScreen)) { C.unread = 0; list.scrollTop = list.scrollHeight; }
  fitAboveKeyboard();
  badge.hidden = !C.unread;
  badge.textContent = C.unread > 9 ? '9+' : String(C.unread);
}

/** Leaving the table: its conversation goes with it. */
export function resetChat() {
  C.lines = []; C.unread = 0; C.open = false; C.sent = '';
  list.replaceChildren();
  input.value = '';
  syncChat();
}

/** `chat`, `chatLog` (merged, so a rejoin adds only what was missed), or a too-fast refusal. */
export function chatMessage(msg) {
  if (msg.type === 'error') {
    note(msg.message);
    if (!input.value) input.value = C.sent;
    return;
  }
  if (msg.type === 'chat') return add(msg, true);
  const have = new Set(C.lines.map(key));
  for (const l of msg.lines) if (!have.has(key(l))) add(l, false);
}

const key = (l) => `${l.at}|${l.seat}|${l.text}`;

function add(line, live) {
  const { seat, name, text, at } = line;
  C.lines.push({ seat, name, text, at });
  if (C.lines.length > CHAT_HISTORY) { C.lines.shift(); list.querySelector('li:not(.sys)')?.remove(); }
  const li = document.createElement('li'), who = document.createElement('b');
  const mine = seat === D.me;
  li.className = mine ? 'me' : '';
  who.className = `who s${seat}`;
  who.textContent = mine ? 'You' : name;
  li.append(who, ' ', text);
  append(li, mine);
  if (mine) return;
  if (root.hidden || !C.onScreen) { C.unread++; syncChat(); }
  if (live) sayChat(seat, text);
}

function note(text) {
  const li = document.createElement('li');
  li.className = 'sys';
  li.textContent = text;
  append(li, true);
}

/** Follows the newest line, unless you have scrolled back to read and it isn't yours. */
function append(li, follow) {
  const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
  list.append(li);
  if (atEnd || follow) list.scrollTop = list.scrollHeight;
}
