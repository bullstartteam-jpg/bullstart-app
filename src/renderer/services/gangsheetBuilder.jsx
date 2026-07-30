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

// Registration-mark sizes (px @300dpi), editable + saved per machine. Defaults
// from the MARK_* constants above. gap = khoảng hở mép design → mark.
export function getGangMarks() {
  const d = { gap: MARK_GAP, arm: MARK_ARM, thick: MARK_THICK, tick: CENTER_TICK };
  try {
    const v = JSON.parse(localStorage.getItem('gangsheet_marks') || '{}');
    const num = (x, dv) => (Number.isFinite(+x) && +x >= 0 ? +x : dv);
    return { gap: num(v.gap, d.gap), arm: num(v.arm, d.arm), thick: num(v.thick, d.thick), tick: num(v.tick, d.tick) };
  } catch { return d; }
}
export function setGangMarks(m) {
  try { localStorage.setItem('gangsheet_marks', JSON.stringify(m)); } catch { /* noop */ }
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

// Lazy-loaded pdfjs (same pattern as converter.jsx) — only pulled in when a
// gang built earlier has to be rasterised back into PNG pages.
let _pdfjsPromise = null;
function getPdfjs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return _pdfjsPromise;
}

/**
 * Rasterise a gang PDF that already exists on B2 into one PNG blob per page —
 * used by the Manage tab to add PNG exports to gangs built before the feature.
 * The pages were embedded 1:1 from 300dpi PNGs, so rendering at 300/72 gives
 * back the exact original pixel size.
 */
export async function rasterizeGangPdf(url, { onProgress } = {}) {
  const pdfjs = await getPdfjs();
  const data = await fetchImageBytes(url);
  const doc = await pdfjs.getDocument({ data }).promise;
  const blobs = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: DPI / PT_PER_IN });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    blobs.push(await canvasToBlob(canvas, 'image/png'));
    onProgress?.({ done: i, total: doc.numPages });
  }
  return blobs;
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
function drawAlignmentMarks(ctx, L, m) {
  ctx.save();
  ctx.fillStyle = '#000000';

  const gap = m.gap, arm = m.arm, thick = m.thick, tick = m.tick;
  const dx1 = L.DESIGN_X;
  const dy1 = L.DESIGN_Y;
  const dx2 = L.DESIGN_X + DESIGN_W;
  const dy2 = L.DESIGN_Y + DESIGN_H;
  const cx = (dx1 + dx2) / 2;

  // Place the inner corner of the L at (ix, iy), arms extending in (sx, sy)
  // (each ±1) AWAY from the design. Thickness extends INTO the corner (toward
  // the design) so the L-elbow visually points at the design corner.
  const drawCornerL = (ix, iy, sx, sy) => {
    const hx = sx > 0 ? ix : ix - arm;
    const hy = sy > 0 ? iy - thick : iy;
    ctx.fillRect(hx, hy, arm, thick);
    const vx = sx > 0 ? ix - thick : ix;
    const vy = sy > 0 ? iy : iy - arm;
    ctx.fillRect(vx, vy, thick, arm);
  };

  // 4 corners — inner corner sits diagonally outside each design corner.
  drawCornerL(dx1 - gap, dy1 - gap, -1, -1); // top-left
  drawCornerL(dx2 + gap, dy1 - gap, +1, -1); // top-right
  drawCornerL(dx1 - gap, dy2 + gap, -1, +1); // bottom-left
  drawCornerL(dx2 + gap, dy2 + gap, +1, +1); // bottom-right

  // Center ticks at the horizontal mid-point, above top + below bottom edge.
  if (tick > 0) {
    ctx.fillRect(cx - thick / 2, dy1 - gap - tick, thick, tick);
    ctx.fillRect(cx - thick / 2, dy2 + gap, thick, tick);
  }

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
export async function buildGangsheetForChunk(orders, { onProgress, linePrefix, includeProduced = false, nameSuffix = '', seq = 0, pageFormat = 'letter', collectPages = false } = {}) {
  if (!orders.length) throw new Error('Empty chunk');

  const records = flattenQrMetas(orders, { includeProduced });
  if (!records.length) throw new Error('No _qr metas in this chunk');

  // 'native' = each page is the design's OWN pixel size (no fixed sheet, no
  // margin, no registration marks, no gap) — used for greeting card 5x5, whose
  // converted _qr is 3300×1650 (11×5.5"). Every other format uses a fixed
  // centered-design sheet.
  const native = pageFormat === 'native';
  const L = native ? null : pageLayout(pageFormat);   // page size + centered design box
  const marks = getGangMarks();       // editable registration-mark sizes

  const pdf = await PDFDocument.create();
  const total = records.length;
  let done = 0;

  // Every page as its own PNG blob, in page order — only kept when the caller
  // asks for it (PNG export), since a big gang would otherwise hold every page
  // in memory for nothing.
  const pageBlobs = [];

  // For filename — system_ids of first/last orders that actually contributed.
  const orderIdsUsed = [];
  const metaIdsUsed = [];
  const seenOrders = new Set();

  // Reuse one canvas across all pages (fixed formats). Native re-sizes per page.
  let sheetCanvas = null, sheetCtx = null;
  if (!native) {
    sheetCanvas = document.createElement('canvas');
    sheetCanvas.width = L.CANVAS_W;
    sheetCanvas.height = L.CANVAS_H;
    sheetCtx = sheetCanvas.getContext('2d');
  }

  for (const rec of records) {
    const bytes = await fetchImageBytes(rec.meta.value);
    const img = await loadImageFromBytes(bytes);

    if (native) {
      // Page = the design's own size; draw 1:1 on a white backing, no marks/gap.
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const cx = c.getContext('2d');
      cx.fillStyle = '#ffffff';
      cx.fillRect(0, 0, w, h);
      cx.drawImage(img, 0, 0, w, h);

      const blob = await canvasToBlob(c, 'image/png');
      if (collectPages) pageBlobs.push(blob);
      const pngBytes = new Uint8Array(await blob.arrayBuffer());
      const pageImg = await pdf.embedPng(pngBytes);
      const pw = (w / DPI) * PT_PER_IN;
      const ph = (h / DPI) * PT_PER_IN;
      const page = pdf.addPage([pw, ph]);
      page.drawImage(pageImg, { x: 0, y: 0, width: pw, height: ph });
    } else {
      // 1. Reset canvas to white.
      sheetCtx.fillStyle = '#ffffff';
      sheetCtx.fillRect(0, 0, L.CANVAS_W, L.CANVAS_H);

      // 2. Draw the _qr design centered on the canvas.
      sheetCtx.drawImage(img, L.DESIGN_X, L.DESIGN_Y, DESIGN_W, DESIGN_H);

      // 2b. Registration marks in the surrounding margin — only when the page is
      //     larger than the design (Letter/A4). 'original' (page = design) has no
      //     margin, so marks are skipped.
      if (L.marks) drawAlignmentMarks(sheetCtx, L, marks);

      // 3. Snapshot the canvas as a single PNG, embed into PDF as a full page.
      const blob = await canvasToBlob(sheetCanvas, 'image/png');
      if (collectPages) pageBlobs.push(blob);
      const pngBytes = new Uint8Array(await blob.arrayBuffer());
      const pageImg = await pdf.embedPng(pngBytes);
      const page = pdf.addPage([L.PAGE_W_PT, L.PAGE_H_PT]);
      page.drawImage(pageImg, { x: 0, y: 0, width: L.PAGE_W_PT, height: L.PAGE_H_PT });
    }

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
    pageBlobs,
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

// ---------------------------------------------------------------------------
// Tiled gangsheet (card skin) — reproduces the printer's sample sheet exactly.
//
// One Letter page holds 3 designs, each printed TWICE: the original carries the
// QR/info band, the copy right below it is the bare design (no QR, no text).
//
//   ┌──────────────────────────────┐   left column  = 2 designs × 2 = 4 cards,
//   │ [qr]▭ design A      qr       │                  landscape
//   │     ▭ copy   A     ┌───┐     │   right column = 1 design  × 2 = 2 cards,
//   │ [qr]▭ design B     │ C │     │                  the SAME composed image
//   │     ▭ copy   B     └───┘     │                  rotated 90° CW, so the
//   │                    ┌───┐     │                  original's band lands on
//   │                    │ C │     │                  top instead of the left
//   └──────────────────────────────┘
//
// ALIGNMENT: the grid is keyed to the CARD rectangle only — a fixed CR80 die
// (3.375 × 2.125" @300dpi, measured off the sample). The QR/info band is NOT
// part of the cell; it hangs into a reserved gutter beside the card, scaled by
// the design's own scale factor. So a source whose band/design proportion
// differs can never shift or resize the card. Used for convert layout 'outside'.
// ---------------------------------------------------------------------------
const PAGE_W = 2550;   // Letter 8.5" @300dpi (portrait)
const PAGE_H = 3300;   // 11"
const CARD_W = 1013;   // 3.375" — CR80 die width  (measured off the sample sheet)
const CARD_H = 638;    // 2.125" — CR80 die height
const BAND_RESERVE = 200;   // gutter beside the card that the info band hangs in
const LEFT_DESIGNS = 2;     // landscape designs stacked in the left column
const RIGHT_DESIGNS = 1;    // portrait (rotated) designs in the right column
const COPIES = 2;           // prints per design: 1 original + 1 copy
// Fixed gaps (px @300dpi), all measured card-edge to card-edge. Each column is
// then centred on the page with whatever is left over — the gaps are the spec,
// the margins are the slack.
const GAP_Y_LEFT = 50;      // between the 4 landscape cards
const GAP_X_COLS = 100;     // landscape card's right edge → portrait card's left edge
const GAP_Y_RIGHT = 50;     // blank between the 2 portrait cards (band not counted)

/**
 * @param opts.cardWpx/cardHpx  CARD cell size in px @300dpi — the die itself,
 *                         band excluded (default 1013 × 638 = 3.375 × 2.125").
 * @param opts.bandPx      width of the barcode/info band in the SOURCE _qr
 *                         image (default 200px = CARD_SKIN_BAND_W), sliced off
 *                         so the design alone drives the card size.
 * @param opts.bandReservePx  gutter reserved for the band next to the card
 *                         (default 200px @300dpi ≈ 0.667").
 * @param opts.gapYLeft/gapXCols/gapYRight  fixed gaps in px @300dpi between the
 *                         landscape cards / the two columns / the portrait cards.
 */
export async function buildTiledGangsheet(orders, {
  onProgress, linePrefix, includeProduced = false, nameSuffix = '', seq = 0,
  cardWpx = CARD_W, cardHpx = CARD_H, bandPx = 200,
  bandReservePx = BAND_RESERVE,
  gapYLeft = GAP_Y_LEFT, gapXCols = GAP_X_COLS, gapYRight = GAP_Y_RIGHT,
  collectPages = false,
} = {}) {
  if (!orders.length) throw new Error('Empty chunk');
  const records = flattenQrMetas(orders, { includeProduced });
  if (!records.length) throw new Error('No _qr metas in this chunk');

  const perPage = LEFT_DESIGNS + RIGHT_DESIGNS;   // 3 designs per page
  // Columns, measured on the CARDS. The left column reserves an extra
  // `bandReservePx` gutter that only the band lives in; the right column is the
  // same card rotated, so it is cardHpx wide and reserves its gutter on top.
  //   [margin][band][ CARD ][gapXCols][ card ][margin]
  const colLeftW = bandReservePx + cardWpx;
  const colRightW = cardHpx;
  const marginX = Math.max(0, Math.round((PAGE_W - (colLeftW + gapXCols + colRightW)) / 2));
  const xLeftCard = marginX + bandReservePx;           // card x, NOT band x
  const xRightCard = marginX + colLeftW + gapXCols;
  // Fixed gaps, each column centred vertically on whatever slack is left.
  const leftRows = LEFT_DESIGNS * COPIES;             // 4
  const rightRows = RIGHT_DESIGNS * COPIES;           // 2
  const leftBlockH = leftRows * cardHpx + (leftRows - 1) * gapYLeft;
  const leftTop = Math.max(0, Math.round((PAGE_H - leftBlockH) / 2));
  const rightCellH = bandReservePx + cardWpx;         // band on top + rotated card
  const rightBlockH = rightRows * rightCellH + (rightRows - 1) * gapYRight;
  const rightTop = Math.max(0, Math.round((PAGE_H - rightBlockH) / 2));
  // Slot → card top-left. Left slots run 0..3 top-down, right slots 0..1.
  const leftSlotY = (i) => leftTop + i * (cardHpx + gapYLeft);
  const rightSlotY = (i) => rightTop + i * (rightCellH + gapYRight) + bandReservePx;

  const pdf = await PDFDocument.create();
  const total = records.length;
  let done = 0;
  const orderIdsUsed = [];
  const metaIdsUsed = [];
  const seenOrders = new Set();
  // Per-page PNGs, kept only for the PNG export (see buildGangsheetForChunk).
  const pageBlobs = [];

  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const pageWpt = (PAGE_W / DPI) * PT_PER_IN;
  const pageHpt = (PAGE_H / DPI) * PT_PER_IN;

  // The working canvas stays TRANSPARENT: card skins print on clear film, and
  // the composed _qr sources carry their own alpha (composeCardSkinOutside lays
  // down no white backing). The exported PNG keeps that alpha; the PDF page
  // gets a white backing composited underneath, so it still reads correctly on
  // screen and on paper.
  const flushPage = async () => {
    if (collectPages) pageBlobs.push(await canvasToBlob(canvas, 'image/png'));

    const flat = document.createElement('canvas');
    flat.width = PAGE_W;
    flat.height = PAGE_H;
    const fctx = flat.getContext('2d');
    fctx.fillStyle = '#ffffff';
    fctx.fillRect(0, 0, PAGE_W, PAGE_H);
    fctx.drawImage(canvas, 0, 0);

    const blob = await canvasToBlob(flat, 'image/png');
    const pngBytes = new Uint8Array(await blob.arrayBuffer());
    const pageImg = await pdf.embedPng(pngBytes);
    const page = pdf.addPage([pageWpt, pageHpt]);
    page.drawImage(pageImg, { x: 0, y: 0, width: pageWpt, height: pageHpt });
  };

  let slot = 0;
  const resetCanvas = () => { ctx.clearRect(0, 0, PAGE_W, PAGE_H); };
  resetCanvas();

  /**
   * Draw one print of a composed _qr. (cardX, cardY) is the top-left of the CARD
   * itself; the band hangs outside it. `rotated` turns the whole thing 90° CW,
   * which puts the (left) band on top and makes the card portrait — the right
   * column of the sample sheet.
   */
  const placeCard = (img, srcBand, srcDesignW, bandW, bandH, cardX, cardY, rotated, withBand) => {
    ctx.save();
    if (rotated) {
      // After this transform the local axes are the landscape card's own: local
      // (0,0)-(cardWpx,cardHpx) lands on screen as a cardHpx × cardWpx portrait
      // box whose top edge is the design's left edge.
      ctx.translate(cardX + cardHpx, cardY);
      ctx.rotate(Math.PI / 2);
    } else {
      ctx.translate(cardX, cardY);
    }
    // Design → the fixed card cell (exact die size regardless of source res).
    ctx.drawImage(img, srcBand, 0, srcDesignW, img.height, 0, 0, cardWpx, cardHpx);
    // Band hung outside the cell, centred on the card's long edge — only on the
    // original. Copies print the bare design (no QR, no info text). The band
    // never participates in the alignment, so dropping it shifts nothing.
    if (withBand) {
      ctx.drawImage(
        img, 0, 0, srcBand, img.height,
        -bandW, Math.round((cardHpx - bandH) / 2), bandW, bandH,
      );
    }
    ctx.restore();
  };

  for (const rec of records) {
    const bytes = await fetchImageBytes(rec.meta.value);
    const img = await loadImageFromBytes(bytes);

    // The composed _qr source is [ band | design ]: the band is exactly the
    // first `bandPx` px (composeCardSkinOutside draws it at x=[0..bandPx]).
    const srcBand = Math.min(img.width - 1, bandPx);
    const srcDesignW = Math.max(1, img.width - srcBand);
    // Scale that maps the source DESIGN onto the fixed card cell; the band is
    // drawn at that same scale, capped to the gutter so an unusual band/design
    // proportion spills into the margin instead of off the page.
    const sc = cardWpx / srcDesignW;
    const bandSc = Math.min(sc, bandReservePx / srcBand);
    const bandW = Math.max(1, Math.round(srcBand * bandSc));
    const bandH = Math.max(1, Math.round(img.height * bandSc));

    // Slot 0..1 → left column (landscape), slot 2 → right column (rotated).
    // Every design is printed COPIES times, stacked directly below itself: the
    // first print carries the QR/info band, the rest are design-only copies.
    if (slot < LEFT_DESIGNS) {
      for (let c = 0; c < COPIES; c++) {
        placeCard(img, srcBand, srcDesignW, bandW, bandH,
          xLeftCard, leftSlotY(slot * COPIES + c), false, c === 0);
      }
    } else {
      const rightIdx = slot - LEFT_DESIGNS;
      for (let c = 0; c < COPIES; c++) {
        placeCard(img, srcBand, srcDesignW, bandW, bandH,
          xRightCard, rightSlotY(rightIdx * COPIES + c), true, c === 0);
      }
    }

    metaIdsUsed.push(rec.meta.id);
    if (!seenOrders.has(rec.order.id)) { seenOrders.add(rec.order.id); orderIdsUsed.push(rec.order.id); }
    done++;
    onProgress?.({ done, total, system_id: rec.order.system_id, key: rec.meta.key });

    slot++;
    if (slot === perPage) { await flushPage(); resetCanvas(); slot = 0; }
  }
  if (slot > 0) await flushPage();   // last partial page

  const orderedOrders = orders.filter(o => seenOrders.has(o.id));
  const firstSid = orderedOrders[0]?.system_id || '';
  const lastSid = orderedOrders[orderedOrders.length - 1]?.system_id || firstSid;

  const filename = gangsheetFilename({
    linePrefix: (linePrefix || '').toUpperCase(),
    firstSid, lastSid,
    ordersCount: orderedOrders.length,
    metasCount: metaIdsUsed.length,
    suffix: nameSuffix,
    seq,
  });

  const pdfBytes = await pdf.save();
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  return {
    blob, pageBlobs, filename, linePrefix,
    firstSid, lastSid,
    ordersInChunk: orderedOrders.length,
    metasUsed: metaIdsUsed.length,
    orderIds: orderIdsUsed,
    metaIds: metaIdsUsed,
  };
}
