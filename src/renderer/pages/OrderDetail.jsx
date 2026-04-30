import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import api, { getApiUrl } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { UrlPreview, PreviewModal } from '../components/Preview';
import { isPreviewable } from '../utils/drive';

const STATUS_MAP = ['new_order', 'processing', 'wrongsize', 'fixed', 'reprint', 'onhold', 'shipped'];

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [previewUrl, setPreviewUrl] = useState(null);

  const fetchOrder = () => {
    api.get(`/orders/${id}`).then(res => {
      setOrder(res.data.order);
      setForm({
        status: res.data.order.status,
        shipping_label: res.data.order.shipping_label || '',
        tracking_id: res.data.order.tracking_id || '',
        shipping_cost: res.data.order.shipping_cost ?? '',
      });
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchOrder(); }, [id]);

  const handleUpdate = async () => {
    const payload = {
      ...form,
      shipping_cost: form.shipping_cost === '' ? 0 : Number(form.shipping_cost),
    };
    await api.put(`/orders/${id}`, payload);
    setEditing(false);
    fetchOrder();
  };

  const handlePay = async () => {
    try {
      const res = await api.post(`/orders/${id}/pay`);
      alert(res.data.message);
      fetchOrder();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this order?')) return;
    try {
      await api.delete(`/orders/${id}`);
      navigate('/orders');
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  const handleReconvert = async () => {
    if (!confirm('Reconvert all _qr images for this order?\nExisting QR-overlaid images will be removed and re-built by the converter cron.')) return;
    try {
      const res = await api.post(`/orders/${id}/reconvert`);
      alert(res.data.message);
      fetchOrder();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  if (loading) return <div className="p-6 text-neutral-400">Loading...</div>;
  if (!order) return <div className="p-6 text-red-500">Order not found</div>;

  const addr = order.address;

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <button onClick={() => navigate('/orders')} className="text-neutral-400 hover:text-neutral-700 text-sm mb-2">&larr; Back to orders</button>
          <h2 className="text-xl font-bold text-neutral-800">Order {order.system_id}</h2>
          {order.ref_id && <p className="text-xs text-neutral-500 mt-1">Ref: <span className="font-mono">{order.ref_id}</span></p>}
          {(() => {
            const base = getApiUrl().replace(/\/api\/?$/, '');
            const qrUrl = `${base}/qr/${order.system_id}`;
            return (
              <div className="mt-3 inline-flex items-center gap-3 bg-white border border-neutral-200 rounded-lg p-2 shadow-sm">
                <div className="bg-white p-1 rounded">
                  <QRCodeSVG value={qrUrl} size={96} level="M" />
                </div>
                <div className="text-xs">
                  <div className="text-neutral-500">Scan to view this order</div>
                  <a href={qrUrl} target="_blank" rel="noreferrer" className="text-orange-500 break-all">{qrUrl}</a>
                </div>
              </div>
            );
          })()}
        </div>
        <div className="flex gap-2">
          {order.paid_cost < order.total_cost && (
            <button onClick={handlePay} className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg">Pay Order</button>
          )}
          <button onClick={() => setEditing(!editing)} className="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">
            {editing ? 'Cancel' : 'Edit'}
          </button>
          {(hasRole('admin') || hasRole('support')) && (
            <button onClick={handleReconvert} title="Delete _qr metas so converter rebuilds them" className="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-600 text-sm rounded-lg">Reconvert</button>
          )}
          {hasRole('admin') && (
            <button onClick={handleDelete} className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-500 text-sm rounded-lg">Delete</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Order info */}
        <div className="bg-white rounded-xl border border-neutral-200 p-4 space-y-3 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-600 mb-2">Order Info</h3>
          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-neutral-500">Status</label>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: parseInt(e.target.value) }))} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm">
                  {STATUS_MAP.map((s, i) => <option key={i} value={i}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-neutral-500">Shipping Label</label>
                <input value={form.shipping_label} onChange={e => setForm(f => ({ ...f, shipping_label: e.target.value }))} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
              </div>
              <div>
                <label className="text-xs text-neutral-500">Tracking ID</label>
                <input value={form.tracking_id} onChange={e => setForm(f => ({ ...f, tracking_id: e.target.value }))} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
              </div>
              <div>
                <label className="text-xs text-neutral-500">Shipping Cost</label>
                <input type="number" step="0.01" value={form.shipping_cost} onChange={e => setForm(f => ({ ...f, shipping_cost: e.target.value }))} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
              </div>
              <button onClick={handleUpdate} className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg">Save</button>
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <Row label="Status" value={STATUS_MAP[order.status]} />
              <Row label="Ship Type" value={order.ship_type} />
              <div className="flex justify-between items-center gap-3">
                <span className="text-neutral-500 text-sm">Shipping Label</span>
                {isPreviewable(order.shipping_label) ? (
                  <UrlPreview url={order.shipping_label} onOpen={setPreviewUrl} label="Shipping label" size="sm" />
                ) : (
                  <span className="text-neutral-800 font-medium text-sm">{order.shipping_label || '-'}</span>
                )}
              </div>
              <Row label="Tracking ID" value={order.tracking_id || '-'} />
              <Row label="Print Cost" value={`$${order.print_cost}`} />
              <Row label="Shipping Cost" value={`$${order.shipping_cost}`} />
              <Row label="Total Cost" value={`$${order.total_cost}`} />
              <Row label="Paid" value={`$${order.paid_cost}`} />
              <Row label="Created" value={new Date(order.created_at).toLocaleString()} />
              {order.completed_time && <Row label="Completed" value={new Date(order.completed_time).toLocaleString()} />}
            </div>
          )}
        </div>

        {/* Address */}
        {addr && (
          <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-neutral-600 mb-2">Shipping Address</h3>
            <div className="space-y-1 text-sm text-neutral-600">
              <p className="text-neutral-800 font-medium">{addr.first_name} {addr.last_name}</p>
              <p>{addr.address_1}</p>
              {addr.address_2 && <p>{addr.address_2}</p>}
              <p>{addr.city}, {addr.state} {addr.zipcode}</p>
              <p>{addr.country}</p>
            </div>
          </div>
        )}
      </div>

      {/* Order items */}
      <div className="mt-6 bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-neutral-600 mb-3">Order Items</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-neutral-500 text-xs border-b border-neutral-200">
              <th className="pb-2 text-left">Product</th>
              <th className="pb-2 text-left">Type</th>
              <th className="pb-2 text-left">Accessory</th>
              <th className="pb-2 text-left">Mockup Front</th>
              <th className="pb-2 text-left">Mockup Back</th>
              <th className="pb-2 text-center">Qty</th>
              <th className="pb-2 text-right">Price</th>
              <th className="pb-2 text-right">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {order.items?.map(item => {
              const acc = item.accessory_price;
              const accUnit = acc ? Number(acc.price) : 0;
              const qty = item.quantity ?? 1;
              const subtotal = (Number(item.price) + accUnit) * qty;
              return (
                <tr key={item.id} className="border-b border-neutral-100">
                  <td className="py-2 text-neutral-800">
                    {item.product_variant?.product?.name || '-'} - {item.product_variant?.color} / {item.product_variant?.size}
                  </td>
                  <td className="py-2 text-neutral-600">{item.order_type === 0 ? 'Greeting Card' : 'Pass Sleeve'}</td>
                  <td className="py-2 text-neutral-600 text-xs">
                    {acc ? (
                      <span>
                        <span className="text-neutral-800">{acc.accessory?.name || `#${acc.accessory_id}`}</span>
                        {acc.style && <span className="text-neutral-500"> / {acc.style}</span>}
                        <span className="text-neutral-400"> (+${acc.price})</span>
                      </span>
                    ) : '-'}
                  </td>
                  <td className="py-2">
                    {isPreviewable(item.mockup_front)
                      ? <UrlPreview url={item.mockup_front} onOpen={setPreviewUrl} label="Mockup front" size="sm" />
                      : <span className="text-neutral-400 text-xs">-</span>}
                  </td>
                  <td className="py-2">
                    {isPreviewable(item.mockup_back)
                      ? <UrlPreview url={item.mockup_back} onOpen={setPreviewUrl} label="Mockup back" size="sm" />
                      : <span className="text-neutral-400 text-xs">-</span>}
                  </td>
                  <td className="py-2 text-center text-neutral-700">{qty}</td>
                  <td className="py-2 text-right text-neutral-800 font-medium">${item.price}</td>
                  <td className="py-2 text-right text-neutral-800 font-medium">${subtotal.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Metas */}
        {order.items?.some(item => item.metas?.length > 0) && (
          <div className="mt-4">
            <h4 className="text-xs text-neutral-500 mb-2">Item Metas</h4>
            {order.items.filter(item => item.metas?.length > 0).map(item => (
              <div key={item.id} className="mb-3 pl-2 border-l-2 border-neutral-100">
                <div className="text-[11px] text-neutral-400 mb-1">
                  Item #{item.id} — {item.product_variant?.product?.name}
                </div>
                <div className="flex flex-wrap gap-3">
                  {item.metas.map(meta => (
                    <div key={meta.id} className="flex items-center gap-2 text-xs bg-[#faf8f6] px-2 py-1 rounded">
                      <span className="text-neutral-500 font-medium">{meta.key}:</span>
                      {isPreviewable(meta.value) ? (
                        <UrlPreview url={meta.value} onOpen={setPreviewUrl} label={`Meta ${meta.key}`} size="sm" />
                      ) : (
                        <span className="text-neutral-700">{meta.value || '-'}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <PreviewModal url={previewUrl} onClose={() => setPreviewUrl(null)} />
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between">
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-800 font-medium">{value}</span>
    </div>
  );
}
