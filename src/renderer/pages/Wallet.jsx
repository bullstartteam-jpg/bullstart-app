import { useState, useEffect } from 'react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { notify, askConfirm } from '../components/Dialog';
import Pagination from '../components/Pagination';

const STATUS_BADGE = {
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-emerald-100 text-emerald-700',
};

const TYPE_BADGE = (type) =>
  type === 'deposit' ? 'bg-green-100 text-green-600'
  : type === 'refund' ? 'bg-blue-100 text-blue-600'
  : 'bg-red-100 text-red-500';

export default function Wallet() {
  const [balance, setBalance] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [meta, setMeta] = useState({});
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  // Split deposit vs paid into separate tabs. Each tab paginates independently;
  // switching tabs resets the page back to 1 so users don't land on an empty
  // page 5 when the new filter only has 2 results.
  const [activeTab, setActiveTab] = useState('deposits'); // 'deposits' | 'paid' | 'refunds'
  // Filter state — applies to both the table view and the CSV export.
  // Admin can pick a specific user; sellers only see their own (server enforces).
  const [filters, setFilters] = useState({ user_id: '', date_from: '', date_to: '', search: '' });
  // Separate text state so typing debounces into `filters.search` (which drives
  // the request) rather than firing a query on every keystroke.
  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters(f => (f.search === searchInput.trim() ? f : { ...f, search: searchInput.trim() }));
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // VNPay deposit. Admin can pick a target user to top up on their behalf
  // (vnpayUserId); sellers always credit their own wallet (server enforces).
  const [showVnpay, setShowVnpay] = useState(false);
  const [vnpayRate, setVnpayRate] = useState(null);  // { vnd_to_usd_rate, min_vnd }
  const [vnpayVnd, setVnpayVnd] = useState('');
  const [vnpayUserId, setVnpayUserId] = useState('');
  const [vnpayBusy, setVnpayBusy] = useState(false);

  useEffect(() => {
    api.get('/wallet/vnpay/rate').then(res => setVnpayRate(res.data)).catch(() => {});
  }, []);

  const usdPreview = (() => {
    if (!vnpayRate || !vnpayVnd) return 0;
    const vnd = parseFloat(vnpayVnd) || 0;
    return Math.floor((vnd / vnpayRate.vnd_to_usd_rate) * 100) / 100;
  })();

  const startVnpay = async (e) => {
    e?.preventDefault?.();
    const vnd = parseFloat(vnpayVnd) || 0;
    if (!vnpayRate) return;
    if (vnd < vnpayRate.min_vnd) {
      return notify(`Số tiền tối thiểu ${vnpayRate.min_vnd.toLocaleString()} ₫`, { title: 'VNPay', kind: 'error' });
    }
    setVnpayBusy(true);
    try {
      const payload = { vnd_amount: vnd };
      if (hasRole('admin') && vnpayUserId) payload.user_id = vnpayUserId;
      const res = await api.post('/wallet/vnpay/create', payload);
      const { payment_url } = res.data;
      if (window.electronAPI?.openExternal) {
        await window.electronAPI.openExternal(payment_url);
      } else {
        window.open(payment_url, '_blank');
      }
      setShowVnpay(false);
      setVnpayVnd('');
      setVnpayUserId('');
      await notify('Đã mở trang thanh toán VNPay. Sau khi pay xong, ví sẽ tự cộng USD theo tỷ giá hiện tại.', {
        title: 'VNPay', kind: 'success',
      });
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 5000));
        refreshAll();
      }
    } catch (err) {
      const errs = err.response?.data?.errors;
      const msg = err.response?.data?.message || (errs ? Object.values(errs).flat().join('\n') : 'Error');
      notify(msg, { title: 'VNPay failed', kind: 'error' });
    } finally {
      setVnpayBusy(false);
    }
  };
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositForm, setDepositForm] = useState({ user_id: '', amount: '', method: '', transaction_id: '', note: '' });
  const [users, setUsers] = useState([]);
  const [editingTxId, setEditingTxId] = useState(null);
  const [editForm, setEditForm] = useState({ user_id: '', amount: '', method: '', transaction_id: '', note: '' });
  const { hasRole, user: authUser } = useAuth();

  const buildParams = (extra = {}) => {
    const TAB_TYPE = { paid: 'paid', refunds: 'refund', deposits: 'deposit' };
    const p = { type: TAB_TYPE[activeTab] || 'deposit', ...extra };
    if (filters.user_id)   p.user_id   = filters.user_id;
    if (filters.date_from) p.date_from = filters.date_from;
    if (filters.date_to)   p.date_to   = filters.date_to;
    if (filters.search)    p.search    = filters.search;
    return p;
  };

  const refreshAll = () => {
    api.get('/wallet/balance').then(res => setBalance(res.data));
    setLoading(true);
    api.get('/wallet/transactions', { params: buildParams({ page, per_page: 20 }) })
      .then(res => {
        setTransactions(res.data.data || []);
        setMeta(res.data);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    api.get('/wallet/balance').then(res => setBalance(res.data));
    if (hasRole('admin')) {
      api.get('/users', { params: { per_page: 100 } }).then(res => setUsers(res.data.data || []));
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    api.get('/wallet/transactions', { params: buildParams({ page, per_page: 20 }) })
      .then(res => {
        setTransactions(res.data.data || []);
        setMeta(res.data);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, activeTab, filters.user_id, filters.date_from, filters.date_to, filters.search]);

  const switchTab = (tab) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setPage(1);
  };

  const handleDeposit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...depositForm };
      if (!hasRole('admin')) delete payload.user_id; // server forces seller's own id
      await api.post('/wallet/deposit', payload);
      setShowDeposit(false);
      setDepositForm({ user_id: '', amount: '', method: '', transaction_id: '', note: '' });
      refreshAll();
    } catch (err) {
      const errs = err.response?.data?.errors;
      const msg = err.response?.data?.message || (errs ? Object.values(errs).flat().join('\n') : 'Error');
      notify(msg, { title: 'Deposit failed', kind: 'error' });
    }
  };

  const handleApprove = async (tx) => {
    const ok = await askConfirm(`Approve deposit $${tx.amount} (${tx.method}, tx: ${tx.transaction_id}) for user #${tx.user_id}?`, { title: 'Approve deposit', okText: 'Approve' });
    if (!ok) return;
    try {
      await api.post(`/wallet/deposit/${tx.id}/approve`);
      refreshAll();
    } catch (err) {
      notify(err.response?.data?.message || 'Error', { title: 'Approve failed', kind: 'error' });
    }
  };

  const startEdit = (tx) => {
    setEditingTxId(tx.id);
    setEditForm({
      user_id: tx.user_id ?? '',
      amount: tx.amount,
      method: tx.method || '',
      transaction_id: tx.transaction_id || '',
      note: tx.note || '',
    });
  };

  const saveEdit = async (txId) => {
    try {
      const payload = { ...editForm };
      // Sellers can't move a tx to another user — strip the field so the
      // server doesn't 422 on a no-op admin-only field.
      if (!hasRole('admin')) delete payload.user_id;
      await api.put(`/wallet/deposit/${txId}`, payload);
      setEditingTxId(null);
      refreshAll();
    } catch (err) {
      const errs = err.response?.data?.errors;
      const msg = err.response?.data?.message || (errs ? Object.values(errs).flat().join('\n') : 'Error');
      notify(msg, { title: 'Update failed', kind: 'error' });
    }
  };

  const canEditTx = (tx) => {
    if (tx.type !== 'deposit' || tx.status !== 'pending') return false;
    if (hasRole('admin')) return true;
    return tx.user_id === authUser?.id;
  };

  // Multi-select on the transactions table for admin bulk-refund-delete.
  // Selection clears on tab/page/filter change so a hidden row can't be
  // refunded by mistake.
  const [selectedTxIds, setSelectedTxIds] = useState(new Set());
  const [bulkRefunding, setBulkRefunding] = useState(false);
  useEffect(() => { setSelectedTxIds(new Set()); }, [page, activeTab, filters.user_id, filters.date_from, filters.date_to, filters.search]);

  // A paid tx can be refunded only once — already-refunded rows (refunded_at
  // set, e.g. via the keep-history bulk refund) are excluded from selection.
  const isRefundable = (t) => t.type === 'paid' && !t.refunded_at;

  const toggleSelectTx = (id) => setSelectedTxIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleSelectAllTx = () => {
    const eligible = transactions.filter(isRefundable).map(t => t.id);
    if (eligible.length > 0 && eligible.every(id => selectedTxIds.has(id))) {
      setSelectedTxIds(new Set());
    } else {
      setSelectedTxIds(new Set(eligible));
    }
  };

  const handleBulkRefund = async () => {
    const ids = [...selectedTxIds];
    if (ids.length === 0) return;
    const ok = await askConfirm(
      `Refund ${ids.length} transaction(s)?\n\n` +
      `Số tiền sẽ được cộng lại vào wallet user, tạo thêm 1 transaction refund (giữ lại transaction paid gốc), và paid_cost của đơn liên quan trừ về như chưa pay.`,
      { title: 'Confirm refund', okText: 'Refund' }
    );
    if (!ok) return;
    setBulkRefunding(true);
    try {
      const res = await api.post('/wallet/transactions/bulk-refund', { transaction_ids: ids });
      const errs = res.data.errors || [];
      const tone = errs.length ? 'warning' : 'success';
      notify(
        `${res.data.message}${errs.length ? `\n\nSkipped: ${errs.length}\n• ${errs.slice(0, 5).join('\n• ')}` : ''}`,
        { title: 'Bulk refund', kind: tone }
      );
      setSelectedTxIds(new Set());
      refreshAll();
    } catch (err) {
      notify(err.response?.data?.message || 'Bulk refund failed', { title: 'Bulk refund failed', kind: 'error' });
    } finally {
      setBulkRefunding(false);
    }
  };

  const handleBulkRefundDelete = async () => {
    const ids = [...selectedTxIds];
    if (ids.length === 0) return;
    const ok = await askConfirm(
      `Refund + DELETE ${ids.length} transaction(s)?\n\n` +
      `Số tiền sẽ được cộng lại vào wallet user, paid_cost của đơn liên quan trừ về như chưa pay, và bản ghi transaction sẽ bị xoá vĩnh viễn.\n\n` +
      `Hành động này không thể undo.`,
      { title: 'Confirm refund + delete', okText: 'Refund + Delete' }
    );
    if (!ok) return;
    setBulkRefunding(true);
    try {
      const res = await api.post('/wallet/transactions/bulk-refund-delete', { transaction_ids: ids });
      const errs = res.data.errors || [];
      const tone = errs.length ? 'warning' : 'success';
      notify(
        `${res.data.message}${errs.length ? `\n\nSkipped: ${errs.length}\n• ${errs.slice(0, 5).join('\n• ')}` : ''}`,
        { title: 'Bulk refund + delete', kind: tone }
      );
      setSelectedTxIds(new Set());
      refreshAll();
    } catch (err) {
      notify(err.response?.data?.message || 'Bulk refund failed', { title: 'Bulk refund failed', kind: 'error' });
    } finally {
      setBulkRefunding(false);
    }
  };

  // Streaming CSV export of transactions matching the current tab's filter.
  // Filename encodes tab + date stamp so downloads don't collide.
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    setExporting(true);
    try {
      // Export uses the same filter state as the table — what you see is
      // what you get. Drops pagination (export is full-set).
      const params = buildParams();
      const res = await api.get('/wallet/transactions/export', { params, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      // Encode active filter slugs in the filename for traceability.
      const slug = [
        params.type,
        params.user_id ? `u${params.user_id}` : null,
        params.date_from || null,
        params.date_to || null,
      ].filter(Boolean).join('_');
      a.download = `wallet_${slug}_${stamp}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      notify(`Exported ${params.type} transactions`, { title: 'Export', kind: 'success' });
    } catch (err) {
      notify(err.response?.data?.message || 'Export failed', { title: 'Export failed', kind: 'error' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-neutral-800">Wallet</h2>
        <div className="flex gap-2">
          {hasRole('admin') && activeTab === 'paid' && selectedTxIds.size > 0 && (
            <>
              <button
                onClick={handleBulkRefund}
                disabled={bulkRefunding}
                className="px-3 py-2 bg-blue-100 hover:bg-blue-200 disabled:opacity-50 text-blue-700 text-sm rounded-lg"
                title="Hoàn tiền các transaction đã chọn + tạo transaction refund (giữ lại bản ghi paid) + reset paid_cost của đơn"
              >
                {bulkRefunding ? 'Refunding…' : `↩ Refund (${selectedTxIds.size})`}
              </button>
              <button
                onClick={handleBulkRefundDelete}
                disabled={bulkRefunding}
                className="px-3 py-2 bg-red-100 hover:bg-red-200 disabled:opacity-50 text-red-700 text-sm rounded-lg"
                title="Hoàn tiền các transaction đã chọn + xoá bản ghi + reset paid_cost của đơn"
              >
                {bulkRefunding ? 'Refunding…' : `↩ Refund + Delete (${selectedTxIds.size})`}
              </button>
            </>
          )}
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-3 py-2 bg-purple-100 hover:bg-purple-200 disabled:opacity-50 text-purple-700 text-sm rounded-lg"
            title={`Export tab "${activeTab}" sang CSV`}
          >
            {exporting ? 'Exporting…' : `⬇ Export ${activeTab === 'paid' ? 'Paid' : activeTab === 'refunds' ? 'Refunds' : 'Deposits'}`}
          </button>
          <button
            onClick={() => { setShowVnpay(true); setShowDeposit(false); }}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg"
            title="Nạp tiền cho ví của chính bạn qua VNPay (ATM / QR / Visa)"
          >
            Deposit qua VNPay
          </button>
          <button
            onClick={() => { setShowDeposit(!showDeposit); setShowVnpay(false); }}
            className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg"
          >
            {showDeposit ? 'Cancel' : (hasRole('admin') ? 'Manual Deposit' : 'Request Deposit')}
          </button>
        </div>
      </div>

      {/* VNPay deposit form */}
      {showVnpay && (
        <div className="mb-4 bg-white rounded-xl border border-blue-200 p-5 shadow-sm">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="text-base font-semibold text-blue-700">Deposit qua VNPay</h3>
              <p className="text-xs text-neutral-500 mt-1">
                Chuyển khoản VNPay (ATM / QR / Visa) → wallet tự cộng USD theo tỷ giá hiện tại.
                {hasRole('admin') && ' Admin có thể chọn user để nạp hộ khách.'}
              </p>
            </div>
            <button onClick={() => setShowVnpay(false)} className="text-xs text-neutral-400 hover:text-neutral-700">✕</button>
          </div>
          {!vnpayRate ? (
            <p className="text-sm text-neutral-500">Loading rate…</p>
          ) : (
            <form onSubmit={startVnpay} className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-blue-50 rounded-lg p-2">
                  <div className="text-xs text-blue-600">Tỷ giá hiện tại</div>
                  <div className="font-semibold text-neutral-800">1 USD = {vnpayRate.vnd_to_usd_rate.toLocaleString()} ₫</div>
                </div>
                <div className="bg-neutral-50 rounded-lg p-2">
                  <div className="text-xs text-neutral-500">Tối thiểu</div>
                  <div className="font-semibold text-neutral-800">{vnpayRate.min_vnd.toLocaleString()} ₫</div>
                </div>
              </div>
              {hasRole('admin') && (
                <div>
                  <label className="text-xs text-neutral-500">Nạp cho user</label>
                  <select
                    value={vnpayUserId}
                    onChange={e => setVnpayUserId(e.target.value)}
                    className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm"
                  >
                    <option value="">— Chính tôi —</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs text-neutral-500">Số tiền VND</label>
                <input
                  type="number"
                  value={vnpayVnd}
                  onChange={e => setVnpayVnd(e.target.value)}
                  required
                  min={vnpayRate.min_vnd}
                  step="any"
                  placeholder="vd 500000"
                  className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-base font-mono"
                />
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center justify-between">
                <span className="text-sm text-neutral-600">Wallet sẽ nhận</span>
                <span className="font-extrabold text-emerald-700 text-2xl">${usdPreview.toFixed(2)}</span>
              </div>
              <button
                type="submit"
                disabled={vnpayBusy || !vnpayVnd}
                className="w-full px-4 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
              >
                {vnpayBusy ? 'Mở VNPay…' : 'Tiếp tục → mở VNPay'}
              </button>
            </form>
          )}
        </div>
      )}

      {/* Balance cards */}
      {balance && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
            <div className="text-xs text-neutral-500">Balance</div>
            <div className="text-xl font-bold text-neutral-800">${balance.wallet}</div>
          </div>
          <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
            <div className="text-xs text-neutral-500">Deposited</div>
            <div className="text-xl font-bold text-green-600">${balance.total_deposited}</div>
          </div>
          <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
            <div className="text-xs text-neutral-500">Pending</div>
            <div className="text-xl font-bold text-yellow-600">${balance.pending_deposits ?? 0}</div>
          </div>
          <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
            <div className="text-xs text-neutral-500">Paid</div>
            <div className="text-xl font-bold text-red-500">${balance.total_paid}</div>
          </div>
          <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
            <div className="text-xs text-neutral-500">Refunded</div>
            <div className="text-xl font-bold text-orange-500">${balance.total_refunded}</div>
          </div>
        </div>
      )}

      {/* Deposit form */}
      {showDeposit && (
        <form onSubmit={handleDeposit} className="mb-4 bg-white rounded-xl border border-neutral-200 p-4 flex gap-3 items-end shadow-sm flex-wrap">
          {hasRole('admin') && (
            <div>
              <label className="text-xs text-neutral-500">User</label>
              <select value={depositForm.user_id} onChange={e => setDepositForm({ ...depositForm, user_id: e.target.value })} required className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm">
                <option value="">Select user...</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-xs text-neutral-500">Amount</label>
            <input type="number" step="0.01" min="0.01" value={depositForm.amount} onChange={e => setDepositForm({ ...depositForm, amount: e.target.value })} required className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
          </div>
          <div>
            <label className="text-xs text-neutral-500">Method</label>
            <select value={depositForm.method} onChange={e => setDepositForm({ ...depositForm, method: e.target.value })} required className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm">
              <option value="">Select method...</option>
              <option value="paypal">PayPal</option>
              <option value="pingpong">PingPong</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-neutral-500">Transaction ID</label>
            <input value={depositForm.transaction_id} onChange={e => setDepositForm({ ...depositForm, transaction_id: e.target.value })} required placeholder="Gateway tx ref" className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
          </div>
          <div>
            <label className="text-xs text-neutral-500">Note</label>
            <input value={depositForm.note} onChange={e => setDepositForm({ ...depositForm, note: e.target.value })} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
          </div>
          <button type="submit" className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg">Submit</button>
        </form>
      )}

      {/* Filter bar — applies to both table view and CSV export */}
      <div className="mb-3 flex flex-wrap gap-2 items-end bg-white border border-neutral-200 rounded-xl p-3 shadow-sm">
        {hasRole('admin') && (
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-neutral-500 font-semibold mb-1">User</label>
            <select
              value={filters.user_id}
              onChange={e => { setFilters(f => ({ ...f, user_id: e.target.value })); setPage(1); }}
              className="px-2 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded text-sm min-w-[200px]"
            >
              <option value="">— all users —</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-neutral-500 font-semibold mb-1">Search</label>
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="ref_id hoặc system_id…"
            className="px-2 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded text-sm min-w-[200px]"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-neutral-500 font-semibold mb-1">From</label>
          <input
            type="date"
            value={filters.date_from}
            onChange={e => { setFilters(f => ({ ...f, date_from: e.target.value })); setPage(1); }}
            className="px-2 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded text-sm"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-neutral-500 font-semibold mb-1">To</label>
          <input
            type="date"
            value={filters.date_to}
            onChange={e => { setFilters(f => ({ ...f, date_to: e.target.value })); setPage(1); }}
            className="px-2 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded text-sm"
          />
        </div>
        {(filters.user_id || filters.date_from || filters.date_to || filters.search) && (
          <button
            onClick={() => { setFilters({ user_id: '', date_from: '', date_to: '', search: '' }); setSearchInput(''); setPage(1); }}
            className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs rounded"
          >
            Clear filters
          </button>
        )}
        <span className="text-xs text-neutral-500 ml-auto">
          {meta.total != null && (
            <>Showing <span className="font-semibold">{meta.total}</span> {activeTab}</>
          )}
        </span>
      </div>

      {/* Tabs split deposits and paid transactions */}
      <div className="flex gap-1 mb-3 border-b border-neutral-200">
        <TabBtn active={activeTab === 'deposits'} onClick={() => switchTab('deposits')}>
          Deposits {balance && <span className="ml-1 text-xs opacity-70">${balance.total_deposited}</span>}
        </TabBtn>
        <TabBtn active={activeTab === 'paid'} onClick={() => switchTab('paid')}>
          Paid {balance && <span className="ml-1 text-xs opacity-70">${balance.total_paid}</span>}
        </TabBtn>
        <TabBtn active={activeTab === 'refunds'} onClick={() => switchTab('refunds')}>
          Refunds {balance && <span className="ml-1 text-xs opacity-70">${balance.total_refunded}</span>}
        </TabBtn>
      </div>

      {/* Transactions table */}
      <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-neutral-500 text-xs bg-[#faf8f6]">
              {hasRole('admin') && activeTab === 'paid' && (
                <th className="p-3 text-center w-10">
                  <input
                    type="checkbox"
                    onChange={toggleSelectAllTx}
                    checked={
                      transactions.filter(isRefundable).length > 0 &&
                      transactions.filter(isRefundable).every(t => selectedTxIds.has(t.id))
                    }
                    className="accent-orange-500"
                    title="Select all paid on this page"
                  />
                </th>
              )}
              <th className="p-3 text-left">Date</th>
              <th className="p-3 text-left">User</th>
              <th className="p-3 text-left">Type</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Method</th>
              <th className="p-3 text-left">Transaction ID</th>
              <th className="p-3 text-left">Order</th>
              <th className="p-3 text-right">Amount</th>
              <th className="p-3 text-right">Before</th>
              <th className="p-3 text-right">After</th>
              <th className="p-3 text-left">Note</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={hasRole('admin') && activeTab === 'paid' ? 13 : 12} className="p-6 text-center text-neutral-400">Loading...</td></tr>
            ) : transactions.length === 0 ? (
              <tr><td colSpan={hasRole('admin') && activeTab === 'paid' ? 13 : 12} className="p-6 text-center text-neutral-400">No transactions</td></tr>
            ) : transactions.map(t => {
              const editing = editingTxId === t.id;
              const eligible = hasRole('admin') && activeTab === 'paid' && isRefundable(t);
              const isSel = selectedTxIds.has(t.id);
              return (
                <tr key={t.id} className={`border-b border-neutral-100 ${isSel ? 'bg-orange-50/60' : ''}`}>
                  {hasRole('admin') && activeTab === 'paid' && (
                    <td className="p-3 text-center">
                      {eligible ? (
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggleSelectTx(t.id)}
                          className="accent-orange-500"
                        />
                      ) : t.type === 'paid' && t.refunded_at ? (
                        <span className="text-blue-500" title={`Đã refund lúc ${new Date(t.refunded_at).toLocaleString()}`}>↩</span>
                      ) : <span className="text-neutral-300">—</span>}
                    </td>
                  )}
                  <td className="p-3 text-neutral-600 text-xs">{new Date(t.created_at).toLocaleString()}</td>
                  <td className="p-3 text-xs">
                    {editing && hasRole('admin') ? (
                      <select
                        value={editForm.user_id}
                        onChange={e => setEditForm({ ...editForm, user_id: e.target.value })}
                        className="px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded text-xs max-w-[180px]"
                      >
                        {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
                      </select>
                    ) : (
                      <div className="leading-tight">
                        <div className="text-neutral-800 font-medium">{t.user?.name || `#${t.user_id}`}</div>
                        {t.user?.email && <div className="text-neutral-400">{t.user.email}</div>}
                      </div>
                    )}
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${TYPE_BADGE(t.type)}`}>{t.type}</span>
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[t.status] || 'bg-neutral-100 text-neutral-600'}`}>{t.status}</span>
                  </td>
                  <td className="p-3 text-neutral-600 text-xs capitalize">
                    {editing ? (
                      <select value={editForm.method} onChange={e => setEditForm({ ...editForm, method: e.target.value })} className="px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded text-xs">
                        <option value="paypal">PayPal</option>
                        <option value="pingpong">PingPong</option>
                      </select>
                    ) : (t.method || '-')}
                  </td>
                  <td className="p-3 text-neutral-600 text-xs font-mono">
                    {editing ? (
                      <input value={editForm.transaction_id} onChange={e => setEditForm({ ...editForm, transaction_id: e.target.value })} className="w-32 px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded text-xs font-mono" />
                    ) : (t.transaction_id || '-')}
                  </td>
                  <td className="p-3 text-orange-500 text-xs">{t.order?.system_id || t.order_system_id || '-'}</td>
                  <td className={`p-3 text-right font-medium ${t.amount >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {editing ? (
                      <input type="number" step="0.01" min="0.01" value={editForm.amount} onChange={e => setEditForm({ ...editForm, amount: e.target.value })} className="w-24 px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded text-xs text-right" />
                    ) : (
                      <>{t.amount >= 0 ? '+' : ''}${t.amount}</>
                    )}
                  </td>
                  <td className="p-3 text-right text-neutral-500">{t.balance_before != null ? `$${t.balance_before}` : '-'}</td>
                  <td className="p-3 text-right text-neutral-600">{t.balance_after != null ? `$${t.balance_after}` : '-'}</td>
                  <td className="p-3 text-neutral-500 text-xs">
                    {editing ? (
                      <input value={editForm.note} onChange={e => setEditForm({ ...editForm, note: e.target.value })} className="w-32 px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded text-xs" />
                    ) : (t.note || '-')}
                  </td>
                  <td className="p-3 text-right text-xs space-x-1 whitespace-nowrap">
                    {editing ? (
                      <>
                        <button onClick={() => saveEdit(t.id)} className="px-2 py-1 bg-orange-500 hover:bg-orange-600 text-white rounded">Save</button>
                        <button onClick={() => setEditingTxId(null)} className="px-2 py-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-600 rounded">Cancel</button>
                      </>
                    ) : (
                      <>
                        {canEditTx(t) && (
                          <button onClick={() => startEdit(t)} className="px-2 py-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded">Edit</button>
                        )}
                        {hasRole('admin') && t.type === 'deposit' && t.status === 'pending' && (
                          <button onClick={() => handleApprove(t)} className="px-2 py-1 bg-emerald-500 hover:bg-emerald-600 text-white rounded">Approve</button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={page} lastPage={meta.last_page} onChange={setPage} />
    </div>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
        active ? 'border-orange-500 text-orange-600' : 'border-transparent text-neutral-500 hover:text-neutral-700'
      }`}
    >{children}</button>
  );
}
