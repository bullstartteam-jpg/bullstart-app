// App-wide background job that validates the image URLs of the orders created
// by a CSV import. Lives at module scope (not inside a component) so it keeps
// running — and keeps reporting progress via toasts — after the user navigates
// away from the Create Order page.
//
// Flow: import inserts the data first; the caller then fires this and returns.
// We fetch the just-created orders (the /orders index sorts id desc and
// auto-scopes sellers, so page 1 is the newest rows), validate each item's
// image URLs, record failures to urlFailureCache (which the Orders list /
// Order detail surface), and show a single progress toast + a completion toast.

import api from './api';
import { validateImageUrl, collectItemUrls, runWithConcurrency } from '../utils/imageUrlCheck';
import { setOrderResult } from './urlFailureCache';
import { pushToast, updateToast } from '../components/Toast';

let running = false;

export async function runImportUrlCheck({ createdCount, userId } = {}) {
  if (!createdCount) return;
  if (running) return; // one CSV import at a time — ignore re-entry.
  running = true;

  const id = pushToast({ kind: 'progress', title: 'Image URL check', message: 'Starting…' });
  try {
    const params = { page: 1, per_page: Math.min(createdCount, 100) };
    if (userId) params.user_id = userId;
    const res = await api.get('/orders', { params });
    const orders = res.data?.data || [];
    const checkedAt = Date.now();
    const total = orders.length;
    let issues = 0;
    let done = 0;

    for (const order of orders) {
      const itemFailures = {};
      for (const item of order.items || []) {
        const urls = collectItemUrls(item);
        if (!urls.length) continue;
        const results = await runWithConcurrency(urls, 5, (c) => validateImageUrl(c.url));
        const fields = {};
        urls.forEach((c, i) => { if (results[i] && !results[i].ok) fields[c.field] = results[i].reason; });
        if (Object.keys(fields).length) itemFailures[item.id] = fields;
      }
      if (Object.keys(itemFailures).length) issues++;
      setOrderResult(order.id, itemFailures, checkedAt);
      done++;
      updateToast(id, { message: `Checking image URLs… ${done}/${total} orders` });
    }

    updateToast(id, {
      kind: issues ? 'warning' : 'success',
      sticky: issues > 0,
      durationMs: 6000,
      message: issues
        ? `${issues} of ${total} order(s) have image URL issues.`
        : `All ${total} imported order(s) have valid image URLs.`,
      action: issues ? { label: 'View orders', onClick: () => { window.location.hash = '#/orders'; } } : undefined,
    });
  } catch {
    updateToast(id, { kind: 'error', sticky: false, durationMs: 6000, message: 'Background image URL check failed.' });
  } finally {
    running = false;
  }
}
