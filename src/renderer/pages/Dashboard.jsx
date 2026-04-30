import { useState, useEffect } from 'react';
import api from '../services/api';

const STATUS_COLORS = {
  new_order: 'bg-blue-100 text-blue-600',
  processing: 'bg-yellow-100 text-yellow-600',
  wrongsize: 'bg-red-100 text-red-600',
  fixed: 'bg-green-100 text-green-600',
  reprint: 'bg-orange-100 text-orange-600',
  onhold: 'bg-gray-100 text-gray-600',
  shipped: 'bg-emerald-100 text-emerald-600',
};

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/dashboard').then(res => {
      setStats(res.data);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-neutral-400">Loading...</div>;
  if (!stats) return <div className="p-6 text-red-500">Failed to load dashboard</div>;

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold text-neutral-800 mb-6">Dashboard</h2>

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
                <span className="text-orange-500 font-mono">{order.ref_id}</span>
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
