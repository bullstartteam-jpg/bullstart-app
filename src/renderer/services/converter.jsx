import bwipjs from 'bwip-js';
import api from './api';
import { driveThumb, driveId } from '../utils/drive';

let intervalId = null;
const POLL_MS = 60_000;

const state = {
  enabled: false,
  running: false,
  paused: false,
  lastTickAt: null,
  nextTickAt: null,
  pendingCount: 0,
  pending: [], // [{ order_item_id, system_id, key, value }]
  processedTotal: 0,
  errorTotal: 0,
  log: [], // [{ ts, level, system_id, key, message }]
};
const listeners = new Set();

export function subscribeConverter(fn) {
  listeners.add(fn);
  fn(snapshot());
  return () => listeners.delete(fn);
}

export function getConverterState() {
  return snapshot();
}

function snapshot() {
  return { ...state, log: state.log.slice(0, 200), pending: state.pending.slice(0, 200) };
}

function emit() {
  const s = snapshot();
  listeners.forEach((fn) => { try { fn(s); } catch { /* noop */ } });
}

function pushLog(level, system_id, key, message) {
  state.log.unshift({ ts: Date.now(), level, system_id, key, message });
  if (state.log.length > 200) state.log.length = 200;
}

export function startConverter() {
  state.enabled = true;
  if (!intervalId) {
    intervalId = setInterval(() => { if (!state.paused) tick(); }, POLL_MS);
  }
  state.nextTickAt = Date.now() + 1500;
  emit();
  setTimeout(() => { if (!state.paused) tick(); }, 1500);
}

export function stopConverter() {
  state.enabled = false;
  state.paused = false;
  state.running = false;
  state.nextTickAt = null;
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
  emit();
}

export function pauseConverter() { state.paused = true; emit(); }
export function resumeConverter() {
  if (!state.enabled) return;
  state.paused = false;
  emit();
  if (!state.running) tick();
}

export function runNow() {
  if (!state.enabled || state.running) return;
  tick();
}

async function tick() {
  if (state.running) return;
  state.running = true;
  state.lastTickAt = Date.now();
  emit();
  try {
    const res = await api.get('/conversion/pending');
    const items = res.data || [];
    state.pending = items.flatMap(it =>
      it.pending.map(p => ({
        order_item_id: it.order_item_id,
        system_id: it.system_id,
        accessory_summary: it.accessory_summary || '',
        target_key: p.target_key,
        source_key: p.source_key,
        index: p.index,
        total: p.total,
        value: p.source_value,
      }))
    );
    state.pendingCount = state.pending.length;
    emit();

    for (const item of items) {
      if (state.paused || !state.enabled) break;
      for (const meta of item.pending) {
        if (state.paused || !state.enabled) break;
        try {
          pushLog('info', item.system_id, meta.target_key, `Starting (${meta.index}/${meta.total})…`);
          emit();
          await processOne(item, meta);
          state.processedTotal += 1;
          pushLog('ok', item.system_id, meta.target_key, `Uploaded ${meta.index}/${meta.total}`);
          state.pending = state.pending.filter(p => !(p.order_item_id === item.order_item_id && p.target_key === meta.target_key));
          state.pendingCount = state.pending.length;
          emit();
        } catch (err) {
          state.errorTotal += 1;
          pushLog('error', item.system_id, meta.target_key, err?.message || String(err));
          emit();
          console.warn('[converter] failed', item.system_id, meta.target_key, err);
        }
      }
    }
  } catch (err) {
    if (err?.response?.status === 403) {
      pushLog('error', null, null, 'Convert mode disabled by server (403). Stopping.');
      stopConverter();
      return;
    }
    pushLog('error', null, null, err?.message || 'Poll error');
    console.warn('[converter] poll error', err);
  } finally {
    state.running = false;
    state.nextTickAt = state.enabled && !state.paused ? Date.now() + POLL_MS : null;
    emit();
  }
}

async function processOne(item, meta) {
  const blob = await composeImage(
    meta.source_value,
    item.system_id,
    item.accessory_summary || ''
  );
  const formData = new FormData();
  formData.append('key', meta.target_key);
  formData.append('image', blob, `${item.system_id}_${meta.target_key}.png`);
  await api.post(`/conversion/${item.order_item_id}/qr-meta`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

/**
 * Render a Code 128 1D barcode into a fresh canvas. Encodes only the short
 * system_id (e.g. "PS_C115"). Background is transparent so the bars sit on
 * the design without an opaque rectangle.
 */
function generateBarcodeCanvas(value) {
  const c = document.createElement('canvas');
  bwipjs.toCanvas(c, {
    bcid: 'code128',
    text: value,
    scale: 3,
    height: 14,         // mm — taller bars are easier to scan
    includetext: false,
    paddingwidth: 0,
    paddingheight: 0,
    // No backgroundcolor → transparent gaps between bars.
  });
  return c;
}

/**
 * Compose the QR/barcode-overlaid image. We no longer add a footer below the
 * source — the small PDF417 barcode + a single text label sit directly on the
 * design at the bottom-left corner, on top of a small white panel for
 * scanning reliability.
 */
async function composeImage(sourceUrl, systemId, accessorySummary = '') {
  const id = driveId(sourceUrl);
  // Drive thumbnails are capped at the requested width; w3230 covers the full
  // 3030/3130-px native designs at 300 DPI (10.1×7.1 in landscape) without
  // downsampling. Direct (non-Drive) URLs are fetched at native resolution.
  const fetchUrl = id ? driveThumb(sourceUrl, 'w3230') : sourceUrl;

  const sourceImg = await loadImage(fetchUrl);
  const sourceW = sourceImg.naturalWidth || sourceImg.width;
  const sourceH = sourceImg.naturalHeight || sourceImg.height;

  // _qr output must always be landscape (width >= height). If the source is
  // portrait (e.g. a 2130×3030 design), rotate it 90° counter-clockwise so the
  // printed _qr is landscape with the original "top edge" of the design on the right.
  const isPortraitSource = sourceW < sourceH;
  const aspect = sourceW / Math.max(1, sourceH);

  // Final canvas is always 3000×2100 — slightly smaller than the standard
  // 3030×2130 design so labels print with built-in inner margin. The source
  // image (rotated if portrait) is scaled to fill this target before the
  // barcode/text overlay is drawn on top.
  const TARGET_W = 3000;
  const TARGET_H = 2100;
  console.log('[converter] composeImage', { systemId, sourceW, sourceH, aspect: aspect.toFixed(4), isPortraitSource, target: `${TARGET_W}x${TARGET_H}` });

  const canvas = document.createElement('canvas');
  canvas.width = TARGET_W;
  canvas.height = TARGET_H;
  const ctx = canvas.getContext('2d');

  // 1. Draw source scaled to fill the 3175×2175 canvas. If portrait, rotate
  //    90° CCW around the canvas centre — after rotation the image's original
  //    width maps to TARGET_H and height to TARGET_W, so we hand drawImage the
  //    swapped dimensions.
  if (isPortraitSource) {
    ctx.save();
    ctx.translate(TARGET_W / 2, TARGET_H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(sourceImg, -TARGET_H / 2, -TARGET_W / 2, TARGET_H, TARGET_W);
    ctx.restore();
  } else {
    ctx.drawImage(sourceImg, 0, 0, TARGET_W, TARGET_H);
  }

  // 2. Build content. Code 128 1D barcode encodes only the short system_id.
  //    The accessory summary lives in the human-readable text label above.
  const codeText = accessorySummary ? `${systemId}-${accessorySummary}` : systemId;
  const barcodeCanvas = generateBarcodeCanvas(systemId);

  // 3. Overlay layout — bottom-left corner.
  const MARGIN_X = 190; // 60 base + 130 horizontal inset
  const MARGIN_Y = 60;  // bottom margin unchanged
  const PANEL_PAD = 10;
  const TEXT_H = 22;
  const TEXT_TO_BAR = 6;
  const BARCODE_W = 350;
  const BARCODE_H = 130;

  // Measure text width so the panel always fits both the label and the barcode.
  ctx.font = 'bold 18px sans-serif';
  const textW = Math.ceil(ctx.measureText(codeText).width);

  const innerW = Math.max(BARCODE_W, textW);
  const panelW = innerW + PANEL_PAD * 2;
  const panelH = TEXT_H + TEXT_TO_BAR + BARCODE_H + PANEL_PAD * 2;
  const panelX = MARGIN_X;
  // Use the (possibly rotated) canvas height so the overlay always sits at the
  // bottom-left of the printed orientation.
  const panelY = canvas.height - MARGIN_Y - panelH;

  // No background panel — the barcode and label are drawn directly onto the
  // design with transparent gaps so the artwork below shows through.

  // Text label above the barcode.
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(codeText, panelX + PANEL_PAD, panelY + PANEL_PAD);

  // Barcode below the label, left-aligned within the layout slot.
  ctx.drawImage(
    barcodeCanvas,
    panelX + PANEL_PAD,
    panelY + PANEL_PAD + TEXT_H + TEXT_TO_BAR,
    BARCODE_W,
    BARCODE_H
  );

  console.log('[converter] composeImage output canvas', { systemId, canvasW: canvas.width, canvasH: canvas.height });
  const rawBlob = await canvasToBlob(canvas, 'image/png');
  return await setPngDpi(rawBlob, 300);
}

function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob returned null'))),
      type
    );
  });
}

// Inject a pHYs chunk into a PNG blob so it advertises 300 DPI metadata. The
// raster pixels are unchanged — this only fixes how viewers (Drive, Photoshop,
// printers honoring the chunk) report the resolution.
async function setPngDpi(blob, dpi = 300) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  // PNG signature (8 bytes) + IHDR chunk header. We insert pHYs right after
  // IHDR — that's the spec-compliant location.
  const SIG_LEN = 8;
  // IHDR: 4 length + 4 type + 13 data + 4 CRC = 25 bytes
  const IHDR_END = SIG_LEN + 25;

  // Strip any existing pHYs chunk to avoid duplicates.
  const stripped = stripPhysChunk(buf);

  const ppm = Math.round(dpi / 0.0254); // pixels per meter
  const phys = new Uint8Array(4 + 4 + 9 + 4);
  // length (9)
  phys[0] = 0; phys[1] = 0; phys[2] = 0; phys[3] = 9;
  // type "pHYs"
  phys[4] = 0x70; phys[5] = 0x48; phys[6] = 0x59; phys[7] = 0x73;
  // data: ppmX (4), ppmY (4), unit (1=meter)
  const dv = new DataView(phys.buffer);
  dv.setUint32(8, ppm, false);
  dv.setUint32(12, ppm, false);
  phys[16] = 1;
  // CRC over type + data
  const crc = crc32(phys.subarray(4, 17));
  dv.setUint32(17, crc, false);

  const out = new Uint8Array(stripped.length + phys.length);
  out.set(stripped.subarray(0, IHDR_END), 0);
  out.set(phys, IHDR_END);
  out.set(stripped.subarray(IHDR_END), IHDR_END + phys.length);
  return new Blob([out], { type: 'image/png' });
}

function stripPhysChunk(buf) {
  let i = 8;
  while (i < buf.length) {
    const len = (buf[i] << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3];
    const type = String.fromCharCode(buf[i + 4], buf[i + 5], buf[i + 6], buf[i + 7]);
    const total = 4 + 4 + len + 4;
    if (type === 'pHYs') {
      const out = new Uint8Array(buf.length - total);
      out.set(buf.subarray(0, i), 0);
      out.set(buf.subarray(i + total), i);
      return out;
    }
    if (type === 'IEND') break;
    i += total;
  }
  return buf;
}

// Standard PNG CRC32 (poly 0xEDB88320). Cached table.
let _crcTable = null;
function crc32(bytes) {
  if (!_crcTable) {
    _crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      _crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = (_crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Load an image either via direct <img> (works for non-tainted CORS-friendly URLs)
// or by routing through the main process to bypass renderer CORS for Drive etc.
async function loadImage(url) {
  // Always use IPC fetch to avoid tainted canvas issues from cross-origin sources.
  if (window.electronAPI?.fetchImage) {
    try {
      const { base64, contentType } = await window.electronAPI.fetchImage(url);
      const dataUrl = `data:${contentType};base64,${base64}`;
      return await loadFromSrc(dataUrl);
    } catch (err) {
      console.warn('[converter] IPC fetch failed, falling back to direct img', err);
    }
  }
  return loadFromSrc(url);
}

function loadFromSrc(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error('Image load failed: ' + (e?.message || src)));
    img.src = src;
  });
}
