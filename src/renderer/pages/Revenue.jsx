import { useEffect, useState } from 'react';
import api from '../services/api';
import { notify } from '../components/Dialog';

// Admin revenue summary for a period: seller top-ups, order totals per
// seller, and the split paid to each partner. Days are UTC — the same window
// the Orders list/export filter uses, so totals match an export of the same
// dates.

const TZ = 'UTC';

const fmt$ = (v) => `$${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtN = (v) => Number(v || 0).toLocaleString('en-US');
const fmtVnd = (v) => `${Number(v || 0).toLocaleString('vi-VN')} ₫`;

// Today's year/month/day in UTC.
function chicagoToday() {
  const [y, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: TZ }).split('-').map(Number);
  return { y, m, d };
}
const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y, m) => new Date(y, m, 0).getDate();

function presetRange(preset) {
  const { y, m, d } = chicagoToday();
  if (preset === 'this_month') return { from: ymd(y, m, 1), to: ymd(y, m, d) };
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return { from: ymd(py, pm, 1), to: ymd(py, pm, lastDay(py, pm)) };
}

const PRESETS = [
  { key: 'this_month', label: 'Tháng này' },
  { key: 'last_month', label: 'Tháng trước' },
  { key: 'range', label: 'Khoảng ngày' },
];

export default function Revenue() {
  const [preset, setPreset] = useState('this_month');
  const [range, setRange] = useState(() => presetRange('this_month'));
  const [dateField, setDateField] = useState('created_at');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async (r = range, field = dateField) => {
    if (!r.from || !r.to) return;
    setLoading(true);
    try {
      const res = await api.get('/revenue-report', { params: { date_from: r.from, date_to: r.to, date_field: field } });
      setData(res.data);
    } catch (err) {
      notify(err?.response?.data?.message || 'Không tải được báo cáo', { title: 'Doanh thu', kind: 'error' });
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const pickPreset = (key) => {
    setPreset(key);
    if (key === 'range') return; // keep the current dates, user edits then clicks Xem
    const r = presetRange(key);
    setRange(r);
    load(r);
  };
  const pickField = (field) => {
    setDateField(field);
    load(range, field);
  };

  const t = data;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-xl font-bold text-neutral-800">Doanh thu</h2>
        <p className="text-xs text-neutral-500 mt-1">
          Tổng hợp theo kỳ (ngày theo UTC, giống lọc ngày khi export Orders): tiền seller nạp, tổng tiền đơn, và tiền đã chia cho partner. Đơn cancelled không tính.
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-neutral-200 p-3 flex flex-wrap gap-3 items-end">
        <div className="flex rounded-lg overflow-hidden border border-neutral-200">
          {PRESETS.map(p => (
            <button key={p.key} onClick={() => pickPreset(p.key)}
              className={`px-3 py-1.5 text-sm ${preset === p.key ? 'bg-orange-500 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'}`}>
              {p.label}
            </button>
          ))}
        </div>
        <div>
          <label className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider block mb-1">Từ ngày</label>
          <input type="date" value={range.from} disabled={preset !== 'range'}
            onChange={e => setRange(r => ({ ...r, from: e.target.value }))}
            className="px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded text-sm disabled:opacity-60" />
        </div>
        <div>
          <label className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider block mb-1">Đến ngày</label>
          <input type="date" value={range.to} disabled={preset !== 'range'}
            onChange={e => setRange(r => ({ ...r, to: e.target.value }))}
            className="px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded text-sm disabled:opacity-60" />
        </div>
        {preset === 'range' && (
          <button onClick={() => load()} disabled={!range.from || !range.to || range.from > range.to}
            className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm rounded-lg">Xem</button>
        )}
        <div className="ml-auto">
          <label className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider block mb-1">Ngày của đơn</label>
          <div className="flex rounded-lg overflow-hidden border border-neutral-200">
            <button onClick={() => pickField('created_at')}
              className={`px-3 py-1.5 text-sm ${dateField === 'created_at' ? 'bg-neutral-800 text-white' : 'bg-white text-neutral-600'}`}>
              Ngày tạo
            </button>
            <button onClick={() => pickField('completed_time')}
              className={`px-3 py-1.5 text-sm ${dateField === 'completed_time' ? 'bg-neutral-800 text-white' : 'bg-white text-neutral-600'}`}>
              Ngày ship
            </button>
          </div>
        </div>
      </div>

      {loading && <p className="text-sm text-neutral-400">Loading…</p>}

      {t && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card label={`Seller nạp · ${fmtN(t.topups.total.count)} lần`} value={fmt$(t.topups.total.amount)} tone="text-emerald-600" />
            <Card label={`Tổng tiền đơn · ${fmtN(t.orders.total.count)} đơn`} value={fmt$(t.orders.total.total_cost)} tone="text-orange-600" />
            <Card label={`Đã chia partner · ${fmtN(t.partners.total.count)} đơn`} value={fmt$(t.partners.total.partner_revenue)} tone="text-sky-600" />
          </div>

          <Table
            title="Tiền seller nạp (topup)"
            hint="Giao dịch deposit đã approve, theo ngày tạo giao dịch."
            cols={['Seller', 'Số lần', 'Số tiền (USD)', 'VND']}
            rows={t.topups.rows.map(r => [<Who u={r.user} />, fmtN(r.count), fmt$(r.amount), r.vnd_amount ? fmtVnd(r.vnd_amount) : '—'])}
            total={['Tổng', fmtN(t.topups.total.count), fmt$(t.topups.total.amount), t.topups.total.vnd_amount ? fmtVnd(t.topups.total.vnd_amount) : '—']}
          />

          <Table
            title="Tổng tiền đơn theo seller"
            hint={`Đơn không cancelled, lọc theo ${dateField === 'created_at' ? 'ngày tạo' : 'ngày ship'}.`}
            cols={['Seller', 'Số đơn', 'Total cost', 'Đã paid']}
            rows={t.orders.rows.map(r => [<Who u={r.user} />, fmtN(r.count), fmt$(r.total_cost), fmt$(r.paid_cost)])}
            total={['Tổng', fmtN(t.orders.total.count), fmt$(t.orders.total.total_cost), fmt$(t.orders.total.paid_cost)]}
          />

          <Table
            title="Tiền đã chia cho partner"
            hint={`Tổng partner_revenue của đơn do partner làm, cùng bộ lọc ngày. "Chưa tính" = đơn chưa có số tiền partner.`}
            cols={['Partner', 'Số đơn', 'Total cost đơn', 'Chia partner', 'Chưa tính']}
            rows={t.partners.rows.map(r => [<Who u={r.user} />, fmtN(r.count), fmt$(r.total_cost), fmt$(r.partner_revenue),
              r.unpriced ? <span className="text-amber-600">{fmtN(r.unpriced)}</span> : '—'])}
            total={['Tổng', fmtN(t.partners.total.count), fmt$(t.partners.total.total_cost), fmt$(t.partners.total.partner_revenue),
              t.partners.total.unpriced ? fmtN(t.partners.total.unpriced) : '—']}
          />
        </>
      )}
    </div>
  );
}

function Card({ label, value, tone }) {
  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${tone}`}>{value}</div>
    </div>
  );
}

function Who({ u }) {
  return (
    <div>
      <div className="text-neutral-800">{u.name}</div>
      {u.email && <div className="text-[11px] text-neutral-400">{u.email}</div>}
    </div>
  );
}

// First column left-aligned, numbers right-aligned; total row pinned last.
function Table({ title, hint, cols, rows, total }) {
  return (
    <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-100">
        <h3 className="text-sm font-semibold text-neutral-800">{title}</h3>
        {hint && <p className="text-[11px] text-neutral-500 mt-0.5">{hint}</p>}
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wider text-neutral-500 bg-[#faf8f6]">
          <tr>{cols.map((c, i) => <th key={c} className={`px-4 py-2 ${i === 0 ? 'text-left' : 'text-right'}`}>{c}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.length === 0 ? (
            <tr><td colSpan={cols.length} className="px-4 py-6 text-center text-neutral-400">Không có dữ liệu trong kỳ này.</td></tr>
          ) : rows.map((cells, ri) => (
            <tr key={ri} className="hover:bg-orange-50/30">
              {cells.map((c, i) => <td key={i} className={`px-4 py-2 ${i === 0 ? '' : 'text-right tabular-nums'}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
        {rows.length > 0 && (
          <tfoot className="bg-[#faf8f6] font-semibold text-neutral-800 border-t border-neutral-200">
            <tr>{total.map((c, i) => <td key={i} className={`px-4 py-2 ${i === 0 ? '' : 'text-right tabular-nums'}`}>{c}</td>)}</tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
