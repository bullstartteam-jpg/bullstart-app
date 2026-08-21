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
      notify(err?.response?.data?.message || 'Huỷ thất bại', { title: 'Partner Payout', kind: 'error' });
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-neutral-800">Partner Payout</h2>
          <p className="text-xs text-neutral-500">Toàn bộ giao dịch đã trả cho partner. Ghi giao dịch mới ở trang Partner.</p>
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
