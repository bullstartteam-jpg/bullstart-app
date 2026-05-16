import bwipjs from 'bwip-js';
import api from './api';
import { driveThumb, driveId } from '../utils/drive';

// Two independent background jobs, each with its own poll interval, state,
// log, and persisted auto flag. They share the `/conversion/pending` endpoint
// and the image composition helpers below, but otherwise run separately so
// the seller-facing Convert page (qr) and admin-only Convert Label page can
// be toggled without affecting each other.

const POLL_MS = 60_000;

function createJob({ name, storageKey, runOnce }) {
  let intervalId = null;
  const state = {
    name,
    enabled: false,
    running: false,
    paused: false,
    lastTickAt: null,
    nextTickAt: null,
    pending: [],
    pendingCount: 0,
    processedTotal: 0,
    errorTotal: 0,
    log: [],
  };
  const listeners = new Set();

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

  async function tick() {
    if (state.running) return;
    state.running = true;
    state.lastTickAt = Date.now();
    emit();
    try {
      await runOnce({ state, pushLog, emit });
    } catch (err) {
      if (err?.response?.status === 403) {
        pushLog('error', null, null, 'Convert mode disabled by server (403). Stopping.');
        stop();
        return;
      }
      pushLog('error', null, null, err?.message || 'Poll error');
      console.warn(`[${name}] poll error`, err);
    } finally {
      state.running = false;
      state.nextTickAt = state.enabled && !state.paused ? Date.now() + POLL_MS : null;
      emit();
    }
  }

  function softStop() {
    // Stop timers and reset live state without touching the persisted auto
    // flag. Used by AuthContext on logout so the next login can restore the
    // user's previous on/off choice.
    state.enabled = false;
    state.paused = false;
    state.running = false;
    state.nextTickAt = null;
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
    emit();
  }
  function start() {
    state.enabled = true;
    try { localStorage.setItem(storageKey, '1'); } catch { /* noop */ }
    if (!intervalId) {
      intervalId = setInterval(() => { if (!state.paused) tick(); }, POLL_MS);
    }
    state.nextTickAt = Date.now() + 1500;
    emit();
    setTimeout(() => { if (!state.paused) tick(); }, 1500);
  }
  function stop() {
    // User-initiated stop — also clears the persisted auto flag so the next
    // login does NOT auto-start this job.
    try { localStorage.setItem(storageKey, '0'); } catch { /* noop */ }
    softStop();
  }
  function pause() { state.paused = true; emit(); }
  function resume() {
    if (!state.enabled) return;
    state.paused = false;
    emit();
    if (!state.running) tick();
  }
  function runNow() {
    if (!state.enabled || state.running) return;
    tick();
  }
  function isAutoEnabled() {
    try { return localStorage.getItem(storageKey) === '1'; } catch { return false; }
  }
  function subscribe(fn) {
    listeners.add(fn);
    fn(snapshot());
    return () => listeners.delete(fn);
  }

  return { subscribe, start, stop, softStop, pause, resume, runNow, isAutoEnabled };
}

// ---------------- QR job (seller workflow) ----------------

const qrJob = createJob({
  name: 'qr',
  storageKey: 'converter_qr_auto',
  async runOnce({ state, pushLog, emit }) {
    const res = await api.get('/conversion/pending');
    const data = res.data || {};
    const items = Array.isArray(data) ? data : (data.items || []);

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
          console.warn('[qr] failed', item.system_id, meta.target_key, err);
        }
      }
    }
  },
});

// ---------------- Convert Label job (admin/support workflow) ----------------

const labelJob = createJob({
  name: 'label',
  storageKey: 'converter_label_auto',
  async runOnce({ state, pushLog, emit }) {
    const res = await api.get('/conversion/pending');
    const data = res.data || {};
    const labels = Array.isArray(data)
      ? []
      : (data.convert_label_pending || data.shipping_label_pending || []);

    state.pending = labels.map(l => ({ ...l }));
    state.pendingCount = state.pending.length;
    emit();

    for (const lbl of labels) {
      if (state.paused || !state.enabled) break;
      try {
        pushLog('info', lbl.system_id, 'convert_label', 'Composing convert label…');
        emit();
        await processConvertLabel(lbl);
        state.processedTotal += 1;
        pushLog('ok', lbl.system_id, 'convert_label', 'Uploaded convert label');
        state.pending = state.pending.filter(p => p.order_id !== lbl.order_id);
        state.pendingCount = state.pending.length;
        emit();
      } catch (err) {
        state.errorTotal += 1;
        pushLog('error', lbl.system_id, 'convert_label', err?.message || String(err));
        emit();
        console.warn('[label] failed', lbl.system_id, err);
      }
    }
  },
});

// ---------------- Public API ----------------

// QR job (seller _qr conversion).
export const subscribeQrConverter = qrJob.subscribe;
export const startQrConverter = qrJob.start;
export const stopQrConverter = qrJob.stop;
export const pauseQrConverter = qrJob.pause;
export const resumeQrConverter = qrJob.resume;
export const runQrNow = qrJob.runNow;
export const isQrAutoEnabled = qrJob.isAutoEnabled;

// Convert Label job (admin/support carrier-label overlay).
export const subscribeLabelConverter = labelJob.subscribe;
export const startLabelConverter = labelJob.start;
export const stopLabelConverter = labelJob.stop;
export const pauseLabelConverter = labelJob.pause;
export const resumeLabelConverter = labelJob.resume;
export const runLabelNow = labelJob.runNow;
export const isLabelAutoEnabled = labelJob.isAutoEnabled;

/**
 * Restore each job's previously-persisted auto flag. Called by AuthContext
 * after login so users see whichever jobs they had on resume automatically.
 */
export function autoStartConverters() {
  if (qrJob.isAutoEnabled()) qrJob.start();
  if (labelJob.isAutoEnabled()) labelJob.start();
}

/** Stop both jobs (called on logout). Preserves the persisted auto flags so
 *  the next login resumes whatever each was set to. */
export function stopAllConverters() {
  qrJob.softStop();
  labelJob.softStop();
}

// ---------------- Image composition + upload (shared) ----------------

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

async function processConvertLabel(lbl) {
  const blob = await composeConvertLabel(
    lbl.shipping_label,
    lbl.system_id,
    lbl.accessory_summary || ''
  );
  const formData = new FormData();
  formData.append('image', blob, `${lbl.system_id}_label.png`);
  await api.post(`/conversion/order/${lbl.order_id}/convert-label`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

/**
 * Compose a convert-label image: the carrier label with a system_id Code 128
 * barcode + "{system_id}-{accessory_summary}" text band stamped in the
 * BOTTOM-LEFT corner. Preserves the source dimensions and produces a single
 * image (no per-copy split — one convert_label per order).
 */
async function composeConvertLabel(sourceUrl, systemId, accessorySummary = '') {
  const id = driveId(sourceUrl);
  const fetchUrl = id ? driveThumb(sourceUrl, 'w1600') : sourceUrl;
  const sourceImg = await loadImage(fetchUrl);
  const sourceW = sourceImg.naturalWidth || sourceImg.width;
  const sourceH = sourceImg.naturalHeight || sourceImg.height;

  const canvas = document.createElement('canvas');
  canvas.width = sourceW;
  canvas.height = sourceH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(sourceImg, 0, 0, sourceW, sourceH);

  const codeText = accessorySummary ? `${systemId}-${accessorySummary}` : systemId;
  const fontSize = Math.max(22, Math.round(sourceW * 0.035));
  const barcodeCanvas = generateBarcodeCanvas(systemId);

  const PANEL_PAD = Math.round(fontSize * 0.45);
  const TEXT_TO_BAR = Math.round(fontSize * 0.35);
  const BARCODE_W = Math.round(sourceW * 0.30);
  const BARCODE_H = Math.round(BARCODE_W * 0.38);

  ctx.font = `bold ${fontSize}px sans-serif`;
  const textW = Math.ceil(ctx.measureText(codeText).width);
  const innerW = Math.max(BARCODE_W, textW);
  const panelW = innerW + PANEL_PAD * 2;
  const panelH = fontSize + TEXT_TO_BAR + BARCODE_H + PANEL_PAD * 2;
  const margin = Math.round(fontSize * 0.5);
  // Bottom-left anchor.
  const panelX = margin;
  const panelY = sourceH - panelH - margin;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.strokeRect(panelX, panelY, panelW, panelH);

  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(codeText, panelX + PANEL_PAD, panelY + PANEL_PAD);

  ctx.drawImage(
    barcodeCanvas,
    panelX + PANEL_PAD,
    panelY + PANEL_PAD + fontSize + TEXT_TO_BAR,
    BARCODE_W,
    BARCODE_H
  );

  const rawBlob = await canvasToBlob(canvas, 'image/png');
  return await setPngDpi(rawBlob, 300);
}

function generateBarcodeCanvas(value) {
  const c = document.createElement('canvas');
  bwipjs.toCanvas(c, {
    bcid: 'code128',
    text: value,
    scale: 3,
    height: 14,
    includetext: false,
    paddingwidth: 0,
    paddingheight: 0,
  });
  return c;
}

async function composeImage(sourceUrl, systemId, accessorySummary = '') {
  const id = driveId(sourceUrl);
  const fetchUrl = id ? driveThumb(sourceUrl, 'w3230') : sourceUrl;

  const sourceImg = await loadImage(fetchUrl);
  const sourceW = sourceImg.naturalWidth || sourceImg.width;
  const sourceH = sourceImg.naturalHeight || sourceImg.height;

  const isPortraitSource = sourceW < sourceH;
  const TARGET_W = 3000;
  const TARGET_H = 2100;

  const canvas = document.createElement('canvas');
  canvas.width = TARGET_W;
  canvas.height = TARGET_H;
  const ctx = canvas.getContext('2d');

  if (isPortraitSource) {
    ctx.save();
    ctx.translate(TARGET_W / 2, TARGET_H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(sourceImg, -TARGET_H / 2, -TARGET_W / 2, TARGET_H, TARGET_W);
    ctx.restore();
  } else {
    ctx.drawImage(sourceImg, 0, 0, TARGET_W, TARGET_H);
  }

  const codeText = accessorySummary ? `${systemId}-${accessorySummary}` : systemId;
  const barcodeCanvas = generateBarcodeCanvas(systemId);

  const MARGIN_X = 190;
  const MARGIN_Y = 60;
  const PANEL_PAD = 10;
  const TEXT_H = 22;
  const TEXT_TO_BAR = 6;
  const BARCODE_W = 350;
  const BARCODE_H = 130;

  ctx.font = 'bold 18px sans-serif';
  const textW = Math.ceil(ctx.measureText(codeText).width);

  const innerW = Math.max(BARCODE_W, textW);
  const panelW = innerW + PANEL_PAD * 2;
  const panelH = TEXT_H + TEXT_TO_BAR + BARCODE_H + PANEL_PAD * 2;
  const panelX = MARGIN_X;
  const panelY = canvas.height - MARGIN_Y - panelH;

  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(codeText, panelX + PANEL_PAD, panelY + PANEL_PAD);

  ctx.drawImage(
    barcodeCanvas,
    panelX + PANEL_PAD,
    panelY + PANEL_PAD + TEXT_H + TEXT_TO_BAR,
    BARCODE_W,
    BARCODE_H
  );

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

async function setPngDpi(blob, dpi = 300) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const SIG_LEN = 8;
  const IHDR_END = SIG_LEN + 25;

  const stripped = stripPhysChunk(buf);

  const ppm = Math.round(dpi / 0.0254);
  const phys = new Uint8Array(4 + 4 + 9 + 4);
  phys[0] = 0; phys[1] = 0; phys[2] = 0; phys[3] = 9;
  phys[4] = 0x70; phys[5] = 0x48; phys[6] = 0x59; phys[7] = 0x73;
  const dv = new DataView(phys.buffer);
  dv.setUint32(8, ppm, false);
  dv.setUint32(12, ppm, false);
  phys[16] = 1;
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

async function loadImage(url) {
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
