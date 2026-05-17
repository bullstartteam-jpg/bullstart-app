import { useState, useEffect } from 'react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { notify, askConfirm } from '../components/Dialog';

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
  const [activeTab, setActiveTab] = useState('deposits'); // 'deposits' | 'paid'
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositForm, setDepositForm] = useState({ user_id: '', amount: '', method: '', transaction_id: '', note: '' });
  const [users, setUsers] = useState([]);
  const [editingTxId, setEditingTxId] = useState(null);
  const [editForm, setEditForm] = useState({ amount: '', method: '', transaction_id: '', note: '' });
  const { hasRole, user: authUser } = useAuth();

  const refreshAll = () => {
    api.get('/wallet/balance').then(res => setBalance(res.data));
    setLoading(true);
    const params = { page, per_page: 20, type: activeTab === 'paid' ? 'paid' : 'deposit' };
    api.get('/wallet/transactions', { params }).then(res => {
      setTransactions(res.data.data || []);
      setMeta(res.data);
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    api.get('/wallet/balance').then(res => setBalance(res.data));
    if (hasRole('admin')) {
      api.get('/users', { params: { per_page: 100 } }).then(res => setUsers(res.data.data || []));
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = { page, per_page: 20, type: activeTab === 'paid' ? 'paid' : 'deposit' };
    api.get('/wallet/transactions', { params }).then(res => {
      setTransactions(res.data.data || []);
      setMeta(res.data);
    }).finally(() => setLoading(false));
  }, [page, activeTab]);

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
    setEditForm({ amount: tx.amount, method: tx.method || '', transaction_id: tx.transaction_id || '', note: tx.note || '' });
  };

  const saveEdit = async (txId) => {
    try {
      await api.put(`/wallet/deposit/${txId}`, editForm);
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

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-neutral-800">Wallet</h2>
        <button onClick={() => setShowDeposit(!showDeposit)} className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg">
          {showDeposit ? 'Cancel' : (hasRole('admin') ? 'Deposit' : 'Request Deposit')}
        </button>
      </div>

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

      {/* Tabs split deposits and paid transactions */}
      <div className="flex gap-1 mb-3 border-b border-neutral-200">
        <TabBtn active={activeTab === 'deposits'} onClick={() => switchTab('deposits')}>
          Deposits {balance && <span className="ml-1 text-xs opacity-70">${balance.total_deposited}</span>}
        </TabBtn>
        <TabBtn active={activeTab === 'paid'} onClick={() => switchTab('paid')}>
          Paid {balance && <span className="ml-1 text-xs opacity-70">${balance.total_paid}</span>}
        </TabBtn>
      </div>

      {/* Transactions table */}
      <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-neutral-500 text-xs bg-[#faf8f6]">
              <th className="p-3 text-left">Date</th>
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
              <tr><td colSpan="11" className="p-6 text-center text-neutral-400">Loading...</td></tr>
            ) : transactions.length === 0 ? (
              <tr><td colSpan="11" className="p-6 text-center text-neutral-400">No transactions</td></tr>
            ) : transactions.map(t => {
              const editing = editingTxId === t.id;
              return (
                <tr key={t.id} className="border-b border-neutral-100">
                  <td className="p-3 text-neutral-600 text-xs">{new Date(t.created_at).toLocaleString()}</td>
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

      {meta.last_page > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          {Array.from({ length: Math.min(meta.last_page, 10) }, (_, i) => i + 1).map(p => (
            <button key={p} onClick={() => setPage(p)} className={`px-3 py-1 rounded text-sm ${page === p ? 'bg-orange-500 text-white' : 'bg-white border border-neutral-200 text-neutral-600'}`}>{p}</button>
          ))}
        </div>
      )}
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
