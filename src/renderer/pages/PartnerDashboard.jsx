import { useState, useEffect, Fragment } from 'react';
import api from '../services/api';
import { notify } from '../components/Dialog';

/**
 * What each partner shipped, and what that owes them.
 *
 * Days are bucketed hub-side in America/Chicago, the same convention the main
 * dashboard uses, so a day here means the same day there.
 */
const fmt$ = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);
const shortDay = (iso) => iso.slice(5).replace('-', '/');   // 2026-08-19 -> 08/19

export default function PartnerDashboard() {
  const [days, setDays] = useState(14);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailFor, setDetailFor] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/partner-report/dashboard', { params: { days } });
      setData(res.data);
    } catch (err) {
      notify(err?.response?.data?.message || 'Không tải được dashboard', { title: 'Partner', kind: 'error' });
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [days]);

  if (loading && !data) return <div className="p-6 text-neutral-400">Loading…</div>;

  const partners = data?.partners || [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-neutral-800">Partner</h2>
          <p className="text-xs text-neutral-500">
            Đơn đã ship theo ngày ({data?.from} → {data?.to}, giờ {data?.timezone})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-neutral-500">Số ngày</label>
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            className="px-3 py-1.5 bg-white border border-neutral-200 rounded-lg text-sm">
            {[7, 14, 30, 60].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <button onClick={load} className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">
            Refresh
          </button>
        </div>
      </div>

      {partners.length === 0 ? (
        <p className="text-neutral-400 text-sm">Chưa có tài khoản role <b>partner</b> nào.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {partners.map(p => <PartnerCard key={p.user.id} p={p} onOpen={() => setDetailFor(p)} />)}
        </div>
      )}

      {detailFor && (
        <RevenueModal partner={detailFor} onClose={() => setDetailFor(null)} onApplied={load} />
      )}
    </div>
  );
}

function PartnerCard({ p, onOpen }) {
  const max = Math.max(1, ...p.daily.map(d => d.count));

  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-800">{p.user.name}</div>
          <div className="text-[11px] text-neutral-500 truncate">
            {p.price_list
              ? <>Bảng giá: <span className="text-purple-700">{p.price_list.name}</span></>
              : <span className="text-red-500">Chưa gán bảng giá — không tính tiền được</span>}
          </div>
        </div>
        <button onClick={onOpen}
          className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs rounded-lg shrink-0">
          Tính tiền
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2 text-center">
        <Stat label="Hôm nay" value={p.shipped_today} />
        <Stat label={`${p.daily.length ? 'Trong kỳ' : 'Kỳ này'}`} value={p.shipped_window} />
        <Stat label="Tổng ship" value={p.shipped_total} />
        <Stat label="Đã trả" value={fmt$(p.revenue_total)} tone="emerald" />
      </div>

      {(p.unpriced > 0 || p.undated > 0) && (
        <div className="flex gap-2 flex-wrap text-[11px]">
          {p.unpriced > 0 && (
            <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-medium"
              title="Đơn đã ship nhưng chưa có số tiền — bấm Tính tiền">
              {p.unpriced} đơn chưa tính tiền
            </span>
          )}
          {/* Shipped without a timestamp, so absent from the bars below. Called
              out so the strip and the totals cannot silently disagree. */}
          {p.undated > 0 && (
            <span className="px-2 py-0.5 rounded bg-neutral-100 text-neutral-600"
              title="Đã ship nhưng thiếu completed_time nên không xếp được vào ngày nào">
              {p.undated} đơn không có ngày
            </span>
          )}
        </div>
      )}

      {p.daily.length === 0 ? (
        <p className="text-xs text-neutral-400">Chưa ship đơn nào trong kỳ.</p>
      ) : (
        <div className="flex items-end gap-1 h-20 pt-2">
          {p.daily.map(d => (
            <div key={d.date} className="flex-1 flex flex-col items-center justify-end group"
              title={`${d.date}: ${d.count} đơn · ${fmt$(d.revenue)}`}>
              <div className="text-[9px] text-neutral-500 mb-0.5">{d.count}</div>
              <div className="w-full bg-orange-400 group-hover:bg-orange-500 rounded-t transition"
                style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }} />
              <div className="text-[9px] text-neutral-400 mt-0.5">{shortDay(d.date)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="bg-[#faf8f6] rounded-lg py-2">
      <div className={`text-lg font-bold ${tone === 'emerald' ? 'text-emerald-600' : 'text-neutral-800'}`}>{value}</div>
      <div className="text-[10px] text-neutral-500">{label}</div>
    </div>
  );
}

/**
 * The working behind a partner's pay: every shipped order, what it is worth
 * now, and what the rate card says. A preview first — applying writes the
 * computed amounts onto the orders, and locked ones are never touched.
 */
/**
 * The arithmetic behind one order's amount, item by item: which rate-card key
 * or accessory contributed what, the unit price, and the multiply by quantity.
 * An amount nobody can check is an amount nobody can argue with.
 */
function Working({ lines, total }) {
  if (!lines?.length) {
    return <p className="text-xs text-neutral-400">Bảng giá chưa có giá cho sản phẩm của đơn này.</p>;
  }
  return (
    <div className="space-y-3">
      {lines.map((l, i) => (
        <div key={i} className="text-xs">
          <div className="font-medium text-neutral-700">
            {l.product || '?'}{l.sku ? <span className="text-neutral-400 font-normal"> · {l.sku}</span> : null}
          </div>
          <div className="mt-1 pl-3 border-l-2 border-neutral-200 space-y-0.5">
            {l.parts.length === 0 && <div className="text-neutral-400">bảng giá không có dòng nào cho variant này</div>}
            {l.parts.map((p, j) => (
              <div key={j} className="flex gap-2">
                <span className={p.type === 'accessory' ? 'text-purple-600' : 'text-neutral-600'}>
                  {p.type === 'accessory' ? 'Add-on: ' : ''}{p.label}
                </span>
                <span className="flex-1 border-b border-dotted border-neutral-300 translate-y-[-3px]" />
                {/* On the order but absent from the card — an omission, not free work. */}
                <span className={p.price == null ? 'text-amber-600' : 'text-neutral-700'}>
                  {p.price == null ? 'chưa có giá' : fmt$(p.price)}
                </span>
              </div>
            ))}
            <div className="flex gap-2 pt-0.5 font-medium text-neutral-800">
              <span>Đơn giá {fmt$(l.unit)} × {l.quantity}</span>
              <span className="flex-1 border-b border-dotted border-neutral-300 translate-y-[-3px]" />
              <span>{fmt$(l.total)}</span>
            </div>
          </div>
        </div>
      ))}
      <div className="flex gap-2 text-xs font-semibold text-emerald-700 pt-1 border-t border-neutral-200">
        <span>Tổng đơn</span>
        <span className="flex-1" />
        <span>{fmt$(total)}</span>
      </div>
    </div>
  );
}

/** Same working, flattened onto one CSV cell. */
function workingText(lines) {
  if (!lines?.length) return '';
  return lines.map(l => {
    const parts = l.parts.map(p => `${p.label} ${p.price == null ? '(chưa có giá)' : fmt$(p.price)}`).join(' + ');
    return `${l.product || '?'}: ${parts} = ${fmt$(l.unit)} x${l.quantity} = ${fmt$(l.total)}`;
  }).join(' | ');
}

function RevenueModal({ partner, onClose, onApplied }) {
  const [range, setRange] = useState({ date_from: '', date_to: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [open, setOpen] = useState(() => new Set());   // order_ids showing their working

  const toggle = (id) => setOpen(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (range.date_from) params.date_from = range.date_from;
      if (range.date_to) params.date_to = range.date_to;
      const res = await api.get(`/partner-report/${partner.user.id}/orders`, { params });
      setData(res.data);
    } catch (err) {
      notify(err?.response?.data?.message || 'Không tải được chi tiết', { title: 'Tính tiền', kind: 'error' });
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const apply = async () => {
    // Locked orders are skipped hub-side too; filtering here keeps the
    // confirmation honest about how many will actually change.
    // `settled`, not `locked`: a locked order with no amount has nothing to
    // protect, and skipping it would leave it blank forever.
    const ids = (data?.orders || []).filter(o => !o.settled && o.computed != null).map(o => o.order_id);
    if (ids.length === 0) {
      notify('Không có đơn nào để tính.', { title: 'Tính tiền', kind: 'error' });
      return;
    }
    if (!confirm(
      `Ghi số tiền tính được vào ${ids.length} đơn của ${partner.user.name}?\n\n`
      + 'Đơn đã chốt tiền (đã có số tiền + partner đã đánh dấu in) được giữ nguyên.'
    )) return;

    setApplying(true);
    try {
      const res = await api.post(`/partner-report/${partner.user.id}/apply-revenue`, { order_ids: ids });
      notify(res.data?.message || 'Đã tính tiền', { title: 'Tính tiền', kind: 'success' });
      await load();
      onApplied?.();
    } catch (err) {
      notify(err?.response?.data?.message || 'Tính tiền thất bại', { title: 'Tính tiền', kind: 'error' });
    } finally { setApplying(false); }
  };

  const exportCsv = () => {
    const rows = data?.orders || [];
    if (rows.length === 0) return;
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['system_id', 'ref_id', 'completed_time', 'items', 'qty', 'current', 'computed', 'diff', 'locked', 'cach_tinh'];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([
        r.system_id, r.ref_id, r.completed_time,
        r.items.map(i => `${i.product || ''} x${i.quantity}`).join(' | '),
        r.qty, r.current ?? '', r.computed ?? '', r.diff ?? '', r.locked ? 'yes' : '',
        workingText(r.breakdown),
      ].map(esc).join(','));
    }
    // BOM so Excel opens the Vietnamese product names as UTF-8.
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `partner_${partner.user.name}_${range.date_from || 'all'}_${range.date_to || 'all'}.csv`
      .replace(/\s+/g, '-');
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const t = data?.totals;

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6">
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-[92vw] max-w-5xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200 flex justify-between items-center gap-3">
          <div>
            <h3 className="text-sm font-semibold text-neutral-800">Tính tiền — {partner.user.name}</h3>
            <div className="text-[11px] text-neutral-500">
              {data?.price_list ? `Bảng giá: ${data.price_list.name}` : 'Chưa gán bảng giá'}
            </div>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-800 text-xl leading-none">×</button>
        </div>

        <div className="px-4 py-3 border-b border-neutral-100 flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-neutral-500 block">Từ ngày</label>
            <input type="date" value={range.date_from}
              onChange={e => setRange(r => ({ ...r, date_from: e.target.value }))}
              className="mt-1 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
          </div>
          <div>
            <label className="text-xs text-neutral-500 block">Đến ngày</label>
            <input type="date" value={range.date_to}
              onChange={e => setRange(r => ({ ...r, date_to: e.target.value }))}
              className="mt-1 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
          </div>
          <button onClick={load} className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg">Xem</button>
          <button onClick={exportCsv} disabled={!data?.orders?.length}
            className="px-3 py-1.5 bg-emerald-100 hover:bg-emerald-200 disabled:opacity-40 text-emerald-700 text-sm rounded-lg">
            Export CSV
          </button>
          <button onClick={apply} disabled={applying || !data?.orders?.length}
            className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white text-sm rounded-lg ml-auto">
            {applying ? 'Đang ghi…' : 'Ghi số tiền vào đơn'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-6 text-center text-neutral-400 text-sm">Loading…</p>
          ) : (data?.orders?.length ?? 0) === 0 ? (
            <p className="p-6 text-center text-neutral-400 text-sm">Không có đơn đã ship nào trong khoảng này.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#faf8f6]">
                <tr className="text-neutral-500 text-xs border-b border-neutral-200">
                  <th className="py-2 px-2 w-6"></th>
                  <th className="py-2 px-3 text-left">System ID</th>
                  <th className="py-2 px-3 text-left">Ship lúc</th>
                  <th className="py-2 px-3 text-left">Sản phẩm</th>
                  <th className="py-2 px-3 text-right">SL</th>
                  <th className="py-2 px-3 text-right">Hiện tại</th>
                  <th className="py-2 px-3 text-right">Tính ra</th>
                  <th className="py-2 px-3 text-right">Chênh</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map(o => (
                  <Fragment key={o.order_id}>
                  <tr onClick={() => toggle(o.order_id)} title="Bấm để xem cách tính"
                    className={`border-b border-neutral-100 cursor-pointer hover:bg-orange-50/60 ${o.settled ? 'bg-neutral-50' : ''}`}>
                    <td className="py-1.5 px-2 text-neutral-400 text-[10px] select-none">
                      {open.has(o.order_id) ? '▼' : '▶'}
                    </td>
                    <td className="py-1.5 px-3 font-mono text-orange-500 text-xs">
                      {o.system_id}
                      {o.locked && (
                        <span className={`ml-1.5 text-[10px] ${o.settled ? 'text-neutral-500' : 'text-neutral-300'}`}
                          title={o.settled
                            ? 'Partner đã đánh dấu in và số tiền đã chốt — không ghi đè'
                            : 'Partner đã đánh dấu in nhưng chưa có số tiền — vẫn sẽ được tính'}>🔒</span>
                      )}
                    </td>
                    <td className="py-1.5 px-3 text-neutral-500 text-xs">{o.completed_time || '—'}</td>
                    <td className="py-1.5 px-3 text-neutral-700 text-xs">
                      {o.items.map(i => `${i.product || '?'} ×${i.quantity}`).join(', ')}
                    </td>
                    <td className="py-1.5 px-3 text-right text-neutral-600">{o.qty}</td>
                    <td className="py-1.5 px-3 text-right text-neutral-600">{fmt$(o.current)}</td>
                    <td className="py-1.5 px-3 text-right font-medium text-neutral-800">{fmt$(o.computed)}</td>
                    <td className={`py-1.5 px-3 text-right text-xs ${
                      o.diff == null ? 'text-neutral-300'
                        : o.diff > 0 ? 'text-emerald-600' : o.diff < 0 ? 'text-red-500' : 'text-neutral-400'
                    }`}>
                      {o.diff == null ? '—' : (o.diff > 0 ? `+${o.diff.toFixed(2)}` : o.diff.toFixed(2))}
                    </td>
                  </tr>
                  {open.has(o.order_id) && (
                    <tr className="border-b border-neutral-100 bg-[#faf8f6]">
                      <td colSpan={8} className="px-6 py-3">
                        <Working lines={o.breakdown} total={o.computed} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {t && (
          <div className="px-4 py-3 border-t border-neutral-200 flex flex-wrap gap-4 text-sm">
            <span className="text-neutral-600">{t.orders} đơn · {t.qty} sản phẩm</span>
            <span className="text-neutral-600">Hiện tại: <b>{fmt$(t.current)}</b></span>
            <span className="text-emerald-700">Tính ra: <b>{fmt$(t.computed)}</b></span>
            {t.settled > 0 && <span className="text-neutral-500">{t.settled} đơn đã chốt tiền (giữ nguyên)</span>}
            {t.unpriced > 0 && <span className="text-amber-600">{t.unpriced} đơn chưa có tiền</span>}
          </div>
        )}
      </div>
    </div>
  );
}
