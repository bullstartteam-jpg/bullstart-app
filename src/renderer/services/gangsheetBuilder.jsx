import { PDFDocument } from 'pdf-lib';

// Pixel-only layout. Build each gangsheet page as a raster canvas, then embed
// the canvas as a single PNG into the PDF page. No PDF point math — design is
// placed by absolute pixel coordinates inside a fixed 3300×2550 canvas.
const DPI = 300;
const PT_PER_IN = 72;

// Design footprint within the page (matches converter.composeImage output).
const DESIGN_W = 3000;
const DESIGN_H = 2100;
const DESIGN_TOP = 150;   // fixed top margin; horizontally centered per page.

// Registration marks drawn in the margin around the design — corner L-shapes
// pointing toward each design corner + a tick at the center of each edge.
// Used by the press operator to align the gangsheet on the printer bed.
const MARK_GAP = 30;        // px gap between design edge and mark (no overlap)
const MARK_ARM = 90;        // length of each L-arm
const MARK_THICK = 10;      // line thickness
const CENTER_TICK = 70;     // length of the per-edge center mark

// Page formats @ 300 DPI (landscape).
//   'original' = the _qr design at native 10×7" (page = design, no margin/marks)
//   'letter'   = 11×8.5" sheet with the design centered + registration marks
//                (this is the original/legacy gang format)
const PAGE_SIZES = {
  original: { w: 3000, h: 2100 },   // 10 × 7 in  (design native size)
  letter:   { w: 3300, h: 2550 },   // 11 × 8.5 in (legacy gang)
};
const PAGE_FORMATS = ['original', 'letter'];

// Per-format layout: page canvas size + design box + PDF point size. For
// 'original' the design fills the whole page (no margin → no alignment marks).
function pageLayout(format = 'original') {
  const p = PAGE_SIZES[format] || PAGE_SIZES.original;
  const fill = format === 'original';
  return {
    CANVAS_W: p.w,
    CANVAS_H: p.h,
    DESIGN_X: fill ? 0 : Math.round((p.w - DESIGN_W) / 2),
    DESIGN_Y: fill ? 0 : DESIGN_TOP,
    marks: !fill,
    PAGE_W_PT: (p.w / DPI) * PT_PER_IN,
    PAGE_H_PT: (p.h / DPI) * PT_PER_IN,
  };
}

// Per-machine gang page-format choice, set from the UI. Default 'original' (10×7).
export function getGangPageFormat() {
  try {
    const v = localStorage.getItem('gangsheet_page_format');
    return PAGE_FORMATS.includes(v) ? v : 'original';
  } catch { return 'original'; }
}
export function setGangPageFormat(fmt) {
  const v = PAGE_FORMATS.includes(fmt) ? fmt : 'original';
  try { localStorage.setItem('gangsheet_page_format', v); } catch { /* noop */ }
}

// Source side keys, in the canonical order we want them to appear in the gang sheet.
const SOURCE_KEYS = ['front', 'back', 'left', 'right', 'neck', 'special'];
// Matches "<source>_qr" or "<source>_qr_<copy>" (copy starts at 1).
const QR_KEY_RE = /^(front|back|left|right|neck|special)_qr(?:_(\d+))?$/;

export function parseQrKey(key) {
  const m = key && key.match(QR_KEY_RE);
  if (!m) return null;
  return { sourceKey: m[1], copy: m[2] ? parseInt(m[2], 10) : 1 };
}

export function isQrKey(key) {
  return QR_KEY_RE.test(key || '');
}

// MMM DD upper, e.g. "APR28".
function shortDate(d = new Date()) {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${months[d.getMonth()]}${String(d.getDate()).padStart(2, '0')}`;
}

export function gangsheetFilename({ linePrefix, firstSid, lastSid, ordersCount, metasCount, date, suffix, seq }) {
  const prefix = linePrefix || 'GANGSHEET';
  const day = date || shortDate();
  const sfx = suffix ? `_${suffix}` : '';
  // Zero-padded batch sequence (01, 02, …) so multiple gangsheets generated
  // from a single Generate click sort in chunk order on disk.
  const seqPrefix = (seq && seq > 0) ? `${String(seq).padStart(2, '0')}_` : '';
  return `${seqPrefix}${prefix}_${firstSid}-${lastSid}_${ordersCount}_${metasCount}_${day}${sfx}.pdf`;
}

/**
 * Split orders into two buckets:
 *   - twoSide: order has BOTH a front_qr AND a back_qr meta among unproduced
 *              metas (respecting `includeProduced` the same way flattenQrMetas
 *              does). These need their own gangsheet so a press operator
 *              prints both sides in one pass.
 *   - oneSide: everything else (only front, only back, or neither — left/
 *              right/neck/special-only orders go here).
 */
export function splitOrdersBySideCount(orders, { includeProduced = false } = {}) {
  const twoSide = [];
  const oneSide = [];
  for (const order of orders) {
    let hasFront = false;
    let hasBack = false;
    for (const item of order.items || []) {
      for (const m of item.metas || []) {
        if (m.production && !includeProduced) continue;
        const parsed = parseQrKey(m.key);
        if (!parsed) continue;
        if (parsed.sourceKey === 'front') hasFront = true;
        else if (parsed.sourceKey === 'back') hasBack = true;
        if (hasFront && hasBack) break;
      }
      if (hasFront && hasBack) break;
    }
    (hasFront && hasBack ? twoSide : oneSide).push(order);
  }
  return { twoSide, oneSide };
}

// Split an array into roughly even chunks of size `size`.
export function chunkArray(arr, size) {
  const n = Math.max(1, parseInt(size, 10) || 1);
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * Pull all _qr metas from a list of orders, keeping stable order:
 * order asc → item asc → key index asc. Returns a flat array of
 * { order, item, meta } records.
 *
 * By default, metas with production=true are skipped (normal Compose flow).
 * Pass { includeProduced: true } when re-ganging from the Find tab so that
 * already-produced metas get rebuilt into the new sheet too.
 */
export function flattenQrMetas(orders, { includeProduced = false } = {}) {
  const records = [];
  for (const order of orders) {
    for (const item of order.items || []) {
      const buckets = [];
      for (const m of item.metas || []) {
        const parsed = parseQrKey(m.key);
        if (!parsed) continue;
        if (m.production && !includeProduced) continue;
        buckets.push({ meta: m, ...parsed });
      }
      // Order: source key (front, back, left, right, neck, special) → copy index.
      buckets.sort((a, b) => {
        const ai = SOURCE_KEYS.indexOf(a.sourceKey);
        const bi = SOURCE_KEYS.indexOf(b.sourceKey);
        if (ai !== bi) return ai - bi;
        return a.copy - b.copy;
      });
      for (const b of buckets) records.push({ order, item, meta: b.meta });
    }
  }
  return records;
}

async function fetchImageBytes(url) {
  if (window.electronAPI?.fetchImage) {
    const { base64 } = await window.electronAPI.fetchImage(url);
    return base64ToBytes(base64);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Load an image element from raw bytes — used to draw the _qr design onto the
// canvas before re-encoding the whole sheet as a single PNG.
function loadImageFromBytes(bytes) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([bytes]);
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

/**
 * Draw corner L-marks + center ticks around the design. Each L's elbow points
 * at the design corner with a small gap, so the operator can register the
 * sheet without the marks bleeding onto the artwork. Center ticks on every
 * edge mark the mid-point of the design for symmetric alignment.
 */
function drawAlignmentMarks(ctx, L) {
  ctx.save();
  ctx.fillStyle = '#000000';

  const dx1 = L.DESIGN_X;
  const dy1 = L.DESIGN_Y;
  const dx2 = L.DESIGN_X + DESIGN_W;
  const dy2 = L.DESIGN_Y + DESIGN_H;
  const cx = (dx1 + dx2) / 2;
  const cy = (dy1 + dy2) / 2;

  // Place the inner corner of the L at (ix, iy), arms extending in (sx, sy)
  // (each ±1) AWAY from the design. Thickness extends INTO the corner (toward
  // the design) so the L-elbow visually points at the design corner.
  const drawCornerL = (ix, iy, sx, sy) => {
    // Horizontal arm: width=ARM in -sx direction, thickness=T in -sy direction
    const hx = sx > 0 ? ix : ix - MARK_ARM;
    const hy = sy > 0 ? iy - MARK_THICK : iy;
    ctx.fillRect(hx, hy, MARK_ARM, MARK_THICK);
    // Vertical arm
    const vx = sx > 0 ? ix - MARK_THICK : ix;
    const vy = sy > 0 ? iy : iy - MARK_ARM;
    ctx.fillRect(vx, vy, MARK_THICK, MARK_ARM);
  };

  // 4 corners — inner corner sits diagonally outside each design corner.
  drawCornerL(dx1 - MARK_GAP, dy1 - MARK_GAP, -1, -1); // top-left
  drawCornerL(dx2 + MARK_GAP, dy1 - MARK_GAP, +1, -1); // top-right
  drawCornerL(dx1 - MARK_GAP, dy2 + MARK_GAP, -1, +1); // bottom-left
  drawCornerL(dx2 + MARK_GAP, dy2 + MARK_GAP, +1, +1); // bottom-right

  // Center ticks marking the horizontal mid-point of the design — vertical
  // sticks above the top edge and below the bottom edge. (Left/right edge
  // ticks were intentionally dropped — operator only needs to find the
  // horizontal center for press alignment.)
  ctx.fillRect(cx - MARK_THICK / 2, dy1 - MARK_GAP - CENTER_TICK, MARK_THICK, CENTER_TICK);
  ctx.fillRect(cx - MARK_THICK / 2, dy2 + MARK_GAP, MARK_THICK, CENTER_TICK);

  ctx.restore();
}

function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob returned null'))),
      type,
    );
  });
}

/**
 * Compose one chunk into a single PDF Blob.
 *
 *   onProgress({ done, total, system_id, key }) is invoked after each page.
 *
 * Returns:
 *   { blob, filename, linePrefix, firstSid, lastSid, ordersInChunk, metasUsed,
 *     orderIds, metaIds }
 */
export async function buildGangsheetForChunk(orders, { onProgress, linePrefix, includeProduced = false, nameSuffix = '', seq = 0, pageFormat = 'letter' } = {}) {
  if (!orders.length) throw new Error('Empty chunk');

  const records = flattenQrMetas(orders, { includeProduced });
  if (!records.length) throw new Error('No _qr metas in this chunk');

  const L = pageLayout(pageFormat);   // page size + centered design box

  const pdf = await PDFDocument.create();
  const total = records.length;
  let done = 0;

  // For filename — system_ids of first/last orders that actually contributed.
  const orderIdsUsed = [];
  const metaIdsUsed = [];
  const seenOrders = new Set();

  // Reuse one canvas across all pages — fast, predictable memory.
  const sheetCanvas = document.createElement('canvas');
  sheetCanvas.width = L.CANVAS_W;
  sheetCanvas.height = L.CANVAS_H;
  const sheetCtx = sheetCanvas.getContext('2d');

  for (const rec of records) {
    const bytes = await fetchImageBytes(rec.meta.value);
    const img = await loadImageFromBytes(bytes);

    // 1. Reset canvas to white.
    sheetCtx.fillStyle = '#ffffff';
    sheetCtx.fillRect(0, 0, L.CANVAS_W, L.CANVAS_H);

    // 2. Draw the _qr design centered on the canvas.
    sheetCtx.drawImage(img, L.DESIGN_X, L.DESIGN_Y, DESIGN_W, DESIGN_H);

    // 2b. Registration marks in the surrounding margin — only when the page is
    //     larger than the design (Letter/A4). 'original' (page = design) has no
    //     margin, so marks are skipped.
    if (L.marks) drawAlignmentMarks(sheetCtx, L);

    // 3. Snapshot the canvas as a single PNG, embed into PDF as a full page.
    const blob = await canvasToBlob(sheetCanvas, 'image/png');
    const pngBytes = new Uint8Array(await blob.arrayBuffer());
    const pageImg = await pdf.embedPng(pngBytes);
    const page = pdf.addPage([L.PAGE_W_PT, L.PAGE_H_PT]);
    page.drawImage(pageImg, { x: 0, y: 0, width: L.PAGE_W_PT, height: L.PAGE_H_PT });

    metaIdsUsed.push(rec.meta.id);
    if (!seenOrders.has(rec.order.id)) {
      seenOrders.add(rec.order.id);
      orderIdsUsed.push(rec.order.id);
    }
    done++;
    onProgress?.({ done, total, system_id: rec.order.system_id, key: rec.meta.key });
  }

  const orderedOrders = orders.filter(o => seenOrders.has(o.id));
  const firstSid = orderedOrders[0]?.system_id || '';
  const lastSid = orderedOrders[orderedOrders.length - 1]?.system_id || firstSid;
  const ordersInChunk = orderedOrders.length;
  const metasUsed = metaIdsUsed.length;

  const filename = gangsheetFilename({
    linePrefix: (linePrefix || '').toUpperCase(),
    firstSid,
    lastSid,
    ordersCount: ordersInChunk,
    metasCount: metasUsed,
    suffix: nameSuffix,
    seq,
  });

  const pdfBytes = await pdf.save();
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });

  return {
    blob,
    filename,
    linePrefix,
    firstSid,
    lastSid,
    ordersInChunk,
    metasUsed,
    orderIds: orderIdsUsed,
    metaIds: metaIdsUsed,
  };
}
