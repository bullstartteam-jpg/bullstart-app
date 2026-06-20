import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { notify } from '../components/Dialog';

// Tracking-status pill colors for the chips.
const TRK_COLOR = {
  in_transit:         'bg-blue-100 text-blue-700',
  out_for_delivery:   'bg-indigo-100 text-indigo-700',
  accepted:           'bg-sky-100 text-sky-700',
  delivery_attempted: 'bg-amber-100 text-amber-700',
  exception:          'bg-red-100 text-red-700',
  pre_shipment:       'bg-neutral-100 text-neutral-600',
  unknown:            'bg-neutral-100 text-neutral-500',
};

// "Chưa delivered" page: orders that ran but the carrier hasn't delivered yet.
// Grouped by ship day → seller; each chip shows its current tracking status.
// Select + copy system ids + re-check via ShipEngine (/tracking/check).
export default function NotDelivered() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);   // { not_delivered, not_delivered_by_day }
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/dashboard/not-delivered')
      .then(res => setData(res.data))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const days = data?.not_delivered_by_day || [];

  const allIds = useMemo(() => days.flatMap(d => d.sellers.flatMap(s => s.orders.map(o => o.id))), [days]);
  const sysById = useMemo(() => {
    const m = new Map();
    days.forEach(d => d.sellers.forEach(s => s.orders.forEach(o => m.set(o.id, o.system_id))));
    return m;
  }, [days]);

  const fmtDay = (date) => {
    if (!date) return 'Khác';
    const d = new Date(`${date}T12:00:00`);
    return d.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' });
  };

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const toggleIds = (ids) => setSelected(prev => {
    const next = new Set(prev);
    const allOn = ids.every(id => next.has(id));
    ids.forEach(id => (allOn ? next.delete(id) : next.add(id)));
    return next;
  });

  const copySelected = async () => {
    if (!selected.size) return;
    const text = [...selected].map(id => sysById.get(id)).filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(text); notify(`Đã copy ${selected.size} system id`, { title: 'Copy', kind: 'success' }); }
    catch { notify('Copy thất bại', { title: 'Copy', kind: 'error' }); }
  };

  const check = async () => {
    if (!selected.size || busy) return;
    setBusy(true);
    try {
      const res = await api.post('/tracking/check', { order_ids: [...selected] });
      notify(res.data.message || 'Đã check tracking', { title: 'Check tracking', kind: 'success' });
      setSelected(new Set());
      load();
    } catch (err) {
      notify(err?.response?.data?.message || 'Check tracking thất bại', { title: 'Check tracking', kind: 'error' });
    } finally { setBusy(false); }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
        <div>
          <h2 className="text-xl font-bold text-neutral-800">Chưa delivered</h2>
          <p className="text-xs text-neutral-500 mt-1">
            Đơn đã run nhưng carrier chưa báo delivered — tất cả (trừ hôm nay), theo ngày ship.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs rounded-lg">Refresh</button>
          <button onClick={() => setSelected(selected.size ? new Set() : new Set(allIds))} className="text-xs text-neutral-500 hover:text-neutral-700">
            {selected.size ? 'Bỏ chọn' : 'Chọn hết'}
          </button>
          <button onClick={copySelected} disabled={!selected.size}
            className="px-3 py-1.5 bg-white border border-neutral-200 text-neutral-700 disabled:opacity-50 text-xs rounded-lg hover:bg-neutral-50"
            title="Copy system id các đơn đã chọn">
            Copy system id ({selected.size})
          </button>
          <button onClick={check} disabled={!selected.size || busy}
            className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-xs rounded-lg"
            title="Check lại tracking các đơn đã chọn">
            {busy ? 'Đang check…' : `Check tracking (${selected.size})`}
          </button>
        </div>
      </div>

      <div className="mb-3 text-sm text-amber-700 font-semibold">
        📦 Tổng chưa delivered: {data?.not_delivered ?? (loading ? '…' : 0)}
      </div>

      {loading ? (
        <p className="text-neutral-400">Loading…</p>
      ) : days.length === 0 ? (
        <p className="text-neutral-400">Không có đơn nào đang chờ delivered. 🎉</p>
      ) : (
        <div className="space-y-4">
          {days.map(d => {
            const dayIds = d.sellers.flatMap(s => s.orders.map(o => o.id));
            const dayAllOn = dayIds.length > 0 && dayIds.every(id => selected.has(id));
            return (
              <div key={d.date || 'other'} className="rounded-lg border border-neutral-200 bg-white shadow-sm">
                <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-[#faf8f6] rounded-t-lg border-b border-neutral-200">
                  <button onClick={() => toggleIds(dayIds)} className="text-sm font-semibold text-neutral-800 hover:text-amber-600">
                    {dayAllOn ? '☑' : '☐'} 📅 {fmtDay(d.date)}
                  </button>
                  <span className="text-xs font-bold text-amber-600">{d.count}</span>
                </div>
                <div className="p-3 space-y-3">
                  {d.sellers.map(s => {
                    const ids = s.orders.map(o => o.id);
                    const allOn = ids.length > 0 && ids.every(id => selected.has(id));
                    return (
                      <div key={s.user_id} className="border-b border-neutral-100 last:border-0 pb-2 last:pb-0">
                        <div className="flex items-center justify-between mb-1">
                          <button onClick={() => toggleIds(ids)} className="text-sm font-medium text-neutral-800 hover:text-amber-600">
                            {allOn ? '☑' : '☐'} {s.user || `User #${s.user_id}`}
                          </button>
                          <span className="text-xs font-bold text-amber-600">{s.count}</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {s.orders.map(o => {
                            const on = selected.has(o.id);
                            return (
                              <span key={o.id}
                                className={`inline-flex items-center gap-1 font-mono text-[11px] px-1.5 py-0.5 rounded border ${
                                  on ? 'bg-amber-50 border-amber-300' : 'bg-neutral-100 border-transparent'
                                }`}>
                                <input type="checkbox" checked={on} onChange={() => toggle(o.id)} className="accent-amber-500 cursor-pointer" />
                                <button onClick={() => navigate(`/orders/${o.id}`)} className="text-neutral-600 hover:text-amber-600 hover:underline">
                                  {o.system_id}
                                </button>
                                <span className={`px-1 rounded text-[10px] ${TRK_COLOR[o.status] || 'bg-neutral-100 text-neutral-500'}`}>{o.status}</span>
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
