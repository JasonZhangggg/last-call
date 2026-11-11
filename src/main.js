import * as THREE from 'three';
import { $, clamp, settings } from './util.js';
import { renderer, scene, camera, canvas, render, adapt, applyQuality, quality } from './render/core.js';
import { buildWorld, updateWorld, setShadowSize } from './render/world.js';
import { buildCharacter, updateCharacter } from './render/characters.js';
import { buildCards, layoutHands, updateCards, pickCard, handUI, warmCards, views } from './render/cards.js';
import { buildGun, updateGun, gun } from './render/gun.js';
import { rig, updateCamera, fitToViewport, lookFromPointer, lookByDelta } from './render/camera.js';
import { audio } from './audio.js';
import * as ui from './ui.js';
import { D, SEATS, runGame, abortGame, setCharacters, toggleCard, submitPlay, submitChallenge, lookTargetFor } from './director.js';
import { createDeck } from './model/rules.js';

const clock = new THREE.Clock(false);
const characters = [null];
const raycaster = new THREE.Raycaster();
const pointer = { ndc: new THREE.Vector2(9, 9), moved: false, x: 0, y: 0, touchLook: null };
const _v = new THREE.Vector3();
const EMPTY_GAME = { players: [0, 1, 2, 3].map((seat) => ({ seat, hand: [] })) };

/* ---------- frame ---------- */
function simulate(dt, t) {
  updateWorld(dt, t);
  updateCamera(dt, t);
  camera.updateMatrixWorld();
  for (let s = 1; s < 4; s++) {
    const ch = characters[s];
    lookTargetFor(s, camera, ch.lookTarget);
    updateCharacter(ch, dt, t);
  }
  layoutHands(D.game || EMPTY_GAME, characters, innerWidth < 720 ? 112 : 124);
  updateCards(dt);
  updateGun(dt);
  camera.updateMatrixWorld();
  updateHover();
}

// scripts/motion-probe.mjs sets hooks.probe to sample motion at a finer step than the frame rate.
const hooks = { probe: null };
function frame() {
  const probe = hooks.probe, dt = Math.min(clock.getDelta(), probe ? probe.maxDt : 1 / 20), t = clock.elapsedTime;
  if (probe) {
    const n = Math.max(1, Math.ceil(dt * probe.hz));
    for (let i = 1; i <= n; i++) { simulate(dt / n, t - dt + (dt * i) / n); probe.sample(dt / n); }
  } else simulate(dt, t);
  // a probe may skip most draws so the software renderer can't starve the simulation it measures
  if (!probe || probe.draw(dt)) render(dt, t);
  placeTags(dt);
  probe?.frame(dt);
  adapt(dt);
}

function placeTags(dt) {
  const W = innerWidth, H = innerHeight, narrow = W < 600;
  for (let s = 1; s < 4; s++) {
    const ch = characters[s];
    ch.head.getWorldPosition(_v); _v.y += 0.27; _v.project(camera);
    const behind = _v.z > 1;
    let x, y;
    if (narrow) { x = W * (s === 1 ? 0.18 : s === 2 ? 0.5 : 0.82); y = 226; }
    else { x = clamp((_v.x * 0.5 + 0.5) * W, 90, W - 90); y = clamp((-_v.y * 0.5 + 0.5) * H, 150, H - 230); }
    ui.placeTag(s, x, y, narrow || !behind, dt);
  }
}

function updateHover() {
  if (!handUI.enabled || !pointer.moved || !D.game) { if (!handUI.enabled && handUI.hover != null) { handUI.hover = null; canvas.style.cursor = ''; } return; }
  pointer.moved = false;
  raycaster.setFromCamera(pointer.ndc, camera);
  const id = pickCard(raycaster, D.game);
  if (id !== handUI.hover) { handUI.hover = id; canvas.style.cursor = id != null ? 'pointer' : ''; if (id != null) audio.hover(); }
}

/* ---------- input ---------- */
canvas.addEventListener('pointermove', (e) => {
  const nx = (e.clientX / innerWidth) * 2 - 1, ny = (e.clientY / innerHeight) * 2 - 1;
  pointer.ndc.set(nx, -ny); pointer.moved = true;
  if (e.pointerType === 'mouse') { if (!settings.paused && ui.topOverlay() == null) lookFromPointer(nx, ny); }
  else if (pointer.touchLook && pointer.touchLook.id === e.pointerId) {
    const tl = pointer.touchLook, dx = e.clientX - tl.x, dy = e.clientY - tl.y;
    if (Math.hypot(e.clientX - tl.x0, e.clientY - tl.y0) > 8) tl.dragging = true;
    lookByDelta(dx, dy); tl.x = e.clientX; tl.y = e.clientY;
  }
});
canvas.addEventListener('pointerdown', (e) => {
  pointer.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  if (e.pointerType !== 'mouse') pointer.touchLook = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, dragging: false };
  if (e.pointerType === 'mouse') tryPick();
});
canvas.addEventListener('pointerup', (e) => {
  const tl = pointer.touchLook;
  if (tl && tl.id === e.pointerId) { if (!tl.dragging) tryPick(); pointer.touchLook = null; }
});
canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') lookFromPointer(0, 0); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
function tryPick() {
  if (!handUI.enabled || !D.game) return;
  camera.updateMatrixWorld();
  raycaster.setFromCamera(pointer.ndc, camera);
  const id = pickCard(raycaster, D.game);
  if (id != null) toggleCard(id);
}

$('#play-btn').addEventListener('click', submitPlay);
$('#liar-btn').addEventListener('click', submitChallenge);
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); return togglePause(); }
  if (e.key === 'm' || e.key === 'M') return $('#sound-btn').click();
  if (settings.paused || !handUI.enabled) return;
  if (e.key >= '1' && e.key <= '9') {
    const mine = [...D.game.players[0].hand].sort((a, b) => ({ sun: 0, moon: 1, star: 2, wild: 3 }[a.rank] - { sun: 0, moon: 1, star: 2, wild: 3 }[b.rank] || a.id - b.id));
    const c = mine[+e.key - 1]; if (c) toggleCard(c.id);
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
  if (open) { ui.openOverlay('pause'); lookFromPointer(0, 0); } else ui.closeOverlay('pause');
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
  for (let s = 1; s < 4; s++) characters[s] = buildCharacter(SEATS[s].design, SEATS[s].angle);
  setCharacters(characters);
  buildCards(createDeck());
  buildGun();
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
  window.__lastcall = { D, quality, hooks, views, gun, rig, camera, renderer, characters, handUI };
  if (settings.autoplay) startGame();
}
boot().catch((err) => {
  console.error(err);
  const f = document.createElement('div'); f.id = 'fatal';
  f.innerHTML = `<div class="sheet"><h2>The tavern is closed</h2><p class="lede">This browser could not start WebGL 2. Try a recent Chrome, Edge, Firefox or Safari.</p></div>`;
  document.body.appendChild(f);
});
