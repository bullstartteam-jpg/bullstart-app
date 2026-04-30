import { PDFDocument } from 'pdf-lib';

// pdf-lib measures everything in PDF points (1 inch = 72 pt). We keep page
// + design dimensions in points and let pdf-lib retain the original raster
// data at full 300-DPI via embedPng/embedJpg.
const DPI = 300;
const PT_PER_IN = 72;
const pxToPt = (px) => (px / DPI) * PT_PER_IN;

// Page: landscape 11 × 8.5 inch  (3300 × 2550 px @ 300 DPI)
const PAGE_W = 11  * PT_PER_IN;   // 792
const PAGE_H = 8.5 * PT_PER_IN;   // 612

// Design: landscape 3030 × 2130 px @ 300 DPI → 10.1 × 7.1 inch → 727.2 × 511.2 pt
const DESIGN_W = pxToPt(3030);
const DESIGN_H = pxToPt(2130);

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

  for (const rec of records) {
    const bytes = await fetchImageBytes(rec.meta.value);
    let img;
    try {
      img = await pdf.embedPng(bytes);
    } catch {
      img = await pdf.embedJpg(bytes);
    }

    const page = pdf.addPage([PAGE_W, PAGE_H]);
    // Pin the design to the top-left corner. pdf-lib uses bottom-left origin,
    // so y = PAGE_H - DESIGN_H places the top edge of the design at the top
    // edge of the page; x = 0 puts the left edge flush with the left edge.
    const x = 0;
    const y = PAGE_H - DESIGN_H;
    page.drawImage(img, { x, y, width: DESIGN_W, height: DESIGN_H });

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
