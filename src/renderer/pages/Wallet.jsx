import { useState, useEffect } from 'react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

export default function Wallet() {
  const [balance, setBalance] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [meta, setMeta] = useState({});
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositForm, setDepositForm] = useState({ user_id: '', amount: '', note: '' });
  const [users, setUsers] = useState([]);
  const { hasRole } = useAuth();

  useEffect(() => {
    api.get('/wallet/balance').then(res => setBalance(res.data));
    if (hasRole('admin')) {
      api.get('/users', { params: { per_page: 100 } }).then(res => setUsers(res.data.data || []));
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    api.get('/wallet/transactions', { params: { page, per_page: 20 } }).then(res => {
      setTransactions(res.data.data || []);
      setMeta(res.data);
    }).finally(() => setLoading(false));
  }, [page]);

  const handleDeposit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/wallet/deposit', depositForm);
      setShowDeposit(false);
      setDepositForm({ user_id: '', amount: '', note: '' });
      api.get('/wallet/balance').then(res => setBalance(res.data));
      api.get('/wallet/transactions', { params: { page: 1, per_page: 20 } }).then(res => {
        setTransactions(res.data.data || []);
        setMeta(res.data);
        setPage(1);
      });
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-neutral-800">Wallet</h2>
        {hasRole('admin') && (
          <button onClick={() => setShowDeposit(!showDeposit)} className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg">
            {showDeposit ? 'Cancel' : 'Deposit'}
          </button>
        )}
      </div>

      {/* Balance cards */}
      {balance && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
            <div className="text-xs text-neutral-500">Balance</div>
            <div className="text-xl font-bold text-neutral-800">${balance.wallet}</div>
          </div>
          <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
            <div className="text-xs text-neutral-500">Deposited</div>
            <div className="text-xl font-bold text-green-600">${balance.total_deposited}</div>
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
        <form onSubmit={handleDeposit} className="mb-4 bg-white rounded-xl border border-neutral-200 p-4 flex gap-3 items-end shadow-sm">
          <div>
            <label className="text-xs text-neutral-500">User</label>
            <select value={depositForm.user_id} onChange={e => setDepositForm({ ...depositForm, user_id: e.target.value })} required className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm">
              <option value="">Select user...</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-neutral-500">Amount</label>
            <input type="number" step="0.01" min="0.01" value={depositForm.amount} onChange={e => setDepositForm({ ...depositForm, amount: e.target.value })} required className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
          </div>
          <div>
            <label className="text-xs text-neutral-500">Note</label>
            <input value={depositForm.note} onChange={e => setDepositForm({ ...depositForm, note: e.target.value })} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
          </div>
          <button type="submit" className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg">Deposit</button>
        </form>
      )}

      {/* Transactions table */}
      <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-neutral-500 text-xs bg-[#faf8f6]">
              <th className="p-3 text-left">Date</th>
              <th className="p-3 text-left">Type</th>
              <th className="p-3 text-left">Order</th>
              <th className="p-3 text-right">Amount</th>
              <th className="p-3 text-right">Balance</th>
              <th className="p-3 text-left">Note</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="6" className="p-6 text-center text-neutral-400">Loading...</td></tr>
            ) : transactions.length === 0 ? (
              <tr><td colSpan="6" className="p-6 text-center text-neutral-400">No transactions</td></tr>
            ) : transactions.map(t => (
              <tr key={t.id} className="border-b border-neutral-100">
                <td className="p-3 text-neutral-600 text-xs">{new Date(t.created_at).toLocaleString()}</td>
                <td className="p-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    t.type === 'deposit' ? 'bg-green-100 text-green-600' :
                    t.type === 'refund' ? 'bg-blue-100 text-blue-600' :
                    'bg-red-100 text-red-500'
                  }`}>{t.type}</span>
                </td>
                <td className="p-3 text-orange-500 text-xs">{t.order?.system_id || '-'}</td>
                <td className={`p-3 text-right font-medium ${t.amount >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {t.amount >= 0 ? '+' : ''}${t.amount}
                </td>
                <td className="p-3 text-right text-neutral-600">${t.balance_after}</td>
                <td className="p-3 text-neutral-500 text-xs">{t.note || '-'}</td>
              </tr>
            ))}
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
