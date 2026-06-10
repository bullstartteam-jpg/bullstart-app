// Image URL validation core.
//
// Verifies that a pasted image URL (external site or Google Drive) is actually
// reachable AND actually an image. Reuses the main-process `fetch-image` IPC
// (src/main/main.js) which bypasses renderer CORS and throws `HTTP <status> for
// <url>` on non-2xx. Drive links are checked via the thumbnail endpoint, which
// returns real image bytes and reflects whether the file is publicly viewable.

import { driveId, driveThumb, isPreviewable } from './drive';

// Drive `/file/d/.../view` pages return HTML, not image bytes — normalise to the
// thumbnail endpoint so a publicly-shared Drive image validates as an image.
export function normalizeForCheck(url) {
  if (!url) return url;
  return driveId(url) ? driveThumb(url, 'w400') : url;
}

function reasonFromError(err) {
  const msg = err?.message || String(err || '');
  const m = msg.match(/HTTP\s+(\d{3})/i);
  if (m) {
    const status = Number(m[1]);
    if (status === 401 || status === 403) return 'no permission / not shared publicly';
    if (status === 404) return 'not found';
    return `unreachable (HTTP ${status})`;
  }
  return 'could not load (network/blocked)';
}

// Best-effort fallback for non-Electron contexts (dev in a plain browser).
function probeWithImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ ok: true });
    img.onerror = () => resolve({ ok: false, reason: 'could not load (network/blocked)' });
    img.src = url;
  });
}

// Validate a single URL. Returns { ok: true } or { ok: false, reason }.
export async function validateImageUrl(url) {
  if (!url || !isPreviewable(url)) return { ok: false, reason: 'not a valid URL' };
  const target = normalizeForCheck(url);
  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  if (!api?.fetchImage) return probeWithImage(target);
  try {
    const res = await api.fetchImage(target);
    const ct = (res?.contentType || '').toLowerCase();
    if (!ct.startsWith('image/')) return { ok: false, reason: 'URL is not an image' };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: reasonFromError(err) };
  }
}

// Collect the image-URL fields of one order item that should be validated.
// Skips empty / non-URL values and generated `_qr` metas. Field keys match the
// shape stored by urlFailureCache: `mockup_front`, `mockup_back`, `meta:<key>`.
export function collectItemUrls(item) {
  const out = [];
  if (isPreviewable(item?.mockup_front)) {
    out.push({ field: 'mockup_front', label: 'Mockup front', url: item.mockup_front });
  }
  if (isPreviewable(item?.mockup_back)) {
    out.push({ field: 'mockup_back', label: 'Mockup back', url: item.mockup_back });
  }
  for (const m of item?.metas || []) {
    const key = m?.key || '';
    if (!key || /_qr(_\d+)?$/.test(key)) continue;
    if (isPreviewable(m?.value)) {
      out.push({ field: `meta:${key}`, label: `Design ${key}`, url: m.value });
    }
  }
  return out;
}

// Run async `fn` over `items` with a bounded concurrency pool.
export async function runWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  const size = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: size }, () => worker()));
  return results;
}
