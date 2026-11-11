import * as THREE from 'three';
import { $, clamp, settings } from './util.js';
import { renderer, scene, camera, canvas, render, adapt, applyQuality, quality } from './render/core.js';
import { buildWorld, updateWorld, setShadowSize } from './render/world.js';
import { buildCharacter, updateCharacter } from './render/characters.js';
import { buildCards, layoutHands, updateCards, pickCard, handUI, warmCards, views, sortForDisplay } from './render/cards.js';
import { buildGun, updateGun, gun } from './render/gun.js';
import { buildPlayerArm, updatePlayerArm, arm } from './render/playerArm.js';
import { rig, updateCamera, fitToViewport, lookFromPointer, lookByDelta, centerLook } from './render/camera.js';
import { dampVec3 } from './render/motion.js';
import { audio } from './audio.js';
import * as ui from './ui.js';
import { D, SEATS, runGame, abortGame, setCharacters, toggleCard, submitPlay, submitChallenge, lookTargetFor } from './director.js';
import { createDeck } from './model/rules.js';

const clock = new THREE.Clock(false);
const characters = [null];
const raycaster = new THREE.Raycaster();
const pointer = { ndc: new THREE.Vector2(9, 9), moved: false, idle: 0, touch: false, touchLook: null };
const _v = new THREE.Vector3(), _look = new THREE.Vector3();
const lookVel = [null, {}, {}, {}];
// Procedural motion runs on simulated time: dt is clamped after a hitch, and a wall clock that
// kept running would make every sway, breath and flicker jump forward in that frame.
let simT = 0;
const EMPTY_GAME = { players: [0, 1, 2, 3].map((seat) => ({ seat, hand: [] })) };

/* ---------- frame ---------- */
function simulate(dt, t) {
  updateWorld(dt, t);
  updateCamera(dt, t);
  camera.updateMatrixWorld();
  for (let s = 1; s < 4; s++) {
    const ch = characters[s];
    // the gaze target glides between subjects, so a head starts turning gently instead of all at once
    dampVec3(ch.lookTarget, lookTargetFor(s, camera, _look), lookVel[s], 0.16, dt);
    updateCharacter(ch, dt, t);
  }
  layoutHands(D.game || EMPTY_GAME, characters, innerWidth < 720 ? 112 : 124);
  updateCards(dt);
  updatePlayerArm(dt);
  updateGun(dt);
  camera.updateMatrixWorld();
  updateHover(dt);
}

// scripts/motion-probe.mjs sets hooks.probe to sample motion at a finer step than the frame rate.
const hooks = { probe: null };
function frame() {
  const probe = hooks.probe, dt = Math.min(clock.getDelta(), probe ? probe.maxDt : 1 / 20), t0 = simT;
  simT += dt;
  const t = simT;
  if (probe) {
    const n = Math.max(1, Math.ceil(dt * probe.hz));
    for (let i = 1; i <= n; i++) { simulate(dt / n, t0 + (dt * i) / n); probe.sample(dt / n); }
  } else simulate(dt, t);
  // a probe may skip most draws so the software renderer can't starve the simulation it measures
  if (!probe || probe.draw(dt)) render(dt, t);
  placeTags();
  probe?.frame(dt);
  adapt(dt);
}

// Tags hang over where each head rests, not the head itself, so they ride the (already smooth)
// camera rigidly and don't shiver when a character trembles or slumps.
// ui.placeTag low-passes by dt; a full second's step makes it land exactly, with no trailing.
const TAG_SNAP = 1;
function placeTags() {
  const W = innerWidth, H = innerHeight, narrow = W < 600;
  for (let s = 1; s < 4; s++) {
    const ch = characters[s];
    _v.copy(ch.tagAnchor).project(camera);
    const behind = _v.z > 1;
    let x, y;
    if (narrow) { x = W * (s === 1 ? 0.18 : s === 2 ? 0.5 : 0.82); y = 226; }
    else { x = clamp((_v.x * 0.5 + 0.5) * W, 90, W - 90); y = clamp((-_v.y * 0.5 + 0.5) * H, 150, H - 230); }
    ui.placeTag(s, x, y, narrow || !behind, TAG_SNAP);
  }
}

// Re-picked on every pointer move, and a few times a second while it rests, because the hand
// reflows under a still pointer.
function updateHover(dt) {
  if (!handUI.enabled || !D.game || pointer.touch) { if (handUI.hover != null) { handUI.hover = null; canvas.style.cursor = ''; } return; }
  pointer.idle += dt;
  if (!pointer.moved && pointer.idle < 0.1) return;
  pointer.moved = false; pointer.idle = 0;
  raycaster.setFromCamera(pointer.ndc, camera);
  const id = pickCard(raycaster, D.game, handUI.hover);
  if (id !== handUI.hover) { handUI.hover = id; canvas.style.cursor = id != null ? 'pointer' : ''; if (id != null) audio.hover(); }
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
    if (onCanvas && !settings.paused && ui.topOverlay() == null) lookFromPointer(pointer.ndc.x, -pointer.ndc.y);
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
  if (!handUI.enabled || !D.game) return;
  camera.updateMatrixWorld();
  raycaster.setFromCamera(pointer.ndc, camera);
  const id = pickCard(raycaster, D.game, handUI.hover);
  if (id != null) toggleCard(id);
}

$('#play-btn').addEventListener('click', submitPlay);
$('#liar-btn').addEventListener('click', submitChallenge);
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); return togglePause(); }
  if (e.key === 'm' || e.key === 'M') return $('#sound-btn').click();
  if (settings.paused || !handUI.enabled) return;
  if (e.key >= '1' && e.key <= '9') {
    const c = sortForDisplay(D.game.players[0].hand)[+e.key - 1]; if (c) toggleCard(c.id);
  } else if (e.key === 'Enter') { e.preventDefault(); submitPlay(); }
  else if (e.key === 'l' || e.key === 'L') submitChallenge();
});

/* ---------- menus ---------- */
function togglePause(force) {
  const top = ui.topOverlay();
  if (top && top !== 'pause') { ui.closeOverlay(top); return; }
  if (!D.running) return;
  const open = force ?? !ui.isOpen('pause');
  settings.paused = open;
  if (open) { ui.openOverlay('pause'); centerLook(0.5); } else ui.closeOverlay('pause');
}
$('#pause-btn').addEventListener('click', () => togglePause(true));
$('#resume-btn').addEventListener('click', () => togglePause(false));
$('#pause-rules-btn').addEventListener('click', () => ui.openOverlay('rules'));
$('#pause-settings-btn').addEventListener('click', () => ui.openOverlay('settings'));
$('#quit-btn').addEventListener('click', () => { settings.paused = false; ui.closeOverlay('pause'); abortGame(); rig.introTarget = 0; ui.openOverlay('title'); });
$('#rules-btn').addEventListener('click', () => ui.openOverlay('rules'));
$('#settings-btn').addEventListener('click', () => ui.openOverlay('settings'));
function startGame() {
  audio.init();
  ui.closeOverlay('title'); ui.closeOverlay('end');
  setTimeout(() => runGame(), 300);
}
$('#start-btn').addEventListener('click', startGame);
$('#again-btn').addEventListener('click', startGame);
$('#menu-btn').addEventListener('click', () => { ui.closeOverlay('end'); rig.introTarget = 0; ui.openOverlay('title'); });
addEventListener('resize', () => { fitToViewport(); applyQuality(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) clock.stop(); else { clock.start(); } });

canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault(); renderer.setAnimationLoop(null);
  const f = document.createElement('div'); f.id = 'fatal';
  f.innerHTML = '<div class="sheet"><h2>The lamps went out</h2><p class="lede">Your graphics driver reset. Reload to sit back down.</p><button class="btn primary" onclick="location.reload()">Reload</button></div>';
  document.body.appendChild(f);
});

/* ---------- boot ---------- */
async function boot() {
  try { await Promise.race([Promise.all([document.fonts.load('700 25px Cinzel'), document.fonts.load('500 16px "Alegreya Sans"')]), new Promise((r) => setTimeout(r, 2500))]); } catch { /* fallback fonts */ }
  buildWorld();
  for (let s = 1; s < 4; s++) {
    const ch = characters[s] = buildCharacter(SEATS[s].design, SEATS[s].angle);
    ch.tagAnchor = ch.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.27, 0));
    ch.lookTarget.copy(camera.position);
  }
  setCharacters(characters);
  buildCards(createDeck());
  buildGun();
  buildPlayerArm();
  ui.initUI();
  quality.onShadowSize = setShadowSize;
  fitToViewport(); applyQuality();

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
  $('#start-btn').focus({ preventScroll: true });
  window.__lastcall = { D, quality, hooks, views, gun, arm, rig, camera, renderer, characters, handUI };
  if (settings.autoplay) startGame();
}
boot().catch((err) => {
  console.error(err);
  const f = document.createElement('div'); f.id = 'fatal';
  f.innerHTML = `<div class="sheet"><h2>The tavern is closed</h2><p class="lede">This browser could not start WebGL 2. Try a recent Chrome, Edge, Firefox or Safari.</p></div>`;
  document.body.appendChild(f);
});
