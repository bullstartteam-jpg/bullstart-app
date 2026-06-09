import { useEffect, useMemo, useState } from 'react';
import api from '../services/api';

// Shipped-orders-per-day report. Group by created_at or completed_time
// (completed_time = when the order was marked shipped). Server buckets days
// in Vietnam local time and reports how many shipped orders still lack a
// completed_time so we can warn that the "completed" view is partial.

function ymd(d) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function lastNDays(n) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (n - 1));
  return { from: ymd(from), to: ymd(to) };
}

export default function Reports() {
  const def = lastNDays(30);
  const [dateField, setDateField] = useState('created_at'); // created_at | completed_time
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchReport = () => {
    setLoading(true);
    api.get('/dashboard/shipped-report', {
      params: { date_field: dateField, date_from: from, date_to: to },
    }).then(res => setData(res.data)).finally(() => setLoading(false));
  };

  useEffect(() => { fetchReport(); /* eslint-disable-next-line */ }, [dateField, from, to]);

  const rows = data?.rows || [];
  const meta = data?.meta;
  const maxCount = useMemo(() => Math.max(1, ...rows.map(r => r.count)), [rows]);
  const labelEvery = Math.ceil(rows.length / 12) || 1; // keep x-axis readable

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-start flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-neutral-800">Report — Đơn đã shipped theo ngày</h2>
          <p className="text-xs text-neutral-500 mt-1">
            Gom theo ngày (giờ VN). Chọn mốc thời gian: ngày tạo đơn hoặc ngày hoàn tất (shipped).
          </p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex rounded-lg overflow-hidden border border-neutral-200">
            <button onClick={() => setDateField('created_at')}
              className={`px-3 py-1.5 text-sm ${dateField === 'created_at' ? 'bg-orange-500 text-white' : 'bg-white text-neutral-600'}`}>
              Theo created_at
            </button>
            <button onClick={() => setDateField('completed_time')}
              className={`px-3 py-1.5 text-sm ${dateField === 'completed_time' ? 'bg-orange-500 text-white' : 'bg-white text-neutral-600'}`}>
              Theo completed (shipped)
            </button>
          </div>
          <div>
            <label className="block text-[11px] text-neutral-500">Từ</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="px-2 py-1.5 bg-white border border-neutral-200 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-[11px] text-neutral-500">Đến</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="px-2 py-1.5 bg-white border border-neutral-200 rounded-lg text-sm" />
          </div>
          <button onClick={fetchReport} className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Refresh</button>
        </div>
      </div>

      {/* completed_time health warning */}
      {meta && dateField === 'completed_time' && meta.missing_completed > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 text-xs text-yellow-800">
          ⚠️ {meta.missing_completed}/{meta.total_shipped} đơn shipped <b>chưa có completed_time</b> nên không hiện ở chế độ "completed".
          Các đơn này được set completed_time khi chuyển sang shipped — đơn cũ trước khi có tính năng có thể bị trống.
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Đơn shipped (kỳ)" value={meta?.total_count ?? 0} tone="text-green-600" />
        <Stat label="Doanh thu (kỳ)" value={`$${(meta?.total_revenue ?? 0).toLocaleString()}`} tone="text-orange-600" />
        <Stat label="Tổng đã shipped" value={meta?.total_shipped ?? 0} tone="text-neutral-700" />
        <Stat label="Thiếu completed_time" value={meta?.missing_completed ?? 0} tone={meta?.missing_completed ? 'text-red-500' : 'text-neutral-400'} />
      </div>

      {/* Chart */}
      <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
        {loading ? (
          <div className="h-64 flex items-center justify-center text-neutral-400 text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-neutral-400 text-sm">Không có đơn shipped trong khoảng này.</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="flex items-end gap-1 h-64 min-w-full" style={{ minWidth: `${rows.length * 14}px` }}>
              {rows.map((r) => (
                <div key={r.day} className="flex-1 flex flex-col items-center justify-end h-full group"
                  title={`${r.day}\n${r.count} đơn · $${r.revenue.toLocaleString()}`}>
                  <span className="text-[9px] text-neutral-500 mb-0.5 opacity-0 group-hover:opacity-100">{r.count}</span>
                  <div className="w-full bg-orange-400 group-hover:bg-orange-500 rounded-t transition-all"
                    style={{ height: `${(r.count / maxCount) * 100}%` }} />
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
        )}
      </div>

      {/* Table */}
      {rows.length > 0 && (
        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-neutral-500 bg-[#faf8f6]">
              <tr>
                <th className="text-left px-4 py-2">Ngày</th>
                <th className="text-right px-4 py-2">Đơn shipped</th>
                <th className="text-right px-4 py-2">Doanh thu</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.day} className="border-t border-neutral-100">
                  <td className="px-4 py-2 font-mono text-neutral-700">{r.day}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium">{r.count}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-neutral-600">${r.revenue.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`text-xl font-bold ${tone || 'text-neutral-800'}`}>{value}</div>
    </div>
  );
}
