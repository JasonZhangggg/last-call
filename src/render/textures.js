// Procedural textures. Everything is drawn once at boot; nothing is downloaded.

/* periodic value noise */
function hash(x, y) { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
export function vnoise(x, y, px, py) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (a, p) => ((a % p) + p) % p;
  const x0 = w(xi, px), x1 = w(xi + 1, px), y0 = w(yi, py), y1 = w(yi + 1, py);
  const a = hash(x0, y0), b = hash(x1, y0), c = hash(x0, y1), d = hash(x1, y1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, px, py) { let s = 0, amp = 0.5, f = 1; for (let o = 0; o < 4; o++) { s += amp * vnoise(x * f, y * f, px * f, py * f); amp *= 0.5; f *= 2; } return s; }
export { hash };

const mk = (w, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };

export function woodCanvas(size, { planks = 6, base = [120, 66, 36], dark = [58, 28, 14], vertical = false, seed = 1, seams = true } = {}) {
  const [c, ctx] = mk(size); const img = ctx.createImageData(size, size); const d = img.data;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let u = px / size, v = py / size;
    if (vertical) { const t = u; u = v; v = t; }
    const pl = Math.floor(v * planks), vv = v * planks - pl;
    const off = hash(pl, seed), tone = 0.82 + 0.3 * hash(pl, seed + 9);
    const n = fbm(u * 4 + off * 4, v * planks * 2, 4, planks * 2);
    const stripe = 0.5 + 0.5 * Math.sin((v * planks * 18 + n * 7 + off * 3) * Math.PI);
    const fine = vnoise(u * 64, v * 256, 64, 256);
    const k = (0.35 + 0.45 * stripe + 0.2 * fine) * tone;
    let r = dark[0] + (base[0] - dark[0]) * k, g = dark[1] + (base[1] - dark[1]) * k, b = dark[2] + (base[2] - dark[2]) * k;
    if (seams && (vv < 0.025 || vv > 0.975 || Math.abs(u - hash(pl, seed + 3)) < 0.0035)) { r *= 0.4; g *= 0.4; b *= 0.4; }
    const i = (py * size + px) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); return c;
}

/** Grayscale roughness companion for a wood canvas: darker grain = rougher. */
export function roughnessFrom(src, lo = 0.35, hi = 0.75) {
  const [c, ctx] = mk(src.width, src.height); ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 765; const v = 255 * (hi - (hi - lo) * Math.min(1, l * 2.2)); d[i] = d[i + 1] = d[i + 2] = v; }
  ctx.putImageData(img, 0, 0); return c;
}

export function feltCanvas(size, color = [29, 72, 50]) {
  const [c, ctx] = mk(size); const img = ctx.createImageData(size, size); const d = img.data;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const n = fbm(px / size * 8, py / size * 8, 8, 8) * 0.6 + hash(px, py) * 0.4;
    const k = 0.78 + 0.32 * n, i = (py * size + px) * 4;
    d[i] = color[0] * k; d[i + 1] = color[1] * k; d[i + 2] = color[2] * k; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); return c;
}

export function softDot(size = 64) {
  const [c, ctx] = mk(size); const h = size / 2;
  const g = ctx.createRadialGradient(h, h, 0, h, h, h);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size); return c;
}

/* ---------- cards ---------- */
// Standard corner indices (K, Q, A) with our own tavern emblems in the middle: a laurelled crown,
// a crowned rose, the Crooked Lantern itself, a jester's cap and a horned mask.
export const RANK_STYLE = {
  king:  { name: 'King',  plural: 'Kings',  index: 'K', color: '#a1223a', deep: '#4f0e1a' },
  queen: { name: 'Queen', plural: 'Queens', index: 'Q', color: '#2d4c8c', deep: '#122246' },
  ace:   { name: 'Ace',   plural: 'Aces',   index: 'A', color: '#b5601c', deep: '#5c2a06' },
  joker: { name: 'Joker', plural: 'Jokers', index: 'JOKER', color: '#3f6f34', deep: '#1c3416' },
  devil: { name: 'Devil', plural: 'Devils', index: 'DEVIL', color: '#d0402e', deep: '#2a0807', dark: true },
};
const PAPER = '#efe3c8';
const GOLD = '#c99a3e';
const DEVIL_FIELD = '#2a0b0c';

export function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
const dot = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
function leaf(ctx, x, y, len, wid, angle) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(len * 0.5, -wid, len, 0); ctx.quadraticCurveTo(len * 0.5, wid, 0, 0); ctx.fill();
  ctx.restore();
}

function crown(ctx, s, c, deep, paper, detail) {
  const tips = [[-0.4, -0.2], [-0.2, -0.33], [0, -0.42], [0.2, -0.33], [0.4, -0.2]];
  ctx.beginPath(); ctx.moveTo(-0.36 * s, 0.1 * s);
  tips.forEach(([x, y], i) => { ctx.lineTo(x * s, y * s); if (i < 4) ctx.lineTo((x + 0.1) * s, -0.04 * s); });
  ctx.lineTo(0.36 * s, 0.1 * s); ctx.closePath(); ctx.fill();
  if (detail) { ctx.lineWidth = s * 0.018; ctx.strokeStyle = deep; ctx.stroke(); }
  ctx.fillStyle = deep; roundRect(ctx, -0.4 * s, 0.06 * s, 0.8 * s, 0.13 * s, 0.03 * s); ctx.fill();
  ctx.fillStyle = detail ? GOLD : c;
  for (const [x, y] of tips) dot(ctx, x * s, y * s, 0.045 * s);
  ctx.fillStyle = paper;
  for (const x of [-0.26, 0, 0.26]) dot(ctx, x * s, 0.125 * s, 0.035 * s);
  if (detail) {
    for (const x of [-0.2, 0.2]) { ctx.save(); ctx.translate(x * s, -0.08 * s); ctx.rotate(Math.PI / 4); ctx.fillRect(-0.03 * s, -0.03 * s, 0.06 * s, 0.06 * s); ctx.restore(); }
    ctx.fillStyle = GOLD; ctx.beginPath(); ctx.moveTo(0, -0.2 * s); ctx.lineTo(0.05 * s, -0.12 * s); ctx.lineTo(0, -0.04 * s); ctx.lineTo(-0.05 * s, -0.12 * s); ctx.closePath(); ctx.fill();
  }
}
function laurel(ctx, s, color) {
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = s * 0.014;
  for (const side of [-1, 1]) {
    ctx.beginPath(); ctx.arc(0, -0.06 * s, 0.44 * s, Math.PI / 2 + side * 0.15, Math.PI / 2 + side * 2.1, side < 0); ctx.stroke();
    for (let i = 0; i < 10; i++) {
      const a = Math.PI / 2 + side * (0.25 + i * 0.19), x = Math.cos(a) * 0.44 * s, y = -0.06 * s + Math.sin(a) * 0.44 * s;
      leaf(ctx, x, y, 0.13 * s, 0.045 * s, a + side * 2.1);
      leaf(ctx, x, y, 0.11 * s, 0.04 * s, a + side * 1.0 + Math.PI);
    }
  }
}

function rose(ctx, s, c, deep, paper, detail) {
  if (detail) {
    ctx.strokeStyle = deep; ctx.lineWidth = s * 0.03; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0.12 * s); ctx.bezierCurveTo(0.08 * s, 0.3 * s, -0.08 * s, 0.4 * s, 0.02 * s, 0.52 * s); ctx.stroke();
    ctx.fillStyle = deep;
    leaf(ctx, 0.03 * s, 0.3 * s, 0.22 * s, 0.07 * s, -0.5);
    leaf(ctx, 0, 0.4 * s, 0.2 * s, 0.065 * s, Math.PI + 0.45);
  }
  ctx.fillStyle = c;
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; dot(ctx, Math.cos(a) * 0.13 * s, Math.sin(a) * 0.13 * s - 0.02 * s, 0.13 * s); }
  dot(ctx, 0, -0.02 * s, 0.17 * s);
  ctx.strokeStyle = paper; ctx.lineWidth = s * (detail ? 0.018 : 0.028); ctx.lineCap = 'round';
  ctx.beginPath();
  for (let t = 0; t < 1; t += 0.02) { const a = t * Math.PI * 4.2, r = 0.02 * s + t * 0.17 * s; ctx.lineTo(Math.cos(a) * r, -0.02 * s + Math.sin(a) * r); }
  ctx.stroke();
  if (detail) {
    ctx.fillStyle = GOLD;
    ctx.beginPath(); ctx.moveTo(-0.16 * s, -0.3 * s);
    for (const [x, y] of [[-0.12, -0.42], [-0.06, -0.33], [0, -0.47], [0.06, -0.33], [0.12, -0.42], [0.16, -0.3]]) ctx.lineTo(x * s, y * s);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = paper; dot(ctx, 0, -0.36 * s, 0.025 * s);
  }
}

function lantern(ctx, s, c, deep, paper, detail) {
  if (detail) {
    ctx.strokeStyle = GOLD; ctx.lineWidth = s * 0.016; ctx.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2, r0 = 0.3 * s, r1 = (i % 2 ? 0.4 : 0.47) * s;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, 0.04 * s + Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * r1, 0.04 * s + Math.sin(a) * r1); ctx.stroke();
    }
  }
  ctx.fillStyle = c; ctx.strokeStyle = c; ctx.lineWidth = s * 0.035;
  ctx.beginPath(); ctx.arc(0, -0.38 * s, 0.06 * s, Math.PI * 0.95, Math.PI * 2.05); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-0.08 * s, -0.33 * s); ctx.lineTo(0.08 * s, -0.33 * s); ctx.lineTo(0.2 * s, -0.2 * s); ctx.lineTo(-0.2 * s, -0.2 * s); ctx.closePath(); ctx.fill();
  roundRect(ctx, -0.17 * s, -0.2 * s, 0.34 * s, 0.4 * s, 0.03 * s); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-0.2 * s, 0.2 * s); ctx.lineTo(0.2 * s, 0.2 * s); ctx.lineTo(0.13 * s, 0.29 * s); ctx.lineTo(-0.13 * s, 0.29 * s); ctx.closePath(); ctx.fill();
  ctx.fillStyle = detail ? '#f6dea0' : paper;
  roundRect(ctx, -0.12 * s, -0.15 * s, 0.24 * s, 0.3 * s, 0.02 * s); ctx.fill();
  ctx.fillStyle = c; ctx.fillRect(-0.012 * s, -0.15 * s, 0.024 * s, 0.3 * s);
  ctx.fillStyle = detail ? '#e0702a' : c;
  ctx.beginPath(); ctx.moveTo(0, -0.1 * s); ctx.bezierCurveTo(0.08 * s, 0, 0.06 * s, 0.1 * s, 0, 0.11 * s); ctx.bezierCurveTo(-0.06 * s, 0.1 * s, -0.08 * s, 0, 0, -0.1 * s); ctx.fill();
  if (detail) { ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.ellipse(0, 0.05 * s, 0.025 * s, 0.045 * s, 0, 0, Math.PI * 2); ctx.fill(); }
}

function jester(ctx, s, c, deep, paper, detail) {
  for (const sd of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(0, 0.06 * s);
    ctx.quadraticCurveTo(sd * 0.34 * s, -0.36 * s, sd * 0.42 * s, -0.02 * s);
    ctx.quadraticCurveTo(sd * 0.12 * s, -0.2 * s, sd * 0.14 * s, 0.06 * s); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = detail ? deep : c;
  ctx.beginPath(); ctx.moveTo(-0.12 * s, 0.06 * s); ctx.quadraticCurveTo(-0.1 * s, -0.36 * s, 0.04 * s, -0.46 * s); ctx.quadraticCurveTo(0.02 * s, -0.24 * s, 0.12 * s, 0.06 * s); ctx.closePath(); ctx.fill();
  ctx.fillStyle = detail ? GOLD : c;
  for (const [x, y] of [[-0.42, -0.02], [0.42, -0.02], [0.04, -0.46]]) dot(ctx, x * s, y * s, 0.055 * s);
  ctx.fillStyle = deep; roundRect(ctx, -0.27 * s, 0.04 * s, 0.54 * s, 0.11 * s, 0.05 * s); ctx.fill();
  ctx.fillStyle = paper;
  for (let i = -2; i <= 2; i++) { ctx.save(); ctx.translate(i * 0.1 * s, 0.095 * s); ctx.rotate(Math.PI / 4); ctx.fillRect(-0.022 * s, -0.022 * s, 0.044 * s, 0.044 * s); ctx.restore(); }
  if (detail) {
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.moveTo(-0.22 * s, 0.2 * s); ctx.quadraticCurveTo(0, 0.5 * s, 0.22 * s, 0.2 * s); ctx.quadraticCurveTo(0, 0.34 * s, -0.22 * s, 0.2 * s); ctx.fill();
    ctx.fillStyle = deep; dot(ctx, -0.1 * s, 0.24 * s, 0.02 * s); dot(ctx, 0.1 * s, 0.24 * s, 0.02 * s);
  }
}

function devilMask(ctx, s, c, deep, paper, detail) {
  if (detail) {
    ctx.fillStyle = 'rgba(224, 96, 40, 0.4)';
    for (let i = -2; i <= 2; i++) {
      const x = i * 0.13 * s, top = (-0.12 - (2 - Math.abs(i)) * 0.1) * s, lean = (i % 2 ? 0.05 : -0.04) * s;
      ctx.beginPath(); ctx.moveTo(x - 0.1 * s, 0.4 * s);
      ctx.bezierCurveTo(x - 0.14 * s, 0.15 * s, x + lean - 0.04 * s, 0.05 * s, x + lean, top);
      ctx.bezierCurveTo(x + lean + 0.06 * s, 0.06 * s, x + 0.14 * s, 0.15 * s, x + 0.1 * s, 0.4 * s);
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.fillStyle = c;
  for (const sd of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(sd * 0.1 * s, -0.16 * s);
    ctx.quadraticCurveTo(sd * 0.36 * s, -0.22 * s, sd * 0.32 * s, -0.46 * s);
    ctx.quadraticCurveTo(sd * 0.27 * s, -0.27 * s, sd * 0.2 * s, -0.06 * s); ctx.closePath(); ctx.fill();
  }
  ctx.beginPath(); ctx.moveTo(0, 0.36 * s);
  ctx.bezierCurveTo(0.12 * s, 0.24 * s, 0.26 * s, 0.1 * s, 0.25 * s, -0.08 * s);
  ctx.bezierCurveTo(0.24 * s, -0.24 * s, -0.24 * s, -0.24 * s, -0.25 * s, -0.08 * s);
  ctx.bezierCurveTo(-0.26 * s, 0.1 * s, -0.12 * s, 0.24 * s, 0, 0.36 * s); ctx.fill();
  ctx.fillStyle = detail ? '#ffd27a' : paper;
  for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sd * 0.04 * s, -0.02 * s); ctx.lineTo(sd * 0.17 * s, -0.08 * s); ctx.lineTo(sd * 0.14 * s, 0.01 * s); ctx.closePath(); ctx.fill(); }
  ctx.beginPath(); ctx.moveTo(-0.11 * s, 0.13 * s); ctx.quadraticCurveTo(0, 0.2 * s, 0.11 * s, 0.13 * s); ctx.quadraticCurveTo(0, 0.25 * s, -0.11 * s, 0.13 * s); ctx.fill();
}

const EMBLEMS = { king: crown, queen: rose, ace: lantern, joker: jester, devil: devilMask };
/** A rank's emblem centred at (cx, cy), `s` px across. `detail` adds the shading and props of the card face. */
export function drawSymbol(ctx, rank, cx, cy, s, color, paper = PAPER, detail = false) {
  const R = RANK_STYLE[rank];
  ctx.save(); ctx.translate(cx, cy); ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (rank === 'king' && detail) { laurel(ctx, s, R.deep); ctx.fillStyle = color; ctx.translate(0, -0.04 * s); }
  EMBLEMS[rank](ctx, s, color, R.deep, paper, detail);
  ctx.restore();
}

function cornerIndex(ctx, rank, ink, paper) {
  const R = RANK_STYLE[rank];
  ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  if (R.index.length === 1) {
    ctx.font = '700 50px Cinzel, Georgia, serif';
    ctx.fillText(R.index, 40, 74);
    drawSymbol(ctx, rank, 40, 100, 36, ink, paper);
  } else {
    ctx.font = '700 19px Cinzel, Georgia, serif';
    [...R.index].forEach((ch, i) => ctx.fillText(ch, 36, 50 + i * 20));
    drawSymbol(ctx, rank, 36, 168, 30, ink, paper);
  }
}

export const CARD_PX = { w: 256, h: 358 };
function paperBase(ctx, fill) {
  const { w, h } = CARD_PX;
  roundRect(ctx, 2, 2, w - 4, h - 4, 22); ctx.fillStyle = fill; ctx.fill();
  ctx.save(); ctx.clip();
  for (let i = 0; i < 2200; i++) { ctx.fillStyle = `rgba(80,50,20,${Math.random() * 0.07})`; ctx.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6); }
  const g = ctx.createRadialGradient(w / 2, h / 2, 60, w / 2, h / 2, 220); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(70,40,10,0.22)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore();
}
export function cardFront(rank) {
  const R = RANK_STYLE[rank], { w, h } = CARD_PX; const [c, ctx] = mk(w, h);
  const paper = R.dark ? DEVIL_FIELD : PAPER, ink = R.dark ? R.color : R.deep;
  paperBase(ctx, PAPER);
  if (R.dark) { roundRect(ctx, 10, 10, w - 20, h - 20, 15); ctx.fillStyle = DEVIL_FIELD; ctx.fill(); }
  ctx.strokeStyle = R.dark ? GOLD : R.color; ctx.lineWidth = 3; roundRect(ctx, 14, 14, w - 28, h - 28, 13); ctx.stroke();
  ctx.lineWidth = 1.2; roundRect(ctx, 21, 21, w - 42, h - 42, 9); ctx.stroke();
  cornerIndex(ctx, rank, ink, paper);
  ctx.save(); ctx.translate(w, h); ctx.rotate(Math.PI); cornerIndex(ctx, rank, ink, paper); ctx.restore();
  drawSymbol(ctx, rank, w / 2 + 6, h / 2, 150, R.color, paper, true);
  return c;
}
export function cardBack() {
  const { w, h } = CARD_PX; const [c, ctx] = mk(w, h);
  paperBase(ctx, PAPER);
  roundRect(ctx, 12, 12, w - 24, h - 24, 14); ctx.fillStyle = '#5b1622'; ctx.fill();
  ctx.save(); roundRect(ctx, 20, 20, w - 40, h - 40, 10); ctx.clip();
  ctx.strokeStyle = 'rgba(216,164,70,0.45)'; ctx.lineWidth = 1.5;
  for (let i = -h; i < w + h; i += 22) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(i, h); ctx.lineTo(i + h, 0); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = '#d8a446'; ctx.lineWidth = 2.5; roundRect(ctx, 20, 20, w - 40, h - 40, 10); ctx.stroke();
  ctx.save(); ctx.translate(w / 2, h / 2);
  ctx.fillStyle = '#5b1622'; ctx.beginPath(); ctx.arc(0, 0, 62, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#d8a446'; ctx.lineWidth = 3; ctx.stroke();
  ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, 0, 54, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#d8a446';
  ctx.beginPath(); ctx.arc(0, -40, 7, Math.PI, 0); ctx.lineWidth = 3; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-20, -24); ctx.lineTo(20, -24); ctx.lineTo(13, -33); ctx.lineTo(-13, -33); ctx.closePath(); ctx.fill();
  roundRect(ctx, -18, -24, 36, 48, 6); ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = '#f4c56a'; ctx.beginPath(); ctx.moveTo(0, -14); ctx.quadraticCurveTo(10, 4, 0, 14); ctx.quadraticCurveTo(-10, 4, 0, -14); ctx.fill();
  ctx.fillStyle = '#d8a446'; ctx.fillRect(-22, 24, 44, 6);
  ctx.restore();
  return c;
}
export function cardGlow() {
  const [c, ctx] = mk(160, 210);
  ctx.shadowColor = '#fff'; ctx.shadowBlur = 22; ctx.fillStyle = '#fff';
  roundRect(ctx, 26, 26, 108, 158, 12); ctx.fill();
  return c;
}
export function rankIcon(rank, px = 96) {
  const [c, ctx] = mk(px); drawSymbol(ctx, rank, px / 2, px / 2 + px * 0.02, px * 0.8, RANK_STYLE[rank].color); return c.toDataURL();
}
export function cardImage(rank) { return cardFront(rank).toDataURL(); }
