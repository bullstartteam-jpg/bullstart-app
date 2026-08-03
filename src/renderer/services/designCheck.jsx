import api from './api';
import { createJob } from './jobRunner';
import { fetchFileBytes } from './gangsheetBuilder';
import { driveOriginal } from '../utils/drive';

// ---------------------------------------------------------------------------
// Card-skin design check.
//
// A skin that is the right size can still be unusable: the chip cutout may be
// missing entirely (a flat JPEG has no alpha to cut with) or sized for the
// other chip. This measures the artwork and compares it against the reference
// files, then posts a verdict per item.
//
// Reference numbers were measured off the two approved designs at 300 dpi:
//   small chip  1006×634 px, hole 135×99 px  at (104, 211)
//   big chip    1006×634 px, hole 144×123 px at (104, 226)
// ---------------------------------------------------------------------------

export const CHECKER_VERSION = '1';

const DPI = 300;

export const SPEC = {
  card: { w: 1006, h: 634 },
  // Dung sai kích thước thẻ: 6 px = 0.02 in. Nhóm 1014×645 hay gặp lệch
  // +8/+11 px nên sẽ bị bắt, còn sai số làm tròn khi export thì bỏ qua.
  cardTolPx: 6,
  holes: {
    smallchip: { w: 135, h: 99 },
    bigchip: { w: 144, h: 123 },
  },
  // Lỗ so theo tỉ lệ vì design có thể xuất ở độ phân giải khác (2x, 1.5x…):
  // mọi số đo được quy về bề ngang chuẩn 1006 px trước khi so.
  holeTolPct: 0.12,
};

/** Chuẩn hoá về NGANG rồi trả ImageData — composer cũng xoay portrait như vậy. */
async function loadPixels(url) {
  const bytes = await fetchFileBytes(driveOriginal(url));
  const blob = new Blob([bytes]);
  const bmpUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Không decode được ảnh'));
      i.src = bmpUrl;
    });
    const portrait = img.height > img.width;
    const w = portrait ? img.height : img.width;
    const h = portrait ? img.width : img.height;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (portrait) {
      // xoay 90° CW để về khổ ngang
      ctx.translate(w, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, 0, 0);
    } else {
      ctx.drawImage(img, 0, 0);
    }
    return { data: ctx.getImageData(0, 0, w, h), w, h, portrait };
  } finally {
    URL.revokeObjectURL(bmpUrl);
  }
}

/**
 * Lỗ khoét = vùng trong suốt KHÔNG chạm mép ảnh. Loang từ toàn bộ viền để loại
 * nền và bo góc, phần trong suốt còn sót lại mới là lỗ; trả về lỗ lớn nhất.
 */
function findHole({ data, w, h }) {
  const a = data.data;
  const isClear = (i) => a[i * 4 + 3] < 128;
  const seen = new Uint8Array(w * h);
  const stack = [];

  const pushIfClear = (i) => { if (!seen[i] && isClear(i)) { seen[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { pushIfClear(x); pushIfClear((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { pushIfClear(y * w); pushIfClear(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w; const y = (i - x) / w;
    if (x > 0) pushIfClear(i - 1);
    if (x < w - 1) pushIfClear(i + 1);
    if (y > 0) pushIfClear(i - w);
    if (y < h - 1) pushIfClear(i + w);
  }

  let best = null;
  const visited = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || visited[i] || !isClear(i)) continue;
    let minX = w; let maxX = -1; let minY = h; let maxY = -1; let area = 0;
    const q = [i];
    visited[i] = 1;
    while (q.length) {
      const j = q.pop();
      const x = j % w; const y = (j - x) / w;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const nb = [];
      if (x > 0) nb.push(j - 1);
      if (x < w - 1) nb.push(j + 1);
      if (y > 0) nb.push(j - w);
      if (y < h - 1) nb.push(j + w);
      for (const k of nb) if (!visited[k] && isClear(k)) { visited[k] = 1; q.push(k); }
    }
    if (area > 1500 && (!best || area > best.area)) {
      best = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area };
    }
  }
  return best;
}

/** Đo một design và chấm điểm theo chip của item. */
export async function measureDesign(url, chip) {
  const px = await loadPixels(url);
  const hole = findHole(px);
  const scale = SPEC.card.w / px.w;          // quy mọi số đo về bề ngang chuẩn
  const holeN = hole ? { w: hole.w * scale, h: hole.h * scale } : null;

  const dw = px.w - SPEC.card.w;
  const dh = px.h - SPEC.card.h;
  const sizeOk = Math.abs(dw) <= SPEC.cardTolPx && Math.abs(dh) <= SPEC.cardTolPx;

  const want = SPEC.holes[chip] || null;
  const near = (got, exp) => Math.abs(got - exp) / exp <= SPEC.holeTolPct;
  const matches = (h) => h && near(holeN.w, h.w) && near(holeN.h, h.h);

  const reasons = [];
  const issues = new Set();   // 'size' | 'hole' — server gom nhóm theo đây
  if (!sizeOk) {
    issues.add('size');
    reasons.push(`size ${px.w}×${px.h} (chuẩn ${SPEC.card.w}×${SPEC.card.h}, lệch ${dw >= 0 ? '+' : ''}${dw}×${dh >= 0 ? '+' : ''}${dh}px)`);
  }
  if (!want) {
    // Chỉ 2 loại chip có mẫu chuẩn. 'nochip' thì không được có lỗ; 'holo' chưa
    // có mẫu nên bỏ qua phần lỗ, chỉ soi kích thước — báo lỗi lúc này là oan.
    if (chip === 'nochip' && hole) { issues.add('hole'); reasons.push('có lỗ khoét nhưng đơn không đặt chip'); }
  } else if (!hole) {
    issues.add('hole');
    reasons.push('thiếu lỗ khoét chip');
  } else if (!matches(want)) {
    issues.add('hole');
    const other = Object.entries(SPEC.holes).find(([k, v]) => k !== chip && matches(v));
    reasons.push(other
      ? `lỗ khoét theo ${other[0]} (${Math.round(holeN.w)}×${Math.round(holeN.h)}px) nhưng đơn là ${chip}`
      : `lỗ ${Math.round(holeN.w)}×${Math.round(holeN.h)}px, chuẩn ${want.w}×${want.h}px`);
  }

  const category = issues.size === 2 ? 'both' : (issues.values().next().value || null);

  return {
    status: reasons.length ? 'fail' : 'ok',
    category,
    reason: reasons.join(' · ') || null,
    width: px.w,
    height: px.h,
    hole_w: hole ? hole.w : null,
    hole_h: hole ? hole.h : null,
    inches: { w: +(px.w / DPI).toFixed(3), h: +(px.h / DPI).toFixed(3) },
  };
}

// ---- Settings (per máy) ----------------------------------------------------

const KEY_STATUSES = 'design_check_statuses';
const DEFAULT_STATUSES = [0, 1, 2, 3, 4, 5];   // mọi trạng thái chưa ship/huỷ

export function getCheckStatuses() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY_STATUSES));
    if (Array.isArray(v)) return v.map(Number).filter((n) => n >= 0 && n <= 7);
  } catch { /* noop */ }
  return [...DEFAULT_STATUSES];
}
export function setCheckStatuses(list) {
  try { localStorage.setItem(KEY_STATUSES, JSON.stringify([...new Set(list.map(Number))].sort())); } catch { /* noop */ }
}

// ---- Cron job --------------------------------------------------------------

export const designCheckJob = createJob({
  name: 'design-check',
  storageKey: 'design_check_auto',
  pollMs: 10 * 60 * 1000,   // 10 phút/lượt — ảnh nặng, không cần gấp
  async runOnce({ state, pushLog, emit }) {
    const res = await api.get('/design-checks/pending', {
      params: { statuses: getCheckStatuses(), version: CHECKER_VERSION, limit: 500 },
    });
    const items = res.data.items || [];
    state.pending = items;
    state.pendingCount = items.length;
    emit();
    if (items.length === 0) return;

    // Gom theo đơn để mỗi đơn chỉ POST một lần.
    const byOrder = new Map();
    for (const it of items) {
      if (!byOrder.has(it.order_id)) byOrder.set(it.order_id, []);
      byOrder.get(it.order_id).push(it);
    }

    for (const [orderId, group] of byOrder) {
      if (state.paused || !state.enabled) break;
      const results = [];
      for (const it of group) {
        try {
          const m = await measureDesign(it.url, it.chip);
          results.push({ ...m, order_item_id: it.order_item_id, field: it.field, url: it.url, chip: it.chip });
          if (m.status === 'fail') {
            pushLog('error', it.system_id, it.field, m.reason);
            state.errorTotal += 1;
          } else {
            pushLog('ok', it.system_id, it.field, `OK ${m.width}×${m.height}`);
          }
        } catch (err) {
          results.push({
            order_item_id: it.order_item_id, field: it.field, url: it.url, chip: it.chip,
            status: 'error', reason: (err?.message || 'lỗi đo').slice(0, 190),
          });
          pushLog('error', it.system_id, it.field, err?.message || 'lỗi đo');
          state.errorTotal += 1;
        }
        state.processedTotal += 1;
        emit();
      }
      try {
        const res = await api.post(`/orders/${orderId}/design-check`, { version: CHECKER_VERSION, results });
        if (res.data?.moved_wrongsize) {
          pushLog('info', group[0].system_id, null, 'Đã chuyển đơn sang wrongsize');
        }
      } catch (err) {
        pushLog('error', null, null, `Lưu kết quả đơn #${orderId} thất bại: ${err?.message || ''}`);
      }
    }

    // Báo Telegram một lần cho cả lượt: gom theo seller rồi theo loại lỗi.
    // Server chỉ bắn những lỗi chưa báo nên chạy lại không spam.
    try {
      const n = await api.post('/design-checks/notify');
      if (n.data?.sent) pushLog('ok', null, null, n.data.message);
    } catch (err) {
      pushLog('error', null, null, `Báo Telegram thất bại: ${err?.message || ''}`);
    }
  },
});

export const subscribeDesignCheck = designCheckJob.subscribe;
export const startDesignCheck = designCheckJob.start;
export const stopDesignCheck = designCheckJob.stop;
export const runDesignCheckNow = designCheckJob.runNow;
export const isDesignCheckAuto = designCheckJob.isAutoEnabled;
