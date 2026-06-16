import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import api, { getApiUrl } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { UrlPreview, PreviewModal } from '../components/Preview';
import { isPreviewable } from '../utils/drive';
import { notify, askConfirm } from '../components/Dialog';
import UploadButton from '../components/UploadButton';
import { getOrderFailures, syncOrders, recheckOrder, fetchOrdersStatus, URL_FAILURES_EVENT } from '../services/urlFailureCache';

const STATUS_MAP = ['new_order', 'producing', 'wrongsize', 'fixed', 'reprint', 'onhold', 'shipped', 'cancelled'];
const SELLER_STATUS_OPTIONS = [5, 7]; // onhold, cancelled

// Small red marker shown next to an image URL whose background validation failed.
// Reason appears on hover via the native title tooltip (the app's standard).
function UrlFailMark({ reason }) {
  if (!reason) return null;
  return (
    <span
      title={`Image URL problem: ${reason}`}
      className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[10px] leading-none cursor-help align-middle"
    >!</span>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [previewUrl, setPreviewUrl] = useState(null);
  // Image-URL validation failures for this order, read from the server-backed
  // store. syncOrders fetches the latest status (and triggers background
  // validation if the order was never checked); the shared event then refreshes
  // this view so a re-check or a finishing background run shows immediately.
  const [urlFailures, setUrlFailures] = useState(null);
  const [rechecking, setRechecking] = useState(false);
  useEffect(() => {
    const refresh = () => setUrlFailures(getOrderFailures(id));
    refresh();
    window.addEventListener(URL_FAILURES_EVENT, refresh);
    // Show stored status immediately; actual (re)validation of an unchecked
    // order happens once the order (with items) loads — see fetchOrder.
    fetchOrdersStatus([id]).catch(() => {});
    return () => window.removeEventListener(URL_FAILURES_EVENT, refresh);
  }, [id]);

  // Re-validate every image URL on this order on demand (client-side, saved to DB).
  const recheckUrls = async () => {
    if (!order) return;
    setRechecking(true);
    try {
      await recheckOrder(order);
    } catch {
      notify('Re-check failed', { title: 'Image URL check', kind: 'error' });
    } finally {
      setRechecking(false);
    }
  };

  // Catalog used by the per-item accessory editor (only fetched when an
  // editor opens for the first time — avoids paying the cost on every view).
  const [products, setProducts] = useState(null);
  const ensureProducts = () => {
    if (products) return;
    api.get('/products', { params: { per_page: 200 } })
      .then(res => setProducts(res.data.data || []));
  };

  const fetchOrder = () => {
    api.get(`/orders/${id}`).then(res => {
      const o = res.data.order;
      setOrder(o);
      // Validate this order's images in the client if it was never checked
      // (skips shipped + already-validated); persists the result to the DB.
      // Silent — the detail view has its own inline "Re-check images" feedback.
      syncOrders([o], { toast: false });
      const a = o.address || {};
      setForm({
        status: o.status,
        shipping_label: o.shipping_label || '',
        tracking_id: o.tracking_id || '',
        shipping_cost: o.shipping_cost ?? '',
        proof_image: o.proof_image || '',
        ship_type: o.ship_type || '',
        address: {
          first_name: a.first_name || '',
          last_name:  a.last_name  || '',
          address_1:  a.address_1  || '',
          address_2:  a.address_2  || '',
          city:       a.city       || '',
          state:      a.state      || '',
          zipcode:    a.zipcode    || '',
          country:    a.country    || '',
        },
      });
    }).finally(() => setLoading(false));
  };

  const setAddr = (key, value) => setForm(f => ({ ...f, address: { ...f.address, [key]: value } }));

  useEffect(() => { fetchOrder(); }, [id]);

  const handleUpdate = async () => {
    const payload = {
      ...form,
      shipping_cost: form.shipping_cost === '' ? 0 : Number(form.shipping_cost),
    };
    // Backend validates proof_image as a URL — drop it when blank.
    if (!payload.proof_image) delete payload.proof_image;
    await api.put(`/orders/${id}`, payload);
    setEditing(false);
    fetchOrder();
  };

  const handlePay = async () => {
    // Frontend pre-check. Sellers pay from their own wallet — compare against
    // /wallet/balance up front. Admin/staff pay from the ORDER OWNER'S wallet,
    // so the caller's balance is irrelevant; let the backend enforce.
    try {
      const required = (parseFloat(order?.total_cost) || 0) - (parseFloat(order?.paid_cost) || 0);
      if (required <= 0) {
        return notify('Order already fully paid.', { title: 'Nothing to pay' });
      }

      if (hasRole('seller')) {
        const balanceRes = await api.get('/wallet/balance');
        const wallet = parseFloat(balanceRes.data.wallet) || 0;
        if (wallet < required) {
          return notify(`Insufficient wallet balance.\nRequired: $${required.toFixed(2)}\nWallet: $${wallet.toFixed(2)}\nShort by: $${(required - wallet).toFixed(2)}`, { title: 'Cannot pay', kind: 'error' });
        }
      }

      const ok = await askConfirm(`Pay $${required.toFixed(2)} for this order?`, { title: 'Confirm pay', okText: 'Pay' });
      if (!ok) return;
    } catch {
      // fall through; backend will enforce
    }
    try {
      const res = await api.post(`/orders/${id}/pay`);
      await notify(res.data.message, { title: 'Pay', kind: 'success' });
      fetchOrder();
    } catch (err) {
      const d = err.response?.data;
      const msg = d?.required != null && d?.wallet != null
        ? `${d.message}.\nRequired: $${d.required}\nWallet: $${d.wallet}`
        : (d?.message || 'Error');
      notify(msg, { title: 'Pay failed', kind: 'error' });
    }
  };

  const handleDelete = async () => {
    const ok = await askConfirm('Delete this order?', { title: 'Confirm delete', okText: 'Delete' });
    if (!ok) return;
    try {
      await api.delete(`/orders/${id}`);
      navigate('/orders');
    } catch (err) {
      notify(err.response?.data?.message || 'Error', { title: 'Delete failed', kind: 'error' });
    }
  };

  const handleReconvert = async () => {
    const ok = await askConfirm('Reconvert all _qr images for this order?\nExisting QR-overlaid images will be removed and re-built by the converter cron.', { title: 'Reconvert', okText: 'Reconvert' });
    if (!ok) return;
    try {
      const res = await api.post(`/orders/${id}/reconvert`);
      await notify(res.data.message, { title: 'Reconvert', kind: 'success' });
      fetchOrder();
    } catch (err) {
      notify(err.response?.data?.message || 'Error', { title: 'Reconvert failed', kind: 'error' });
    }
  };

  const handleReconvertLabel = async () => {
    const ok = await askConfirm(
      'Clear convert_label so the converter cron rebuilds it on the next poll? Only orders still in new_order status will be re-processed.',
      { title: 'Reconvert Label', okText: 'Reconvert Label' }
    );
    if (!ok) return;
    try {
      const res = await api.post(`/orders/${id}/reconvert-label`);
      await notify(res.data.message, { title: 'Reconvert Label', kind: 'success' });
      fetchOrder();
    } catch (err) {
      notify(err.response?.data?.message || 'Error', { title: 'Reconvert Label failed', kind: 'error' });
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
          {!hasRole('seller') && (() => {
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
          {(hasRole('admin') || hasRole('support')) && order.shipping_label && (
            <button onClick={handleReconvertLabel} title="Clear convert_label so the cron rebuilds the overlay" className="px-4 py-2 bg-purple-50 hover:bg-purple-100 text-purple-600 text-sm rounded-lg">Reconvert Label</button>
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
                  {STATUS_MAP.map((s, i) => (
                    (!hasRole('seller') || SELLER_STATUS_OPTIONS.includes(i) || i === order.status)
                      ? <option key={i} value={i}>{s}</option>
                      : null
                  ))}
                </select>
              </div>
              {/* Ship type — staff only. Switching to stamp recomputes
                  shipping cost from item qty and clears label/tracking. */}
              {(hasRole('admin') || hasRole('support')) && (
                <div>
                  <label className="text-xs text-neutral-500">Ship Type</label>
                  <select value={form.ship_type} onChange={e => setForm(f => ({ ...f, ship_type: e.target.value }))} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm">
                    <option value="tiktok_ship">tiktok_ship (TikTok label)</option>
                    <option value="seller_ship">seller_ship (seller buys label)</option>
                    <option value="stamp">stamp (no tracking, $/thiệp)</option>
                  </select>
                  {form.ship_type === 'stamp' && form.ship_type !== order.ship_type && (
                    <p className="text-[11px] text-amber-600 mt-1">Khi lưu: label/tracking sẽ bị xoá, handling fee tính lại theo qty.</p>
                  )}
                  {form.ship_type === 'seller_ship' && form.ship_type !== order.ship_type && (
                    <p className="text-[11px] text-amber-600 mt-1">Khi lưu: label/tracking sẽ bị xoá, shipping cost tính lại theo qty (base + addition × (qty-1)).</p>
                  )}
                </div>
              )}
              {/* Shipping label — always editable so staff can attach a label
                  URL even to seller_ship/stamp orders. Backend won't recompute
                  shipping_cost when only the label changes (ship_type stays
                  the same). */}
              <>
                  <div>
                    <label className="text-xs text-neutral-500">
                      Shipping Label
                      {form.ship_type !== 'tiktok_ship' && (
                        <span className="ml-1 text-[10px] text-neutral-400">(không đổi shipping cost)</span>
                      )}
                    </label>
                    <input value={form.shipping_label} onChange={e => setForm(f => ({ ...f, shipping_label: e.target.value }))} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-neutral-500">Tracking ID</label>
                    <input value={form.tracking_id} onChange={e => setForm(f => ({ ...f, tracking_id: e.target.value }))} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
                  </div>
                </>
              <div>
                <label className="text-xs text-neutral-500">{form.ship_type === 'stamp' ? 'Handling Fee' : 'Shipping Cost'}</label>
                <input type="number" step="0.01" value={form.shipping_cost} onChange={e => setForm(f => ({ ...f, shipping_cost: e.target.value }))} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
              </div>
              {/* Address — used for stamp (mailed direct) and seller_ship
                  (seller buys their own label) orders. Staff only. */}
              {(form.ship_type === 'stamp' || form.ship_type === 'seller_ship') && (hasRole('admin') || hasRole('support')) && (
                <div className="space-y-1">
                  <label className="text-xs text-neutral-500">Shipping Address</label>
                  <div className="grid grid-cols-2 gap-2">
                    <input value={form.address.first_name} onChange={e => setAddr('first_name', e.target.value)} placeholder="First name" className="px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
                    <input value={form.address.last_name} onChange={e => setAddr('last_name', e.target.value)} placeholder="Last name" className="px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
                    <input value={form.address.address_1} onChange={e => setAddr('address_1', e.target.value)} placeholder="Address line 1" className="col-span-2 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
                    <input value={form.address.address_2} onChange={e => setAddr('address_2', e.target.value)} placeholder="Address line 2 (optional)" className="col-span-2 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
                    <input value={form.address.city} onChange={e => setAddr('city', e.target.value)} placeholder="City" className="px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
                    <input value={form.address.state} onChange={e => setAddr('state', e.target.value)} placeholder="State" className="px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
                    <input value={form.address.zipcode} onChange={e => setAddr('zipcode', e.target.value)} placeholder="Zipcode" className="px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
                    <input value={form.address.country} onChange={e => setAddr('country', e.target.value)} placeholder="Country" className="px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
                  </div>
                </div>
              )}
              {/* Stamp proof photo — fulfiller uploads the stamped envelope as
                  evidence (stamp has no tracking). Staff only. */}
              {form.ship_type === 'stamp' && (hasRole('admin') || hasRole('support')) && (
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-neutral-500">Proof image (stamped envelope)</label>
                    <UploadButton folder="stamp-proof" accept="image/*" onUrl={(url) => setForm(f => ({ ...f, proof_image: url }))} title="Upload proof" />
                  </div>
                  <input value={form.proof_image} onChange={e => setForm(f => ({ ...f, proof_image: e.target.value }))} placeholder="URL or Upload" className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
                  {isPreviewable(form.proof_image) && <UrlPreview url={form.proof_image} onOpen={setPreviewUrl} label="Proof" size="sm" />}
                </div>
              )}
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
              {/* convert_label is admin/support-only; backend hides it from sellers */}
              {('convert_label' in order) && (
                <div className="flex justify-between items-center gap-3">
                  <span className="text-neutral-500 text-sm">Convert Label</span>
                  {isPreviewable(order.convert_label) ? (
                    <UrlPreview url={order.convert_label} onOpen={setPreviewUrl} label="Convert label" size="sm" />
                  ) : (
                    <span className="text-neutral-800 font-medium text-sm">{order.convert_label || '-'}</span>
                  )}
                </div>
              )}
              {order.ship_type === 'stamp' && (
                <div className="flex justify-between items-center gap-3">
                  <span className="text-neutral-500 text-sm">Proof (stamp)</span>
                  {isPreviewable(order.proof_image) ? (
                    <UrlPreview url={order.proof_image} onOpen={setPreviewUrl} label="Proof" size="sm" />
                  ) : (
                    <span className="text-neutral-800 font-medium text-sm">{order.proof_image || '-'}</span>
                  )}
                </div>
              )}
              <Row label="Tracking ID" value={order.ship_type === 'stamp' ? 'No tracking (stamp)' : (order.tracking_id || '-')} />
              <Row label="Print Cost" value={`$${order.print_cost}`} />
              <Row label={order.ship_type === 'stamp' ? 'Handling Fee' : 'Shipping Cost'} value={`$${order.shipping_cost}`} />
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
              // Prefer the multi-accessory pivot list; fall back to the legacy
              // single accessory_price for orders created before multi support.
              const accList = item.accessory_prices && item.accessory_prices.length
                ? item.accessory_prices
                : (item.accessory_price ? [item.accessory_price] : []);
              const accUnit = accList.reduce((s, a) => s + Number(a.price || 0), 0);
              const qty = item.quantity ?? 1;
              const subtotal = (Number(item.price) + accUnit) * qty;
              const canEditAcc = order.status !== 6 && order.status !== 7; // not shipped / cancelled
              return (
                <tr key={item.id} className="border-b border-neutral-100">
                  <td className="py-2 text-neutral-800">
                    {item.product_variant?.product?.name || '-'} - {item.product_variant?.color} / {item.product_variant?.size}
                  </td>
                  <td className="py-2 text-neutral-600">{item.order_type === 0 ? 'Greeting Card' : 'Pass Sleeve'}</td>
                  <td className="py-2 text-neutral-600 text-xs">
                    <ItemAccessoriesCell
                      item={item}
                      accList={accList}
                      canEdit={canEditAcc}
                      ownerTierId={order.user?.tier_id ?? null}
                      products={products}
                      onOpen={ensureProducts}
                      onSaved={fetchOrder}
                    />
                  </td>
                  <td className="py-2">
                    <ItemMockupCell
                      item={item}
                      field="mockup_front"
                      label="Mockup front"
                      canEdit={canEditAcc}
                      onOpen={setPreviewUrl}
                      onSaved={fetchOrder}
                      failReason={urlFailures?.[item.id]?.mockup_front}
                    />
                  </td>
                  <td className="py-2">
                    <ItemMockupCell
                      item={item}
                      field="mockup_back"
                      label="Mockup back"
                      canEdit={canEditAcc}
                      onOpen={setPreviewUrl}
                      onSaved={fetchOrder}
                      failReason={urlFailures?.[item.id]?.mockup_back}
                    />
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
        {order.items?.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs text-neutral-500">Item Metas</h4>
              <button
                onClick={recheckUrls}
                disabled={rechecking}
                className="text-xs text-orange-600 hover:text-orange-700 disabled:opacity-50"
              >
                {rechecking ? 'Checking images…' : 'Re-check images'}
              </button>
            </div>
            {order.items.map(item => (
              <ItemMetasBlock
                key={item.id}
                item={item}
                onPreview={setPreviewUrl}
                onSaved={fetchOrder}
                failures={urlFailures?.[item.id]}
              />
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

// Inline editor for one mockup URL (front or back) in the items table. Mirrors
// the inline-edit pattern of ItemAccessoriesCell: a small ✎ toggle reveals a
// URL input + Upload button + preview, saved via PUT /order-items/{id}/mockups.
// The endpoint replaces both mockups, so we send the sibling field's current
// value alongside the edited one.
function ItemMockupCell({ item, field, label, canEdit, onOpen, onSaved, failReason }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = () => { setValue(item[field] || ''); setEditing(true); };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        mockup_front: item.mockup_front || '',
        mockup_back: item.mockup_back || '',
        [field]: value || '',
      };
      const res = await api.put(`/order-items/${item.id}/mockups`, payload);
      await notify(res.data.message, { title: 'Mockups', kind: 'success' });
      setEditing(false);
      onSaved?.();
    } catch (err) {
      const errs = err.response?.data?.errors;
      const msg = err.response?.data?.message || (errs ? Object.values(errs).flat().join('\n') : 'Error');
      notify(msg, { title: 'Update failed', kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-1 min-w-[160px]">
        <div className="flex items-center gap-1">
          <input
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="URL or click Upload"
            className="flex-1 px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded text-xs"
          />
          <UploadButton folder="mockups" accept="image/*" title={`Upload ${label}`} onUrl={(url) => setValue(url)} />
        </div>
        {isPreviewable(value) && <UrlPreview url={value} onOpen={onOpen} label={label} size="sm" />}
        <div className="flex gap-2">
          <button onClick={() => setEditing(false)} disabled={saving} className="text-xs text-neutral-500 hover:text-neutral-700">Cancel</button>
          <button onClick={save} disabled={saving} className="text-xs bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white px-2 py-0.5 rounded">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      {isPreviewable(item[field])
        ? <UrlPreview url={item[field]} onOpen={onOpen} label={label} size="sm" />
        : <span className="text-neutral-400 text-xs">-</span>}
      <UrlFailMark reason={failReason} />
      {canEdit && (
        <button onClick={startEdit} className="text-orange-600 hover:text-orange-700 text-xs" title={`Edit ${label}`}>✎</button>
      )}
    </span>
  );
}

function ItemAccessoriesCell({ item, accList, canEdit, ownerTierId, products, onOpen, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState([]); // [{ accessory_id, accessory_item_id }]
  const [saving, setSaving] = useState(false);

  const product = (products || []).find(p => p.id === item.product_variant?.product_id);
  const accessories = product?.accessories || [];

  const startEdit = () => {
    onOpen?.();
    setRows(accList.map(a => ({
      accessory_id: String(a.accessory_id ?? a.accessory?.id ?? ''),
      accessory_item_id: String(a.id),
    })));
    setEditing(true);
  };

  const addRow = () => setRows(r => [...r, { accessory_id: '', accessory_item_id: '' }]);
  const updateRow = (ri, patch) => setRows(r => r.map((row, i) => i === ri ? { ...row, ...patch } : row));
  const removeRow = (ri) => setRows(r => r.filter((_, i) => i !== ri));

  const save = async () => {
    setSaving(true);
    try {
      const accessory_ids = rows
        .map(r => Number(r.accessory_item_id))
        .filter(Boolean);
      const res = await api.put(`/order-items/${item.id}/accessories`, { accessory_ids });
      await notify(res.data.message, { title: 'Accessories', kind: 'success' });
      setEditing(false);
      onSaved?.();
    } catch (err) {
      const errs = err.response?.data?.errors;
      const msg = err.response?.data?.message || (errs ? Object.values(errs).flat().join('\n') : 'Error');
      notify(msg, { title: 'Update failed', kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div>
        {accList.length === 0 ? (
          <span className="text-neutral-400">-</span>
        ) : (
          <div className="space-y-0.5">
            {accList.map(acc => (
              <div key={acc.id}>
                <span className="text-neutral-800">{acc.accessory?.name || `#${acc.accessory_id}`}</span>
                {acc.style && <span className="text-neutral-500"> / {acc.style}</span>}
                <span className="text-neutral-400"> (+${acc.price})</span>
              </div>
            ))}
          </div>
        )}
        {canEdit && (
          <button
            onClick={startEdit}
            className="mt-1 text-[11px] text-orange-600 hover:text-orange-700"
          >Edit accessories</button>
        )}
      </div>
    );
  }

  // Catalog still loading (we called ensureProducts in startEdit but it's async).
  if (!products) {
    return <div className="text-[11px] text-neutral-400">Loading catalog…</div>;
  }

  return (
    <div className="space-y-1.5">
      {rows.length === 0 && (
        <p className="text-[11px] text-neutral-400">No accessories. Click + to add.</p>
      )}
      {rows.map((row, ri) => {
        const selectedAcc = accessories.find(a => String(a.id) === String(row.accessory_id));
        const stylePrices = (selectedAcc?.prices || []).filter(p => ownerTierId == null || p.tier_id === ownerTierId);
        return (
          <div key={ri} className="flex gap-1 items-center">
            <select
              value={row.accessory_id}
              onChange={e => updateRow(ri, { accessory_id: e.target.value, accessory_item_id: '' })}
              className="px-1.5 py-1 bg-[#faf8f6] border border-neutral-200 rounded text-[11px] flex-1 min-w-0"
            >
              <option value="">— Accessory —</option>
              {accessories.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <select
              value={row.accessory_item_id}
              onChange={e => updateRow(ri, { accessory_item_id: e.target.value })}
              disabled={!selectedAcc || stylePrices.length === 0}
              className="px-1.5 py-1 bg-[#faf8f6] border border-neutral-200 rounded text-[11px] flex-1 min-w-0 disabled:opacity-50"
            >
              <option value="">{selectedAcc && stylePrices.length === 0 ? 'no tier price' : 'Style…'}</option>
              {stylePrices.map(p => (
                <option key={p.id} value={p.id}>{p.style || '(no style)'} — ${p.price}</option>
              ))}
            </select>
            <button onClick={() => removeRow(ri)} className="text-red-400 hover:text-red-600 text-xs px-1">×</button>
          </div>
        );
      })}
      <div className="flex gap-2 pt-1">
        <button onClick={addRow} className="text-[11px] text-orange-600 hover:text-orange-700">+ Add</button>
        <span className="text-neutral-300">|</span>
        <button onClick={save} disabled={saving} className="text-[11px] bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white px-2 py-0.5 rounded">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => setEditing(false)} disabled={saving} className="text-[11px] text-neutral-500 hover:text-neutral-700">Cancel</button>
      </div>
    </div>
  );
}

const SOURCE_KEYS = ['front', 'back', 'left', 'right', 'neck', 'special'];

function ItemMetasBlock({ item, onPreview, onSaved, failures }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const initialForm = () => {
    const f = {};
    for (const k of SOURCE_KEYS) f[k] = '';
    for (const m of item.metas || []) {
      if (SOURCE_KEYS.includes(m.key)) f[m.key] = m.value || '';
    }
    return f;
  };
  const [form, setForm] = useState(initialForm);

  const startEdit = () => { setForm(initialForm()); setEditing(true); };
  const cancel = () => { setEditing(false); };

  const save = async () => {
    const ok = await askConfirm(
      'Lưu thay đổi sẽ XOÁ tất cả _qr meta tương ứng để converter regenerate. Tiếp tục?',
      { title: 'Update metas', okText: 'Save & regenerate' }
    );
    if (!ok) return;
    setSaving(true);
    try {
      const metas = SOURCE_KEYS.map(k => ({ key: k, value: form[k] || null }));
      const res = await api.put(`/order-items/${item.id}/metas`, { metas });
      await notify(res.data.message, { title: 'Metas updated', kind: 'success' });
      setEditing(false);
      onSaved?.();
    } catch (err) {
      const errs = err.response?.data?.errors;
      const msg = err.response?.data?.message || (errs ? Object.values(errs).flat().join('\n') : 'Error');
      notify(msg, { title: 'Update failed', kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const sourceMetas = (item.metas || []).filter(m => SOURCE_KEYS.includes(m.key));
  const qrMetas = (item.metas || []).filter(m => /^(front|back|left|right|neck|special)_qr(_\d+)?$/.test(m.key));

  return (
    <div className="mb-4 pl-2 border-l-2 border-neutral-100">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] text-neutral-400">
          Item #{item.id} — {item.product_variant?.product?.name}
          {qrMetas.length > 0 && (
            <span className="ml-2 px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">{qrMetas.length} _qr</span>
          )}
        </div>
        {!editing ? (
          <button onClick={startEdit} className="text-xs text-orange-600 hover:text-orange-700">Edit metas</button>
        ) : (
          <div className="flex gap-2">
            <button onClick={cancel} disabled={saving} className="text-xs text-neutral-500 hover:text-neutral-700">Cancel</button>
            <button onClick={save} disabled={saving} className="text-xs bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white px-2 py-0.5 rounded">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {SOURCE_KEYS.map(k => (
            <div key={k} className="flex items-center gap-2 text-xs">
              <label className="text-neutral-500 font-medium w-16 capitalize">{k}</label>
              <input
                value={form[k]}
                onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                placeholder="URL or click Upload — leave empty to delete"
                className="flex-1 px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded text-xs"
              />
              <UploadButton
                folder={`metas/${k}`}
                accept="image/*"
                title={`Upload ${k} design`}
                onUrl={(url) => setForm(f => ({ ...f, [k]: url }))}
              />
              {isPreviewable(form[k]) && (
                <UrlPreview url={form[k]} onOpen={onPreview} label={`Preview ${k}`} size="sm" />
              )}
            </div>
          ))}
          <p className="md:col-span-2 text-[10px] text-neutral-400">
            Lưu sẽ xoá toàn bộ _qr meta tương ứng. Converter cron sẽ regenerate từ URL mới.
          </p>
        </div>
      ) : (
        <>
          {sourceMetas.length === 0 && qrMetas.length === 0 ? (
            <p className="text-xs text-neutral-400">No metas. Click "Edit metas" to add source URLs.</p>
          ) : (
            <div className="space-y-2">
              {sourceMetas.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {sourceMetas.map(meta => (
                    <div key={meta.id} className="flex items-center gap-2 text-xs bg-[#faf8f6] px-2 py-1 rounded">
                      <span className="text-neutral-500 font-medium">{meta.key}:</span>
                      {isPreviewable(meta.value) ? (
                        <UrlPreview url={meta.value} onOpen={onPreview} label={`Meta ${meta.key}`} size="sm" />
                      ) : (
                        <span className="text-neutral-700">{meta.value || '-'}</span>
                      )}
                      <UrlFailMark reason={failures?.[`meta:${meta.key}`]} />
                    </div>
                  ))}
                </div>
              )}
              {qrMetas.length > 0 && (
                <div className="flex flex-wrap gap-3 pt-2 border-t border-neutral-100">
                  {qrMetas.map(meta => (
                    <div key={meta.id} className="flex items-center gap-2 text-xs bg-blue-50 px-2 py-1 rounded">
                      <span className="text-blue-600 font-mono font-medium">{meta.key}:</span>
                      {isPreviewable(meta.value) ? (
                        <UrlPreview url={meta.value} onOpen={onPreview} label={`QR ${meta.key}`} size="sm" />
                      ) : (
                        <span className="text-neutral-700">{meta.value || '-'}</span>
                      )}
                      {meta.production && <span className="text-green-600" title="Produced">●</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
