// Client-side cache of image-URL validation failures, keyed by order id.
//
// Used by the CSV-import background check (writer) and by the Orders list /
// Order detail pages (readers) to highlight orders with broken image URLs and
// show the failure reason on hover. Backed by localStorage so results survive a
// reload; an `bs:url-failures-updated` event lets already-open pages refresh.
//
// Shape: { [orderId]: { items: { [itemId]: { [fieldKey]: reason } }, checkedAt } }

const STORAGE_KEY = 'bs_url_failures';
const MAX_ORDERS = 500; // bound size — keep most recently checked orders.
export const URL_FAILURES_EVENT = 'bs:url-failures-updated';

function readAll() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function writeAll(all) {
  try {
    // Prune to the most recently checked orders if we've grown too large.
    const ids = Object.keys(all);
    if (ids.length > MAX_ORDERS) {
      ids
        .sort((a, b) => (all[a]?.checkedAt || 0) - (all[b]?.checkedAt || 0))
        .slice(0, ids.length - MAX_ORDERS)
        .forEach((id) => delete all[id]);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    window.dispatchEvent(new Event(URL_FAILURES_EVENT));
  } catch {
    // Ignore quota / serialization errors — the cache is best-effort.
  }
}

// Per-item failure map for one order, e.g. { [itemId]: { mockup_front: 'not found' } },
// or null when the order has no recorded failures.
export function getOrderFailures(orderId) {
  const entry = readAll()[String(orderId)];
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

// Record the result of validating an order. `itemFailures` is
// { [itemId]: { [fieldKey]: reason } } containing only the FAILED fields.
// An empty object clears the order from the cache (everything passed).
export function setOrderResult(orderId, itemFailures, checkedAtMs) {
  const all = readAll();
  const id = String(orderId);
  const hasAny = itemFailures && Object.values(itemFailures).some((f) => f && Object.keys(f).length);
  if (hasAny) {
    all[id] = { items: itemFailures, checkedAt: checkedAtMs || 0 };
  } else {
    delete all[id];
  }
  writeAll(all);
}

export function clearOrderFailures(orderId) {
  const all = readAll();
  if (all[String(orderId)]) {
    delete all[String(orderId)];
    writeAll(all);
  }
}
