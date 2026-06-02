import { useEffect, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { notify } from '../components/Dialog';

// Admin/support dashboard for the per-seller auto-pay flow:
//   - List sellers with auto_pay = true + wallet + unpaid count
//   - Recent auto-paid wallet_transactions (note LIKE "Auto-paid order #...")
//   - Force-run button per seller (useful when admin just approved a top-up
//     and doesn't want to wait for the seller's 60s app-side tick).
// Style mirrors Convert _qr / Convert Label so it feels native.
export default function AutoPay() {
  const { hasRole } = useAuth();
  const isStaff = hasRole('admin') || hasRole('support');
  const [data, setData] = useState({ users: [], recent: [] });
  const [loading, setLoading] = useState(true);
  const [runningFor, setRunningFor] = useState(null);

  const refresh = () => {
    setLoading(true);
    api.get('/orders/auto-pay/status', { params: { limit: 100 } })
      .then(res => setData(res.data))
      .catch(err => notify(err.response?.data?.message || 'Load failed', { title: 'Auto-pay', kind: 'error' }))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    if (!isStaff) return;
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [isStaff]);

  const forceRun = async (u) => {
    setRunningFor(u.id);
    try {
      const res = await api.post(`/orders/auto-pay/run-for/${u.id}`);
      const { count, amount, wallet } = res.data;
      notify(
        count > 0
          ? `Paid ${count} order(s) for ${u.name}, total $${amount}. Wallet now $${wallet}.`
          : `Nothing to pay (wallet $${wallet} or no unpaid orders that fit).`,
        { title: 'Auto-pay', kind: count > 0 ? 'success' : 'info' }
      );
      refresh();
    } catch (err) {
      notify(err.response?.data?.message || 'Run failed', { title: 'Auto-pay', kind: 'error' });
    } finally { setRunningFor(null); }
  };

  if (!isStaff) {
    return <div className="p-6 text-neutral-500">Admin / support only.</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-neutral-800">Auto-pay</h2>
          <p className="text-xs text-neutral-500 mt-1">
            Sellers tự bật ở Profile. App của họ ping <code className="font-mono">/orders/auto-pay/run</code>
            mỗi phút khi cửa sổ đang mở. Trang này hiển thị live status + cho phép admin force-run.
          </p>
        </div>
        <button
          onClick={refresh}
          className="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Active sellers */}
      <section className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
        <div className="px-4 py-2 flex items-center justify-between border-b border-neutral-100 bg-[#faf8f6]">
          <span className="text-sm font-semibold text-neutral-700">
            Sellers đang bật auto-pay ({data.users.length})
          </span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-neutral-500 text-xs border-b border-neutral-200">
              <th className="px-3 py-2 text-left">User</th>
              <th className="px-3 py-2 text-right">Wallet</th>
              <th className="px-3 py-2 text-right">Unpaid</th>
              <th className="px-3 py-2 text-right">Owed</th>
              <th className="px-3 py-2 text-left">Oldest unpaid</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-6 text-center text-neutral-400">Loading…</td></tr>
            ) : data.users.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-neutral-400">Không có seller nào bật auto-pay.</td></tr>
            ) : data.users.map(u => {
              const canCover = u.oldest && u.wallet >= u.oldest.remaining;
              return (
                <tr key={u.id} className="border-b border-neutral-100 hover:bg-orange-50/30">
                  <td className="px-3 py-2">
                    <div className="text-neutral-800">{u.name}</div>
                    <div className="text-[11px] text-neutral-400">{u.email}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-600">${u.wallet.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{u.unpaid}</td>
                  <td className="px-3 py-2 text-right font-mono text-red-500">${u.owed.toFixed(2)}</td>
                  <td className="px-3 py-2 text-xs">
                    {u.oldest ? (
                      <span title={u.oldest.created_at}>
                        <span className="font-mono text-orange-600">{u.oldest.system_id}</span>
                        <span className="text-neutral-500"> · ${u.oldest.remaining.toFixed(2)}</span>
                        {!canCover && <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-red-100 text-red-600">short</span>}
                      </span>
                    ) : <span className="text-neutral-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => forceRun(u)}
                      disabled={runningFor === u.id || u.unpaid === 0}
                      className="text-xs px-2 py-1 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40 text-emerald-700 rounded"
                      title="Force-run auto-pay for this seller now"
                    >
                      {runningFor === u.id ? 'Running…' : '▶ Run now'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Recent auto-paid transactions */}
      <section className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
        <div className="px-4 py-2 border-b border-neutral-100 bg-[#faf8f6]">
          <span className="text-sm font-semibold text-neutral-700">
            Recent auto-paid transactions ({data.recent.length})
          </span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-neutral-500 text-xs border-b border-neutral-200">
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-left">User</th>
              <th className="px-3 py-2 text-left">Order</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Wallet after</th>
            </tr>
          </thead>
          <tbody>
            {data.recent.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-neutral-400">Chưa có auto-pay nào.</td></tr>
            ) : data.recent.map(t => (
              <tr key={t.id} className="border-b border-neutral-100 hover:bg-orange-50/30">
                <td className="px-3 py-2 text-xs text-neutral-500">{new Date(t.created_at).toLocaleString()}</td>
                <td className="px-3 py-2 text-xs text-neutral-700">{t.user_name || `#${t.user_id}`}</td>
                <td className="px-3 py-2 font-mono text-xs text-orange-600">{t.order_system_id}</td>
                <td className="px-3 py-2 text-right font-mono text-red-500">${Math.abs(t.amount).toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono text-emerald-600">${t.balance_after.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
