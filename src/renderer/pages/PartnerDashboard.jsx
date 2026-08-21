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
  const [payFor, setPayFor] = useState(null);

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
          {partners.map(p => (
            <PartnerCard key={p.user.id} p={p}
              onOpen={() => setDetailFor(p)}
              onPay={() => setPayFor(p)} />
          ))}
        </div>
      )}

      {detailFor && (
        <RevenueModal partner={detailFor} onClose={() => setDetailFor(null)} onApplied={load} />
      )}
      {payFor && (
        <PayoutModal partner={payFor} onClose={() => setPayFor(null)} onPaid={load} />
      )}
    </div>
  );
}

function PartnerCard({ p, onOpen, onPay }) {
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
        <div className="flex gap-1.5 shrink-0">
          <button onClick={onOpen}
            className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs rounded-lg">
            Tính tiền
          </button>
          <button onClick={onPay}
            className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs rounded-lg">
            Trả tiền
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Hôm nay" value={p.shipped_today} />
        <Stat label={`${p.daily.length ? 'Trong kỳ' : 'Kỳ này'}`} value={p.shipped_window} />
        <Stat label="Tổng ship" value={p.shipped_total} />
      </div>

      {/* Money owed on orders the seller has not settled is money going out
          ahead of money coming in — worth seeing apart from the rest. */}
      <div className="grid grid-cols-2 gap-2 text-center">
        <Stat label={`Đơn đã paid · ${p.orders_paid} đơn`} value={fmt$(p.revenue_paid)} tone="emerald" />
        <Stat label={`Đơn chưa paid · ${p.orders_unpaid} đơn`} value={fmt$(p.revenue_unpaid)} tone="amber" />
      </div>

      {/* What we owe the partner, versus what we have already handed over. */}
      <div className="grid grid-cols-2 gap-2 text-center">
        <Stat label={`Còn nợ partner · ${p.owed_orders} đơn`} value={fmt$(p.owed)} tone="red" />
        <Stat label="Đã trả partner" value={fmt$(p.paid_out)} />
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

const STAT_TONES = {
  emerald: 'text-emerald-600',
  amber: 'text-amber-600',
  red: 'text-red-600',
};

function Stat({ label, value, tone }) {
  return (
    <div className="bg-[#faf8f6] rounded-lg py-2">
      <div className={`text-lg font-bold ${STAT_TONES[tone] || 'text-neutral-800'}`}>{value}</div>
      <div className="text-[10px] text-neutral-500">{label}</div>
    </div>
  );
}

/**
 * Recording a payment to a partner, and the history of past ones.
 *
 * The amount comes from the orders being settled, not from a box the user
 * types in — the same reason order totals are computed server-side. An
 * explicit amount can still be given when the transfer was rounded or
 * adjusted, and the hub keeps both figures so the difference stays visible.
 */
function PayoutModal({ partner, onClose, onPaid }) {
  const [data, setData] = useState(null);        // { orders, total, count, unpriced }
  const [history, setHistory] = useState([]);
  const [picked, setPicked] = useState(null);    // null = every unpaid order
  const [form, setForm] = useState({ method: 'bank_transfer', transaction_id: '', note: '', amount: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [out, hist] = await Promise.all([
        api.get(`/partner-payouts/outstanding/${partner.user.id}`),
        api.get('/partner-payouts', { params: { user_id: partner.user.id, per_page: 20 } }),
      ]);
      setData(out.data);
      setHistory(hist.data?.data || []);
      setPicked(null);
    } catch (err) {
      notify(err?.response?.data?.message || 'Không tải được công nợ', { title: 'Trả tiền', kind: 'error' });
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const orders = data?.orders || [];
  const chosen = picked ?? new Set(orders.map(o => o.id));
  const chosenTotal = orders
    .filter(o => chosen.has(o.id))
    .reduce((s, o) => s + Number(o.partner_revenue || 0), 0);

  const toggle = (id) => setPicked(prev => {
    const next = new Set(prev ?? orders.map(o => o.id));
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const submit = async () => {
    const ids = [...chosen];
    if (ids.length === 0 && !form.amount) {
      notify('Chọn ít nhất 1 đơn, hoặc nhập số tiền.', { title: 'Trả tiền', kind: 'error' });
      return;
    }
    if (!confirm(
      `Ghi nhận đã trả ${fmt$(form.amount || chosenTotal)} cho ${partner.user.name}?\n\n`
      + `${ids.length} đơn sẽ được đánh dấu đã thanh toán.`
    )) return;

    setSaving(true);
    try {
      const res = await api.post('/partner-payouts', {
        user_id: partner.user.id,
        order_ids: ids,
        amount: form.amount === '' ? null : Number(form.amount),
        method: form.method || null,
        transaction_id: form.transaction_id || null,
        note: form.note || null,
      });
      notify(res.data?.message || 'Đã ghi nhận', { title: 'Trả tiền', kind: 'success' });
      setForm(f => ({ ...f, transaction_id: '', note: '', amount: '' }));
      await load();
      onPaid?.();
    } catch (err) {
      notify(err?.response?.data?.message || 'Ghi nhận thất bại', { title: 'Trả tiền', kind: 'error' });
    } finally { setSaving(false); }
  };

  const cancelPayout = async (row) => {
    if (!confirm(
      `Huỷ giao dịch #${row.id} (${fmt$(row.amount)})?\n\n`
      + `${row.orders_count} đơn sẽ quay lại trạng thái chưa thanh toán.`
    )) return;
    try {
      const res = await api.delete(`/partner-payouts/${row.id}`);
      notify(res.data?.message || 'Đã huỷ', { title: 'Trả tiền', kind: 'success' });
      await load();
      onPaid?.();
    } catch (err) {
      notify(err?.response?.data?.message || 'Huỷ thất bại', { title: 'Trả tiền', kind: 'error' });
    }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6">
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-[92vw] max-w-4xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200 flex justify-between items-center">
          <div>
            <h3 className="text-sm font-semibold text-neutral-800">Trả tiền — {partner.user.name}</h3>
            <div className="text-[11px] text-neutral-500">
              Còn nợ <b className="text-red-600">{fmt$(data?.total)}</b> trên {data?.count ?? 0} đơn
              {data?.unpriced > 0 && (
                <span className="text-amber-600"> · {data.unpriced} đơn chưa tính tiền (chưa trả được)</span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-800 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-6 text-center text-neutral-400 text-sm">Loading…</p>
          ) : (
            <div className="p-4 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-neutral-600">Đơn chưa thanh toán</span>
                  <span className="text-xs text-neutral-500">
                    Chọn {chosen.size}/{orders.length} · <b className="text-orange-600">{fmt$(chosenTotal)}</b>
                  </span>
                </div>
                {orders.length === 0 ? (
                  <p className="text-neutral-400 text-sm">Không còn đơn nào chưa trả.</p>
                ) : (
                  <div className="border border-neutral-200 rounded-lg overflow-hidden max-h-56 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-[#faf8f6] text-neutral-500 sticky top-0">
                        <tr>
                          <th className="px-2 py-1.5 w-8"></th>
                          <th className="text-left px-2 py-1.5">System ID</th>
                          <th className="text-left px-2 py-1.5">Ship lúc</th>
                          <th className="text-right px-2 py-1.5">Partner nhận</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map(o => (
                          <tr key={o.id} className="border-t border-neutral-100">
                            <td className="px-2 py-1.5">
                              <input type="checkbox" checked={chosen.has(o.id)}
                                onChange={() => toggle(o.id)} className="accent-orange-500" />
                            </td>
                            <td className="px-2 py-1.5 font-mono text-orange-600">{o.system_id}</td>
                            <td className="px-2 py-1.5 text-neutral-500">
                              {o.completed_time ? new Date(o.completed_time).toLocaleDateString() : '—'}
                            </td>
                            <td className="px-2 py-1.5 text-right font-medium">{fmt$(o.partner_revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 border-t border-neutral-100 pt-3">
                <div>
                  <label className="text-xs text-neutral-500 block">Hình thức</label>
                  <select value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))}
                    className="mt-1 w-full px-2 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm">
                    <option value="bank_transfer">Chuyển khoản</option>
                    <option value="cash">Tiền mặt</option>
                    <option value="momo">Momo</option>
                    <option value="paypal">PayPal</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-neutral-500 block">Mã giao dịch</label>
                  <input value={form.transaction_id} onChange={e => setForm(f => ({ ...f, transaction_id: e.target.value }))}
                    placeholder="FT2608..." className="mt-1 w-full px-2 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
                </div>
                <div>
                  {/* Blank means "exactly what the chosen orders add up to" —
                      fill this only when the transfer differed. */}
                  <label className="text-xs text-neutral-500 block">Số tiền (nếu khác)</label>
                  <input type="number" step="0.01" min="0" value={form.amount}
                    onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                    placeholder={chosenTotal.toFixed(2)}
                    className="mt-1 w-full px-2 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm text-right font-mono" />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 block">Ghi chú</label>
                  <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                    placeholder="Kỳ 1–15/08" className="mt-1 w-full px-2 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
                </div>
              </div>

              {history.length > 0 && (
                <div className="border-t border-neutral-100 pt-3">
                  <div className="text-xs font-semibold text-neutral-600 mb-2">Lịch sử giao dịch</div>
                  <table className="w-full text-xs">
                    <thead className="bg-[#faf8f6] text-neutral-500">
                      <tr>
                        <th className="text-left px-2 py-1.5">Ngày</th>
                        <th className="text-right px-2 py-1.5">Số tiền</th>
                        <th className="text-left px-2 py-1.5">Hình thức</th>
                        <th className="text-left px-2 py-1.5">Mã GD</th>
                        <th className="text-right px-2 py-1.5">Đơn</th>
                        <th className="text-right px-2 py-1.5">Còn nợ sau</th>
                        <th className="px-2 py-1.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map(row => (
                        <tr key={row.id} className="border-t border-neutral-100">
                          <td className="px-2 py-1.5 text-neutral-500">{new Date(row.created_at).toLocaleDateString()}</td>
                          <td className="px-2 py-1.5 text-right font-medium text-emerald-700">{fmt$(row.amount)}</td>
                          <td className="px-2 py-1.5 text-neutral-600">{row.method || '—'}</td>
                          <td className="px-2 py-1.5 font-mono text-neutral-500">{row.transaction_id || '—'}</td>
                          <td className="px-2 py-1.5 text-right text-neutral-600">{row.orders_count}</td>
                          <td className="px-2 py-1.5 text-right text-neutral-500">{fmt$(row.balance_after)}</td>
                          <td className="px-2 py-1.5 text-right">
                            <button onClick={() => cancelPayout(row)}
                              className="text-red-500 hover:text-red-700" title="Huỷ giao dịch, trả đơn về chưa thanh toán">
                              Huỷ
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-neutral-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Đóng</button>
          <button onClick={submit} disabled={saving || loading}
            className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg">
            {saving ? 'Đang ghi…' : `Ghi nhận đã trả ${fmt$(form.amount || chosenTotal)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The working behind a partner's pay: every shipped order, what it is worth
 * now, and what the rate card says. A preview first — applying writes the
 * computed amounts onto the orders, and locked ones are never touched.
 */
/**
 * The arithmetic behind one order's amount, laid out the way the order itself
 * is priced: per item base_cost + 2nd_fee x (faces - 1) + add-ons, all x SL,
 * then the once-per-order shipping component. An amount nobody can check is an
 * amount nobody can argue with.
 */
function Working({ breakdown, total }) {
  const items = breakdown?.items || [];
  const orderParts = breakdown?.order || [];

  if (items.length === 0 && orderParts.length === 0) {
    return <p className="text-xs text-neutral-400">Bảng giá chưa có giá cho sản phẩm của đơn này.</p>;
  }

  return (
    <div className="space-y-3">
      {items.map((l, i) => (
        <div key={i} className="text-xs">
          <div className="font-medium text-neutral-700">
            {l.product || '?'}{l.sku ? <span className="text-neutral-400 font-normal"> · {l.sku}</span> : null}
          </div>
          <div className="mt-1 pl-3 border-l-2 border-neutral-200 space-y-0.5">
            {l.parts.length === 0 && (
              <div className="text-neutral-400">bảng giá không có dòng nào cho variant này</div>
            )}
            {l.parts.map((part, j) => <Row key={j} part={part} amount={part.unit} />)}
            <div className="flex gap-2 pt-0.5 font-medium text-neutral-800">
              <span>Đơn giá {fmt$(l.unit)} × SL {l.quantity}</span>
              <Dots />
              <span>{fmt$(l.total)}</span>
            </div>
          </div>
        </div>
      ))}

      {orderParts.length > 0 && (
        <div className="text-xs">
          {/* Charged once for the whole order, not per item - which is why it
              sits outside the item block rather than inside one. */}
          <div className="font-medium text-neutral-700">Phí ship (tính 1 lần cho cả đơn)</div>
          <div className="mt-1 pl-3 border-l-2 border-neutral-200 space-y-0.5">
            {orderParts.map((part, i) => <Row key={i} part={part} amount={part.amount} />)}
          </div>
        </div>
      )}

      <div className="flex gap-2 text-xs font-semibold text-emerald-700 pt-1 border-t border-neutral-200">
        <span>Tổng đơn</span>
        <span className="flex-1" />
        <span>{fmt$(total)}</span>
      </div>
    </div>
  );
}

const Dots = () => <span className="flex-1 border-b border-dotted border-neutral-300 translate-y-[-3px]" />;

/** One component of the calculation: label, why, and how much. */
function Row({ part, amount }) {
  const isAddon = part.label.startsWith('Add-on');
  // A rate the card has but this order does not owe (one-sided design, single
  // item) is shown struck through at zero rather than hidden - otherwise the
  // reader is left wondering why a rate they set went unused.
  const unused = amount === 0 && part.note;

  return (
    <div className="flex gap-2">
      <span className={isAddon ? 'text-purple-600' : 'text-neutral-600'}>
        {part.label}
        {part.note && <span className="ml-1.5 text-[10px] text-neutral-400">({part.note})</span>}
      </span>
      <Dots />
      <span className={
        amount == null ? 'text-amber-600' : unused ? 'text-neutral-400' : 'text-neutral-700'
      }>
        {amount == null ? 'chưa có giá' : fmt$(amount)}
      </span>
    </div>
  );
}

/** Same working, flattened onto one CSV cell. */
function workingText(breakdown) {
  const items = breakdown?.items || [];
  const orderParts = breakdown?.order || [];
  const one = (label, note, amt) =>
    `${label}${note ? ` (${note})` : ''} ${amt == null ? '(chưa có giá)' : fmt$(amt)}`;

  const parts = items.map(l => {
    const inner = l.parts.map(p => one(p.label, p.note, p.unit)).join(' + ');
    return `${l.product || '?'}: ${inner} = ${fmt$(l.unit)} x${l.quantity} = ${fmt$(l.total)}`;
  });
  if (orderParts.length) {
    parts.push(`Ship: ${orderParts.map(p => one(p.label, p.note, p.amount)).join(' + ')}`);
  }
  return parts.join(' | ');
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
    const header = ['system_id', 'ref_id', 'completed_time', 'items', 'qty', 'current', 'computed', 'diff', 'locked', 'paid', 'cach_tinh'];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([
        r.system_id, r.ref_id, r.completed_time,
        r.items.map(i => `${i.product || ''} x${i.quantity}`).join(' | '),
        r.qty, r.current ?? '', r.computed ?? '', r.diff ?? '', r.locked ? 'yes' : '',
        r.paid ? 'paid' : 'chua paid',
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
                  <th className="py-2 px-3 text-left">Paid</th>
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
                    <td className="py-1.5 px-3 text-xs">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        o.paid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {o.paid ? 'paid' : 'chưa paid'}
                      </span>
                    </td>
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
                      <td colSpan={9} className="px-6 py-3">
                        <Working breakdown={o.breakdown} total={o.computed} />
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
            <span className="text-emerald-700">đơn đã paid: <b>{fmt$(t.computed_paid)}</b></span>
            <span className="text-amber-600">đơn chưa paid: <b>{fmt$(t.computed_unpaid)}</b> ({t.orders_unpaid} đơn)</span>
            {t.settled > 0 && <span className="text-neutral-500">{t.settled} đơn đã chốt tiền (giữ nguyên)</span>}
            {t.unpriced > 0 && <span className="text-amber-600">{t.unpriced} đơn chưa có tiền</span>}
          </div>
        )}
      </div>
    </div>
  );
}
