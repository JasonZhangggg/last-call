import * as THREE from 'three';
import { $, clamp, settings } from './util.js';
import { renderer, scene, camera, canvas, render, adapt, applyQuality, quality } from './render/core.js';
import { buildWorld, updateWorld, setShadowSize } from './render/world.js';
import { buildCharacter, updateCharacter, straightGrip, poseRightHand } from './render/characters.js';
import { buildCards, updateCards, warmCards, bodies, hands } from './render/cards.js';
import { buildGun, updateGun, gun } from './render/gun.js';
import { buildAuctionTable, updateAuctionTable } from './render/auctionTable.js';
import { buildPlayerArm, updatePlayerArm, arm } from './render/playerArm.js';
import { buildDiceTable, updateDiceTable, table as diceTable } from './render/diceTable.js';
import { rig, updateCamera, fitToViewport, lookFromPointer, lookByDelta, centerLook } from './render/camera.js';
import { handPointer } from './modes/hand.js';
import { dampVec3 } from './render/motion.js';
import { audio } from './audio.js';
import * as ui from './ui.js';
import { D, T, VIEWS, DESIGNS, lookTargetFor, liveLook, humanLookTarget, catchUp, leaveTable } from './director.js';
import { S, playSolo, host, join, send, close as closeTable } from './session.js';
import { MODES, isPlayable } from './modes/index.js';
import { CATALOG, modeLabel, variantLabel, variantNote } from './modes/catalog.js';
import { ENGINES } from './net/engines.js';
import { ROOM_CODE_RE, normalizeRoomCode } from './net/protocol.js';
import { initChat, chatKey, chatMessage, syncChat, resetChat } from './chat.js';

const clock = new THREE.Clock(false);
const raycaster = new THREE.Raycaster();
const pointer = { ndc: new THREE.Vector2(9, 9), moved: false, idle: 0, touch: false, touchLook: null, hover: null };
const _v = new THREE.Vector3(), _look = new THREE.Vector3();
const lookVel = [null, 1, 2, 3].map((s) => s && { x: 0, y: 0, z: 0 });
// Procedural motion runs on simulated time: dt is clamped after a long stall, and a wall clock that
// kept running would make every sway, breath and flicker jump forward in that frame.
let simT = 0;

/* ---------- frame ---------- */
function simulate(dt, t) {
  updateWorld(dt, t);
  updateCamera(dt, t);
  camera.updateMatrixWorld();
  for (let v = 1; v < 4; v++) {
    const ch = D.viewChars[v], l = liveLook(v);
    // another person's head goes where they look, and their cards rise when they read them
    ch.target.inspect = l?.hand === 'up' ? 1 : 0;
    // the gaze target glides between subjects, so a head starts turning gently instead of all at once
    dampVec3(ch.lookTarget, l ? humanLookTarget(v, l, camera, _look) : lookTargetFor(v, camera, _look), lookVel[v], 0.16, dt);
    updateCharacter(ch, dt, t);
  }
  D.mode?.frame(T, innerWidth < 720 ? 112 : 124, dt);
  updateCards(dt);
  updateAuctionTable(dt);
  updatePlayerArm(dt);
  updateGun(dt);
  updateDiceTable(dt, t);
  camera.updateMatrixWorld();
  updateHover(dt);
}

// Online, the other seats see where your head points and whether you hold your cards up: about 10
// times a second while it turns by more than a degree or the cards go up or down, a last update once
// it settles, and a heartbeat so a still head stays live.
const shared = { yaw: 0, pitch: 0, hand: 'down', at: -Infinity };
function shareLook() {
  if (S.kind !== 'socket' || D.phase !== 'playing' || D.me == null) return;
  const now = performance.now(), since = now - shared.at;
  if (since < 100) return;
  const hand = D.mode?.handUp?.() ? 'up' : 'down';
  const moved = Math.max(Math.abs(rig.viewYaw - shared.yaw), Math.abs(rig.viewPitch - shared.pitch));
  if (hand === shared.hand && moved < 0.0175 && !(moved > 0.002 && since > 400) && since < 1500) return;
  if (send({ type: 'look', yaw: rig.viewYaw, pitch: rig.viewPitch, hand })) Object.assign(shared, { yaw: rig.viewYaw, pitch: rig.viewPitch, hand, at: now });
}

// A slow frame is simulated in steps of at most 1/50 s, so motion keeps time with the director and
// the audio (both on the wall clock) down to 4 fps; only a longer stall is dropped.
// scripts/motion-probe.mjs sets hooks.probe to sample every step at a finer rate.
const hooks = { probe: null };
function frame() {
  const probe = hooks.probe, dt = Math.min(clock.getDelta(), probe ? probe.maxDt : 0.25), t0 = simT;
  simT += dt;
  const t = simT, n = Math.max(1, Math.ceil(dt * (probe ? probe.hz : 50) - 1e-6));
  for (let i = 1; i <= n; i++) { simulate(dt / n, t0 + (dt * i) / n); probe?.sample(dt / n); }
  // a probe may skip most draws so the software renderer can't starve the simulation it measures
  if (!probe || probe.draw(dt)) render(dt, t);
  placeTags();
  shareLook();
  probe?.frame(dt);
  adapt(dt);
}

// Tags hang over where each head rests, not the head itself, so they ride the (already smooth)
// camera rigidly and don't shiver when a character trembles or slumps.
// ui.placeTag low-passes by dt; a full second's step makes it land exactly, with no trailing.
const TAG_SNAP = 1;
function placeTags() {
  const W = innerWidth, H = innerHeight, narrow = W < 600;
  for (let v = 1; v < 4; v++) {
    _v.copy(D.viewChars[v].tagAnchor).project(camera);
    // a head turned well out of view takes its tag with it, rather than stacking tags at the edge
    const inView = _v.z <= 1 && Math.abs(_v.x) < 1.08;
    let x, y;
    if (narrow) { x = W * (v === 1 ? 0.18 : v === 2 ? 0.5 : 0.82); y = 226; }
    else { x = clamp((_v.x * 0.5 + 0.5) * W, 90, W - 90); y = clamp((-_v.y * 0.5 + 0.5) * H, 150, H - 230); }
    ui.placeTag(v, x, y, narrow || inView, TAG_SNAP);
  }
}

// Re-picked on every pointer move, and a few times a second while it rests, because the hand
// reflows under a still pointer.
function updateHover(dt) {
  const m = D.mode;
  if (!m?.pointerEnabled() || pointer.touch) { if (m && pointer.hover != null) { pointer.hover = null; m.hover(null); canvas.style.cursor = ''; } return; }
  pointer.idle += dt;
  if (!pointer.moved && pointer.idle < 0.1) return;
  pointer.moved = false; pointer.idle = 0;
  raycaster.setFromCamera(pointer.ndc, camera);
  const id = m.pick(raycaster, pointer.hover);
  if (id !== pointer.hover) { pointer.hover = id; m.hover(id); canvas.style.cursor = id != null ? 'pointer' : ''; if (id != null) audio.hover(); }
}

/* ---------- input ---------- */
// Listened for on the window so the HUD floating over the canvas never interrupts a head turn.
// Over a HUD control the head holds still rather than swinging away from the button.
const ndcOf = (e, out) => out.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
addEventListener('pointermove', (e) => {
  const onCanvas = e.target === canvas;
  if (onCanvas) ndcOf(e, pointer.ndc); else pointer.ndc.set(9, 9);
  pointer.moved = true;
  if (e.pointerType === 'mouse') {
    pointer.touch = false;
    if (onCanvas && !settings.paused && ui.topOverlay() == null) { lookFromPointer(pointer.ndc.x, -pointer.ndc.y); handPointer(-pointer.ndc.y); }
  } else if (pointer.touchLook && pointer.touchLook.id === e.pointerId) {
    const tl = pointer.touchLook, dx = e.clientX - tl.x, dy = e.clientY - tl.y;
    if (Math.hypot(e.clientX - tl.x0, e.clientY - tl.y0) > 8) tl.dragging = true;
    if (tl.dragging) lookByDelta(dx, dy);
    tl.x = e.clientX; tl.y = e.clientY;
  }
});
canvas.addEventListener('pointerdown', (e) => {
  ndcOf(e, pointer.ndc);
  pointer.touch = e.pointerType !== 'mouse';
  if (pointer.touch) pointer.touchLook = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, dragging: false };
  else tryPick();
});
addEventListener('pointerup', (e) => {
  const tl = pointer.touchLook;
  if (!tl || tl.id !== e.pointerId) return;
  if (tl.dragging) centerLook(0.7); else tryPick();
  pointer.touchLook = null;
});
addEventListener('pointercancel', (e) => { if (pointer.touchLook?.id === e.pointerId) { pointer.touchLook = null; centerLook(0.7); } });
document.addEventListener('pointerout', (e) => { if (e.pointerType === 'mouse' && !e.relatedTarget) { pointer.ndc.set(9, 9); centerLook(0.6); } });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
function tryPick() {
  const m = D.mode;
  if (!m?.pointerEnabled()) return;
  camera.updateMatrixWorld();
  raycaster.setFromCamera(pointer.ndc, camera);
  const id = m.pick(raycaster, pointer.hover);
  if (id != null) m.select(T, id);
}

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (chatKey(e)) return;
  if (e.key === 'Escape') { e.preventDefault(); return togglePause(); }
  if (e.key === 'm' || e.key === 'M') return $('#sound-btn').click();
  if (settings.paused || ui.topOverlay()) return;
  D.mode?.keydown(T, e);
});

/* ---------- menus and the table flow ---------- */
const solo = () => S.kind === 'local';
const MODE_LIST = () => Object.keys(ENGINES).map((mode) => ({ mode, variants: ENGINES[mode].variants, playable: isPlayable(mode) }));
const LABELS = { label: modeLabel, variantLabel, note: variantNote };

function togglePause(force) {
  const top = ui.topOverlay();
  if (top && top !== 'pause') {
    // the table's own sheets aren't dismissed by Escape: they are where you are
    if (!['title', 'lobby', 'end', 'out'].includes(top)) ui.closeOverlay(top);
    return;
  }
  if (!D.mode) return;
  const open = force ?? !ui.isOpen('pause');
  // only a solo table can stop; a hosted one carries on for everyone else
  settings.paused = open && solo();
  $('#pause-h').textContent = solo() ? 'Paused' : 'Table menu';
  if (open) { ui.openOverlay('pause'); centerLook(0.5); } else ui.closeOverlay('pause');
}

function closeAll() { for (const id of ['title', 'solo', 'enter', 'lobby', 'end', 'out', 'pause', 'rules', 'settings']) ui.closeOverlay(id); }
function setRoomInUrl(code) {
  const u = new URL(location.href);
  if (u.protocol === 'file:') return;
  if (code) u.searchParams.set('room', code); else u.searchParams.delete('room');
  history.replaceState(null, '', u);
}

function toTitle(message) {
  closeTable();
  resetChat();
  settings.paused = false;
  setRoomInUrl(null);
  ui.setNet(null);
  closeAll();
  rig.introTarget = 0;
  ui.openOverlay('title');
  if (message) ui.toast(message, 'small');
}

function startSolo(opts) {
  audio.init();
  closeAll();
  playSolo(opts);
}

function showLobby() {
  if (!ui.isOpen('lobby')) { closeAll(); ui.openOverlay('lobby'); }
  rig.introTarget = 0;
  drawLobby();
}
const drawLobby = () => ui.renderLobby(S.lobby, D.me, { modes: MODE_LIST(), ...LABELS, connecting: !!S.transport });

function enterTable(kind, code = '') {
  ui.openEnter(kind, { code }, async ({ name, code: typed }) => {
    audio.init();
    if (kind === 'join') {
      const c = normalizeRoomCode(typed);
      if (!ROOM_CODE_RE.test(c)) return ui.setEnterBusy(false, 'That is not a table code.');
      join(c, name);
      setRoomInUrl(c);
      return showLobby();
    }
    ui.setEnterBusy(true);
    try {
      const c = await host(name);
      setRoomInUrl(c);
      ui.setEnterBusy(false);
      showLobby();
    } catch {
      ui.setEnterBusy(false, 'Could not open a table. Check your connection and try again.');
    }
  });
}

const CLOSED = {
  'not-found': 'There is no table with that code.',
  'room-full': 'That table is full.',
  'in-progress': 'That game has already started.',
  replaced: 'This seat was opened in another tab.',
  refused: 'The table closed the connection.',
};

S.hooks = {
  onLobby() { syncChat(); if (ui.isOpen('lobby')) drawLobby(); },
  onChat: chatMessage,
  onRefused(msg) { if (!D.prompt) ui.toast(msg.message, 'small'); },
  onStatus(status, detail) {
    if (status === 'reconnecting') ui.setNet('Reconnecting to the table…');
    else if (status === 'rejoined') { ui.setNet(null); ui.toast('Back at the table', 'small'); }
    else if (status === 'open') ui.setNet(null);
    else if (status === 'closed') {
      const code = detail?.code;
      toTitle();
      if (code && code !== 'left') {
        if (['not-found', 'room-full', 'in-progress'].includes(code)) { enterTable('join'); ui.setEnterBusy(false, CLOSED[code]); }
        else ui.toast(CLOSED[code] || 'Disconnected from the table.', 'small');
      }
    }
  },
};
D.hooks = {
  onLobby() { if (!solo()) showLobby(); },
  onTable() { for (const id of ['title', 'solo', 'enter', 'lobby', 'end', 'out']) ui.closeOverlay(id); },
  onOut() { ui.openOverlay('out'); },
  onOver(summary) {
    ui.closeOverlay('out');
    ui.showEnd({ ...summary, online: !solo() });
  },
};

$('#pause-btn').addEventListener('click', () => togglePause(true));
$('#resume-btn').addEventListener('click', () => togglePause(false));
$('#pause-rules-btn').addEventListener('click', () => ui.openOverlay('rules'));
$('#pause-settings-btn').addEventListener('click', () => ui.openOverlay('settings'));
$('#quit-btn').addEventListener('click', () => toTitle());
$('#rules-btn').addEventListener('click', () => ui.openOverlay('rules'));
$('#settings-btn').addEventListener('click', () => ui.openOverlay('settings'));
$('#solo-btn').addEventListener('click', () => ui.openOverlay('solo'));
$('#host-btn').addEventListener('click', () => enterTable('host'));
$('#join-btn').addEventListener('click', () => enterTable('join'));
$('#again-btn').addEventListener('click', () => {
  ui.closeOverlay('end');
  if (solo()) send({ type: 'start' }); else showLobby();
});
$('#menu-btn').addEventListener('click', () => toTitle());
$('#watch-btn').addEventListener('click', () => { ui.closeOverlay('out'); ui.setBlackout(false); });
$('#out-leave-btn').addEventListener('click', () => toTitle());
ui.initSolo({ modes: MODE_LIST(), ...LABELS }, startSolo);
initChat();
ui.initEnter();
ui.initLobby({
  addBot: () => send({ type: 'addBot' }),
  removeBot: (seat) => send({ type: 'removeBot', seat }),
  setOptions: (options) => send({ type: 'setOptions', options }),
  ready: (ready) => send({ type: 'setReady', ready }),
  start: () => send({ type: 'start' }),
  leave: () => toTitle(),
  async copy() {
    const link = `${location.origin}/?room=${S.lobby?.roomCode || S.code}`;
    try { await navigator.clipboard.writeText(link); ui.toast('Invite link copied', 'small'); } catch { ui.toast(link, 'small'); }
  },
});

addEventListener('resize', () => { fitToViewport(); applyQuality(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clock.stop();
    // a solo table waits for you; a hosted one can't, and catches up when you come back
    if (solo() && D.mode && !settings.autoplay && ui.topOverlay() == null) togglePause(true);
  } else { clock.start(); catchUp(); }
});

canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault(); renderer.setAnimationLoop(null);
  const f = document.createElement('div'); f.id = 'fatal';
  f.innerHTML = '<div class="sheet"><h2>The lamps went out</h2><p class="lede">Your graphics driver reset. Reload to sit back down.</p><button class="btn primary" onclick="location.reload()">Reload</button></div>';
  document.body.appendChild(f);
});

// three draws every plain shadow caster with one shared depth material. An instanced, morphing or
// skinned caster needs a different program, so each switch between kinds re-initialised that shared
// material, several times per shadow pass. Each such kind gets its own depth material instead.
function splitShadowDepthMaterials() {
  const byKind = new Map();
  scene.traverse((o) => {
    if (!o.isMesh || o.customDepthMaterial) return;
    const m = o.geometry.morphAttributes;
    if (!o.isInstancedMesh && !o.isSkinnedMesh && !m.position && !m.normal && !m.color) return;
    if ([].concat(o.material).some((mat) => mat.alphaTest > 0 || mat.displacementMap)) return;
    const kind = [o.isInstancedMesh, !!o.instanceColor, o.isSkinnedMesh, m.position?.length, m.normal?.length, m.color?.length].join();
    if (!byKind.has(kind)) byKind.set(kind, new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
    o.customDepthMaterial = byKind.get(kind);
  });
}

/* ---------- boot ---------- */
async function boot() {
  try { await Promise.race([Promise.all([document.fonts.load('700 25px Cinzel'), document.fonts.load('500 16px "Alegreya Sans"')]), new Promise((r) => setTimeout(r, 2500))]); } catch { /* fallback fonts */ }
  buildWorld();
  DESIGNS.forEach((design, i) => {
    const ch = D.characters[design] = buildCharacter(design, VIEWS[i + 1].angle);
    ch.tagAnchor = ch.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.27, 0));
    ch.lookTarget.copy(camera.position);
    D.viewChars[i + 1] = ch;
  });
  buildCards();
  buildAuctionTable();
  buildGun();
  buildPlayerArm();
  buildDiceTable();
  ui.initUI();
  quality.onShadowSize = setShadowSize;
  fitToViewport(); applyQuality();

  splitShadowDepthMaterials();

  // Compile every shader and upload every texture now, including things that start hidden,
  // so nothing hitches the first time it appears mid-game.
  const hidden = [];
  scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
  gun.flash.material.opacity = 0.01;
  await renderer.compileAsync(scene, camera);
  warmCards(renderer);
  for (let i = 0; i < 3; i++) render(1 / 60, 0);
  for (const o of hidden) o.visible = false;
  gun.flash.material.opacity = 0;

  clock.start();
  renderer.setAnimationLoop(frame);
  $('#loading').hidden = true; $('#title-menu').hidden = false;
  $('#solo-btn').focus({ preventScroll: true });
  window.__lastcall = { D, S, quality, hooks, gun, arm, rig, camera, renderer, MODES, CATALOG, leaveTable, cards: { bodies, hands }, diceTable, T, settings, pose: { straightGrip, poseRightHand } };
  const room = new URLSearchParams(location.search).get('room');
  const AUTO = { '#autoplay-devil': ['deck', 'devil'], '#autoplay-dice': ['dice', 'basic'], '#autoplay-dice-traditional': ['dice', 'traditional'], '#autoplay-auction': ['auction', 'classic'] };
  if (settings.autoplay) { const [mode, variant] = AUTO[location.hash] || ['deck', 'basic']; startSolo({ mode, variant }); }
  else if (room) enterTable('join', normalizeRoomCode(room));
}
boot().catch((err) => {
  console.error(err);
  const f = document.createElement('div'); f.id = 'fatal';
  f.innerHTML = `<div class="sheet"><h2>The tavern is closed</h2><p class="lede">This browser could not start WebGL 2. Try a recent Chrome, Edge, Firefox or Safari.</p></div>`;
  document.body.appendChild(f);
});
