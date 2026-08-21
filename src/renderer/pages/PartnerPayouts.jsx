import { useState, useEffect } from 'react';
import api from '../services/api';
import { notify } from '../components/Dialog';

/**
 * Every payment made to partners, in one ledger.
 *
 * The partner dashboard shows each partner's own history inside their card;
 * this is the view for the question that card cannot answer — what went out
 * this month, across everyone.
 */
const fmt$ = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);

const METHOD_LABELS = {
  bank_transfer: 'Chuyển khoản',
  cash: 'Tiền mặt',
  momo: 'Momo',
  paypal: 'PayPal',
};

export default function PartnerPayouts() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [partners, setPartners] = useState([]);
  const [filters, setFilters] = useState({ user_id: '', page: 1 });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = { page: filters.page, per_page: 50 };
      if (filters.user_id) params.user_id = filters.user_id;
      const res = await api.get('/partner-payouts', { params });
      setRows(res.data?.data || []);
      setMeta(res.data);
    } catch (err) {
      notify(err?.response?.data?.message || 'Không tải được danh sách', { title: 'Partner Payout', kind: 'error' });
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [filters.user_id, filters.page]);
  useEffect(() => {
    api.get('/gangsheets/partner-users').then(res => setPartners(res.data || [])).catch(() => {});
  }, []);

  // Sum of the page in view, not of everything — say which, or the number
  // reads as a grand total it is not.
  const pageTotal = rows.reduce((s, r) => s + Number(r.amount || 0), 0);

  const cancel = async (row) => {
    if (!confirm(
      `Huỷ giao dịch ${fmt$(row.amount)} trả cho ${row.partner?.name || '?'} `
      + `ngày ${new Date(row.created_at).toLocaleDateString()}?\n\nSố tiền sẽ quay lại phần còn nợ.`
    )) return;
    try {
      const res = await api.delete(`/partner-payouts/${row.id}`);
      notify(res.data?.message || 'Đã huỷ', { title: 'Partner Payout', kind: 'success' });
      load();
    } catch (err) {
      // 409 = the partner already confirmed receiving it. Only then does the
      // second question get asked, so a routine cancel never leads with it.
      if (err?.response?.status === 409 && err.response.data?.needs_force) {
        if (!confirm(`${err.response.data.message}\n\nVẫn huỷ?`)) return;
        try {
          const res = await api.delete(`/partner-payouts/${row.id}`, { params: { force: 1 } });
          notify(res.data?.message || 'Đã huỷ', { title: 'Partner Payout', kind: 'success' });
          load();
        } catch (e2) {
          notify(e2?.response?.data?.message || 'Huỷ thất bại', { title: 'Partner Payout', kind: 'error' });
        }
        return;
      }
      notify(err?.response?.data?.message || 'Huỷ thất bại', { title: 'Partner Payout', kind: 'error' });
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-neutral-800">Partner Payout</h2>
          <p className="text-xs text-neutral-500">Toàn bộ giao dịch đã trả cho partner.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={filters.user_id}
            onChange={e => setFilters({ user_id: e.target.value, page: 1 })}
            className="px-3 py-1.5 bg-white border border-neutral-200 rounded-lg text-sm">
            <option value="">Tất cả partner</option>
            {partners.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <button onClick={load} className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">
            Refresh
          </button>
          <button onClick={() => setCreating(true)}
            className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg">
            + Tạo payout
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
        {loading ? (
          <p className="p-6 text-center text-neutral-400 text-sm">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-neutral-400 text-sm">Chưa có giao dịch nào.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#faf8f6] text-neutral-500 text-xs">
              <tr className="border-b border-neutral-200">
                <th className="text-left px-3 py-2">Ngày</th>
                <th className="text-left px-3 py-2">Partner</th>
                <th className="text-right px-3 py-2">Số tiền</th>
                <th className="text-left px-3 py-2">Hình thức</th>
                <th className="text-left px-3 py-2">Mã GD</th>
                <th className="text-left px-3 py-2">Kỳ</th>
                <th className="text-left px-3 py-2">Ghi chú</th>
                <th className="text-right px-3 py-2">Còn nợ sau</th>
                <th className="text-left px-3 py-2">Partner xác nhận</th>
                <th className="text-left px-3 py-2">Người ghi</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className="border-b border-neutral-100 hover:bg-orange-50/40">
                  <td className="px-3 py-2 text-neutral-500 text-xs">{new Date(row.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2 font-medium text-neutral-800">{row.partner?.name || '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold text-emerald-700">{fmt$(row.amount)}</td>
                  <td className="px-3 py-2 text-neutral-600 text-xs">{METHOD_LABELS[row.method] || row.method || '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-500">{row.transaction_id || '—'}</td>
                  <td className="px-3 py-2 text-neutral-500 text-xs">
                    {row.period_from || row.period_to
                      ? `${row.period_from || '…'} → ${row.period_to || '…'}`
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-neutral-500 text-xs">{row.note || '—'}</td>
                  <td className={`px-3 py-2 text-right text-xs ${
                    Number(row.balance_after) > 0 ? 'text-red-600' : 'text-neutral-500'
                  }`}>
                    {fmt$(row.balance_after)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {row.confirmed_at ? (
                      <span className="text-emerald-700" title={row.confirmed_note || ''}>
                        ✓ {new Date(row.confirmed_at).toLocaleDateString()}
                        {row.confirmed_note && <span className="text-neutral-400"> · {row.confirmed_note}</span>}
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">chờ xác nhận</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-neutral-400 text-xs">{row.creator?.name || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => cancel(row)} className="text-red-500 hover:text-red-700 text-xs">Huỷ</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating && (
        <CreatePayoutModal partners={partners} onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); load(); }} />
      )}

      {meta && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-neutral-600">
            {meta.total} giao dịch · tổng trang này <b className="text-emerald-700">{fmt$(pageTotal)}</b>
          </span>
          {meta.last_page > 1 && (
            <div className="flex items-center gap-2">
              <button disabled={filters.page <= 1}
                onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}
                className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 disabled:opacity-40 rounded-lg text-sm">←</button>
              <span className="text-neutral-500 text-xs">{meta.current_page}/{meta.last_page}</span>
              <button disabled={filters.page >= meta.last_page}
                onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
                className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 disabled:opacity-40 rounded-lg text-sm">→</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Record a payment from the ledger page.
 *
 * Picking a partner pulls what they are owed, so the amount is entered against
 * a figure rather than from memory — but it stays a free number: part payments
 * and rounded transfers are normal, and forcing the owed amount would only
 * make people record something that did not happen.
 */
function CreatePayoutModal({ partners, onClose, onCreated }) {
  const [form, setForm] = useState({
    user_id: '', amount: '', method: 'bank_transfer',
    transaction_id: '', period_from: '', period_to: '', note: '',
  });
  const [sum, setSum] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!form.user_id) { setSum(null); return; }
    api.get(`/partner-payouts/summary/${form.user_id}`)
      .then(res => setSum(res.data))
      .catch(() => setSum(null));
  }, [form.user_id]);

  const submit = async () => {
    if (!form.user_id) { notify('Chọn partner.', { title: 'Tạo payout', kind: 'error' }); return; }
    const amount = Number(form.amount);
    if (!(amount > 0)) { notify('Nhập số tiền.', { title: 'Tạo payout', kind: 'error' }); return; }

    const name = partners.find(u => String(u.id) === String(form.user_id))?.name || '';
    if (!confirm(`Ghi nhận đã trả ${fmt$(amount)} cho ${name}?`)) return;

    setSaving(true);
    try {
      const res = await api.post('/partner-payouts', {
        user_id: Number(form.user_id),
        amount,
        method: form.method || null,
        transaction_id: form.transaction_id || null,
        period_from: form.period_from || null,
        period_to: form.period_to || null,
        note: form.note || null,
      });
      notify(res.data?.message || 'Đã ghi nhận', { title: 'Tạo payout', kind: 'success' });
      onCreated?.();
    } catch (err) {
      notify(err?.response?.data?.message || 'Ghi nhận thất bại', { title: 'Tạo payout', kind: 'error' });
    } finally { setSaving(false); }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6">
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-[92vw] max-w-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200 flex justify-between items-center">
          <h3 className="text-sm font-semibold text-neutral-800">Tạo payout partner</h3>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-800 text-xl leading-none">×</button>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-500 block">Partner</label>
              <select value={form.user_id} onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}
                className="mt-1 w-full px-2 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm">
                <option value="">— chọn partner —</option>
                {partners.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-neutral-500 block">Số tiền đã trả</label>
              <input type="number" step="0.01" min="0" value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                placeholder={sum ? Number(sum.owed).toFixed(2) : '0.00'}
                className="mt-1 w-full px-2 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm text-right font-mono" />
            </div>
          </div>

          {sum && (
            <div className="bg-[#faf8f6] rounded-lg px-3 py-2 text-xs flex flex-wrap gap-4">
              <span className="text-neutral-600">Đã tính: <b>{fmt$(sum.earned)}</b></span>
              <span className="text-emerald-700">Đã trả: <b>{fmt$(sum.paid)}</b></span>
              <span className="text-red-600">Còn nợ: <b>{fmt$(sum.owed)}</b></span>
              {sum.owed > 0 && (
                <button onClick={() => setForm(f => ({ ...f, amount: String(sum.owed) }))}
                  className="text-orange-600 hover:text-orange-700 underline">trả hết</button>
              )}
              {sum.unpriced > 0 && (
                <span className="text-amber-600 w-full">
                  {sum.unpriced} đơn đã ship chưa tính tiền — chưa nằm trong "Đã tính".
                </span>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
                placeholder="FT2608…" className="mt-1 w-full px-2 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="text-xs text-neutral-500 block">Kỳ từ</label>
              <input type="date" value={form.period_from} onChange={e => setForm(f => ({ ...f, period_from: e.target.value }))}
                className="mt-1 w-full px-2 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="text-xs text-neutral-500 block">Kỳ đến</label>
              <input type="date" value={form.period_to} onChange={e => setForm(f => ({ ...f, period_to: e.target.value }))}
                className="mt-1 w-full px-2 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
            </div>
          </div>

          <div>
            <label className="text-xs text-neutral-500 block">Ghi chú</label>
            <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              placeholder="Kỳ 1–15/08" className="mt-1 w-full px-2 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
          </div>
        </div>

        <div className="px-4 py-3 border-t border-neutral-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Huỷ</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg">
            {saving ? 'Đang ghi…' : 'Ghi nhận đã trả'}
          </button>
        </div>
      </div>
    </div>
  );
}
