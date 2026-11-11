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
export const RANK_STYLE = {
  sun:  { name: 'Sun',  plural: 'Suns',  color: '#c0601a', deep: '#6e2c06' },
  moon: { name: 'Moon', plural: 'Moons', color: '#2d4c8c', deep: '#122246' },
  star: { name: 'Star', plural: 'Stars', color: '#a1223a', deep: '#4f0e1a' },
  wild: { name: 'Wild', plural: 'Wilds', color: '#3f6f34', deep: '#1c3416' },
};
const PAPER = '#efe3c8';

export function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

export function drawSymbol(ctx, rank, cx, cy, s, color, paper = PAPER) {
  ctx.save(); ctx.translate(cx, cy); ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineCap = 'round';
  if (rank === 'sun') {
    ctx.beginPath(); ctx.arc(0, 0, s * 0.27, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 16; i++) {
      ctx.save(); ctx.rotate(i / 16 * Math.PI * 2); ctx.beginPath();
      ctx.moveTo(-s * 0.05, -s * 0.33); ctx.lineTo(0, -s * (i % 2 ? 0.43 : 0.5)); ctx.lineTo(s * 0.05, -s * 0.33); ctx.closePath(); ctx.fill(); ctx.restore();
    }
    ctx.fillStyle = paper; ctx.beginPath(); ctx.arc(0, 0, s * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, s * 0.14, 0, Math.PI * 2); ctx.fill();
  } else if (rank === 'moon') {
    const [m, g] = mk(Math.ceil(s * 1.1)); const h = m.width / 2;
    g.fillStyle = color; g.beginPath(); g.arc(h, h, s * 0.44, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(h + s * 0.2, h - s * 0.1, s * 0.37, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'source-over'; g.fillStyle = color;
    for (const [dx, dy, r] of [[0.22, 0.2, 0.05], [0.3, -0.02, 0.03]]) { g.beginPath(); g.arc(h + s * dx, h + s * dy, s * r, 0, Math.PI * 2); g.fill(); }
    ctx.rotate(-0.25); ctx.drawImage(m, -h, -h);
  } else if (rank === 'star') {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? s * 0.19 : s * 0.48; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.fill();
    ctx.lineWidth = s * 0.025; ctx.strokeStyle = paper; ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? s * 0.1 : s * 0.3; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.stroke();
  } else {
    ctx.lineWidth = s * 0.055;
    ctx.beginPath(); ctx.moveTo(-s * 0.46, s * 0.04); ctx.quadraticCurveTo(0, -s * 0.46, s * 0.46, s * 0.04); ctx.quadraticCurveTo(0, s * 0.5, -s * 0.46, s * 0.04); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, s * 0.04, s * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = paper; ctx.beginPath(); ctx.arc(-s * 0.05, -s * 0.01, s * 0.045, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = s * 0.04;
    for (let i = -2; i <= 2; i++) { ctx.save(); ctx.rotate(i * 0.36); ctx.beginPath(); ctx.moveTo(0, -s * 0.3); ctx.lineTo(0, -s * 0.44); ctx.stroke(); ctx.restore(); }
  }
  ctx.restore();
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
  paperBase(ctx, PAPER);
  ctx.strokeStyle = R.color; ctx.lineWidth = 3; roundRect(ctx, 14, 14, w - 28, h - 28, 13); ctx.stroke();
  ctx.lineWidth = 1.2; roundRect(ctx, 21, 21, w - 42, h - 42, 9); ctx.stroke();
  drawSymbol(ctx, rank, 46, 52, 42, R.color);
  ctx.save(); ctx.translate(w, h); ctx.rotate(Math.PI); drawSymbol(ctx, rank, 46, 52, 42, R.color); ctx.restore();
  drawSymbol(ctx, rank, w / 2, h / 2 - 14, 150, R.color);
  ctx.fillStyle = R.deep; ctx.textAlign = 'center'; ctx.font = '700 25px Cinzel, Georgia, serif';
  ctx.fillText(R.name.toUpperCase().split('').join(String.fromCharCode(8202)), w / 2, h - 52);
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
  const [c, ctx] = mk(px); drawSymbol(ctx, rank, px / 2, px / 2, px * 0.77, RANK_STYLE[rank].color); return c.toDataURL();
}
export function cardImage(rank) { return cardFront(rank).toDataURL(); }
