// Post-import image-URL check.
//
// Thin helper over syncOrders: it batch-fetches the just-created orders (with
// items) in one request, then hands them to syncOrders, which validates each
// in the client, saves the result to the DB, and shows the bottom-right
// progress + summary toast — the same path the Orders list / Dashboard use.

import api from './api';
import { syncOrders } from './urlFailureCache';

// `orderIds` are the ids returned by POST /orders/import-csv (created_ids).
export async function runImportUrlCheck({ orderIds, userId } = {}) {
  const ids = [...new Set((orderIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return;

  // Batch-fetch the newest page (import rows are the newest, id desc) so we get
  // full order objects with items in one request instead of one-per-order.
  const idSet = new Set(ids);
  const params = { page: 1, per_page: Math.min(ids.length, 100) };
  if (userId) params.user_id = userId;

  let orders = [];
  try {
    const res = await api.get('/orders', { params });
    orders = (res.data?.data || []).filter((o) => idSet.has(o.id));
  } catch {
    orders = [];
  }

  // Any ids beyond the first page (very large import) fall back to bare ids;
  // syncOrders fetches their items individually.
  const fetched = new Set(orders.map((o) => o.id));
  const rest = ids.filter((id) => !fetched.has(id));

  syncOrders([...orders, ...rest]);
}
