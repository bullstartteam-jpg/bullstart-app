import QRCode from 'qrcode';
import bwipjs from 'bwip-js';
import api from './api';
import { driveThumb, driveId, driveOriginal } from '../utils/drive';
import { runGroupAssign, generateClaimedGroups, getAutomationConfig } from './groupGang';

// Two independent background jobs, each with its own poll interval, state,
// log, and persisted auto flag. They share the `/conversion/pending` endpoint
// and the image composition helpers below, but otherwise run separately so
// the seller-facing Convert page (qr) and admin-only Convert Label page can
// be toggled without affecting each other.

const POLL_MS = 60_000;

function createJob({ name, storageKey, runOnce, pollMs = POLL_MS }) {
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
      state.nextTickAt = state.enabled && !state.paused ? Date.now() + pollMs : null;
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
      intervalId = setInterval(() => { if (!state.paused) tick(); }, pollMs);
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

  return {
    subscribe, start, stop, softStop, pause, resume, runNow, isAutoEnabled,
    // Exposed so callers (e.g. manual one-off conversions) can push entries
    // into the job's activity log without going through tick().
    pushLog: (level, system_id, key, message) => { pushLog(level, system_id, key, message); emit(); },
    bumpProcessed: () => { state.processedTotal += 1; emit(); },
    bumpError: () => { state.errorTotal += 1; emit(); },
  };
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
        line_id: it.line_id || '',
        target_key: p.target_key,
        source_key: p.source_key,
        is_greeting_card_back: !!p.is_greeting_card_back,
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
          const backTag = meta.target_key === 'back_qr' || meta.source_key === 'back' ? ' [back: no qr]' : '';
          pushLog('info', item.system_id, meta.target_key, `Starting (${meta.index}/${meta.total})${backTag}…`);
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

// ---------------- Automation gangsheet jobs (groups) ----------------

// 'HH:mm' right now in Vietnam — auto-close hooks are evaluated in fixed VN
// time regardless of the operator machine's timezone.
function vnNowHHMM() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const h = parts.find(p => p.type === 'hour').value;
  const m = parts.find(p => p.type === 'minute').value;
  return `${h}:${m}`;
}

// Hourly "gom đơn vào group". Server does the bucketing atomically; this just
// pokes it. Safe to run on multiple machines (assign is idempotent per order).
const assignJob = createJob({
  name: 'gangsheet-assign',
  storageKey: 'converter_gangsheet_assign_auto',
  pollMs: 3_600_000,   // 1 hour
  async runOnce({ state, pushLog, emit }) {
    const res = await runGroupAssign();
    state.processedTotal += res?.assigned || 0;
    pushLog('ok', null, 'assign', `Gom ${res?.assigned ?? 0} đơn vào group (touched ${res?.groups_touched ?? 0}).`);
    emit();
  },
});

// Polls every minute; when server auto_close.enabled, fires any time-hook that
// has been reached but not yet fired this production day. mark-fired claims the
// hook atomically so multiple open apps don't double-close.
const autoCloseJob = createJob({
  name: 'gangsheet-autoclose',
  storageKey: 'converter_gangsheet_autoclose_auto',
  pollMs: 60_000,      // 1 minute
  async runOnce({ state, pushLog, emit }) {
    const cfg = await getAutomationConfig();
    if (!cfg?.auto_close?.enabled) return;   // policy off → do nothing

    const hooks = cfg.auto_close.hooks || [];
    const nowHM = vnNowHHMM();
    const firedToday = (cfg.close_marks?.date === cfg.production_day) ? (cfg.close_marks.fired || []) : [];
    const due = hooks.filter(h => h <= nowHM && !firedToday.includes(h)).sort();

    for (const hook of due) {
      if (state.paused || !state.enabled) break;
      const mark = await api.post('/gangsheet-groups/mark-fired', { hook });
      if (!mark.data?.was_new) continue;     // another client already fired this hook

      pushLog('info', null, 'autoclose', `Móc ${hook}: gom đơn rồi chốt…`);
      emit();
      try {
        // At the hook: pull ALL pending into groups (any count), then gang them.
        const asg = await runGroupAssign();
        if (asg?.assigned) pushLog('info', null, 'autoclose', `Móc ${hook}: gom ${asg.assigned} đơn.`);
        const results = await generateClaimedGroups({});   // all open groups
        state.processedTotal += results.length;
        pushLog('ok', null, 'autoclose', `Móc ${hook}: tạo ${results.length} gang.`);
      } catch (err) {
        state.errorTotal += 1;
        pushLog('error', null, 'autoclose', `Móc ${hook}: ${err?.message || String(err)}`);
      }
      emit();
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

// Automation gangsheet: assign (hourly gom) + auto-close (hook-driven).
export const subscribeAssignJob = assignJob.subscribe;
export const startAssignJob = assignJob.start;
export const stopAssignJob = assignJob.stop;
export const runAssignNow = assignJob.runNow;
export const isAssignAutoEnabled = assignJob.isAutoEnabled;

export const subscribeAutoCloseJob = autoCloseJob.subscribe;
export const startAutoCloseJob = autoCloseJob.start;
export const stopAutoCloseJob = autoCloseJob.stop;
export const runAutoCloseNow = autoCloseJob.runNow;
export const isAutoCloseAutoEnabled = autoCloseJob.isAutoEnabled;

/**
 * Restore each job's previously-persisted auto flag. Called by AuthContext
 * after login so users see whichever jobs they had on resume automatically.
 */
export function autoStartConverters() {
  if (qrJob.isAutoEnabled()) qrJob.start();
  if (labelJob.isAutoEnabled()) labelJob.start();
  if (assignJob.isAutoEnabled()) assignJob.start();
  if (autoCloseJob.isAutoEnabled()) autoCloseJob.start();
}

/** Stop both jobs (called on logout). Preserves the persisted auto flags so
 *  the next login resumes whatever each was set to. */
export function stopAllConverters() {
  qrJob.softStop();
  labelJob.softStop();
  assignJob.softStop();
  autoCloseJob.softStop();
}

// ---------------- Image composition + upload (shared) ----------------

async function processOne(item, meta) {
  const blob = await composeImage(
    meta.source_value,
    item.system_id,
    item.accessory_summary || '',
    {
      source_key: meta.source_key,
      line_id: item.line_id,
      is_greeting_card_back: !!meta.is_greeting_card_back,
    }
  );
  const formData = new FormData();
  formData.append('key', meta.target_key);
  formData.append('image', blob, `${item.system_id}_${meta.target_key}.png`);
  await api.post(`/conversion/${item.order_item_id}/qr-meta`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

async function processConvertLabel(lbl, { force = false } = {}) {
  // Stamp orders render from the address; everyone else from the carrier label.
  const blob = lbl.ship_type === 'stamp'
    ? await composeStampLabel(lbl.address, lbl.system_id, lbl.accessory_summary || '')
    : await composeConvertLabel(lbl.shipping_label, lbl.system_id, lbl.accessory_summary || '');
  const formData = new FormData();
  formData.append('image', blob, `${lbl.system_id}_label.jpg`);
  if (force) formData.append('force', '1');
  await api.post(`/conversion/order/${lbl.order_id}/convert-label`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

/**
 * Manual one-off convert for any order regardless of status. Used by the
 * "Convert by ID" input on the Convert Label page. Pushes events into the
 * label job's activity log so the operator sees progress alongside the
 * regular cron output.
 */
export async function manualConvertLabelById(idOrSystemId) {
  const needle = String(idOrSystemId || '').trim();
  if (!needle) throw new Error('Missing id or system_id');

  labelJob.pushLog('info', needle, 'convert_label', 'Manual lookup…');
  let target;
  try {
    const lookup = await api.get(`/conversion/label-lookup/${encodeURIComponent(needle)}`);
    target = lookup.data;
  } catch (err) {
    const msg = err?.response?.data?.message || err?.message || String(err);
    labelJob.pushLog('error', needle, 'convert_label', `Lookup failed: ${msg}`);
    labelJob.bumpError();
    throw err;
  }

  labelJob.pushLog('info', target.system_id, 'convert_label', `Composing convert label (manual, status=${target.status})…`);
  try {
    await processConvertLabel(target, { force: true });
    labelJob.pushLog('ok', target.system_id, 'convert_label', 'Uploaded convert label (manual)');
    labelJob.bumpProcessed();
  } catch (err) {
    const msg = err?.response?.data?.message || err?.message || String(err);
    labelJob.pushLog('error', target.system_id, 'convert_label', `Upload failed: ${msg}`);
    labelJob.bumpError();
    throw err;
  }
  return target;
}

/**
 * Compose a STAMP convert-label as a US-style envelope mock-up:
 *   top-left: BullStart return address (From)
 *   top-right: "Stamps" placeholder + system_id text
 *   center: large recipient block (To: name / address / city,state,zip /
 *            country / phone)
 * A6 portrait @ 300 DPI. Returns a JPEG.
 */
const STAMP_RETURN = {
  name: 'BullStart',
  line1: '4353 Saddle Horn Way',
  line2: 'Oceanside, CA 92057',
};

async function composeStampLabel(address, systemId, accessorySummary = '') {
  const W = 1800, H = 1200;            // 6×4 inch landscape @ 300 DPI
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  const pad = 70;

  // ── Top-left: From / return address ─────────────────────────────
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = '32px sans-serif';
  let ry = pad;
  ctx.fillText(`From: ${STAMP_RETURN.name}`, pad, ry); ry += 42;
  ctx.fillText(STAMP_RETURN.line1, pad, ry); ry += 42;
  ctx.fillText(STAMP_RETURN.line2, pad, ry);

  // ── Top-right: "Stamps" + system_id ────────────────────────────
  const codeText = accessorySummary ? `${systemId}-${accessorySummary}` : systemId;
  ctx.textAlign = 'right';
  ctx.font = '32px sans-serif';
  ctx.fillText('Stamps', W - pad, pad);
  ctx.font = 'bold 30px monospace';
  ctx.fillStyle = '#d9480f';
  ctx.fillText(codeText, W - pad, pad + 48);

  // ── Center: large recipient block ──────────────────────────────
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const a = address || {};
  const name = [a.first_name, a.last_name].filter(Boolean).join(' ');
  const cityLine = [a.city, a.state, a.zipcode].filter(Boolean).join(' ');
  const lines = [
    name ? `To: ${name}` : 'To:',
    a.address_1,
    a.address_2,
    cityLine,
    a.country,
    a.phone,
  ].filter(s => s && String(s).trim() !== '');

  const fontSize = 78;
  const lineH = 100;
  ctx.font = `${fontSize}px sans-serif`;
  // Soft-wrap any line that overflows the printable width.
  const maxW = W - pad * 2;
  const wrapped = [];
  for (const raw of lines) {
    let text = String(raw);
    while (ctx.measureText(text).width > maxW && text.length > 4) {
      let cut = text.length;
      while (cut > 4 && ctx.measureText(text.slice(0, cut)).width > maxW) cut--;
      wrapped.push(text.slice(0, cut));
      text = text.slice(cut);
    }
    wrapped.push(text);
  }
  const block = wrapped.length * lineH;
  // Anchor below the From/Stamps band; center vertically in the remaining
  // space (top band ~170px).
  const topBandEnd = 200;
  let cy = topBandEnd + (H - topBandEnd) / 2 - block / 2 + lineH / 2;
  for (const line of wrapped) {
    ctx.fillText(line, W / 2, cy);
    cy += lineH;
  }

  const rawBlob = await canvasToBlob(canvas, 'image/jpeg', 0.95);
  return await setJpgDpi(rawBlob, 300);
}

/**
 * Compose a convert-label image: the carrier label with a system_id QR code
 * + "{system_id}-{accessory_summary}" text band stamped in the BOTTOM-LEFT
 * corner. Preserves the source dimensions and produces a single JPEG.
 *
 * Switched from Code 128 to QR (2026-05-27): QR scans reliably from any
 * angle/distance and survives thermal-printer drift better than thin
 * Code 128 bars after JPEG compression.
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
  const fontSize = Math.max(28, Math.round(sourceW * 0.035));

  // QR is square. ~11% of source width with a 140px floor keeps it small
  // enough to not dominate the label but still scannable from a phone at
  // arm's length (operator feedback 2026-05-27: previous 22% was too big).
  const qrSize = Math.max(140, Math.round(sourceW * 0.11));
  const qrCanvas = await generateQrCanvas(systemId, qrSize);

  const PANEL_PAD = Math.round(fontSize * 0.45);
  const TEXT_TO_QR = Math.round(fontSize * 0.35);
  const QR_W = qrCanvas.width;
  const QR_H = qrCanvas.height;

  ctx.font = `bold ${fontSize}px sans-serif`;
  const textW = Math.ceil(ctx.measureText(codeText).width);
  const innerW = Math.max(QR_W, textW);
  const panelW = innerW + PANEL_PAD * 2;
  const panelH = fontSize + TEXT_TO_QR + QR_H + PANEL_PAD * 2;
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
    qrCanvas,
    panelX + PANEL_PAD,
    panelY + PANEL_PAD + fontSize + TEXT_TO_QR,
    QR_W,
    QR_H
  );

  // Resize the composed label to A6 (105 × 148 mm) at 300 DPI. Carrier PDFs
  // are typically A4 (ratio 1:1.4142) and so is A6 — the source fits the
  // target canvas almost exactly with no aspect-ratio padding. The 4×6"
  // thermal-printer ratio (1:1.5) that the previous version used left a
  // visible white strip on the long edge AND, when operators printed via
  // browser Ctrl+P (default A4 paper), came out oversized.
  //   1. Trim outer pure-white margins from the carrier PDF.
  //   2. Auto-orient: portrait source → 1240×1748, landscape → 1748×1240.
  //   3. Scale-to-fit on white (effectively no padding for A4 sources).
  const trimmed = cropWhiteMargins(canvas);
  const LABEL_LONG  = 1748; // 148 mm  @ 300 DPI (A6 long edge)
  const LABEL_SHORT = 1240; // 105 mm  @ 300 DPI (A6 short edge)
  const isPortrait = trimmed.height >= trimmed.width;
  const targetW = isPortrait ? LABEL_SHORT : LABEL_LONG;
  const targetH = isPortrait ? LABEL_LONG : LABEL_SHORT;
  const finalCanvas = fitOnLabelStock(trimmed, targetW, targetH);

  // Quality 0.95 keeps QR modules sharp at small sizes; 0.85 was blurring
  // the smallest modules and tripping scanners on heavy compression.
  const rawBlob = await canvasToBlob(finalCanvas, 'image/jpeg', 0.95);
  return await setJpgDpi(rawBlob, 300);
}

async function generateQrCanvas(value, size = 280) {
  const c = document.createElement('canvas');
  await QRCode.toCanvas(c, value, {
    width: size,
    margin: 1,                       // quiet zone in modules
    errorCorrectionLevel: 'M',       // ~15% recovery — enough for label print
    color: { dark: '#000000', light: '#FFFFFF' },
  });
  return c;
}

/**
 * Trim outer pure-white margins from a canvas. Carrier PDFs frequently
 * place the actual shipping label inside a larger page (A4 / Letter) with
 * blank padding around it — when we then resize for a 4×6 label printer
 * those margins waste real estate and shrink the readable content.
 *
 * Scans rows/cols from each edge inward until it hits a non-white pixel
 * (RGB threshold 240). Adds a tiny 1% bleed so content doesn't kiss the
 * edge after cropping.
 */
function cropWhiteMargins(canvas) {
  const ctx = canvas.getContext('2d');
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const TH = 240;
  let minX = width, maxX = -1, minY = height, maxY = -1;
  for (let y = 0; y < height; y++) {
    const rowOff = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = rowOff + x * 4;
      if (data[i] < TH || data[i + 1] < TH || data[i + 2] < TH) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return canvas; // fully white
  const pad = Math.round(Math.min(width, height) * 0.01);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  if (w === width && h === height) return canvas;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').drawImage(canvas, -minX, -minY);
  return out;
}

/**
 * Scale-fit `src` onto a target canvas of exact label dimensions. White
 * background, content centred. Uses high-quality smoothing so the
 * downscale doesn't soften the Code 128 bars more than necessary.
 */
function fitOnLabelStock(src, targetW, targetH) {
  const out = document.createElement('canvas');
  out.width = targetW;
  out.height = targetH;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetW, targetH);
  const scale = Math.min(targetW / src.width, targetH / src.height);
  const drawW = Math.round(src.width * scale);
  const drawH = Math.round(src.height * scale);
  const dx = Math.round((targetW - drawW) / 2);
  const dy = Math.round((targetH - drawH) / 2);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, dx, dy, drawW, drawH);
  return out;
}

async function composeImage(sourceUrl, systemId, accessorySummary = '', opts = {}) {
  const { source_key } = opts;
  // Two-sided convert: back faces are no longer flipped 180° — they keep the
  // same orientation as the front. The QR code is also skipped for backs
  // (only the front carries it). source_key === 'back' is the single switch.

  // The barcode is stamped at a fixed bottom-left panel (no design detection),
  // so a flattened thumbnail is fine. For Drive links we still fetch a large
  // render; very large originals can fail (Drive serves an HTML virus-scan page
  // instead of bytes) — fall back to a smaller thumbnail then.
  const id = driveId(sourceUrl);
  let sourceImg;
  if (id) {
    try {
      sourceImg = await loadImage(driveOriginal(sourceUrl));
    } catch (err) {
      console.warn('[convert] original fetch failed, falling back to thumbnail', err);
      sourceImg = await loadImage(driveThumb(sourceUrl, 'w3230'));
    }
  } else {
    sourceImg = await loadImage(sourceUrl);
  }
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
    // Portrait → landscape via -90° (CCW). Backs share this same rotation —
    // no extra flip.
    ctx.save();
    ctx.translate(TARGET_W / 2, TARGET_H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(sourceImg, -TARGET_H / 2, -TARGET_W / 2, TARGET_H, TARGET_W);
    ctx.restore();
  } else {
    ctx.drawImage(sourceImg, 0, 0, TARGET_W, TARGET_H);
  }

  // Skip the QR + system_id panel for any back face — only the front
  // carries the QR now.
  if (source_key === 'back') {
    const rawBlob = await canvasToBlob(canvas, 'image/png');
    return await setPngDpi(rawBlob, 300);
  }

  const codeText = accessorySummary ? `${systemId}-${accessorySummary}` : systemId;
  // Code 128 barcode (system_id) + text, stamped at a FIXED bottom-left panel —
  // no design detection. Size & position match the original convert layout.
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
  // Center the system_id text over the barcode below.
  ctx.textAlign = 'center';
  const barcodeCenterX = panelX + PANEL_PAD + BARCODE_W / 2;
  ctx.fillText(codeText, barcodeCenterX, panelY + PANEL_PAD);

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

// Code 128 barcode of `value` rendered to its own canvas via bwip-js. `scale`
// is px-per-module; a quiet zone (paddingwidth) keeps the start/stop codes
// readable after lossy compression / thermal-printer drift.
function generateBarcodeCanvas(value, scale = 3) {
  const c = document.createElement('canvas');
  bwipjs.toCanvas(c, {
    bcid: 'code128',
    text: value,
    scale,
    height: 14,
    includetext: false,
    paddingwidth: 10,
    paddingheight: 4,
  });
  return c;
}

function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    const cb = (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob returned null')));
    if (typeof quality === 'number') {
      canvas.toBlob(cb, type, quality);
    } else {
      canvas.toBlob(cb, type);
    }
  });
}

/**
 * Patch the JFIF APP0 marker in a canvas-generated JPEG so it advertises the
 * intended print DPI. Browsers always include a JFIF marker but default the
 * density to 1:1 (no unit) — we rewrite Xdensity/Ydensity in place.
 */
async function setJpgDpi(blob, dpi = 300) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  // Must start with SOI (FFD8).
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return blob;
  let i = 2;
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xFF) break;
    const marker = buf[i + 1];
    const segLen = (buf[i + 2] << 8) | buf[i + 3];
    // APP0 + "JFIF\0" header
    if (
      marker === 0xE0 &&
      buf[i + 4] === 0x4A && buf[i + 5] === 0x46 &&
      buf[i + 6] === 0x49 && buf[i + 7] === 0x46 &&
      buf[i + 8] === 0x00
    ) {
      // Layout per JFIF: ... version (2), units (1), Xdensity (2), Ydensity (2)
      buf[i + 11] = 1; // 1 = pixels per inch
      buf[i + 12] = (dpi >> 8) & 0xFF;
      buf[i + 13] = dpi & 0xFF;
      buf[i + 14] = (dpi >> 8) & 0xFF;
      buf[i + 15] = dpi & 0xFF;
      return new Blob([buf], { type: 'image/jpeg' });
    }
    i += 2 + segLen;
  }
  return blob;
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
      // Carriers (e.g. cdn.cotik.app) serve labels as PDF. Render the first
      // page to a canvas and wrap it in an HTMLImageElement so the rest of
      // the composer pipeline can drawImage() it unchanged.
      const isPdf = (contentType || '').includes('pdf') || base64.startsWith('JVBERi');
      if (isPdf) {
        return await renderPdfFirstPageAsImage(base64);
      }
      const dataUrl = `data:${contentType};base64,${base64}`;
      return await loadFromSrc(dataUrl);
    } catch (err) {
      console.warn('[converter] IPC fetch failed, falling back to direct img', err);
    }
  }
  return loadFromSrc(url);
}

// Lazy-loaded pdfjs module + memoized worker config.
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

async function renderPdfFirstPageAsImage(base64) {
  const pdfjs = await getPdfjs();
  const data = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const pdf = await pdfjs.getDocument({ data }).promise;
  const page = await pdf.getPage(1);
  // Scale 4× of PDF default 72 DPI = ~288 DPI raster. Scale 2 produced
  // sub-300 DPI sources (USPS 4×6" PDF at scale 2 = 596x840) which left
  // the overlay Code 128 too small to scan after JPG compression.
  const viewport = page.getViewport({ scale: 4 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  // Convert the rendered canvas to a data URL so we can return an
  // HTMLImageElement (matches the rest of the loadImage contract).
  const dataUrl = canvas.toDataURL('image/png');
  return await loadFromSrc(dataUrl);
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
