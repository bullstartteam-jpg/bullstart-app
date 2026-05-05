import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { notify, askConfirm } from '../components/Dialog';

const STATUS_MAP = ['new_order', 'processing', 'wrongsize', 'fixed', 'reprint', 'onhold', 'shipped', 'cancelled'];
const SELLER_STATUS_OPTIONS = [5, 7]; // onhold, cancelled
const STATUS_COLORS = {
  0: 'bg-blue-100 text-blue-600',
  1: 'bg-yellow-100 text-yellow-600',
  2: 'bg-red-100 text-red-600',
  3: 'bg-green-100 text-green-600',
  4: 'bg-orange-100 text-orange-600',
  5: 'bg-gray-100 text-gray-600',
  6: 'bg-emerald-100 text-emerald-600',
  7: 'bg-rose-100 text-rose-600',
};

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', ref_id: '', user_id: '', page: 1 });
  const [selected, setSelected] = useState([]);
  const { hasPermission, hasRole, user: authUser } = useAuth();
  const isStaff = hasRole('admin') || hasRole('support');
  const isAdmin = hasRole('admin');
  const isSeller = hasRole('seller');
  const navigate = useNavigate();

  // Pay-All preview modal state
  const [showPayAll, setShowPayAll] = useState(false);
  const [payAllUserId, setPayAllUserId] = useState('');
  const [payAllSummary, setPayAllSummary] = useState(null);
  const [payAllLoading, setPayAllLoading] = useState(false);
  const [adminUsers, setAdminUsers] = useState([]);

  // Bulk-Assign modal
  const [showAssign, setShowAssign] = useState(false);
  const [assignUserId, setAssignUserId] = useState('');
  const [assignLoading, setAssignLoading] = useState(false);

  // Seller's own unpaid totals — shown as banner above the list
  const [unpaidBanner, setUnpaidBanner] = useState(null);
  const refreshUnpaidBanner = () => {
    if (!isSeller) return;
    api.get('/orders/unpaid-summary').then(res => setUnpaidBanner(res.data)).catch(() => {});
  };

  useEffect(() => {
    if (isAdmin) {
      api.get('/users', { params: { per_page: 100 } }).then(res => setAdminUsers(res.data.data || []));
    }
    if (isSeller) refreshUnpaidBanner();
  }, [isAdmin, isSeller, authUser?.id]);

  const fetchOrders = () => {
    setLoading(true);
    const params = { page: filters.page, per_page: 20 };
    if (filters.status !== '') params.status = filters.status;
    if (filters.ref_id) params.ref_id = filters.ref_id;
    if (filters.user_id) params.user_id = filters.user_id;

    api.get('/orders', { params }).then(res => {
      setOrders(res.data.data);
      setMeta(res.data);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchOrders(); refreshUnpaidBanner(); }, [filters.page, filters.status, filters.user_id]);

  const handleSearch = (e) => {
    e.preventDefault();
    setFilters(f => ({ ...f, page: 1 }));
    fetchOrders();
  };

  const handleBulkStatus = async (status) => {
    if (selected.length === 0) return;
    await api.post('/orders/bulk-status', { order_ids: selected, status });
    setSelected([]);
    fetchOrders();
  };

  const handleBulkPay = async () => {
    if (selected.length === 0) return;

    // Frontend pre-check: sum unpaid amounts of selected orders, compare against wallet.
    try {
      const balanceRes = await api.get('/wallet/balance');
      const wallet = parseFloat(balanceRes.data.wallet) || 0;
      const required = orders
        .filter(o => selected.includes(o.id))
        .reduce((sum, o) => {
          const remain = (parseFloat(o.total_cost) || 0) - (parseFloat(o.paid_cost) || 0);
          return remain > 0 ? sum + remain : sum;
        }, 0);
      if (required <= 0) {
        return notify('All selected orders are already fully paid.', { title: 'Nothing to pay' });
      }
      if (wallet < required) {
        return notify(`Insufficient wallet balance.\nRequired: $${required.toFixed(2)}\nWallet: $${wallet.toFixed(2)}\nShort by: $${(required - wallet).toFixed(2)}`, { title: 'Cannot pay', kind: 'error' });
      }
      const ok = await askConfirm(`Pay ${selected.length} order(s) for $${required.toFixed(2)}?`, { title: 'Confirm bulk pay', okText: 'Pay' });
      if (!ok) return;
    } catch {
      // If balance check fails, fall through and let backend enforce.
    }

    try {
      const res = await api.post('/orders/bulk-pay', { order_ids: selected });
      await notify(res.data.message, { title: 'Bulk pay', kind: 'success' });
      setSelected([]);
      fetchOrders();
      refreshUnpaidBanner();
    } catch (err) {
      const d = err.response?.data;
      const msg = d?.required != null && d?.wallet != null
        ? `${d.message}.\nRequired: $${d.required}\nWallet: $${d.wallet}`
        : (d?.message || 'Error');
      notify(msg, { title: 'Bulk pay failed', kind: 'error' });
    }
  };

  const handleCopyIds = async () => {
    if (selected.length === 0) return;
    const ids = orders.filter(o => selected.includes(o.id)).map(o => o.system_id).filter(Boolean);
    if (ids.length === 0) return;
    const text = ids.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      notify(`Copied ${ids.length} system ID${ids.length > 1 ? 's' : ''} to clipboard`, { kind: 'success' });
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      notify(`Copied ${ids.length} system ID${ids.length > 1 ? 's' : ''}`, { kind: 'success' });
    }
  };

  const handleBulkReconvert = async () => {
    if (selected.length === 0) return;
    const ok = await askConfirm(`Reconvert ${selected.length} order(s)?\nTheir _qr metas will be removed and rebuilt by the converter cron.`, { title: 'Confirm reconvert', okText: 'Reconvert' });
    if (!ok) return;
    try {
      const res = await api.post('/orders/bulk-reconvert', { order_ids: selected });
      await notify(res.data.message, { title: 'Bulk reconvert', kind: 'success' });
      setSelected([]);
      fetchOrders();
      refreshUnpaidBanner();
    } catch (err) {
      notify(err.response?.data?.message || 'Error', { title: 'Reconvert failed', kind: 'error' });
    }
  };

  const [dupRefreshing, setDupRefreshing] = useState(false);

  // Tracking-fetch queue — processes orders one at a time like the converter.
  const [showTracking, setShowTracking] = useState(false);
  const [trackingQueue, setTrackingQueue] = useState([]);   // [{id, system_id, shipping_label}]
  const [trackingDone, setTrackingDone] = useState(0);
  const [trackingErrors, setTrackingErrors] = useState(0);
  const [trackingPaused, setTrackingPaused] = useState(false);
  const [trackingRunning, setTrackingRunning] = useState(false);
  const [trackingLog, setTrackingLog] = useState([]); // [{kind, sid, msg, at}]
  const trackingPausedRef = useRef(false);
  const trackingCancelRef = useRef(false);
  trackingPausedRef.current = trackingPaused;

  const pushTrackingLog = (entry) => {
    setTrackingLog(prev => [...prev.slice(-99), { ...entry, at: new Date() }]);
  };

  const handleRefreshDuplicates = async () => {
    setDupRefreshing(true);
    try {
      const res = await api.post('/orders/refresh-duplicates');
      await notify(res.data.message, { title: 'Refresh duplicates', kind: 'success' });
      fetchOrders();
    } catch (err) {
      notify(err.response?.data?.message || 'Error', { title: 'Refresh failed', kind: 'error' });
    } finally {
      setDupRefreshing(false);
    }
  };

  const openTrackingModal = async () => {
    setShowTracking(true);
    setTrackingDone(0);
    setTrackingErrors(0);
    setTrackingLog([]);
    setTrackingPaused(false);
    trackingCancelRef.current = false;
    try {
      const res = await api.get('/orders/pending-tracking', { params: { limit: 500 } });
      setTrackingQueue(res.data.data || []);
    } catch (err) {
      notify(err.response?.data?.message || 'Error', { title: 'Load queue failed', kind: 'error' });
      setShowTracking(false);
    }
  };

  const startTrackingQueue = async () => {
    if (trackingRunning || trackingQueue.length === 0) return;
    setTrackingRunning(true);
    trackingCancelRef.current = false;

    let q = [...trackingQueue];
    const BASE_DELAY = 3000;
    const ERROR_BACKOFF = 8000;
    const CONSECUTIVE_FAIL_LIMIT = 5; // auto-stop after this many in a row
    let consecutiveFails = 0;
    let delay = BASE_DELAY;

    while (q.length > 0 && !trackingCancelRef.current) {
      while (trackingPausedRef.current && !trackingCancelRef.current) {
        await new Promise(r => setTimeout(r, 300));
      }
      if (trackingCancelRef.current) break;

      const item = q.shift();
      setTrackingQueue([...q]);
      pushTrackingLog({ kind: 'info', sid: item.system_id, msg: 'Fetching…' });
      let hadError = false;
      try {
        // 1. Call carrier directly from Electron main (bypasses Laravel + CORS).
        const result = await window.electronAPI.fetchTracking(item.shipping_label);
        const tk = result?.tracking_id;
        if (!tk) {
          pushTrackingLog({ kind: 'warn', sid: item.system_id, msg: 'No tracking in carrier response' });
          setTrackingErrors(e => e + 1);
          consecutiveFails = 0;
        } else {
          // 2. Save to backend.
          await api.post(`/orders/${item.id}/save-tracking`, { tracking_id: tk });
          const carrier = result.carrier ? ` (${result.carrier})` : '';
          pushTrackingLog({ kind: 'ok', sid: item.system_id, msg: `tracking = ${tk}${carrier}` });
          setTrackingDone(d => d + 1);
          consecutiveFails = 0;
        }
      } catch (err) {
        const upstreamStatus = err.upstreamStatus;
        const upstreamBody = err.upstreamBody;
        const upstreamMsg = typeof upstreamBody === 'string'
          ? upstreamBody.slice(0, 200)
          : (upstreamBody?.error ? String(upstreamBody.error).slice(0, 200) : '');
        const baseMsg = err.response?.data?.message || err.message || 'Error';
        const msg = upstreamStatus
          ? `Carrier ${upstreamStatus}${upstreamMsg ? ' — ' + upstreamMsg : ''}`
          : baseMsg;
        pushTrackingLog({ kind: 'error', sid: item.system_id, msg });
        setTrackingErrors(e => e + 1);
        hadError = true;
        consecutiveFails++;
      }

      // Circuit breaker: bail out if upstream keeps failing — pointless to keep hammering it.
      if (consecutiveFails >= CONSECUTIVE_FAIL_LIMIT) {
        pushTrackingLog({
          kind: 'error',
          sid: '!!',
          msg: `Stopping — ${consecutiveFails} consecutive upstream failures. Verify carrier.pressify.us is reachable.`,
        });
        break;
      }

      delay = hadError ? ERROR_BACKOFF : BASE_DELAY;
      if (q.length > 0) {
        pushTrackingLog({ kind: 'info', sid: '·', msg: `waiting ${Math.round(delay / 1000)}s…` });
      }
      await new Promise(r => setTimeout(r, delay));
    }

    setTrackingRunning(false);
    fetchOrders();
  };

  const cancelTrackingQueue = () => {
    trackingCancelRef.current = true;
    setTrackingPaused(false);
  };

  const handleBulkAssign = async () => {
    if (selected.length === 0 || !assignUserId) return;
    setAssignLoading(true);
    try {
      const res = await api.post('/orders/bulk-assign', { order_ids: selected, user_id: Number(assignUserId) });
      setShowAssign(false);
      setAssignUserId('');
      await notify(res.data.message, { title: 'Bulk assign', kind: 'success' });
      setSelected([]);
      fetchOrders();
    } catch (err) {
      notify(err.response?.data?.message || 'Error', { title: 'Assign failed', kind: 'error' });
    } finally {
      setAssignLoading(false);
    }
  };

  const handleBulkReProduction = async () => {
    if (selected.length === 0) return;
    const ok = await askConfirm(`Re-production ${selected.length} order(s)?\nĐặt production=false cho orders và toàn bộ order_item_metas của chúng. Đơn sẽ được tính lại trong gangsheet kế tiếp.`, { title: 'Confirm re-production', okText: 'Re-production' });
    if (!ok) return;
    try {
      const res = await api.post('/orders/bulk-re-production', { order_ids: selected });
      await notify(res.data.message, { title: 'Bulk re-production', kind: 'success' });
      setSelected([]);
      fetchOrders();
      refreshUnpaidBanner();
    } catch (err) {
      notify(err.response?.data?.message || 'Error', { title: 'Re-production failed', kind: 'error' });
    }
  };

  const handleBulkSetProduction = async () => {
    if (selected.length === 0) return;
    const ok = await askConfirm(`Mark ${selected.length} order(s) as produced?\nĐặt production=true cho orders và toàn bộ order_item_metas của chúng. Đơn sẽ bị loại khỏi gangsheet pipeline.`, { title: 'Confirm mark produced', okText: 'Mark produced' });
    if (!ok) return;
    try {
      const res = await api.post('/orders/bulk-set-production', { order_ids: selected });
      await notify(res.data.message, { title: 'Bulk mark produced', kind: 'success' });
      setSelected([]);
      fetchOrders();
      refreshUnpaidBanner();
    } catch (err) {
      notify(err.response?.data?.message || 'Error', { title: 'Mark produced failed', kind: 'error' });
    }
  };

  const handleBulkDelete = async () => {
    if (selected.length === 0) return;
    const ok = await askConfirm(`Delete ${selected.length} order(s)? This cannot be undone.`, { title: 'Confirm delete', okText: 'Delete' });
    if (!ok) return;
    try {
      const res = await api.post('/orders/bulk-delete', { order_ids: selected });
      await notify(res.data.message, { title: 'Bulk delete', kind: 'success' });
      setSelected([]);
      fetchOrders();
      refreshUnpaidBanner();
    } catch (err) {
      notify(err.response?.data?.message || 'Error', { title: 'Delete failed', kind: 'error' });
    }
  };

  const fetchPayAllSummary = async (userId) => {
    setPayAllLoading(true);
    setPayAllSummary(null);
    try {
      const params = userId ? { user_id: userId } : {};
      const res = await api.get('/orders/unpaid-summary', { params });
      setPayAllSummary(res.data);
    } catch (err) {
      notify(err.response?.data?.message || 'Error fetching summary', { title: 'Error', kind: 'error' });
      setShowPayAll(false);
    } finally {
      setPayAllLoading(false);
    }
  };

  const openPayAll = () => {
    setShowPayAll(true);
    setPayAllUserId('');
    setPayAllSummary(null);
    if (!isAdmin) {
      // Seller: fetch summary for self immediately
      fetchPayAllSummary(null);
    }
  };

  const confirmPayAll = async () => {
    if (!payAllSummary) return;
    if (payAllSummary.short > 0) return; // safety
    setPayAllLoading(true);
    try {
      const payload = isAdmin && payAllUserId ? { user_id: Number(payAllUserId) } : {};
      const res = await api.post('/orders/pay-all-unpaid', payload);
      setShowPayAll(false);
      await notify(res.data.message, { title: 'Pay all unpaid', kind: 'success' });
      fetchOrders();
      refreshUnpaidBanner();
    } catch (err) {
      const d = err.response?.data;
      const msg = d?.required != null && d?.wallet != null
        ? `${d.message}.\nRequired: $${d.required}\nWallet: $${d.wallet}\nShort by: $${(d.required - d.wallet).toFixed(2)}`
        : (d?.message || 'Error');
      notify(msg, { title: 'Cannot pay all', kind: 'error' });
    } finally {
      setPayAllLoading(false);
    }
  };

  const toggleSelect = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    if (selected.length === orders.length) {
      setSelected([]);
    } else {
      setSelected(orders.map(o => o.id));
    }
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-neutral-800">Orders</h2>
        <div className="flex gap-2">
          {isStaff && (
            <button
              onClick={openTrackingModal}
              className="px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 text-sm rounded-lg transition-colors"
              title="Open the tracking-fetch queue — processes orders without tracking one at a time"
            >
              Fetch Tracking
            </button>
          )}
          {isStaff && (
            <button
              onClick={handleRefreshDuplicates}
              disabled={dupRefreshing}
              className="px-4 py-2 bg-rose-100 hover:bg-rose-200 disabled:opacity-50 text-rose-700 text-sm rounded-lg transition-colors"
              title="Recompute the duplicate ref_id snapshot used to highlight rows in red"
            >
              {dupRefreshing ? 'Refreshing…' : 'Refresh Duplicates'}
            </button>
          )}
          <button onClick={openPayAll} className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm rounded-lg transition-colors">
            Pay All Unpaid
          </button>
          {hasPermission('orders', 'can_create') && (
            <Link to="/orders/create" className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition-colors">
              New Order
            </Link>
          )}
        </div>
      </div>

      {/* Seller unpaid banner */}
      {hasRole('seller') && unpaidBanner && unpaidBanner.count > 0 && (
        <div className={`mb-4 px-4 py-3 rounded-lg border flex items-center justify-between gap-4 ${
          unpaidBanner.short > 0
            ? 'bg-red-50 border-red-200'
            : 'bg-yellow-50 border-yellow-200'
        }`}>
          <div className="flex items-center gap-4 flex-wrap text-sm">
            <span className="text-neutral-600">Pending unpaid:</span>
            <span className="font-semibold text-neutral-800">{unpaidBanner.count} order{unpaidBanner.count > 1 ? 's' : ''}</span>
            <span className="text-neutral-300">·</span>
            <span className="text-neutral-600">Total to pay:</span>
            <span className="font-semibold text-red-600">${Number(unpaidBanner.total_unpaid).toFixed(2)}</span>
            <span className="text-neutral-300">·</span>
            <span className="text-neutral-600">Wallet:</span>
            <span className="font-semibold text-neutral-800">${Number(unpaidBanner.wallet).toFixed(2)}</span>
            {unpaidBanner.short > 0 && (
              <>
                <span className="text-neutral-300">·</span>
                <span className="text-red-600 font-medium">Short by ${Number(unpaidBanner.short).toFixed(2)}</span>
              </>
            )}
          </div>
          <button onClick={openPayAll} className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs rounded-lg whitespace-nowrap">
            Pay All
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-4 items-center flex-wrap">
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            placeholder="Search ref_id..."
            value={filters.ref_id}
            onChange={e => setFilters(f => ({ ...f, ref_id: e.target.value }))}
            className="px-3 py-1.5 bg-white border border-neutral-200 rounded-lg text-neutral-800 text-sm focus:outline-none focus:border-orange-400 w-48"
          />
          <button type="submit" className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Search</button>
        </form>

        <select
          value={filters.status}
          onChange={e => setFilters(f => ({ ...f, status: e.target.value, page: 1 }))}
          className="px-3 py-1.5 bg-white border border-neutral-200 rounded-lg text-neutral-700 text-sm focus:outline-none"
        >
          <option value="">All Status</option>
          {STATUS_MAP.map((s, i) => <option key={i} value={i}>{s}</option>)}
        </select>

        {isStaff && (
          <select
            value={filters.user_id}
            onChange={e => setFilters(f => ({ ...f, user_id: e.target.value, page: 1 }))}
            className="px-3 py-1.5 bg-white border border-neutral-200 rounded-lg text-neutral-700 text-sm focus:outline-none w-56"
          >
            <option value="">All Users</option>
            {adminUsers.map(u => (
              <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
            ))}
          </select>
        )}

        {selected.length > 0 && (
          <div className="flex gap-2 ml-auto">
            <span className="text-neutral-500 text-sm py-1.5">{selected.length} selected</span>
            <button onClick={handleCopyIds} className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs rounded-lg" title="Copy all selected system IDs to clipboard (newline-separated)">
              Copy IDs
            </button>
            <select
              onChange={e => { if (e.target.value) handleBulkStatus(parseInt(e.target.value)); e.target.value = ''; }}
              className="px-2 py-1.5 bg-white border border-neutral-200 rounded-lg text-neutral-700 text-xs"
            >
              <option value="">Bulk Status...</option>
              {STATUS_MAP.map((s, i) => (
                (isStaff || SELLER_STATUS_OPTIONS.includes(i))
                  ? <option key={i} value={i}>{s}</option>
                  : null
              ))}
            </select>
            <button onClick={handleBulkPay} className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-xs rounded-lg">
              Bulk Pay
            </button>
            {isStaff && (
              <button onClick={handleBulkReconvert} className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded-lg">
                Bulk Reconvert
              </button>
            )}
            {isAdmin && (
              <button onClick={() => setShowAssign(true)} className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs rounded-lg" title="Reassign selected orders to another seller">
                Bulk Assign
              </button>
            )}
            {isAdmin && (
              <button onClick={handleBulkSetProduction} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-lg" title="Mark orders + all their metas as produced (production=true) — removes them from the gangsheet pipeline">
                Bulk Mark Produced
              </button>
            )}
            {isAdmin && (
              <button onClick={handleBulkReProduction} className="px-3 py-1.5 bg-purple-500 hover:bg-purple-600 text-white text-xs rounded-lg" title="Reset production flag of orders and all metas so they re-enter the gangsheet pipeline">
                Bulk Re-Production
              </button>
            )}
            {isAdmin && (
              <button onClick={handleBulkDelete} className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs rounded-lg">
                Bulk Delete
              </button>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-neutral-500 text-xs bg-[#faf8f6]">
              <th className="p-3 text-left w-8">
                <input type="checkbox" onChange={toggleSelectAll} checked={selected.length === orders.length && orders.length > 0} className="accent-orange-500" />
              </th>
              <th className="p-3 text-left">System ID</th>
              <th className="p-3 text-left">Ref ID</th>
              {isStaff && <th className="p-3 text-left">User</th>}
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Ship Type</th>
              <th className="p-3 text-right">Total</th>
              <th className="p-3 text-right">Paid</th>
              <th className="p-3 text-left">Tracking</th>
              <th className="p-3 text-left">Date</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={isStaff ? 10 : 9} className="p-6 text-center text-neutral-400">Loading...</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={isStaff ? 10 : 9} className="p-6 text-center text-neutral-400">No orders found</td></tr>
            ) : orders.map(order => (
              <tr key={order.id} className="border-b border-neutral-100 hover:bg-orange-50/50 cursor-pointer transition-colors" onClick={() => navigate(`/orders/${order.id}`)}>
                <td className="p-3" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.includes(order.id)} onChange={() => toggleSelect(order.id)} className="accent-orange-500" />
                </td>
                <td className="p-3 text-orange-500 font-mono text-xs">{order.system_id}</td>
                <td className={`p-3 text-xs ${order.is_duplicate_ref ? 'text-red-600 font-semibold' : 'text-neutral-700'}`}>
                  {order.ref_id ? (
                    <span title={order.is_duplicate_ref ? 'Ref ID duplicated across multiple orders' : ''}>
                      {order.ref_id}
                      {order.is_duplicate_ref && <span className="ml-1 text-[10px] uppercase tracking-wide">dup</span>}
                    </span>
                  ) : <span className="text-neutral-400">-</span>}
                </td>
                {isStaff && (
                  <td className="p-3 text-neutral-700 text-xs">
                    {order.user ? (
                      <span title={order.user.email}>{order.user.name}</span>
                    ) : <span className="text-neutral-400">-</span>}
                  </td>
                )}
                <td className="p-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[order.status]}`}>{STATUS_MAP[order.status]}</span>
                </td>
                <td className="p-3 text-neutral-600">{order.ship_type}</td>
                <td className="p-3 text-right text-neutral-800 font-medium">${order.total_cost}</td>
                <td className="p-3 text-right">
                  <span className={order.paid_cost >= order.total_cost ? 'text-green-600' : 'text-red-500'}>
                    ${order.paid_cost}
                  </span>
                </td>
                <td className="p-3 text-neutral-500 text-xs">{order.tracking_id || '-'}</td>
                <td className="p-3 text-neutral-500 text-xs">{new Date(order.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {meta.last_page > 1 && (() => {
        const cur = filters.page;
        const last = meta.last_page;
        const span = 2;
        const start = Math.max(1, cur - span);
        const end = Math.min(last, cur + span);
        const pages = [];
        for (let p = start; p <= end; p++) pages.push(p);
        const goto = (p) => setFilters(f => ({ ...f, page: Math.min(Math.max(1, p), last) }));
        return (
          <div className="flex justify-between items-center mt-4 flex-wrap gap-2">
            <div className="text-xs text-neutral-500">
              Page <span className="font-medium text-neutral-700">{cur}</span> of {last} · {meta.total ?? 0} order{(meta.total ?? 0) !== 1 ? 's' : ''}
            </div>
            <div className="flex gap-1">
              <button onClick={() => goto(1)} disabled={cur <= 1} className="px-2 py-1 rounded text-sm bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50 disabled:opacity-40">«</button>
              <button onClick={() => goto(cur - 1)} disabled={cur <= 1} className="px-2 py-1 rounded text-sm bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50 disabled:opacity-40">‹</button>
              {start > 1 && <span className="px-2 py-1 text-xs text-neutral-400">…</span>}
              {pages.map(p => (
                <button
                  key={p}
                  onClick={() => goto(p)}
                  className={`px-3 py-1 rounded text-sm ${cur === p ? 'bg-orange-500 text-white' : 'bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50'}`}
                >{p}</button>
              ))}
              {end < last && <span className="px-2 py-1 text-xs text-neutral-400">…</span>}
              <button onClick={() => goto(cur + 1)} disabled={cur >= last} className="px-2 py-1 rounded text-sm bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50 disabled:opacity-40">›</button>
              <button onClick={() => goto(last)} disabled={cur >= last} className="px-2 py-1 rounded text-sm bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50 disabled:opacity-40">»</button>
            </div>
          </div>
        );
      })()}

      {/* Pay-All preview modal */}
      {showPayAll && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowPayAll(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-[480px] max-w-[90%] p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-neutral-800 mb-3">Pay All Unpaid Orders</h3>

            {isAdmin && (
              <div className="mb-3">
                <label className="text-xs text-neutral-500">User</label>
                <select
                  value={payAllUserId}
                  onChange={e => {
                    const v = e.target.value;
                    setPayAllUserId(v);
                    if (v) fetchPayAllSummary(v);
                    else setPayAllSummary(null);
                  }}
                  className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm"
                >
                  <option value="">Select user...</option>
                  {adminUsers.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
                </select>
              </div>
            )}

            {payAllLoading && <p className="text-sm text-neutral-500 py-3">Loading…</p>}

            {payAllSummary && !payAllLoading && (
              <div className="space-y-1.5 text-sm bg-[#faf8f6] rounded-lg p-3 border border-neutral-200">
                {isAdmin && (
                  <div className="flex justify-between"><span className="text-neutral-500">User</span><span className="text-neutral-800">{payAllSummary.user_name}</span></div>
                )}
                <div className="flex justify-between"><span className="text-neutral-500">Unpaid orders</span><span className="text-neutral-800 font-medium">{payAllSummary.count}</span></div>
                <div className="flex justify-between"><span className="text-neutral-500">Total to pay</span><span className="text-neutral-800 font-semibold">${Number(payAllSummary.total_unpaid).toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-neutral-500">Wallet balance</span><span className="text-neutral-800">${Number(payAllSummary.wallet).toFixed(2)}</span></div>
                {payAllSummary.short > 0 ? (
                  <div className="flex justify-between border-t border-neutral-200 pt-1.5 mt-1.5">
                    <span className="text-red-500 font-medium">Short by</span>
                    <span className="text-red-500 font-semibold">${Number(payAllSummary.short).toFixed(2)}</span>
                  </div>
                ) : (
                  <div className="flex justify-between border-t border-neutral-200 pt-1.5 mt-1.5">
                    <span className="text-emerald-600 font-medium">After paying</span>
                    <span className="text-emerald-600 font-semibold">${(Number(payAllSummary.wallet) - Number(payAllSummary.total_unpaid)).toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}

            {payAllSummary && payAllSummary.count === 0 && (
              <p className="text-sm text-neutral-500 mt-2">No unpaid orders.</p>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowPayAll(false)} className="px-4 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Cancel</button>
              <button
                onClick={confirmPayAll}
                disabled={!payAllSummary || payAllSummary.count === 0 || payAllSummary.short > 0 || payAllLoading}
                className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded-lg"
              >
                {payAllLoading ? 'Paying…' : `Pay $${payAllSummary ? Number(payAllSummary.total_unpaid).toFixed(2) : '0.00'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Assign modal */}
      {showAssign && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowAssign(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-[480px] max-w-[90%] p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-neutral-800 mb-3">Bulk Assign Orders</h3>
            <p className="text-sm text-neutral-600 mb-3">Reassign <span className="font-semibold text-neutral-800">{selected.length}</span> selected order(s) to another user.</p>
            <div className="mb-4">
              <label className="text-xs text-neutral-500">Target user</label>
              <select
                value={assignUserId}
                onChange={e => setAssignUserId(e.target.value)}
                className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm"
              >
                <option value="">Select user...</option>
                {adminUsers.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email}){u.role?.name ? ` — ${u.role.name}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-neutral-500 mb-4">
              Note: orders' wallet history (paid/refund) sticks with the original payer. After reassignment, future payments will deduct from the new user's wallet.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAssign(false)} className="px-4 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Cancel</button>
              <button
                onClick={handleBulkAssign}
                disabled={!assignUserId || assignLoading}
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded-lg"
              >
                {assignLoading ? 'Assigning…' : 'Assign'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tracking-fetch queue modal */}
      {showTracking && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => !trackingRunning && setShowTracking(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-[640px] max-w-[95%] p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-neutral-800 mb-3">Fetch Tracking — Queue</h3>

            <div className="grid grid-cols-4 gap-3 text-sm mb-3">
              <div className="bg-neutral-50 rounded-lg p-2 text-center">
                <div className="text-xs text-neutral-500">Pending</div>
                <div className="text-lg font-bold text-neutral-800">{trackingQueue.length}</div>
              </div>
              <div className="bg-emerald-50 rounded-lg p-2 text-center">
                <div className="text-xs text-emerald-600">Done</div>
                <div className="text-lg font-bold text-emerald-700">{trackingDone}</div>
              </div>
              <div className="bg-red-50 rounded-lg p-2 text-center">
                <div className="text-xs text-red-600">Errors</div>
                <div className="text-lg font-bold text-red-700">{trackingErrors}</div>
              </div>
              <div className="bg-neutral-50 rounded-lg p-2 text-center">
                <div className="text-xs text-neutral-500">Status</div>
                <div className="text-xs font-bold text-neutral-700 mt-1">
                  {trackingRunning ? (trackingPaused ? 'Paused' : 'Running') : 'Idle'}
                </div>
              </div>
            </div>

            <div className="bg-[#0d1117] text-neutral-200 text-xs font-mono rounded-lg p-3 h-60 overflow-y-auto mb-3">
              {trackingLog.length === 0 ? (
                <p className="text-neutral-500">Click Start to begin processing.</p>
              ) : trackingLog.map((l, i) => (
                <div key={i} className={
                  l.kind === 'ok' ? 'text-emerald-400' :
                  l.kind === 'warn' ? 'text-yellow-400' :
                  l.kind === 'error' ? 'text-red-400' :
                  'text-neutral-300'
                }>
                  [{l.at.toLocaleTimeString()}] {l.sid}: {l.msg}
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              {!trackingRunning && (
                <>
                  <button onClick={() => setShowTracking(false)} className="px-4 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Close</button>
                  <button
                    onClick={startTrackingQueue}
                    disabled={trackingQueue.length === 0}
                    className="px-4 py-1.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white text-sm rounded-lg"
                  >
                    Start ({trackingQueue.length})
                  </button>
                </>
              )}
              {trackingRunning && (
                <>
                  <button onClick={() => setTrackingPaused(p => !p)} className="px-4 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white text-sm rounded-lg">
                    {trackingPaused ? 'Resume' : 'Pause'}
                  </button>
                  <button onClick={cancelTrackingQueue} className="px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm rounded-lg">Cancel</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
