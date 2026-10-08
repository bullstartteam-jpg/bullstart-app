// Sticker sheet analysis (Sticker Sheet menu). countStickers/dhash256 work on
// raw RGBA pixels with no DOM; analyzeDesignUrl at the bottom feeds them from a
// design URL.
//
// Counting: every sticker is a die-cut — a dark outline around a white rim.
// Stickers often touch, but only through their outlines, so:
//   1. background = pixels reachable from the edge that are transparent, or
//      (on a flattened sheet) the page colour read off the border;
//   2. dark pixels (luma < DARK) are walls;
//   3. each light region that lies against the background is one sticker's rim;
//   4. a rim boxed inside a bigger rim (an inner frame) is the same sticker.
// Fingerprint: 256-bit difference hash of the design flattened on white, for
// spotting the same sheet across orders whatever its size / compression.

import { driveId, driveOriginal } from '../utils/drive';

export const ANALYZE_LONG_SIDE = 1650;   // pixels the long side is scaled to
const DARK = 120;                          // luma below this = outline wall
const NEAR = 7.5;                          // rim must touch bg within this (px @1650)
const MIN_AREA = 0.0004;                   // rim area floor, fraction of image

export function countStickers(data, W, H) {
  const N = W * H;
  // Background reference, read off the border. Transparent sheet: the
  // background is the alpha — a white rim there is part of the sticker, not
  // page. Flattened sheet: the page colour (white, or any solid tint) taken
  // as the median border colour; the white rim is then told apart from a
  // white page only by the dark cut line, which is why dark pixels are walls.
  const border = [];
  for (let x = 0; x < W; x += 2) border.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y += 2) border.push(y * W, y * W + W - 1);
  const clear = border.filter(i => data[i * 4 + 3] < 30).length;
  const transparent = clear / border.length > 0.5;
  let pr = 255, pg = 255, pb = 255;
  if (!transparent) {
    const med = (k) => { const v = border.map(i => data[i * 4 + k]).sort((x, y) => x - y); return v[v.length >> 1]; };
    pr = med(0); pg = med(1); pb = med(2);
  }
  const PAGE_TOL = 18;

  const bgLike = new Uint8Array(N), dark = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
    bgLike[i] = (a < 30 || (!transparent && Math.abs(r - pr) <= PAGE_TOL && Math.abs(g - pg) <= PAGE_TOL && Math.abs(b - pb) <= PAGE_TOL)) ? 1 : 0;
    dark[i] = (a >= 30 && 0.299 * r + 0.587 * g + 0.114 * b < DARK) ? 1 : 0;
  }

  // 1. Background flood from the border.
  const bg = new Uint8Array(N);
  const stack = [];
  const seed = (i) => { if (bgLike[i] && !bg[i]) { bg[i] = 1; stack.push(i); } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (stack.length) {
    const i = stack.pop(); const x = i % W;
    if (x > 0) seed(i - 1); if (x < W - 1) seed(i + 1); if (i >= W) seed(i - W); if (i < N - W) seed(i + W);
  }

  // Distance to background (two-pass chamfer).
  const D = new Float32Array(N);
  for (let i = 0; i < N; i++) D[i] = bg[i] ? 0 : 1e9;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!D[i]) continue; let v = D[i];
    if (x > 0) v = Math.min(v, D[i - 1] + 1);
    if (y > 0) { v = Math.min(v, D[i - W] + 1); if (x > 0) v = Math.min(v, D[i - W - 1] + 1.414); if (x < W - 1) v = Math.min(v, D[i - W + 1] + 1.414); }
    D[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x; if (!D[i]) continue; let v = D[i];
    if (x < W - 1) v = Math.min(v, D[i + 1] + 1);
    if (y < H - 1) { v = Math.min(v, D[i + W] + 1); if (x < W - 1) v = Math.min(v, D[i + W + 1] + 1.414); if (x > 0) v = Math.min(v, D[i + W - 1] + 1.414); }
    D[i] = v;
  }

  // 2–3. Light regions; keep those against the background.
  const scale = Math.max(W, H) / ANALYZE_LONG_SIDE;
  const near = NEAR * scale;
  const minArea = N * MIN_AREA;
  const lab = new Int32Array(N);
  let n = 0;
  const rims = [];
  for (let s = 0; s < N; s++) {
    if (bg[s] || dark[s] || lab[s]) continue;
    n++; let area = 0, minD = 1e9, x0 = W, y0 = H, x1 = 0, y1 = 0;
    stack.push(s); lab[s] = n;
    while (stack.length) {
      const i = stack.pop(); area++;
      if (D[i] < minD) minD = D[i];
      const x = i % W, y = (i - x) / W;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0) { const j = i - 1; if (!bg[j] && !dark[j] && !lab[j]) { lab[j] = n; stack.push(j); } }
      if (x < W - 1) { const j = i + 1; if (!bg[j] && !dark[j] && !lab[j]) { lab[j] = n; stack.push(j); } }
      if (i >= W) { const j = i - W; if (!bg[j] && !dark[j] && !lab[j]) { lab[j] = n; stack.push(j); } }
      if (i < N - W) { const j = i + W; if (!bg[j] && !dark[j] && !lab[j]) { lab[j] = n; stack.push(j); } }
    }
    if (minD <= near && area >= minArea) rims.push({ x0, y0, x1, y1 });
  }

  // 4. Drop rims boxed (≥80%) inside a bigger kept rim.
  const boxArea = (r) => (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
  rims.sort((a, b) => boxArea(b) - boxArea(a));
  const kept = [];
  for (const r of rims) {
    const inner = kept.some(k => {
      const ix = Math.max(0, Math.min(r.x1, k.x1) - Math.max(r.x0, k.x0) + 1);
      const iy = Math.max(0, Math.min(r.y1, k.y1) - Math.max(r.y0, k.y0) + 1);
      return ix * iy >= 0.8 * boxArea(r);
    });
    if (!inner) kept.push(r);
  }
  // Reading order: rows top→bottom, then left→right.
  const rowH = H / 40;
  kept.sort((a, b) => Math.round(a.y0 / rowH) - Math.round(b.y0 / rowH) || a.x0 - b.x0);
  // Boxes as fractions of the image, so they overlay at any display size.
  const boxes = kept.map(r => [r.x0 / W, r.y0 / H, (r.x1 - r.x0 + 1) / W, (r.y1 - r.y0 + 1) / H].map(v => Math.round(v * 10000) / 10000));
  return { count: kept.length, boxes, mode: transparent ? 'transparent' : 'outline' };
}

// 256-bit difference hash: grayscale 17×16 (flattened on white), each bit =
// left pixel brighter than its right neighbour. `sample(w, h)` must return
// RGBA pixels of the whole image scaled to w×h. Returns 64 hex chars.
export function dhash256(sample) {
  const w = 17, h = 16;
  const d = sample(w, h);
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = d[i * 4 + 3] / 255;
    const lum = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    g[i] = lum * a + 255 * (1 - a);
  }
  let hex = '';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < 16; x += 4) {
      let nib = 0;
      for (let k = 0; k < 4; k++) nib = (nib << 1) | (g[y * w + x + k] > g[y * w + x + k + 1] ? 1 : 0);
      hex += nib.toString(16);
    }
  }
  return hex;
}

export function hammingHex(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

// ---------------------------------------------------------------------------
// Browser side: fetch a design URL and analyse it.
// ---------------------------------------------------------------------------
const LOAD_TIMEOUT_MS = 60000;

// Same route as the converter: through the main process when available (no
// CORS, Drive's raw bytes so a PNG keeps its alpha), else a plain <img>.
async function loadDesign(url) {
  const src = driveId(url) ? driveOriginal(url) : url;
  let dataUrl = null;
  if (window.electronAPI?.fetchImage) {
    const { base64, contentType } = await window.electronAPI.fetchImage(src);
    if ((contentType || '').includes('pdf') || base64.startsWith('JVBERi')) {
      throw new Error('Thiết kế là PDF — chưa hỗ trợ phân tích');
    }
    dataUrl = `data:${contentType};base64,${base64}`;
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const t = setTimeout(() => reject(new Error('Tải ảnh quá lâu')), LOAD_TIMEOUT_MS);
    img.onload = () => { clearTimeout(t); resolve(img); };
    img.onerror = () => { clearTimeout(t); reject(new Error('Không tải được ảnh')); };
    img.src = dataUrl || src;
  });
}

function pixelsOf(img, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

/**
 * Analyse one Sticker Sheet design.
 * Returns { sticker_count, phash, boxes, mode, width, height }.
 */
export async function analyzeDesignUrl(url) {
  const img = await loadDesign(url);
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const s = ANALYZE_LONG_SIDE / Math.max(iw, ih);
  const W = Math.max(1, Math.round(iw * s));
  const H = Math.max(1, Math.round(ih * s));
  const { count, boxes, mode } = countStickers(pixelsOf(img, W, H), W, H);
  const phash = dhash256((w, h) => pixelsOf(img, w, h));
  return { sticker_count: count, phash, boxes, mode, width: iw, height: ih };
}
