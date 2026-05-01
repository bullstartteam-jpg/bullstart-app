import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

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
  const [filters, setFilters] = useState({ status: '', ref_id: '', page: 1 });
  const [selected, setSelected] = useState([]);
  const { hasPermission, hasRole } = useAuth();
  const isStaff = hasRole('admin') || hasRole('support');
  const isAdmin = hasRole('admin');
  const navigate = useNavigate();

  const fetchOrders = () => {
    setLoading(true);
    const params = { page: filters.page, per_page: 20 };
    if (filters.status !== '') params.status = filters.status;
    if (filters.ref_id) params.ref_id = filters.ref_id;

    api.get('/orders', { params }).then(res => {
      setOrders(res.data.data);
      setMeta(res.data);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchOrders(); }, [filters.page, filters.status]);

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
    try {
      const res = await api.post('/orders/bulk-pay', { order_ids: selected });
      alert(res.data.message);
      setSelected([]);
      fetchOrders();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  const handleCopyIds = async () => {
    if (selected.length === 0) return;
    const ids = orders.filter(o => selected.includes(o.id)).map(o => o.system_id).filter(Boolean);
    if (ids.length === 0) return;
    const text = ids.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      alert(`Copied ${ids.length} system ID${ids.length > 1 ? 's' : ''} to clipboard`);
    } catch {
      // Fallback: textarea trick
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      alert(`Copied ${ids.length} system ID${ids.length > 1 ? 's' : ''}`);
    }
  };

  const handleBulkReconvert = async () => {
    if (selected.length === 0) return;
    if (!confirm(`Reconvert ${selected.length} order(s)?\nTheir _qr metas will be removed and rebuilt by the converter cron.`)) return;
    try {
      const res = await api.post('/orders/bulk-reconvert', { order_ids: selected });
      alert(res.data.message);
      setSelected([]);
      fetchOrders();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  const handleBulkDelete = async () => {
    if (selected.length === 0) return;
    if (!confirm(`Delete ${selected.length} order(s)? This cannot be undone.`)) return;
    try {
      const res = await api.post('/orders/bulk-delete', { order_ids: selected });
      alert(res.data.message);
      setSelected([]);
      fetchOrders();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
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
          {hasPermission('orders', 'can_create') && (
            <Link to="/orders/create" className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition-colors">
              New Order
            </Link>
          )}
        </div>
      </div>

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
              <tr><td colSpan="9" className="p-6 text-center text-neutral-400">Loading...</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan="9" className="p-6 text-center text-neutral-400">No orders found</td></tr>
            ) : orders.map(order => (
              <tr key={order.id} className="border-b border-neutral-100 hover:bg-orange-50/50 cursor-pointer transition-colors" onClick={() => navigate(`/orders/${order.id}`)}>
                <td className="p-3" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.includes(order.id)} onChange={() => toggleSelect(order.id)} className="accent-orange-500" />
                </td>
                <td className="p-3 text-orange-500 font-mono text-xs">{order.system_id}</td>
                <td className="p-3 text-neutral-700 text-xs">{order.ref_id || <span className="text-neutral-400">-</span>}</td>
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
    </div>
  );
}
