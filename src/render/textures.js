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

/* ---------- surface detail ---------- */

/** Fills a canvas from f(u, v) -> [r, g, b] (0..255), u and v in 0..1. */
function paint(w, h, f) {
  const [c, ctx] = mk(w, h); const img = ctx.createImageData(w, h); const d = img.data;
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const [r, g, b] = f(px / w, py / h, px, py); const i = (py * w + px) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); return c;
}

/** Tangent-space normal map from a tileable height function h(u, v) in 0..1. */
export function normalCanvas(size, height, strength = 2) {
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) H[y * size + x] = height(x / size, y / size);
  const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  return paint(size, size, (u, v, x, y) => {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength * size / 64, dy = (at(x, y + 1) - at(x, y - 1)) * strength * size / 64;
    const l = Math.hypot(dx, dy, 1);
    return [(-dx / l * 0.5 + 0.5) * 255, (dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255];
  });
}

/** Woven cloth: fine twill plus slow fbm, for coats, velvet and the rug. */
export const weaveHeight = (threads = 96) => (u, v) => {
  const a = Math.sin((u + v) * threads * Math.PI) * 0.5 + 0.5, b = Math.sin((u - v) * threads * Math.PI * 0.5) * 0.5 + 0.5;
  return a * 0.55 + b * 0.25 + fbm(u * 8, v * 8, 8, 8) * 0.4;
};
/** Hammered metal: soft dents plus tooling scratches. */
export const hammeredHeight = (u, v) => fbm(u * 12, v * 12, 12, 12) * 0.8 + vnoise(u * 160, v * 6, 160, 6) * 0.12;
/** Skin or porcelain: very low, broad undulation with pores. */
export const poreHeight = (u, v) => fbm(u * 6, v * 6, 6, 6) * 0.5 + hash(Math.floor(u * 256), Math.floor(v * 256)) * 0.08;

/**
 * Packed metal-roughness map for aged brass (three reads roughness from G, metalness from B),
 * plus a matching colour map: polished high spots, dark tarnish and a green patina in the hollows.
 */
export function brassCanvases(size = 256) {
  const field = (u, v) => fbm(u * 5, v * 5, 5, 5);
  const color = paint(size, size, (u, v) => {
    const n = field(u, v), s = vnoise(u * 90, v * 4, 90, 4);
    const tarnish = Math.min(1, Math.max(0, (n - 0.45) * 3)), patina = Math.max(0, (n - 0.66) * 4);
    const k = 0.9 + s * 0.15;
    return [(255 - tarnish * 120 - patina * 90) * k, (205 - tarnish * 100 - patina * 20) * k, (130 - tarnish * 70 + patina * 10) * k];
  });
  const rough = paint(size, size, (u, v) => {
    const n = field(u, v), s = vnoise(u * 90, v * 4, 90, 4);
    return [255, (0.24 + Math.max(0, n - 0.4) * 0.9 + s * 0.08) * 255, (1 - Math.max(0, n - 0.66) * 1.6) * 255];
  });
  return { color, rough };
}

/** Mottled tint map: multiplies a material colour with gentle blotches (skin, porcelain, velvet). */
export function mottleCanvas(size, { amount = 0.12, scale = 6, warm = [1, 0.96, 0.94] } = {}) {
  return paint(size, size, (u, v) => {
    const n = fbm(u * scale, v * scale, scale, scale) - 0.5, f = 1 + n * amount * 2;
    return [255 * Math.min(1, f * warm[0]), 255 * Math.min(1, f * warm[1]), 255 * Math.min(1, f * warm[2])];
  });
}

/** Painted gold filigree for the owl mask, laid out in SphereGeometry UVs (front at u = 0.25). */
export function maskCanvas(size = 512) {
  const [c, ctx] = mk(size, size / 2); const W = size, H = size / 2;
  const tone = paint(W, H, (u, v) => { const n = fbm(u * 10, v * 5, 10, 5); const k = 0.94 + n * 0.08; return [236 * k, 228 * k, 214 * k]; });
  ctx.drawImage(tone, 0, 0);
  const fx = 0.25 * W;
  ctx.strokeStyle = '#b48a3c'; ctx.lineCap = 'round'; ctx.fillStyle = '#b48a3c';
  for (const s of [-1, 1]) {
    ctx.save(); ctx.translate(fx + s * 0.062 * W, H * 0.47);
    ctx.lineWidth = W * 0.0022;
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * (1.1 + i * 0.1), r1 = W * 0.062, r2 = W * 0.09;
      const ax = Math.cos(a) * s, ay = Math.sin(a);
      ctx.beginPath(); ctx.moveTo(ax * r1, ay * r1 * 2.2); ctx.quadraticCurveTo(ax * r2 * 1.1, ay * r2 * 1.6, ax * r2, ay * r2 * 2.3); ctx.stroke();
    }
    ctx.restore();
  }
  // forehead feather chevrons
  ctx.lineWidth = W * 0.003;
  for (let row = 0; row < 4; row++) for (let i = -2 - row; i <= 2 + row; i++) {
    const x = fx + i * W * 0.024, y = H * (0.2 + row * 0.045);
    ctx.globalAlpha = 0.85 - row * 0.12;
    ctx.beginPath(); ctx.moveTo(x - W * 0.01, y - H * 0.012); ctx.quadraticCurveTo(x, y + H * 0.018, x + W * 0.01, y - H * 0.012); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // a teardrop under each eye
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(fx + s * 0.066 * W, H * 0.66, W * 0.005, H * 0.016, 0, 0, Math.PI * 2); ctx.fill(); }
  return c;
}

/* ---------- tavern decor ---------- */

/** Damask wallpaper tile: dark ground, a faintly lighter repeating flourish. */
export function damaskCanvas(size = 256, ground = [44, 26, 22], ink = [78, 50, 34]) {
  const [c, ctx] = mk(size);
  ctx.drawImage(paint(size, size, (u, v) => { const n = 0.88 + fbm(u * 6, v * 6, 6, 6) * 0.24; return [ground[0] * n, ground[1] * n, ground[2] * n]; }), 0, 0);
  ctx.fillStyle = `rgba(${ink.join(',')},0.75)`; ctx.strokeStyle = `rgba(${ink.join(',')},0.75)`; ctx.lineWidth = size * 0.012;
  const motif = (cx, cy, s) => {
    ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
    for (const m of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(0, 60); ctx.bezierCurveTo(m * 50, 40, m * 60, -10, m * 20, -40); ctx.bezierCurveTo(m * 5, -50, 0, -60, 0, -70); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(m * 30, 5, 10, 22, m * 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(m * 42, -30, 6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.beginPath(); ctx.moveTo(0, -78); ctx.lineTo(10, -60); ctx.lineTo(0, -40); ctx.lineTo(-10, -60); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 20, 12, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };
  const s = size / 256;
  for (const [x, y] of [[0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1]]) motif(x * size, y * size, s * 0.9);
  return c;
}

/** A worn oriental-style rug, w x h, with border bands and a central medallion. */
export function rugCanvas(w = 512, h = 384) {
  const [c, ctx] = mk(w, h);
  const red = '#6a1d18', navy = '#1d2638', gold = '#b0823e', cream = '#c9b48c';
  ctx.fillStyle = navy; ctx.fillRect(0, 0, w, h);
  const band = (inset, color, lw) => { ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2); };
  ctx.fillStyle = red; ctx.fillRect(w * 0.08, h * 0.1, w * 0.84, h * 0.8);
  band(w * 0.035, cream, 3); band(w * 0.06, gold, 6); band(w * 0.085, cream, 2);
  ctx.save(); ctx.beginPath(); ctx.rect(w * 0.03, h * 0.03, w * 0.94, h * 0.94); ctx.rect(w * 0.075, h * 0.09, w * 0.85, h * 0.82); ctx.clip('evenodd');
  ctx.fillStyle = gold;
  for (let x = w * 0.04; x < w; x += w * 0.04) for (const y of [h * 0.055, h * 0.945]) { ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 7, y); ctx.fill(); }
  for (let y = h * 0.06; y < h; y += w * 0.04) for (const x of [w * 0.045, w * 0.955]) { ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 7, y); ctx.fill(); }
  ctx.restore();
  ctx.save(); ctx.translate(w / 2, h / 2);
  for (const [r, col] of [[0.3, navy], [0.24, gold], [0.2, red], [0.12, cream], [0.06, navy]]) {
    ctx.fillStyle = col; ctx.beginPath();
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, rr = (i % 2 ? 0.78 : 1) * r * h; ctx.lineTo(Math.cos(a) * rr * 1.5, Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = gold;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    ctx.save(); ctx.translate(sx * w * 0.33, sy * h * 0.28); ctx.rotate(Math.PI / 4);
    ctx.fillRect(-12, -12, 24, 24); ctx.fillStyle = navy; ctx.fillRect(-6, -6, 12, 12); ctx.fillStyle = gold; ctx.restore();
  }
  ctx.restore();
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h, i = (y * w + x) * 4;
    const wear = fbm(u * 6, v * 5, 6, 5), centre = 1 - Math.hypot(u - 0.5, (v - 0.5) * 0.8) * 1.4;
    const k = (0.82 + hash(x, y) * 0.18) * (1 - Math.max(0, wear - 0.55) * centre * 0.9) * (0.92 + 0.08 * Math.sin(x * 1.7));
    d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
  }
  ctx.putImageData(img, 0, 0); return c;
}

/**
 * Four small oil paintings side by side (each w/4 wide): a moonlit ship, rolling hills,
 * a still life and a hound's portrait. Brush noise, varnish and craquelure keep them painterly.
 */
export function paintingsCanvas(w = 1024, h = 320) {
  const [c, ctx] = mk(w, h); const pw = w / 4;
  const grad = (x0, y0, x1, y1, stops) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, col]) => g.addColorStop(o, col)); return g; };
  const blob = (x, y, rx, ry, col, a = 0) => { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, a, 0, Math.PI * 2); ctx.fill(); };
  // 1. ship under the moon
  ctx.save(); ctx.translate(0, 0);
  ctx.fillStyle = grad(0, 0, 0, h, [[0, '#0e1a2c'], [0.55, '#2c4058'], [0.6, '#1a2a3a'], [1, '#0a121c']]); ctx.fillRect(0, 0, pw, h);
  blob(pw * 0.7, h * 0.22, 18, 18, '#efe6c4'); ctx.globalAlpha = 0.25; blob(pw * 0.7, h * 0.22, 44, 44, '#cfd8e0'); ctx.globalAlpha = 1;
  ctx.fillStyle = '#d8d0b0'; for (let i = 0; i < 14; i++) ctx.fillRect(pw * 0.6 + Math.random() * 40 - 20, h * 0.6 + i * 6, 30 - i * 1.5, 2);
  ctx.fillStyle = '#0a0a0e'; ctx.beginPath(); ctx.moveTo(pw * 0.2, h * 0.62); ctx.lineTo(pw * 0.55, h * 0.62); ctx.lineTo(pw * 0.5, h * 0.68); ctx.lineTo(pw * 0.25, h * 0.68); ctx.fill();
  ctx.fillRect(pw * 0.36, h * 0.3, 3, h * 0.32);
  ctx.fillStyle = '#c8bea0'; for (const [y, ww] of [[0.34, 0.12], [0.43, 0.15], [0.52, 0.16]]) ctx.fillRect(pw * 0.375 - ww * pw / 2, h * y, ww * pw, h * 0.07);
  ctx.restore();
  // 2. hills at dusk
  ctx.save(); ctx.translate(pw, 0);
  ctx.fillStyle = grad(0, 0, 0, h, [[0, '#d89a5a'], [0.45, '#e8c48a'], [1, '#6a5a3a']]); ctx.fillRect(0, 0, pw, h);
  for (const [y, col, amp] of [[0.5, '#7a7a5a', 20], [0.6, '#56603a', 26], [0.72, '#3a4428', 30], [0.86, '#28301c', 20]]) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, h);
    for (let x = 0; x <= pw; x += 8) ctx.lineTo(x, h * y + Math.sin(x * 0.03 + y * 9) * amp + Math.sin(x * 0.011 + y * 3) * amp);
    ctx.lineTo(pw, h); ctx.fill();
  }
  blob(pw * 0.3, h * 0.66, 8, 22, '#1e2414'); blob(pw * 0.3, h * 0.6, 18, 20, '#24301a');
  ctx.restore();
  // 3. still life
  ctx.save(); ctx.translate(pw * 2, 0);
  ctx.fillStyle = grad(0, 0, pw, h, [[0, '#2a2016'], [1, '#120d08']]); ctx.fillRect(0, 0, pw, h);
  ctx.fillStyle = '#3a2614'; ctx.fillRect(0, h * 0.7, pw, h * 0.3);
  ctx.fillStyle = '#1e3a24'; ctx.beginPath(); ctx.moveTo(pw * 0.42, h * 0.7); ctx.lineTo(pw * 0.42, h * 0.38); ctx.quadraticCurveTo(pw * 0.42, h * 0.3, pw * 0.48, h * 0.28); ctx.lineTo(pw * 0.48, h * 0.18); ctx.lineTo(pw * 0.53, h * 0.18); ctx.lineTo(pw * 0.53, h * 0.28); ctx.quadraticCurveTo(pw * 0.6, h * 0.3, pw * 0.6, h * 0.38); ctx.lineTo(pw * 0.6, h * 0.7); ctx.fill();
  ctx.fillStyle = 'rgba(220,240,220,0.35)'; ctx.fillRect(pw * 0.44, h * 0.38, 4, h * 0.28);
  blob(pw * 0.28, h * 0.68, 22, 20, '#a8321e'); blob(pw * 0.24, h * 0.64, 6, 5, 'rgba(255,220,180,0.5)');
  blob(pw * 0.72, h * 0.7, 26, 16, '#c89a2a'); blob(pw * 0.76, h * 0.66, 18, 16, '#7a2a4a');
  ctx.restore();
  // 4. hound portrait
  ctx.save(); ctx.translate(pw * 3, 0);
  ctx.fillStyle = grad(0, 0, 0, h, [[0, '#3a3424'], [1, '#14110a']]); ctx.fillRect(0, 0, pw, h);
  ctx.globalAlpha = 0.3; blob(pw * 0.5, h * 0.45, pw * 0.4, h * 0.35, '#6a6040'); ctx.globalAlpha = 1;
  blob(pw * 0.5, h * 0.9, pw * 0.36, h * 0.3, '#5a3a1e');
  blob(pw * 0.5, h * 0.5, pw * 0.18, h * 0.2, '#7a4e26');
  blob(pw * 0.5, h * 0.62, pw * 0.09, h * 0.1, '#8a6034');
  blob(pw * 0.33, h * 0.52, pw * 0.07, h * 0.16, '#4a2c14', 0.3); blob(pw * 0.67, h * 0.52, pw * 0.07, h * 0.16, '#4a2c14', -0.3);
  blob(pw * 0.44, h * 0.46, 5, 4, '#120a04'); blob(pw * 0.56, h * 0.46, 5, 4, '#120a04'); blob(pw * 0.5, h * 0.64, 9, 6, '#140c06');
  ctx.strokeStyle = '#a8202a'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(pw * 0.5, h * 0.62, pw * 0.16, 0.4, Math.PI - 0.4); ctx.stroke();
  ctx.restore();
  // brushwork, varnish and cracks over everything
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, u = x / w, v = y / h;
    const stroke = vnoise(u * 160, v * 40, 160, 40) * 0.14 + 0.93;
    const crack = Math.abs(vnoise(u * 60, v * 20, 60, 20) - 0.5) < 0.012 ? 0.72 : 1;
    const k = stroke * crack;
    d[i] = Math.min(255, d[i] * k * 1.02 + 6); d[i + 1] = Math.min(255, d[i + 1] * k * 0.98 + 3); d[i + 2] = d[i + 2] * k * 0.82;
  }
  ctx.putImageData(img, 0, 0); return c;
}

/** Night through small leaded panes: moon, thin cloud and a far roofline. */
export function nightCanvas(w = 256, h = 384) {
  const [c, ctx] = mk(w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#0a1430'); g.addColorStop(0.7, '#2a3c66'); g.addColorStop(1, '#3a4a70');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 60; i++) { ctx.fillStyle = `rgba(220,230,255,${Math.random() * 0.8})`; ctx.fillRect(Math.random() * w, Math.random() * h * 0.6, 1.5, 1.5); }
  const mg = ctx.createRadialGradient(w * 0.62, h * 0.24, 0, w * 0.62, h * 0.24, w * 0.45);
  mg.addColorStop(0, 'rgba(230,240,255,0.55)'); mg.addColorStop(1, 'rgba(160,190,255,0)');
  ctx.fillStyle = mg; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f4f2e6'; ctx.beginPath(); ctx.arc(w * 0.62, h * 0.24, w * 0.09, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(180,190,170,0.5)'; for (const [x, y, r] of [[0.6, 0.22, 0.02], [0.66, 0.27, 0.025]]) { ctx.beginPath(); ctx.arc(w * x, h * y, w * r, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = 'rgba(120,140,180,0.35)'; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(Math.random() * w, h * (0.3 + Math.random() * 0.25), w * 0.4, h * 0.02, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#060a14'; ctx.beginPath(); ctx.moveTo(0, h);
  for (const [x, y] of [[0, 0.78], [0.2, 0.78], [0.2, 0.7], [0.35, 0.62], [0.5, 0.7], [0.5, 0.74], [0.62, 0.74], [0.62, 0.66], [0.66, 0.66], [0.66, 0.74], [0.8, 0.74], [0.9, 0.68], [1, 0.72]]) ctx.lineTo(w * x, h * y);
  ctx.lineTo(w, h); ctx.fill();
  ctx.fillStyle = 'rgba(255,190,110,0.9)'; ctx.fillRect(w * 0.28, h * 0.72, 6, 8); ctx.fillRect(w * 0.84, h * 0.76, 5, 7);
  return c;
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
