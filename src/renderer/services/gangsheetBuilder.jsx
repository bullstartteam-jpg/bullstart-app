import { PDFDocument } from 'pdf-lib';

// Pixel-only layout. Build each gangsheet page as a raster canvas, then embed
// the canvas as a single PNG into the PDF page. No PDF point math — design is
// placed by absolute pixel coordinates inside a fixed 3300×2550 canvas.
const DPI = 300;
const PT_PER_IN = 72;

// Page canvas size (Letter landscape @ 300 DPI).
const CANVAS_W = 3300;
const CANVAS_H = 2550;

// Design footprint within the canvas (matches converter.composeImage output).
const DESIGN_W = 3000;
const DESIGN_H = 2100;

// Horizontal centered, top fixed at 150 px so the design sits closer to the
// upper edge with a wider bottom margin for trimming / printer feed.
const DESIGN_X = (CANVAS_W - DESIGN_W) / 2;   // 150
const DESIGN_Y = 150;                         // 0.5 in from top

// PDF page size in points (= canvas size at 300 DPI). 11 × 8.5 in landscape.
const PAGE_W_PT = (CANVAS_W / DPI) * PT_PER_IN;   // 792
const PAGE_H_PT = (CANVAS_H / DPI) * PT_PER_IN;   // 612

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

export function gangsheetFilename({ linePrefix, firstSid, lastSid, ordersCount, metasCount, date }) {
  const prefix = linePrefix || 'GANGSHEET';
  const day = date || shortDate();
  return `${prefix}_${firstSid}-${lastSid}_${ordersCount}_${metasCount}_${day}.pdf`;
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
export async function buildGangsheetForChunk(orders, { onProgress, linePrefix, includeProduced = false } = {}) {
  if (!orders.length) throw new Error('Empty chunk');

  const records = flattenQrMetas(orders, { includeProduced });
  if (!records.length) throw new Error('No _qr metas in this chunk');

  const pdf = await PDFDocument.create();
  const total = records.length;
  let done = 0;

  // For filename — system_ids of first/last orders that actually contributed.
  const orderIdsUsed = [];
  const metaIdsUsed = [];
  const seenOrders = new Set();

  // Reuse one canvas across all pages — fast, predictable memory.
  const sheetCanvas = document.createElement('canvas');
  sheetCanvas.width = CANVAS_W;
  sheetCanvas.height = CANVAS_H;
  const sheetCtx = sheetCanvas.getContext('2d');

  for (const rec of records) {
    const bytes = await fetchImageBytes(rec.meta.value);
    const img = await loadImageFromBytes(bytes);

    // 1. Reset canvas to white.
    sheetCtx.fillStyle = '#ffffff';
    sheetCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // 2. Draw the _qr design centered on the canvas.
    sheetCtx.drawImage(img, DESIGN_X, DESIGN_Y, DESIGN_W, DESIGN_H);

    // 3. Snapshot the canvas as a single PNG, embed into PDF as a full page.
    const blob = await canvasToBlob(sheetCanvas, 'image/png');
    const pngBytes = new Uint8Array(await blob.arrayBuffer());
    const pageImg = await pdf.embedPng(pngBytes);
    const page = pdf.addPage([PAGE_W_PT, PAGE_H_PT]);
    page.drawImage(pageImg, { x: 0, y: 0, width: PAGE_W_PT, height: PAGE_H_PT });

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
