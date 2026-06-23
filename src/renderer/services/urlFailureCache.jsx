// Image-URL validation for orders — checked in the client, stored on the server.
//
// The desktop app does the actual image checking (via the Electron main-process
// fetch, which bypasses CORS) and POSTs the result to the hub, which persists it
// in the database. No backend queue/worker is involved. This module:
//   - caches per-order status in memory for synchronous reads by the UI,
//   - fetches stored status from the DB (so already-checked orders are skipped),
//   - validates not-yet-checked orders on demand and saves the result,
// and emits `bs:url-failures-updated` so open pages refresh their badges.
//
// Per-order failure shape (kept identical to the old layout so rendering code is
// unchanged):  { [itemId]: { [fieldKey]: reason } }
//   fieldKey = mockup_front | mockup_back | meta:<key>

import api from './api';
import { validateImageUrl, collectItemUrls, runWithConcurrency } from '../utils/imageUrlCheck';
import { pushToast, updateToast } from '../components/Toast';

export const URL_FAILURES_EVENT = 'bs:url-failures-updated';

const SHIPPED_STATUS = 6; // Order::STATUS_SHIPPED — never validated (per spec).
const ORDER_CONCURRENCY = 3; // how many orders to validate at once
const URL_CONCURRENCY = 5;   // how many URLs within one order to fetch at once

// orderId(string) -> { items, status, checked, imageCount, failedCount }
const store = new Map();
// orderIds currently being validated — guards against duplicate work when a
// page re-renders and calls syncOrders again before the first run finishes.
const inFlight = new Set();

function emit() {
  window.dispatchEvent(new Event(URL_FAILURES_EVENT));
}

// API failures [{ order_item_id, field, url, reason }] → { [itemId]: { [field]: reason } }.
function toItemMap(failures) {
  const items = {};
  for (const f of failures || []) {
    const itemId = String(f.order_item_id);
    if (!items[itemId]) items[itemId] = {};
    items[itemId][f.field] = f.reason;
  }
  return items;
}

function setEntry(orderId, status) {
  store.set(String(orderId), {
    items: toItemMap(status?.failures),
    status: status?.status || 'pending',
    checked: !!status?.checked,
    imageCount: status?.image_count || 0,
    failedCount: status?.failed_count || 0,
  });
}

// --- Readers (the surface the pages already use) ----------------------------

// Per-item failure map for one order, e.g. { [itemId]: { mockup_front: 'not found' } },
// or null when the order has no recorded failures.
export function getOrderFailures(orderId) {
  const entry = store.get(String(orderId));
  const items = entry?.items;
  return items && Object.keys(items).length ? items : null;
}

export function hasOrderFailure(orderId) {
  return !!getOrderFailures(orderId);
}

// Total number of failed fields recorded for an order (for badge tooltips).
export function countOrderFailures(orderId) {
  const items = getOrderFailures(orderId);
  if (!items) return 0;
  return Object.values(items).reduce((n, fields) => n + Object.keys(fields || {}).length, 0);
}

// --- Server reads / writes --------------------------------------------------

// Fetch stored status for a set of orders, update the cache + emit, and return
// the raw { [orderId]: status } map. Read-only — does not trigger validation.
export async function fetchOrdersStatus(orderIds) {
  const ids = [...new Set((orderIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return {};
  const res = await api.get('/orders/image-validation', { params: { order_ids: ids } });
  const data = res.data?.data || {};
  for (const [oid, status] of Object.entries(data)) setEntry(oid, status);
  emit();
  return data;
}

// Check every image URL of one order in the client. Returns
// { imageCount, failures: [{ order_item_id, field, url, reason }] }.
async function checkOrderUrls(order) {
  let imageCount = 0;
  const failures = [];
  for (const item of order.items || []) {
    const urls = collectItemUrls(item);
    if (!urls.length) continue;
    imageCount += urls.length;
    const results = await runWithConcurrency(urls, URL_CONCURRENCY, (c) => validateImageUrl(c.url));
    urls.forEach((c, i) => {
      const r = results[i];
      if (r && !r.ok) {
        failures.push({ order_item_id: item.id, field: c.field, url: c.url, reason: r.reason });
      }
    });
  }
  return { imageCount, failures };
}

// Validate one order in the client and persist the result to the DB. Returns
// the saved status (and updates the cache). `order` must include `items`.
export async function recheckOrder(order) {
  const { imageCount, failures } = await checkOrderUrls(order);
  const res = await api.post(`/orders/${order.id}/image-validation`, {
    image_count: imageCount,
    failures,
  });
  const status = res.data?.data;
  if (status) {
    setEntry(order.id, status);
    emit();
  }
  return status;
}

// Fetch one order with its items (for callers that only have an id — e.g. the
// Dashboard recent-orders list, whose payload omits item URLs).
async function fetchOrderWithItems(orderId) {
  try {
    const res = await api.get(`/orders/${orderId}`);
    return res.data?.order || null;
  } catch {
    return null;
  }
}

// Entry point used by the Orders list, Dashboard, Order detail and CSV import:
// given orders (full objects, or bare ids), fetch their stored status, then
// validate — in the client — any that have never been checked (skipping
// shipped). While work is pending it shows a bottom-right progress toast (same
// style as the CSV import) and a completion summary. Orders passed as bare ids
// (or without `items`) are fetched individually. Runs in the background.
//
// `opts.toast: false` runs silently (used by Order detail, which has its own
// inline "Re-check" feedback). `opts.title` overrides the toast title.
export function syncOrders(ordersOrIds, { toast = true, title = 'Image URL check' } = {}) {
  const list = (ordersOrIds || [])
    .map((o) => (o && typeof o === 'object' ? o : { id: Number(o) }))
    .filter((o) => o && o.id);
  if (!list.length) return;

  // Fetch stored status first so already-checked orders light up immediately
  // and aren't re-validated, then validate the rest.
  fetchOrdersStatus(list.map((o) => o.id))
    .catch(() => ({}))
    .then((statusMap) => {
      const eligible = list.filter((o) => {
        const s = statusMap[String(o.id)];
        if (s?.checked) return false;                 // already validated
        if (s?.status === 'shipped') return false;     // ignore shipped
        if (o.status === SHIPPED_STATUS) return false;
        if (inFlight.has(o.id)) return false;          // already running
        return true;
      });
      if (!eligible.length) return;
      eligible.forEach((o) => inFlight.add(o.id));

      const total = eligible.length;
      const toastId = toast
        ? pushToast({ kind: 'progress', title, message: `Checking image URLs… 0/${total} orders` })
        : null;
      let done = 0;
      let issues = 0;

      // Each order persists + emits as it completes; the toast tracks progress.
      runWithConcurrency(eligible, ORDER_CONCURRENCY, async (o) => {
        try {
          const order = o.items ? o : await fetchOrderWithItems(o.id);
          if (order) {
            const status = await recheckOrder(order);
            if ((status?.failed_count || 0) > 0) issues += 1;
          }
        } catch {
          // best-effort — leave it unchecked so a later visit retries
        } finally {
          inFlight.delete(o.id);
          done += 1;
          if (toastId) updateToast(toastId, { message: `Checking image URLs… ${done}/${total} orders` });
        }
      }).then(() => {
        if (!toastId) return;
        updateToast(toastId, {
          kind: issues ? 'warning' : 'success',
          sticky: issues > 0,
          durationMs: 6000,
          message: issues
            ? `${issues} of ${total} order(s) have image URL issues.`
            : `All ${total} order(s) have valid image URLs.`,
          action: issues ? { label: 'View orders', onClick: () => { window.location.hash = '#/orders'; } } : undefined,
        });
      });
    });
}
