import { useState, useEffect } from 'react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { hasOrderFailure, countOrderFailures, syncOrders, URL_FAILURES_EVENT } from '../services/urlFailureCache';

const STATUS_COLORS = {
  new_order: 'bg-blue-100 text-blue-600',
  producing: 'bg-yellow-100 text-yellow-600',
  wrongsize: 'bg-red-100 text-red-600',
  fixed: 'bg-green-100 text-green-600',
  reprint: 'bg-orange-100 text-orange-600',
  onhold: 'bg-gray-100 text-gray-600',
  shipped: 'bg-emerald-100 text-emerald-600',
};

const WAREHOUSE_ADDRESS = {
  line1: '4353 Saddle Horn Way',
  city: 'Oceanside',
  zipcode: '92057',
};

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const { hasRole } = useAuth();
  const isSeller = hasRole('seller');

  // Re-render when the background image-URL check writes new failures so the
  // recent-orders rows flag issues without a manual reload (same as Orders).
  const [, setUrlFailTick] = useState(0);

  useEffect(() => {
    api.get('/dashboard').then(res => {
      setStats(res.data);
      // Validate the recent-orders rows: shows stored badges immediately, then
      // checks any not-yet-validated order in the client (the dashboard payload
      // omits item URLs, so syncOrders fetches each by id) with a progress toast.
      syncOrders((res.data?.recent_orders || []).map(o => o.id));
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onUpdate = () => setUrlFailTick(t => t + 1);
    window.addEventListener(URL_FAILURES_EVENT, onUpdate);
    return () => window.removeEventListener(URL_FAILURES_EVENT, onUpdate);
  }, []);

  const copyWarehouse = async () => {
    const text = `${WAREHOUSE_ADDRESS.line1}, ${WAREHOUSE_ADDRESS.city} ${WAREHOUSE_ADDRESS.zipcode}`;
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
  };

  if (loading) return <div className="p-6 text-neutral-400">Loading...</div>;
  if (!stats) return <div className="p-6 text-red-500">Failed to load dashboard</div>;

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold text-neutral-800 mb-6">Dashboard</h2>

      {isSeller && (
        <div className="mb-6 bg-orange-50 border border-orange-200 rounded-xl p-4 shadow-sm flex items-start gap-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center text-xl">
            📦
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-orange-700 uppercase tracking-wider mb-1">Warehouse Address</div>
            <div className="text-base font-semibold text-neutral-800">{WAREHOUSE_ADDRESS.line1}</div>
            <div className="text-sm text-neutral-700">{WAREHOUSE_ADDRESS.city}, CA {WAREHOUSE_ADDRESS.zipcode}</div>
          </div>
          <button
            onClick={copyWarehouse}
            className="px-3 py-1.5 bg-white border border-orange-200 text-orange-700 text-xs font-medium rounded-lg hover:bg-orange-100"
            title="Copy address to clipboard"
          >
            Copy
          </button>
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Orders" value={stats.total_orders} />
        <StatCard label="Revenue" value={`$${stats.total_revenue}`} />
        <StatCard label="Paid" value={`$${stats.total_paid}`} color="text-green-600" />
        <StatCard label="Unpaid" value={`$${stats.total_unpaid}`} color="text-red-500" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Print Cost" value={`$${stats.total_print_cost}`} />
        <StatCard label="Shipping Cost" value={`$${stats.total_shipping_cost}`} />
        {stats.total_users !== undefined && <StatCard label="Total Users" value={stats.total_users} />}
        {stats.total_wallet_balance !== undefined && <StatCard label="Wallet Balance" value={`$${stats.total_wallet_balance}`} />}
      </div>

      {/* Orders by status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-600 mb-3">Orders by Status</h3>
          <div className="space-y-2">
            {stats.orders_by_status?.map(item => (
              <div key={item.status} className="flex justify-between items-center">
                <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[item.status] || 'bg-neutral-100 text-neutral-600'}`}>
                  {item.status}
                </span>
                <span className="text-neutral-800 font-semibold">{item.count}</span>
              </div>
            ))}
            {stats.orders_by_status?.length === 0 && <p className="text-neutral-400 text-sm">No orders yet</p>}
          </div>
        </div>

        {/* Recent orders */}
        <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-600 mb-3">Recent Orders</h3>
          <div className="space-y-2">
            {stats.recent_orders?.map(order => (
              <div key={order.id} className="flex justify-between items-center text-sm">
                <span className="inline-flex items-center gap-1">
                  <span className="text-orange-500 font-mono">{order.ref_id}</span>
                  {hasOrderFailure(order.id) && (
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[10px] leading-none" title={`${countOrderFailures(order.id)} image URL(s) failed validation`}>!</span>
                  )}
                </span>
                <span className="text-neutral-500">${order.total_cost}</span>
              </div>
            ))}
            {stats.recent_orders?.length === 0 && <p className="text-neutral-400 text-sm">No orders yet</p>}
          </div>
        </div>
      </div>

      {/* Top sellers (admin) */}
      {stats.top_sellers && (
        <div className="mt-6 bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-600 mb-3">Top Sellers</h3>
          <div className="space-y-2">
            {stats.top_sellers.map(seller => (
              <div key={seller.user_id} className="flex justify-between items-center text-sm">
                <span className="text-neutral-800 font-medium">{seller.user?.name}</span>
                <div className="flex gap-4">
                  <span className="text-neutral-500">{seller.order_count} orders</span>
                  <span className="text-green-600 font-medium">${seller.total_revenue}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color = 'text-neutral-800' }) {
  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
      <div className="text-xs text-neutral-500 mb-1">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
    </div>
  );
}
