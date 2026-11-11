// Card art for The Gilded Bid, drawn once at boot into one atlas so every money and status card
// on the table renders from a single instanced mesh. Money is "crown notes"; status cards are
// curios, the Patron's Favour, and three disgraces. Gilded cards carry a gold border.
import { roundRect, drawSymbol } from './textures.js';

const MONEY = [1, 2, 3, 4, 6, 8, 10, 12, 15, 20, 25];
export const CURIO_NAMES = ['Brass Button', 'Clay Pipe', 'Pewter Tankard', 'Pocket Watch', 'Ship in a Bottle', 'Silver Snuffbox', 'Spyglass', 'Music Box', 'Jewelled Egg', 'Golden Astrolabe'];
export const STATUS_NAMES = { favour: "Patron's Favour", ale: 'Spilled Ale', debt: 'Bad Debt', scandal: 'Public Scandal' };
export const statusName = (c) => (c.kind === 'curio' ? CURIO_NAMES[c.value - 1] : STATUS_NAMES[c.kind]);

/** Atlas layout: cells of art (W x H px) inside a padding of the card's own edge colour. */
export const ATLAS = { cols: 6, rows: 5, pad: 4, w: 248, h: 347 };
ATLAS.cellW = ATLAS.w + ATLAS.pad * 2; ATLAS.cellH = ATLAS.h + ATLAS.pad * 2;
ATLAS.width = ATLAS.cols * ATLAS.cellW; ATLAS.height = ATLAS.rows * ATLAS.cellH;
export const CELL = { moneyBack: 11, curio: 12, favour: 22, ale: 23, debt: 24, scandal: 25, statusBack: 26 };
export const moneyCell = (v) => MONEY.indexOf(v);
export const statusCell = (c) => (c.kind === 'curio' ? CELL.curio + c.value - 1 : CELL[c.kind]);

const PAPER = '#efe3c8', INK = '#2a1a10', GOLD = '#c99a3e', GOLD_HI = '#f3d79a';
const DISPLAY = 'Cinzel, Georgia, serif', BODY = '"Alegreya Sans", "Gill Sans", sans-serif';
const TIERS = [
  { upTo: 4, ink: '#8a3f1c', field: '#e9cfb0', name: 'copper' },
  { upTo: 10, ink: '#2f5f45', field: '#d6e2c8', name: 'green' },
  { upTo: 15, ink: '#2a4680', field: '#d0d8e6', name: 'blue' },
  { upTo: 25, ink: '#5e2a6a', field: '#e2d0e0', name: 'violet' },
];
const tierOf = (v) => TIERS.find((t) => v <= t.upTo);

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
const dot = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
function speckle(ctx, w, h, n = 1600, a = 0.06) {
  for (let i = 0; i < n; i++) { ctx.fillStyle = `rgba(80,50,20,${Math.random() * a})`; ctx.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6); }
  const g = ctx.createRadialGradient(w / 2, h / 2, 50, w / 2, h / 2, 230); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(70,40,10,0.24)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}
function text(ctx, s, x, y, font, color, align = 'center', spacing = 0) {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
  ctx.fillText(s, x, y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}
/** Text squeezed to fit `maxW`. */
function fitText(ctx, s, x, y, size, weight, family, color, maxW, spacing = 0) {
  let px = size;
  ctx.font = `${weight} ${px}px ${family}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
  while (ctx.measureText(s).width > maxW && px > 8) { px -= 1; ctx.font = `${weight} ${px}px ${family}`; }
  text(ctx, s, x, y, `${weight} ${px}px ${family}`, color, 'center', spacing);
}
function gildedFrame(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#fff1c6'); g.addColorStop(0.25, '#d8a446'); g.addColorStop(0.5, '#f6dc96'); g.addColorStop(0.75, '#a8762e'); g.addColorStop(1, '#f0cf84');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(90,56,16,0.55)';
  for (let x = 14; x < w - 10; x += 12) { dot(ctx, x, 7, 2.2); dot(ctx, x, h - 7, 2.2); }
  for (let y = 18; y < h - 14; y += 12) { dot(ctx, 7, y, 2.2); dot(ctx, w - 7, y, 2.2); }
}
function corners(ctx, w, h, draw) { draw(); ctx.save(); ctx.translate(w, h); ctx.rotate(Math.PI); draw(); ctx.restore(); }

/* ---------- money: crown notes ---------- */
function rosette(ctx, cx, cy, r, color) {
  ctx.save(); ctx.translate(cx, cy); ctx.strokeStyle = color; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
  for (let i = 0; i < 36; i++) { ctx.rotate(Math.PI / 18); ctx.beginPath(); ctx.ellipse(r * 0.42, 0, r * 0.58, r * 0.22, 0, 0, Math.PI * 2); ctx.stroke(); }
  ctx.globalAlpha = 0.5; ctx.lineWidth = 1.4;
  for (const k of [1, 0.62]) { ctx.beginPath(); ctx.arc(0, 0, r * k, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
}
function moneyFront(ctx, w, h, v) {
  const T = tierOf(v);
  ctx.fillStyle = T.field; ctx.fillRect(0, 0, w, h);
  speckle(ctx, w, h, 1400, 0.05);
  ctx.strokeStyle = T.ink; ctx.lineWidth = 5; roundRect(ctx, 11, 11, w - 22, h - 22, 12); ctx.stroke();
  ctx.lineWidth = 1.3; roundRect(ctx, 19, 19, w - 38, h - 38, 8); ctx.stroke();
  // fine border hatching between the two rules
  ctx.save(); ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
  for (let x = 24; x < w - 20; x += 6) { ctx.beginPath(); ctx.moveTo(x, 13); ctx.lineTo(x + 4, 18); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, h - 18); ctx.lineTo(x + 4, h - 13); ctx.stroke(); }
  ctx.restore();
  rosette(ctx, w / 2, h * 0.48, 92, T.ink);
  ctx.fillStyle = PAPER; ctx.beginPath(); ctx.ellipse(w / 2, h * 0.48, 66, 58, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = T.ink; ctx.lineWidth = 2; ctx.stroke();
  const big = v >= 10 ? 84 : 100;
  text(ctx, String(v), w / 2, h * 0.48 + big * 0.34, `700 ${big}px ${DISPLAY}`, T.ink);
  drawSymbol(ctx, 'king', w / 2, h * 0.18, 50, T.ink, T.field);
  text(ctx, 'CROWNS', w / 2, h * 0.73, `700 21px ${DISPLAY}`, T.ink, 'center', 4);
  corners(ctx, w, h, () => {
    ctx.fillStyle = PAPER; roundRect(ctx, 22, 22, v >= 10 ? 66 : 50, 58, 8); ctx.fill();
    ctx.strokeStyle = T.ink; ctx.lineWidth = 1.5; ctx.stroke();
    text(ctx, String(v), 22 + (v >= 10 ? 33 : 25), 70, `700 ${v >= 10 ? 40 : 46}px ${DISPLAY}`, T.ink);
  });
}
function moneyBack(ctx, w, h) {
  ctx.fillStyle = '#1d3a2c'; ctx.fillRect(0, 0, w, h);
  ctx.save(); ctx.strokeStyle = 'rgba(216,164,70,0.35)'; ctx.lineWidth = 1.2;
  for (let i = -h; i < w + h; i += 18) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h * 0.6, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(i, h); ctx.lineTo(i + h * 0.6, 0); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = GOLD; ctx.lineWidth = 3; roundRect(ctx, 12, 12, w - 24, h - 24, 12); ctx.stroke();
  ctx.lineWidth = 1.2; roundRect(ctx, 19, 19, w - 38, h - 38, 8); ctx.stroke();
  ctx.fillStyle = '#1d3a2c'; ctx.beginPath(); ctx.arc(w / 2, h / 2, 58, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = GOLD; ctx.lineWidth = 3; ctx.stroke();
  ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(w / 2, h / 2, 50, 0, Math.PI * 2); ctx.stroke();
  drawSymbol(ctx, 'king', w / 2, h / 2 + 4, 70, GOLD, '#1d3a2c');
  speckle(ctx, w, h, 600, 0.05);
}

/* ---------- curios ---------- */
const CURIO_ART = [
  (ctx, s) => { // brass button
    const g = ctx.createRadialGradient(-s * 0.1, -s * 0.12, 4, 0, 0, s * 0.42); g.addColorStop(0, '#ffe4a0'); g.addColorStop(1, '#a8762e');
    ctx.fillStyle = g; dot(ctx, 0, 0, s * 0.4); ctx.strokeStyle = '#6a4614'; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, s * 0.3, 0, Math.PI * 2); ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#4a3010'; for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) dot(ctx, x * s * 0.09, y * s * 0.09, s * 0.045);
  },
  (ctx, s) => { // clay pipe
    ctx.strokeStyle = '#efe6d4'; ctx.lineCap = 'round'; ctx.lineWidth = s * 0.07;
    ctx.beginPath(); ctx.moveTo(-s * 0.42, -s * 0.3); ctx.quadraticCurveTo(-s * 0.05, s * 0.1, s * 0.16, s * 0.12); ctx.stroke();
    ctx.lineWidth = 2.5; ctx.strokeStyle = '#6a5a48'; ctx.stroke();
    ctx.fillStyle = '#efe6d4'; ctx.beginPath(); ctx.moveTo(s * 0.1, s * 0.16); ctx.lineTo(s * 0.16, -s * 0.2); ctx.lineTo(s * 0.4, -s * 0.2); ctx.quadraticCurveTo(s * 0.38, s * 0.26, s * 0.16, s * 0.24); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3a2a1a'; ctx.beginPath(); ctx.ellipse(s * 0.28, -s * 0.2, s * 0.12, s * 0.035, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(120,120,120,0.6)'; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(s * (0.26 + i * 0.03), -s * 0.26); ctx.bezierCurveTo(s * (0.16 + i * 0.05), -s * 0.36, s * (0.36 + i * 0.03), -s * 0.4, s * (0.26 + i * 0.04), -s * 0.5); ctx.stroke(); }
  },
  (ctx, s) => { // pewter tankard
    ctx.fillStyle = '#9a948a'; ctx.strokeStyle = '#3a3630'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-s * 0.24, -s * 0.24); ctx.lineTo(s * 0.2, -s * 0.24); ctx.lineTo(s * 0.24, s * 0.34); ctx.lineTo(-s * 0.28, s * 0.34); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.lineWidth = s * 0.07; ctx.beginPath(); ctx.moveTo(s * 0.21, -s * 0.12); ctx.bezierCurveTo(s * 0.5, -s * 0.12, s * 0.5, s * 0.22, s * 0.23, s * 0.22); ctx.stroke();
    ctx.fillStyle = '#c8c2b6'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(-s * 0.02, -s * 0.26, s * 0.25, s * 0.06, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(-s * 0.18, -s * 0.18, s * 0.05, s * 0.46);
    ctx.strokeStyle = '#3a3630'; ctx.lineWidth = 2; for (const y of [-0.08, 0.22]) { ctx.beginPath(); ctx.moveTo(-s * 0.26, y * s); ctx.lineTo(s * 0.22, y * s); ctx.stroke(); }
  },
  (ctx, s) => { // pocket watch
    ctx.strokeStyle = '#a8762e'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, -s * 0.44, s * 0.07, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s * 0.06, -s * 0.46); for (let i = 0; i < 8; i++) ctx.lineTo(s * (0.12 + i * 0.04), -s * (0.42 - i * 0.025 * (i % 2 ? 1 : -1))); ctx.stroke();
    const g = ctx.createRadialGradient(-s * 0.1, -s * 0.1, 4, 0, 0, s * 0.38); g.addColorStop(0, '#ffe7a8'); g.addColorStop(1, '#a8762e');
    ctx.fillStyle = g; dot(ctx, 0, 0, s * 0.37); ctx.strokeStyle = '#6a4614'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#f6efe0'; dot(ctx, 0, 0, s * 0.29);
    ctx.fillStyle = INK; for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; dot(ctx, Math.cos(a) * s * 0.24, Math.sin(a) * s * 0.24, i % 3 ? 1.5 : 3); }
    ctx.strokeStyle = INK; ctx.lineCap = 'round'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -s * 0.18); ctx.stroke();
    ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s * 0.13, s * 0.06); ctx.stroke();
  },
  (ctx, s) => { // ship in a bottle
    ctx.save(); ctx.rotate(-0.35);
    ctx.fillStyle = 'rgba(120,170,140,0.35)'; ctx.strokeStyle = '#3d6b4f'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-s * 0.46, -s * 0.16); ctx.lineTo(s * 0.22, -s * 0.16); ctx.quadraticCurveTo(s * 0.3, -s * 0.16, s * 0.34, -s * 0.07); ctx.lineTo(s * 0.48, -s * 0.07); ctx.lineTo(s * 0.48, s * 0.07); ctx.lineTo(s * 0.34, s * 0.07); ctx.quadraticCurveTo(s * 0.3, s * 0.16, s * 0.22, s * 0.16); ctx.lineTo(-s * 0.46, s * 0.16); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#8a5a2a'; ctx.fillRect(s * 0.48, -s * 0.06, s * 0.07, s * 0.12);
    ctx.fillStyle = '#5a3a1e'; ctx.beginPath(); ctx.moveTo(-s * 0.3, s * 0.06); ctx.lineTo(s * 0.12, s * 0.06); ctx.lineTo(s * 0.06, s * 0.13); ctx.lineTo(-s * 0.26, s * 0.13); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f6efe0'; for (const [x, hh] of [[-0.18, 0.17], [-0.02, 0.2]]) { ctx.beginPath(); ctx.moveTo(x * s, s * 0.05); ctx.lineTo(x * s, -hh * s + s * 0.05); ctx.lineTo((x + 0.1) * s, s * 0.04); ctx.closePath(); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(-s * 0.4, -s * 0.12, s * 0.5, s * 0.025);
    ctx.restore();
  },
  (ctx, s) => { // silver snuffbox
    ctx.fillStyle = '#b8b4ac'; ctx.strokeStyle = '#3a3630'; ctx.lineWidth = 3;
    roundRect(ctx, -s * 0.38, -s * 0.06, s * 0.76, s * 0.3, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d8d4cc'; roundRect(ctx, -s * 0.4, -s * 0.2, s * 0.8, s * 0.16, 10); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#6a665e'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.arc(-s * 0.3 + i * s * 0.1, s * 0.09, s * 0.04, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = '#a1223a'; ctx.beginPath(); ctx.ellipse(0, -s * 0.12, s * 0.07, s * 0.04, 0, 0, Math.PI * 2); ctx.fill();
  },
  (ctx, s) => { // spyglass
    ctx.save(); ctx.rotate(-0.5);
    const seg = [[-0.46, 0.06], [-0.2, 0.08], [0.06, 0.1], [0.3, 0.12]];
    for (const [x, r] of seg) { ctx.fillStyle = x > 0.2 ? '#5a3a1e' : '#c99a3e'; ctx.strokeStyle = '#4a3010'; ctx.lineWidth = 2.5; ctx.fillRect(x * s, -r * s, s * 0.27, r * 2 * s); ctx.strokeRect(x * s, -r * s, s * 0.27, r * 2 * s); }
    ctx.fillStyle = '#ffe9a8'; ctx.fillRect(s * 0.57, -s * 0.13, s * 0.04, s * 0.26);
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(-s * 0.44, -s * 0.05, s * 0.7, s * 0.02);
    ctx.restore();
  },
  (ctx, s) => { // music box
    ctx.fillStyle = '#7a3a1e'; ctx.strokeStyle = '#2a1408'; ctx.lineWidth = 3;
    ctx.fillRect(-s * 0.34, -s * 0.06, s * 0.68, s * 0.34); ctx.strokeRect(-s * 0.34, -s * 0.06, s * 0.68, s * 0.34);
    ctx.fillStyle = '#9a4e2a'; ctx.beginPath(); ctx.moveTo(-s * 0.34, -s * 0.06); ctx.lineTo(-s * 0.26, -s * 0.3); ctx.lineTo(s * 0.42, -s * 0.3); ctx.lineTo(s * 0.34, -s * 0.06); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = GOLD; ctx.lineWidth = 2; ctx.strokeRect(-s * 0.26, s * 0.02, s * 0.52, s * 0.18);
    ctx.strokeStyle = '#c99a3e'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(s * 0.34, s * 0.1); ctx.lineTo(s * 0.46, s * 0.1); ctx.lineTo(s * 0.46, s * 0.24); ctx.stroke();
    ctx.fillStyle = INK; for (const [x, y] of [[-0.2, -0.42], [0.06, -0.48], [0.28, -0.42]]) { dot(ctx, x * s, y * s, s * 0.035); ctx.fillRect(x * s + s * 0.028, y * s - s * 0.13, 2.5, s * 0.13); }
  },
  (ctx, s) => { // jewelled egg
    const g = ctx.createLinearGradient(-s * 0.3, -s * 0.4, s * 0.3, s * 0.4); g.addColorStop(0, '#d65a6a'); g.addColorStop(1, '#6e1a2e');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, -s * 0.44);
    ctx.bezierCurveTo(s * 0.34, -s * 0.42, s * 0.36, s * 0.34, 0, s * 0.36); ctx.bezierCurveTo(-s * 0.36, s * 0.34, -s * 0.34, -s * 0.42, 0, -s * 0.44); ctx.fill();
    ctx.strokeStyle = GOLD; ctx.lineWidth = 4; ctx.stroke();
    ctx.lineWidth = 3; for (const y of [-0.12, 0.12]) { ctx.beginPath(); ctx.moveTo(-s * 0.3, y * s); ctx.quadraticCurveTo(0, y * s + s * 0.06, s * 0.3, y * s); ctx.stroke(); }
    ctx.fillStyle = '#7fd0e0'; for (const x of [-0.16, 0, 0.16]) dot(ctx, x * s, 0.02 * s, s * 0.035);
    ctx.fillStyle = GOLD_HI; dot(ctx, 0, -s * 0.46, s * 0.04);
  },
  (ctx, s) => { // golden astrolabe
    ctx.strokeStyle = '#a8762e'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, s * 0.38, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = '#c99a3e';
    ctx.beginPath(); ctx.arc(0, 0, s * 0.3, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.38, s * 0.14, 0.4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.14, s * 0.38, 0.4, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, -s * 0.44, s * 0.06, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#f6dc96'; ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2, r = (i % 2 ? 0.05 : 0.13) * s; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.fill();
  },
];
function statusTitle(ctx, w, label, color) { text(ctx, label, w / 2, 44, `700 15px ${DISPLAY}`, color, 'center', 3.5); }
function curio(ctx, w, h, v) {
  ctx.fillStyle = '#f3e6c8'; ctx.fillRect(0, 0, w, h);
  speckle(ctx, w, h);
  ctx.strokeStyle = '#7a5a30'; ctx.lineWidth = 4; roundRect(ctx, 11, 11, w - 22, h - 22, 12); ctx.stroke();
  ctx.lineWidth = 1.2; roundRect(ctx, 18, 18, w - 36, h - 36, 8); ctx.stroke();
  statusTitle(ctx, w, 'CURIO', '#7a5a30');
  const g = ctx.createRadialGradient(w / 2, h * 0.5, 10, w / 2, h * 0.5, 100); g.addColorStop(0, 'rgba(255,240,200,0.9)'); g.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.save(); ctx.translate(w / 2, h * 0.5); ctx.lineJoin = 'round'; CURIO_ART[v - 1](ctx, 150); ctx.restore();
  fitText(ctx, CURIO_NAMES[v - 1], w / 2, h * 0.755, 20, 'italic 500', BODY, INK, w - 96);
  corners(ctx, w, h, () => {
    text(ctx, String(v), 40, 82, `700 ${v === 10 ? 40 : 50}px ${DISPLAY}`, '#7a3a14');
  });
}
function favour(ctx, w, h) {
  gildedFrame(ctx, w, h);
  roundRect(ctx, 16, 16, w - 32, h - 32, 8); ctx.fillStyle = '#4a1422'; ctx.fill();
  ctx.save(); ctx.clip();
  const g = ctx.createRadialGradient(w / 2, h * 0.48, 10, w / 2, h * 0.48, 150); g.addColorStop(0, '#8a2a3a'); g.addColorStop(1, '#3a0e1a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.restore();
  ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5; roundRect(ctx, 23, 23, w - 46, h - 46, 6); ctx.stroke();
  statusTitle(ctx, w, "PATRON'S", GOLD_HI);
  text(ctx, 'FAVOUR', w / 2, 68, `700 22px ${DISPLAY}`, GOLD_HI, 'center', 4);
  drawSymbol(ctx, 'king', w / 2, h * 0.5, 150, GOLD_HI, '#4a1422', true);
  text(ctx, '×2', w / 2, h * 0.84, `700 44px ${DISPLAY}`, GOLD_HI);
  text(ctx, 'doubles your status', w / 2, h * 0.9, `italic 500 14px ${BODY}`, '#e8c88a');
}
function disgraceBase(ctx, w, h, gilded) {
  if (gilded) gildedFrame(ctx, w, h); else { ctx.fillStyle = '#5a1a14'; ctx.fillRect(0, 0, w, h); }
  roundRect(ctx, gilded ? 16 : 10, gilded ? 16 : 10, w - (gilded ? 32 : 20), h - (gilded ? 32 : 20), 8); ctx.fillStyle = '#241010'; ctx.fill();
  ctx.save(); ctx.clip();
  const g = ctx.createRadialGradient(w / 2, h * 0.48, 10, w / 2, h * 0.48, 160); g.addColorStop(0, '#4a1a16'); g.addColorStop(1, '#170808');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(208,64,46,0.12)'; ctx.lineWidth = 6;
  for (let i = -h; i < w; i += 22) { ctx.beginPath(); ctx.moveTo(i, h); ctx.lineTo(i + h, 0); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = '#d0402e'; ctx.lineWidth = 1.5; roundRect(ctx, 23, 23, w - 46, h - 46, 6); ctx.stroke();
  statusTitle(ctx, w, 'DISGRACE', '#e0705a');
}
function ale(ctx, w, h) {
  disgraceBase(ctx, w, h, false);
  ctx.save(); ctx.translate(w / 2, h * 0.47);
  ctx.fillStyle = 'rgba(214,160,60,0.85)'; ctx.beginPath(); ctx.moveTo(-10, 40); ctx.bezierCurveTo(-90, 50, -100, 80, -40, 84); ctx.bezierCurveTo(10, 90, 60, 70, 90, 76); ctx.bezierCurveTo(110, 60, 40, 40, -10, 40); ctx.fill();
  ctx.fillStyle = '#f6efe0'; for (const [x, y, r] of [[-60, 76, 6], [-30, 82, 4], [40, 72, 5]]) dot(ctx, x, y, r);
  ctx.rotate(-1.15);
  ctx.fillStyle = '#9a948a'; ctx.strokeStyle = '#1a1612'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-34, -40); ctx.lineTo(30, -40); ctx.lineTo(36, 46); ctx.lineTo(-40, 46); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(32, -24); ctx.bezierCurveTo(72, -24, 72, 30, 34, 30); ctx.stroke();
  ctx.fillStyle = '#f6efe0'; ctx.beginPath(); ctx.ellipse(-4, -44, 38, 10, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  text(ctx, 'SPILLED ALE', w / 2, h * 0.8, `700 22px ${DISPLAY}`, '#f0c8b8', 'center', 2);
  text(ctx, 'discard one of your curios', w / 2, h * 0.87, `italic 500 15px ${BODY}`, '#e09a88');
}
function debt(ctx, w, h) {
  disgraceBase(ctx, w, h, false);
  ctx.save(); ctx.translate(w / 2, h * 0.4); ctx.rotate(-0.08);
  ctx.fillStyle = '#e8dcc0'; ctx.beginPath(); ctx.moveTo(-70, -64);
  for (let i = 0; i <= 10; i++) ctx.lineTo(-70 + i * 14, -64 + (i % 2 ? 6 : 0));
  ctx.lineTo(70, 60); for (let i = 10; i >= 0; i--) ctx.lineTo(-70 + i * 14, 60 + (i % 2 ? -6 : 0)); ctx.closePath(); ctx.fill();
  text(ctx, 'I.O.U.', 0, -34, `700 22px ${DISPLAY}`, '#5a1a14', 'center', 3);
  ctx.strokeStyle = 'rgba(90,26,20,0.5)'; ctx.lineWidth = 1.5; for (const y of [-14, 0, 14, 28]) { ctx.beginPath(); ctx.moveTo(-52, y); ctx.lineTo(52, y); ctx.stroke(); }
  ctx.strokeStyle = '#a1223a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-50, 40); ctx.lineTo(50, -50); ctx.stroke();
  ctx.restore();
  text(ctx, '−5', w / 2, h * 0.7, `700 50px ${DISPLAY}`, '#e0523e');
  text(ctx, 'BAD DEBT', w / 2, h * 0.815, `700 24px ${DISPLAY}`, '#f0c8b8', 'center', 3);
  text(ctx, 'minus five status', w / 2, h * 0.88, `italic 500 15px ${BODY}`, '#e09a88');
}
function scandal(ctx, w, h) {
  disgraceBase(ctx, w, h, true);
  ctx.save(); ctx.translate(w / 2, h * 0.46); ctx.rotate(0.06);
  ctx.fillStyle = '#e8dcc0'; ctx.fillRect(-74, -70, 148, 132);
  text(ctx, 'THE CRIER', 0, -48, `700 17px ${DISPLAY}`, INK, 'center', 2);
  ctx.fillStyle = INK; ctx.fillRect(-64, -40, 128, 2);
  for (let r = 0; r < 6; r++) for (const x of [-64, 4]) { ctx.fillStyle = 'rgba(42,26,16,0.55)'; ctx.fillRect(x, -30 + r * 14, 60 - (r === 5 ? 20 : 0), 5); }
  ctx.restore();
  ctx.fillStyle = 'rgba(36,16,16,0.85)'; dot(ctx, w / 2, h * 0.5, 40);
  ctx.strokeStyle = '#d0402e'; ctx.lineWidth = 3; ctx.stroke();
  text(ctx, '½', w / 2, h * 0.5 + 19, `700 54px ${DISPLAY}`, '#f6dc96');
  text(ctx, 'PUBLIC', w / 2, h * 0.79, `700 22px ${DISPLAY}`, '#f6dc96', 'center', 4);
  text(ctx, 'SCANDAL', w / 2, h * 0.855, `700 22px ${DISPLAY}`, '#f6dc96', 'center', 4);
  text(ctx, 'halves your status', w / 2, h * 0.905, `italic 500 14px ${BODY}`, '#e09a88');
}
function statusBack(ctx, w, h) {
  ctx.fillStyle = '#182238'; ctx.fillRect(0, 0, w, h);
  ctx.save(); ctx.strokeStyle = 'rgba(216,164,70,0.3)'; ctx.lineWidth = 1.3;
  for (let i = -h; i < w + h; i += 24) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(i, h); ctx.lineTo(i + h, 0); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = GOLD; ctx.lineWidth = 3; roundRect(ctx, 12, 12, w - 24, h - 24, 12); ctx.stroke();
  ctx.lineWidth = 1.2; roundRect(ctx, 19, 19, w - 38, h - 38, 8); ctx.stroke();
  ctx.save(); ctx.translate(w / 2, h / 2);
  ctx.fillStyle = '#182238'; ctx.beginPath(); ctx.arc(0, 0, 64, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = GOLD; ctx.lineWidth = 3; ctx.stroke();
  // the auctioneer's gavel
  ctx.rotate(-0.6); ctx.fillStyle = GOLD;
  roundRect(ctx, -30, -34, 60, 26, 6); ctx.fill();
  ctx.fillStyle = '#182238'; ctx.fillRect(-26, -24, 52, 4); ctx.fillStyle = GOLD;
  ctx.fillRect(-4, -8, 8, 46);
  ctx.restore();
  text(ctx, 'THE GILDED BID', w / 2, h - 34, `700 14px ${DISPLAY}`, GOLD, 'center', 3);
  speckle(ctx, w, h, 600, 0.05);
}

/** The whole atlas: every money note, its back, the sixteen status cards' faces, and their back. */
let atlasCanvas = null;
export function auctionAtlas() {
  const { cols, pad, w, h, cellW, cellH } = ATLAS;
  const [c, ctx] = mk(ATLAS.width, ATLAS.height);
  atlasCanvas = c;
  const draw = (cell, edge, fn) => {
    const x = (cell % cols) * cellW, y = Math.floor(cell / cols) * cellH;
    ctx.save(); ctx.fillStyle = edge; ctx.fillRect(x, y, cellW, cellH);
    ctx.translate(x + pad, y + pad); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    fn(ctx, w, h); ctx.restore();
  };
  MONEY.forEach((v, i) => draw(i, tierOf(v).ink, (k, W, H) => moneyFront(k, W, H, v)));
  draw(CELL.moneyBack, GOLD, moneyBack);
  for (let v = 1; v <= 10; v++) draw(CELL.curio + v - 1, '#7a5a30', (k, W, H) => curio(k, W, H, v));
  draw(CELL.favour, '#d8a446', favour);
  draw(CELL.ale, '#5a1a14', ale);
  draw(CELL.debt, '#5a1a14', debt);
  draw(CELL.scandal, '#d8a446', scandal);
  draw(CELL.statusBack, GOLD, statusBack);
  return c;
}

/** The brass plaque that counts gilded cards turned: four seals, filled left to right. */
export function drawPlaque(c, filled) {
  const ctx = c.getContext('2d'), w = c.width, h = c.height;
  ctx.clearRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#5a3a1a'); g.addColorStop(1, '#2a1a0c');
  roundRect(ctx, 2, 2, w - 4, h - 4, 18); ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = '#c99a3e'; ctx.lineWidth = 4; ctx.stroke();
  ctx.lineWidth = 1.5; roundRect(ctx, 10, 10, w - 20, h - 20, 12); ctx.stroke();
  text(ctx, 'GILDED', w / 2, 40, `700 24px ${DISPLAY}`, '#e8c88a', 'center', 8);
  for (let i = 0; i < 4; i++) {
    const x = w / 2 + (i - 1.5) * 88, y = h * 0.66, on = i < filled, last = i === 3;
    ctx.fillStyle = '#1a0f06'; dot(ctx, x, y, 30);
    ctx.strokeStyle = '#8a6224'; ctx.lineWidth = 3; ctx.stroke();
    if (on) {
      const s = ctx.createRadialGradient(x - 8, y - 8, 2, x, y, 28);
      s.addColorStop(0, '#fff6d8'); s.addColorStop(0.5, last ? '#ff9a4a' : '#f3c56a'); s.addColorStop(1, last ? '#a8321e' : '#a8762e');
      ctx.fillStyle = s; dot(ctx, x, y, 26);
      drawSymbol(ctx, 'king', x, y + 2, 30, '#5a3a10', '#f3d79a');
    } else {
      ctx.fillStyle = 'rgba(201,154,62,0.35)'; text(ctx, String(i + 1), x, y + 10, `700 26px ${DISPLAY}`, 'rgba(201,154,62,0.4)');
    }
  }
  return c;
}
export const plaqueCanvas = () => mk(512, 160)[0];

const thumbs = new Map();
/** A small image of one atlas cell, for the HUD. Drawn once per cell. */
export function cellThumb(cell) {
  if (!thumbs.has(cell) && atlasCanvas) {
    const { cols, pad, w, h, cellW, cellH } = ATLAS, [c, ctx] = mk(72, 100);
    ctx.drawImage(atlasCanvas, (cell % cols) * cellW + pad, Math.floor(cell / cols) * cellH + pad, w, h, 0, 0, 72, 100);
    thumbs.set(cell, c.toDataURL());
  }
  return thumbs.get(cell) || '';
}
