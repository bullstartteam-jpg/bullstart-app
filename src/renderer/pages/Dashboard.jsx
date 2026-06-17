import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { notify } from '../components/Dialog';

const STATUS_COLORS = {
  new_order: 'bg-blue-100 text-blue-600',
  producing: 'bg-yellow-100 text-yellow-600',
  wrongsize: 'bg-red-100 text-red-600',
  fixed: 'bg-green-100 text-green-600',
  reprint: 'bg-orange-100 text-orange-600',
  onhold: 'bg-gray-100 text-gray-600',
  shipped: 'bg-emerald-100 text-emerald-600',
};

const WAREHOUSE_ADDRESS = {
  line1: '4353 Saddle Horn Way',
  city: 'Oceanside',
  zipcode: '92057',
};

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [completedRows, setCompletedRows] = useState(null); // shipped/day by completed_time
  const { hasRole } = useAuth();
  const isSeller = hasRole('seller');

  const loadDashboard = () => api.get('/dashboard').then(res => setStats(res.data));

  useEffect(() => {
    loadDashboard().finally(() => setLoading(false));

    // Completed (shipped) orders per day — last 30 days by completed_time.
    const z = n => String(n).padStart(2, '0');
    const ymd = d => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
    const to = new Date();
    const from = new Date(); from.setDate(from.getDate() - 29);
    api.get('/dashboard/shipped-report', {
      params: { date_field: 'completed_time', date_from: ymd(from), date_to: ymd(to) },
    }).then(res => setCompletedRows(res.data?.rows || [])).catch(() => setCompletedRows([]));
  }, []);

  const copyWarehouse = async () => {
    const text = `${WAREHOUSE_ADDRESS.line1}, ${WAREHOUSE_ADDRESS.city} ${WAREHOUSE_ADDRESS.zipcode}`;
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
  };

  if (loading) return <div className="p-6 text-neutral-400">Loading...</div>;
  if (!stats) return <div className="p-6 text-red-500">Failed to load dashboard</div>;

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold text-neutral-800 mb-6">Dashboard</h2>

      {isSeller && (
        <div className="mb-6 bg-orange-50 border border-orange-200 rounded-xl p-4 shadow-sm flex items-start gap-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center text-xl">
            📦
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-orange-700 uppercase tracking-wider mb-1">Warehouse Address</div>
            <div className="text-base font-semibold text-neutral-800">{WAREHOUSE_ADDRESS.line1}</div>
            <div className="text-sm text-neutral-700">{WAREHOUSE_ADDRESS.city}, CA {WAREHOUSE_ADDRESS.zipcode}</div>
          </div>
          <button
            onClick={copyWarehouse}
            className="px-3 py-1.5 bg-white border border-orange-200 text-orange-700 text-xs font-medium rounded-lg hover:bg-orange-100"
            title="Copy address to clipboard"
          >
            Copy
          </button>
        </div>
      )}

      {/* Orders older than 1 day still not shipped (SLA warning) */}
      <StaleOrders data={stats.stale_unshipped} />

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Orders" value={stats.total_orders} />
        <StatCard label="Revenue" value={`$${stats.total_revenue}`} />
        <StatCard label="Paid" value={`$${stats.total_paid}`} color="text-green-600" />
        <StatCard label="Unpaid" value={`$${stats.total_unpaid}`} color="text-red-500" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Print Cost" value={`$${stats.total_print_cost}`} />
        <StatCard label="Shipping Cost" value={`$${stats.total_shipping_cost}`} />
        {stats.total_users !== undefined && <StatCard label="Total Users" value={stats.total_users} />}
        {stats.total_wallet_balance !== undefined && <StatCard label="Wallet Balance" value={`$${stats.total_wallet_balance}`} />}
        {stats.shipped_tracking && (
          <StatCard
            label={`Tracking đã run · ship 7 ngày${stats.shipped_tracking.shipped ? ` (${stats.shipped_tracking.tracking_ran}/${stats.shipped_tracking.shipped})` : ''}`}
            value={stats.shipped_tracking.rate === null ? '—' : `${Number(stats.shipped_tracking.rate).toFixed(1)}%`}
            color={trackingRateColor(stats.shipped_tracking.rate)}
          />
        )}
      </div>

      {/* Shipped (7d) but tracking chưa run — grouped by seller; select + check via ShipEngine */}
      {stats.shipped_tracking?.not_run_by_seller?.length > 0 && (
        <TrackingNotRun data={stats.shipped_tracking} onChecked={loadDashboard} />
      )}

      {/* End-of-month projection (actual shipped + projection for the remaining days) */}
      <MonthProjection />

      {/* Completed (shipped) orders per day — by completed_time, last 30 days */}
      <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm mb-6">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-sm font-semibold text-neutral-600">Đơn completed (shipped) theo ngày — 30 ngày</h3>
          {completedRows && (
            <span className="text-xs text-neutral-400">{completedRows.reduce((n, r) => n + r.count, 0)} đơn</span>
          )}
        </div>
        <CompletedChart rows={completedRows} />
      </div>

      {/* Orders by status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-600 mb-3">Orders by Status</h3>
          <div className="space-y-2">
            {stats.orders_by_status?.map(item => (
              <div key={item.status} className="flex justify-between items-center">
                <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[item.status] || 'bg-neutral-100 text-neutral-600'}`}>
                  {item.status}
                </span>
                <span className="text-neutral-800 font-semibold">{item.count}</span>
              </div>
            ))}
            {stats.orders_by_status?.length === 0 && <p className="text-neutral-400 text-sm">No orders yet</p>}
          </div>
        </div>

        {/* Recent orders */}
        <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-600 mb-3">Recent Orders</h3>
          <div className="space-y-2">
            {stats.recent_orders?.map(order => (
              <div key={order.id} className="flex justify-between items-center text-sm">
                <span className="text-orange-500 font-mono">{order.ref_id}</span>
                <span className="text-neutral-500">${order.total_cost}</span>
              </div>
            ))}
            {stats.recent_orders?.length === 0 && <p className="text-neutral-400 text-sm">No orders yet</p>}
          </div>
        </div>
      </div>

      {/* Top sellers (admin) */}
      {stats.top_sellers && (
        <div className="mt-6 bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-600 mb-3">Top Sellers</h3>
          <div className="space-y-2">
            {stats.top_sellers.map(seller => (
              <div key={seller.user_id} className="flex justify-between items-center text-sm">
                <span className="text-neutral-800 font-medium">{seller.user?.name}</span>
                <div className="flex gap-4">
                  <span className="text-neutral-500">{seller.order_count} orders</span>
                  <span className="text-green-600 font-medium">${seller.total_revenue}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// "Chưa run tracking" list: pick orders (per-seller or individually) and run an
// on-demand ShipEngine check; orders whose status moves off pre_shipment drop
// out of the list after the dashboard reloads. Each system_id links to its order.
function TrackingNotRun({ data, onChecked }) {
  const navigate = useNavigate();
  // Bucketed by ship day, each day split per seller (falls back to the flat
  // by-seller payload wrapped as a single day for older API responses).
  const days = data?.not_run_by_day
    || (data?.not_run_by_seller ? [{ date: null, count: data.not_run, sellers: data.not_run_by_seller }] : []);
  const [selected, setSelected] = useState(() => new Set());
  const [changedIds, setChangedIds] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  // ShipEngine API key — entered & stored from the app (hub AppSetting).
  const [keyInfo, setKeyInfo] = useState(null);  // {has_key, from_app}
  const [showKey, setShowKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);

  const allIds = useMemo(
    () => days.flatMap(d => d.sellers.flatMap(s => s.orders.map(o => o.id))),
    [days],
  );
  // id -> system_id, so a selection by order id can be copied as readable system ids.
  const sysById = useMemo(() => {
    const m = new Map();
    days.forEach(d => d.sellers.forEach(s => s.orders.forEach(o => m.set(o.id, o.system_id))));
    return m;
  }, [days]);

  // Ship day label: 'YYYY-MM-DD' → "T6 13/06" (anchored at noon to dodge tz shift).
  const fmtDay = (date) => {
    if (!date) return 'Khác';
    const d = new Date(`${date}T12:00:00`);
    return d.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' });
  };

  const loadKey = () => api.get('/tracking/shipengine-key').then(res => setKeyInfo(res.data)).catch(() => setKeyInfo(null));
  useEffect(() => { loadKey(); }, []);

  const saveKey = async () => {
    if (keyBusy) return;
    setKeyBusy(true);
    try {
      await api.put('/tracking/shipengine-key', { api_key: keyInput.trim() });
      setKeyInput('');
      setShowKey(false);
      await loadKey();
      notify('Đã lưu ShipEngine key', { title: 'ShipEngine', kind: 'success' });
    } catch (err) {
      notify(err?.response?.data?.message || 'Lưu key thất bại', { title: 'ShipEngine', kind: 'error' });
    } finally {
      setKeyBusy(false);
    }
  };

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleIds = (ids) => setSelected(prev => {
    const next = new Set(prev);
    const allOn = ids.every(id => next.has(id));
    ids.forEach(id => (allOn ? next.delete(id) : next.add(id)));
    return next;
  });
  const toggleGroup = (s) => toggleIds(s.orders.map(o => o.id));
  const toggleDay = (d) => toggleIds(d.sellers.flatMap(s => s.orders.map(o => o.id)));

  const copySelected = async () => {
    if (!selected.size) return;
    const text = [...selected].map(id => sysById.get(id)).filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      notify(`Đã copy ${selected.size} system id`, { title: 'Copy', kind: 'success' });
    } catch {
      notify('Copy thất bại', { title: 'Copy', kind: 'error' });
    }
  };

  const check = async () => {
    if (!selected.size || busy) return;
    setBusy(true);
    try {
      const res = await api.post('/tracking/check', { order_ids: [...selected] });
      setChangedIds(new Set((res.data.results || []).filter(r => r.changed).map(r => r.id)));
      notify(res.data.message || 'Đã check tracking', { title: 'Check tracking', kind: 'success' });
      setSelected(new Set());
      onChecked?.();
    } catch (err) {
      notify(err?.response?.data?.message || 'Check tracking thất bại', { title: 'Check tracking', kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  if (!days.length) return null;

  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm mb-6">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h3 className="text-sm font-semibold text-red-700">🚦 Chưa run tracking · ship 7 ngày · theo ngày ({data.not_run})</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowKey(v => !v)}
            className={`text-xs ${keyInfo && !keyInfo.has_key ? 'text-red-500' : 'text-neutral-500'} hover:text-neutral-700`}
            title="Nhập ShipEngine API key (lưu trên server qua app)"
          >
            ⚙ {keyInfo ? (keyInfo.has_key ? 'Key đã đặt' : 'Chưa có key') : 'Key'}
          </button>
          <button
            onClick={() => setSelected(selected.size ? new Set() : new Set(allIds))}
            className="text-xs text-neutral-500 hover:text-neutral-700"
          >
            {selected.size ? 'Bỏ chọn' : 'Chọn hết'}
          </button>
          <button
            onClick={copySelected}
            disabled={!selected.size}
            className="px-3 py-1.5 bg-white border border-neutral-200 text-neutral-700 disabled:opacity-50 text-xs rounded-lg hover:bg-neutral-50"
            title="Copy system id các đơn đã chọn"
          >
            Copy system id ({selected.size})
          </button>
          <button
            onClick={check}
            disabled={!selected.size || busy}
            className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs rounded-lg"
            title="Gửi tracking các đơn đã chọn sang ShipEngine kiểm tra & cập nhật nếu đổi"
          >
            {busy ? 'Đang check…' : `Check tracking (${selected.size})`}
          </button>
        </div>
      </div>

      {showKey && (
        <div className="mb-3 flex items-end gap-2 bg-neutral-50 border border-neutral-200 rounded-lg p-3">
          <div className="flex-1">
            <label className="text-xs text-neutral-500 block mb-1">
              ShipEngine API key {keyInfo?.has_key && <span className="text-emerald-600">(đang có{keyInfo.from_app ? '' : ' — từ server .env'})</span>}
            </label>
            <input
              type="password"
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              placeholder={keyInfo?.has_key ? 'Nhập key mới để thay (để trống = xoá, dùng .env)' : 'bk47…'}
              className="w-full px-3 py-2 bg-white border border-neutral-200 rounded-lg text-sm font-mono"
            />
          </div>
          <button onClick={saveKey} disabled={keyBusy} className="px-3 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs rounded-lg">
            {keyBusy ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      )}
      <div className="space-y-4">
        {days.map(d => {
          const dayIds = d.sellers.flatMap(s => s.orders.map(o => o.id));
          const dayAllOn = dayIds.length > 0 && dayIds.every(id => selected.has(id));
          return (
            <div key={d.date || 'other'} className="rounded-lg border border-neutral-200">
              <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-[#faf8f6] rounded-t-lg border-b border-neutral-200">
                <button onClick={() => toggleDay(d)} className="text-sm font-semibold text-neutral-800 hover:text-orange-600">
                  {dayAllOn ? '☑' : '☐'} 📅 {fmtDay(d.date)}
                </button>
                <span className="text-xs font-bold text-red-600">{d.count}</span>
              </div>
              <div className="p-3 space-y-3">
                {d.sellers.map(s => {
                  const ids = s.orders.map(o => o.id);
                  const allOn = ids.length > 0 && ids.every(id => selected.has(id));
                  return (
                    <div key={s.user_id} className="border-b border-neutral-100 last:border-0 pb-2 last:pb-0">
                      <div className="flex items-center justify-between mb-1">
                        <button onClick={() => toggleGroup(s)} className="text-sm font-medium text-neutral-800 hover:text-orange-600">
                          {allOn ? '☑' : '☐'} {s.user || `User #${s.user_id}`}
                        </button>
                        <span className="text-xs font-bold text-red-600">{s.count}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {s.orders.map(o => {
                          const on = selected.has(o.id);
                          return (
                            <span
                              key={o.id}
                              title={o.status}
                              className={`inline-flex items-center gap-1 font-mono text-[11px] px-1.5 py-0.5 rounded border ${
                                on ? 'bg-orange-50 border-orange-300' : 'bg-neutral-100 border-transparent'
                              } ${changedIds.has(o.id) ? 'ring-1 ring-emerald-400' : ''}`}
                            >
                              <input type="checkbox" checked={on} onChange={() => toggle(o.id)} className="accent-orange-500 cursor-pointer" />
                              <button onClick={() => navigate(`/orders/${o.id}`)} className="text-neutral-600 hover:text-orange-600 hover:underline">
                                {o.system_id}
                              </button>
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
    </div>
  );
}

function StaleOrders({ data }) {
  if (!data) return null;
  const items = data.items || [];
  const count = data.count || 0;

  const age = iso => {
    if (!iso) return '';
    const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
    const d = Math.floor(h / 24);
    return d > 0 ? `${d} ngày ${h % 24}h` : `${h}h`;
  };
  // Order date+time in Vietnam local time (created_at is stored UTC).
  const fmtDate = iso => iso
    ? new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    : '';

  if (count === 0) {
    return (
      <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-700">
        ✅ Không có đơn nào quá 1 ngày chưa shipped.
      </div>
    );
  }

  return (
    <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 shadow-sm">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-semibold text-red-700">⚠️ Đơn quá 1 ngày chưa shipped</h3>
        <span className="text-xs font-semibold text-red-600">{count} đơn{count > items.length ? ` (hiện ${items.length})` : ''}</span>
      </div>
      <div className="max-h-72 overflow-y-auto">
        <table className="w-full text-sm">
          <tbody>
            {items.map(o => (
              <tr key={o.id} className="border-b border-red-100/70">
                <td className="py-1.5 pr-2 font-mono text-orange-600">{o.system_id}</td>
                <td className="py-1.5 pr-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[o.status] || 'bg-neutral-100 text-neutral-600'}`}>{o.status}</span>
                </td>
                <td className="py-1.5 pr-2 text-neutral-500 whitespace-nowrap font-mono text-xs">{fmtDate(o.created_at)}</td>
                <td className="py-1.5 pr-2 text-right text-red-600 font-semibold whitespace-nowrap">{age(o.created_at)}</td>
                {o.user && <td className="py-1.5 pl-3 text-neutral-500 text-right whitespace-nowrap">{o.user}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MonthProjection() {
  // Profit per order is a "what-if" rate the operator can tweak; default $1.8.
  const [rate, setRate] = useState(() => localStorage.getItem('dash_profit_per_order') || '1.8');
  useEffect(() => {
    const n = parseFloat(rate);
    if (Number.isFinite(n) && n > 0) localStorage.setItem('dash_profit_per_order', rate);
  }, [rate]);

  // Daily growth rate (%/day) applied LINEARLY to the remaining days. Empty =
  // use the trend auto-detected from this month's data. Persisted when set.
  const [growthOverride, setGrowthOverride] = useState(() => localStorage.getItem('dash_growth_override') ?? '');
  useEffect(() => {
    if (growthOverride === '') localStorage.removeItem('dash_growth_override');
    else localStorage.setItem('dash_growth_override', growthOverride);
  }, [growthOverride]);

  const pad = n => String(n).padStart(2, '0');
  const now = new Date();
  const curMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

  // Selectable months: current + previous 5.
  const months = useMemo(() => {
    const out = [];
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    for (let i = 0; i < 6; i++) {
      out.push({ value: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, label: `${pad(d.getMonth() + 1)}/${d.getFullYear()}` });
      d.setMonth(d.getMonth() - 1);
    }
    return out;
  }, []);
  const [month, setMonth] = useState(curMonth);
  const [rows, setRows] = useState(null);

  // Pull the actual shipped-per-day for the selected month (same source as the
  // shipped chart). Past months are already complete → we just total them.
  useEffect(() => {
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    setRows(null);
    api.get('/dashboard/shipped-report', {
      params: { date_field: 'completed_time', date_from: `${month}-01`, date_to: `${month}-${pad(lastDay)}` },
    }).then(r => setRows(r.data?.rows || [])).catch(() => setRows([]));
  }, [month]);

  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const isCurrent = month === curMonth;
  const daysElapsed = isCurrent ? now.getDate() : daysInMonth;

  const shipped = rows ? rows.reduce((n, r) => n + r.count, 0) : 0;
  const avgPerDay = daysElapsed > 0 ? shipped / daysElapsed : 0;
  const remainingDays = Math.max(0, daysInMonth - daysElapsed);

  // Least-squares slope (orders/day) over this month's shipped days — the data
  // trend. Used to auto-suggest a growth rate.
  const slope = useMemo(() => {
    if (!rows || rows.length < 2) return 0;
    const ys = rows.map(r => r.count);
    const n = ys.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sx += i; sy += ys[i]; sxx += i * i; sxy += i * ys[i]; }
    const d = n * sxx - sx * sx;
    return d ? (n * sxy - sx * sy) / d : 0;
  }, [rows]);

  // Auto growth %/day from the trend, clamped so a steep short run can't blow
  // up the projection. Empty input → use this; otherwise use the typed value.
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const autoGrowthPct = avgPerDay > 0 ? clamp((slope / avgPerDay) * 100, -15, 15) : 0;
  const growthPct = growthOverride === '' ? autoGrowthPct : (parseFloat(growthOverride) || 0);
  const g = growthPct / 100;

  // Total the actual shipped, and project the remaining days as a LINEAR ramp
  // off the current daily average: day k ahead ≈ avg × (1 + g·k). A finished
  // (past) month is its actual total — no projection.
  const projRemaining = avgPerDay * (remainingDays + g * remainingDays * (remainingDays + 1) / 2);
  const projectedShipped = isCurrent ? shipped + Math.round(Math.max(0, projRemaining)) : shipped;

  const rateNum = parseFloat(rate) || 0;
  const money = n => `$${Math.round(n).toLocaleString()}`;

  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm mb-6">
      <div className="flex justify-between items-center mb-3 gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-neutral-600">
          {isCurrent ? 'Doanh thu / dự báo cuối tháng' : 'Tổng shipped tháng'}
        </h3>
        <div className="flex items-center gap-3">
          <select value={month} onChange={e => setMonth(e.target.value)}
            className="px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm">
            {months.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {isCurrent && (
            <label className="flex items-center gap-2 text-xs text-neutral-500" title="Áp dụng tuyến tính cho các ngày còn lại. Để trống = tự động theo xu hướng.">
              Tăng trưởng %/ngày
              <input type="number" step="0.5" value={growthOverride}
                onChange={e => setGrowthOverride(e.target.value)}
                placeholder={autoGrowthPct.toFixed(1)}
                className="w-20 px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm text-right font-mono" />
            </label>
          )}
          <label className="flex items-center gap-2 text-xs text-neutral-500">
            Lãi / đơn ($)
            <input type="number" step="0.1" min="0" value={rate} onChange={e => setRate(e.target.value)}
              className="w-20 px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm text-right font-mono" />
          </label>
        </div>
      </div>

      {rows === null ? (
        <div className="h-20 flex items-center text-neutral-400 text-sm">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Đã shipped" value={shipped.toLocaleString()} />
            <StatCard label="Lãi thực tế" value={money(shipped * rateNum)} color="text-green-600" />
            {isCurrent && <StatCard label="TB shipped / ngày" value={avgPerDay.toFixed(1)} />}
            {isCurrent && <StatCard label="Lãi dự kiến cả tháng" value={money(projectedShipped * rateNum)} color="text-green-600" />}
          </div>
          <p className="text-xs text-neutral-400 mt-3">
            {isCurrent
              ? <>
                  {shipped.toLocaleString()} shipped trong {daysElapsed}/{daysInMonth} ngày · TB {avgPerDay.toFixed(1)}/ngày
                  {' · '}tăng trưởng {growthPct >= 0 ? '+' : ''}{growthPct.toFixed(1)}%/ngày
                  {growthOverride === '' ? ' (tự động)' : ''}
                  {' '}(xu hướng dữ liệu {slope >= 0 ? '+' : ''}{slope.toFixed(0)} đơn/ngày)
                  {' → '}dự kiến {projectedShipped.toLocaleString()} đơn × ${rate || 0} = {money(projectedShipped * rateNum)}
                </>
              : <>Tháng đã đủ số shipped — {shipped.toLocaleString()} đơn × ${rate || 0} = {money(shipped * rateNum)} (không cần dự đoán)</>}
          </p>
        </>
      )}
    </div>
  );
}

function CompletedChart({ rows }) {
  if (rows === null) return <div className="h-48 flex items-center justify-center text-neutral-400 text-sm">Loading…</div>;
  if (rows.length === 0) return <div className="h-48 flex items-center justify-center text-neutral-400 text-sm">Chưa có đơn completed trong 30 ngày.</div>;
  const max = Math.max(1, ...rows.map(r => r.count));
  const labelEvery = Math.ceil(rows.length / 12) || 1;
  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-1 h-48 min-w-full" style={{ minWidth: `${rows.length * 14}px` }}>
        {rows.map(r => (
          <div key={r.day} className="flex-1 flex flex-col items-center justify-end h-full group"
            title={`${r.day}\n${r.count} đơn · $${r.revenue.toLocaleString()}`}>
            <span className="text-[9px] text-neutral-500 mb-0.5 opacity-0 group-hover:opacity-100">{r.count}</span>
            <div className="w-full bg-emerald-400 group-hover:bg-emerald-500 rounded-t transition-all"
              style={{ height: `${(r.count / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-1 min-w-full" style={{ minWidth: `${rows.length * 14}px` }}>
        {rows.map((r, i) => (
          <div key={r.day} className="flex-1 text-center text-[9px] text-neutral-400 whitespace-nowrap">
            {i % labelEvery === 0 ? r.day.slice(5) : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

// Tracking run-rate color: red < 80%, amber < 95%, green otherwise.
function trackingRateColor(rate) {
  if (rate === null || rate === undefined) return 'text-neutral-800';
  if (rate < 80) return 'text-red-500';
  if (rate < 95) return 'text-amber-500';
  return 'text-green-600';
}

function StatCard({ label, value, color = 'text-neutral-800' }) {
  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
      <div className="text-xs text-neutral-500 mb-1">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
    </div>
  );
}
