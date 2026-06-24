import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { notify } from '../components/Dialog';
import {
  syncOrders, getOrderFailures, countOrderFailures, URL_FAILURES_EVENT,
} from '../services/urlFailureCache';

// Dedicated management page for the image-URL check. Lists NON-shipped orders
// (the server only returns status != shipped) with their stored validation
// status, and lets staff run the client-side check per row, per filter, or for
// every still-unchecked order. The actual checking is the same client pipeline
// (Electron fetch → POST result) used elsewhere — this page just drives it.

const STATUS_COLORS = {
  new_order: 'bg-blue-100 text-blue-600',
  producing: 'bg-yellow-100 text-yellow-600',
  wrongsize: 'bg-red-100 text-red-600',
  fixed: 'bg-green-100 text-green-600',
  reprint: 'bg-orange-100 text-orange-600',
  onhold: 'bg-gray-100 text-gray-600',
};

const FILTERS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'unchecked', label: 'Chưa check' },
  { id: 'issues', label: 'Có lỗi' },
  { id: 'ok', label: 'OK' },
];

export default function ImageUrlCheck() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ total: 0, checked: 0, unchecked: 0, issues: 0 });
  const [meta, setMeta] = useState({ page: 1, last_page: 1, total: 0 });
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [, setTick] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    const params = { filter, page, per_page: 50 };
    if (userId) params.user_id = userId;
    api.get('/orders/image-validation/manage', { params })
      .then(res => {
        setRows(res.data.data || []);
        setCounts(res.data.counts || {});
        setMeta(res.data.meta || {});
      })
      .finally(() => setLoading(false));
  }, [filter, page, userId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (hasRole('admin') || hasRole('support')) {
      api.get('/users', { params: { per_page: 100 } }).then(res => setUsers(res.data.data || [])).catch(() => {});
    }
  }, []);

  // Re-render badges as client checks finish; reload the list when a batch run
  // completes so counts/statuses reflect the new DB state.
  useEffect(() => {
    const onUpdate = () => setTick(t => t + 1);
    window.addEventListener(URL_FAILURES_EVENT, onUpdate);
    return () => window.removeEventListener(URL_FAILURES_EVENT, onUpdate);
  }, []);

  const checkOne = (id) => { syncOrders([id], { toast: false, force: true }); };

  // Pull every still-unchecked non-shipped order id (across pages) and run the
  // client check on them. syncOrders skips already-checked + shipped + in-flight.
  const runUnchecked = async () => {
    if (running) return;
    setRunning(true);
    try {
      const ids = [];
      let p = 1, last = 1;
      do {
        const params = { filter: 'unchecked', page: p, per_page: 200 };
        if (userId) params.user_id = userId;
        const res = await api.get('/orders/image-validation/manage', { params });
        (res.data.data || []).forEach(o => ids.push(o.id));
        last = res.data.meta?.last_page || 1;
        p++;
      } while (p <= last && p <= 25); // safety cap 25 pages (5000 orders)
      if (!ids.length) {
        notify('Không có đơn nào chưa check.', { title: 'Image URL check', kind: 'success' });
        return;
      }
      notify(`Bắt đầu check ${ids.length} đơn (chạy nền)…`, { title: 'Image URL check' });
      syncOrders(ids, { title: 'Image URL check', force: true });
      // Reload after a short delay so freshly-saved statuses show.
      setTimeout(load, 4000);
    } catch (err) {
      notify(err.response?.data?.message || 'Lỗi tải danh sách', { title: 'Image URL check', kind: 'error' });
    } finally {
      setRunning(false);
    }
  };

  const switchFilter = (f) => { setFilter(f); setPage(1); };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
        <div>
          <h2 className="text-xl font-bold text-neutral-800">Image URL Check</h2>
          <p className="text-xs text-neutral-500 mt-1">
            Kiểm tra link ảnh (mockup/design) của các đơn <b>chưa shipped</b>. Check chạy trong app, lưu kết quả lên server.
          </p>
        </div>
        <button
          onClick={runUnchecked}
          disabled={running}
          className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-sm rounded-lg"
          title="Chạy check cho tất cả đơn chưa check (bỏ qua đã check + shipped)"
        >
          {running ? 'Đang tải…' : '▶ Check tất cả chưa check'}
        </button>
      </div>

      {/* Counts */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <CountCard label="Tổng (chưa shipped)" value={counts.total} tone="text-neutral-800" />
        <CountCard label="Đã check" value={counts.checked} tone="text-emerald-600" />
        <CountCard label="Chưa check" value={counts.unchecked} tone="text-amber-600" />
        <CountCard label="Có lỗi" value={counts.issues} tone="text-red-600" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {FILTERS.map(f => (
          <button key={f.id} onClick={() => switchFilter(f.id)}
            className={`px-3 py-1.5 text-sm rounded-lg ${filter === f.id ? 'bg-orange-500 text-white' : 'bg-white border border-neutral-200 text-neutral-600'}`}>
            {f.label}
          </button>
        ))}
        {(hasRole('admin') || hasRole('support')) && (
          <select value={userId} onChange={e => { setUserId(e.target.value); setPage(1); }}
            className="ml-auto px-2 py-1.5 bg-white border border-neutral-200 rounded-lg text-sm min-w-[180px]">
            <option value="">— all users —</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#faf8f6] text-neutral-500 text-xs">
            <tr>
              <th className="text-left px-3 py-2">System ID</th>
              <th className="text-left px-3 py-2">User</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-center px-3 py-2">Ảnh</th>
              <th className="text-left px-3 py-2">Kết quả</th>
              <th className="text-left px-3 py-2">Check lúc</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="p-6 text-center text-neutral-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="p-6 text-center text-neutral-400">Không có đơn.</td></tr>
            ) : rows.map(o => {
              const v = o.validation || {};
              // Prefer the live client store (just-run results) over server snapshot.
              const liveFails = countOrderFailures(o.id);
              const failed = liveFails || v.failed_count || 0;
              const checked = v.checked || getOrderFailures(o.id) !== null || liveFails > 0;
              return (
                <tr key={o.id} className="border-t border-neutral-100 hover:bg-orange-50/30">
                  <td className="px-3 py-2">
                    <button onClick={() => navigate(`/orders/${o.id}`)} className="font-mono text-orange-600 hover:underline">{o.system_id}</button>
                  </td>
                  <td className="px-3 py-2 text-neutral-600 text-xs">{o.user || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[o.status] || 'bg-neutral-100 text-neutral-600'}`}>{o.status}</span>
                  </td>
                  <td className="px-3 py-2 text-center text-neutral-600">{v.image_count || 0}</td>
                  <td className="px-3 py-2">
                    {!checked
                      ? <span className="text-neutral-400 text-xs">chưa check</span>
                      : failed > 0
                        ? <span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700">❗ {failed} lỗi</span>
                        : <span className="px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700">✓ OK</span>}
                  </td>
                  <td className="px-3 py-2 text-neutral-400 text-xs">{v.checked_at ? new Date(v.checked_at).toLocaleString() : '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => checkOne(o.id)} className="text-xs text-blue-600 hover:text-blue-700">{checked ? 'Re-check' : 'Check'}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {meta.last_page > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          {Array.from({ length: Math.min(meta.last_page, 12) }, (_, i) => i + 1).map(p => (
            <button key={p} onClick={() => setPage(p)} className={`px-3 py-1 rounded text-sm ${page === p ? 'bg-orange-500 text-white' : 'bg-white border border-neutral-200 text-neutral-600'}`}>{p}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function CountCard({ label, value, tone }) {
  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`text-2xl font-bold ${tone || 'text-neutral-800'}`}>{value ?? 0}</div>
    </div>
  );
}
