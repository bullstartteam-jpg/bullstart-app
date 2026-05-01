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
 * Render a Code 128 1D barcode into a fresh canvas. We only encode the
 * short system_id (e.g. "GC123") — the longer accessory summary stays as the
 * human-readable text label above the bars. With ~5-10 chars Code 128 fits
 * in a very narrow strip.
 */
function generateBarcodeCanvas(value) {
  const c = document.createElement('canvas');
  bwipjs.toCanvas(c, {
    bcid: 'code128',
    text: value,
    scale: 3,
    height: 14,         // mm — taller bars are easier to scan
    includetext: false, // we render our own label
    paddingwidth: 0,
    paddingheight: 0,
    backgroundcolor: 'FFFFFF',
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
  const fetchUrl = id ? driveThumb(sourceUrl, 'w1600') : sourceUrl;

  const sourceImg = await loadImage(fetchUrl);
  const sourceW = sourceImg.naturalWidth || sourceImg.width;
  const sourceH = sourceImg.naturalHeight || sourceImg.height;

  // _qr output must always be landscape (width >= height). If the source is
  // portrait (e.g. a 2130×3030 design), rotate it 90° counter-clockwise so the
  // printed _qr is landscape with the original "top edge" of the design on the right.
  const isPortraitSource = sourceW < sourceH;
  const aspect = sourceW / Math.max(1, sourceH);
  console.log('[converter] composeImage', { systemId, sourceW, sourceH, aspect: aspect.toFixed(4), isPortraitSource });

  const canvas = document.createElement('canvas');
  if (isPortraitSource) {
    canvas.width = sourceH;   // landscape width = original height
    canvas.height = sourceW;  // landscape height = original width
  } else {
    canvas.width = sourceW;
    canvas.height = sourceH;
  }
  const ctx = canvas.getContext('2d');

  // 1. Source design fills the canvas (rotated 90° CCW for portrait sources).
  if (isPortraitSource) {
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(sourceImg, -sourceW / 2, -sourceH / 2);
    ctx.restore();
  } else {
    ctx.drawImage(sourceImg, 0, 0);
  }

  // 2. Build content. Barcode encodes ONLY the short system_id so the bars
  //    stay narrow even with a 1D format. The accessory summary lives in
  //    the human-readable label above.
  const codeText = accessorySummary ? `${systemId}-${accessorySummary}` : systemId;
  const barcodeCanvas = generateBarcodeCanvas(systemId);

  // 3. Overlay layout — bottom-left corner, with extra inset (+30 right, +30 up).
  const MARGIN = 60;
  const PANEL_PAD = 10;
  const TEXT_H = 22;
  const TEXT_TO_BAR = 6;
  const BARCODE_W = 200;
  const BARCODE_H = 50;

  // Measure text width so the panel always fits both the label and the barcode.
  ctx.font = 'bold 18px sans-serif';
  const textW = Math.ceil(ctx.measureText(codeText).width);

  const innerW = Math.max(BARCODE_W, textW);
  const panelW = innerW + PANEL_PAD * 2;
  const panelH = TEXT_H + TEXT_TO_BAR + BARCODE_H + PANEL_PAD * 2;
  const panelX = MARGIN;
  // Use the (possibly rotated) canvas height so the panel always sits at the
  // bottom-left of the printed orientation.
  const panelY = canvas.height - MARGIN - panelH;

  // 3a. White panel background — keeps the barcode scannable on busy designs.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(panelX, panelY, panelW, panelH);

  // 3b. Code label above the barcode.
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(codeText, panelX + PANEL_PAD, panelY + PANEL_PAD);

  // 3c. Barcode below the label, left-aligned within the panel.
  ctx.drawImage(
    barcodeCanvas,
    panelX + PANEL_PAD,
    panelY + PANEL_PAD + TEXT_H + TEXT_TO_BAR,
    BARCODE_W,
    BARCODE_H
  );

  console.log('[converter] composeImage output canvas', { systemId, canvasW: canvas.width, canvasH: canvas.height });
  return await canvasToBlob(canvas, 'image/png');
}

function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob returned null'))),
      type
    );
  });
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
