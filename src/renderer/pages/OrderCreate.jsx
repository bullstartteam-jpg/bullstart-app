import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { driveThumb, isPreviewable } from '../utils/drive';
import { UrlPreview, PreviewModal } from '../components/Preview';
import { notify, askConfirm } from '../components/Dialog';

const META_KEYS = ['front', 'back', 'left', 'right', 'neck', 'special'];

export default function OrderCreate() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userTierId = user?.tier_id ?? null;
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [csvMode, setCsvMode] = useState(false);
  const [csvFile, setCsvFile] = useState(null);
  const [csvResult, setCsvResult] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  const blankItem = () => ({
    product_variant_id: '', accessory_id: '', accessory_item_id: '',
    mockup_front: '', mockup_back: '', quantity: '1', order_type: 0,
    metas: [{ key: 'front', value: '' }],
  });

  const addMeta = (i) => {
    setForm(f => {
      const items = [...f.items];
      items[i] = { ...items[i], metas: [...(items[i].metas || []), { key: 'front', value: '' }] };
      return { ...f, items };
    });
  };

  const updateMeta = (i, mi, field, value) => {
    setForm(f => {
      const items = [...f.items];
      const metas = [...(items[i].metas || [])];
      metas[mi] = { ...metas[mi], [field]: value };
      items[i] = { ...items[i], metas };
      return { ...f, items };
    });
  };

  const removeMeta = (i, mi) => {
    setForm(f => {
      const items = [...f.items];
      items[i] = { ...items[i], metas: items[i].metas.filter((_, idx) => idx !== mi) };
      return { ...f, items };
    });
  };

  const [form, setForm] = useState({
    method: 'label', // 'label' | 'address'
    ref_id: '',
    shipping_label: '',
    address: {
      first_name: '', last_name: '', address_1: '', address_2: '',
      city: '', state: '', zipcode: '', country: 'US',
    },
    items: [blankItem()],
  });

  const updateAddress = (field, value) => {
    setForm(f => ({ ...f, address: { ...f.address, [field]: value } }));
  };

  useEffect(() => {
    api.get('/products', { params: { per_page: 100 } }).then(res => setProducts(res.data.data || []));
  }, []);

  const allVariants = products.flatMap(p => p.variants?.map(v => ({ ...v, product_name: p.name, product_id: p.id })) || []);

  // Lookup product (with accessories) from selected variant id
  const productOfVariant = (variantId) => {
    if (!variantId) return null;
    return products.find(p => p.variants?.some(v => String(v.id) === String(variantId))) || null;
  };

  const updateItem = (index, patch) => {
    setForm(f => {
      const items = [...f.items];
      items[index] = { ...items[index], ...patch };
      return { ...f, items };
    });
  };

  const addItem = () => {
    setForm(f => ({ ...f, items: [...f.items, blankItem()] }));
  };

  const removeItem = (index) => {
    if (form.items.length === 1) return;
    setForm({ ...form, items: form.items.filter((_, i) => i !== index) });
  };

  const submitOrder = async ({ force = false, rename = false } = {}) => {
    const payload = {
      ref_id: form.ref_id || null,
      items: form.items.map(it => ({
        product_variant_id: it.product_variant_id,
        accessory_item_id: it.accessory_item_id ? Number(it.accessory_item_id) : null,
        mockup_front: it.mockup_front,
        mockup_back: it.mockup_back,
        order_type: it.order_type,
        quantity: Math.max(1, parseInt(it.quantity, 10) || 1),
        metas: (it.metas || []).filter(m => m.key && m.key.trim() !== '').map(m => ({ key: m.key, value: m.value })),
      })),
      force,
      rename,
    };
    if (form.method === 'label') {
      payload.shipping_label = form.shipping_label;
    } else {
      payload.address = form.address;
    }
    return api.post('/orders', payload);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      let res;
      try {
        res = await submitOrder();
      } catch (err) {
        if (err.response?.status === 409 && Array.isArray(err.response?.data?.duplicates)) {
          const dups = err.response.data.duplicates.join(', ');
          const cont = await askConfirm(`Ref_id đã tồn tại: ${dups}\n\nCó muốn tiếp tục tạo order không?`, { title: 'Duplicate ref_id', okText: 'Tiếp tục', cancelText: 'Huỷ' });
          if (!cont) {
            setLoading(false);
            return;
          }
          const doRename = await askConfirm('Có muốn thêm hậu tố _r_<số> vào ref_id để tránh trùng không?', { title: 'Rename ref_id', okText: 'Có (auto rename)', cancelText: 'Không (giữ trùng)' });
          res = await submitOrder({ force: true, rename: doRename });
        } else {
          throw err;
        }
      }
      navigate(`/orders/${res.data.order.id}`);
    } catch (err) {
      const errs = err.response?.data?.errors;
      const msg = err.response?.data?.message || (errs ? Object.values(errs).flat().join('\n') : 'Error');
      notify(msg, { title: 'Create order failed', kind: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const submitCsv = async ({ force = false, rename = false } = {}) => {
    const formData = new FormData();
    formData.append('file', csvFile);
    if (force) formData.append('force', '1');
    if (rename) formData.append('rename', '1');
    return api.post('/orders/import-csv', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
  };

  const handleCsvImport = async () => {
    if (!csvFile) return;
    setLoading(true);
    try {
      let res;
      try {
        res = await submitCsv();
      } catch (err) {
        if (err.response?.status === 409 && Array.isArray(err.response?.data?.duplicates)) {
          const dups = err.response.data.duplicates;
          const preview = dups.slice(0, 20).join(', ') + (dups.length > 20 ? `, … (+${dups.length - 20} more)` : '');
          const cont = await askConfirm(`Phát hiện ${dups.length} ref_id trùng:\n${preview}\n\nCó muốn tiếp tục import không?`, { title: 'Duplicate ref_id', okText: 'Tiếp tục', cancelText: 'Huỷ' });
          if (!cont) {
            setLoading(false);
            return;
          }
          const doRename = await askConfirm('Có muốn thêm hậu tố _r_<số> vào ref_id trùng không?', { title: 'Rename ref_id', okText: 'Có (auto rename)', cancelText: 'Không (giữ trùng)' });
          res = await submitCsv({ force: true, rename: doRename });
        } else {
          throw err;
        }
      }
      setCsvResult(res.data);
    } catch (err) {
      notify(err.response?.data?.message || 'Error', { title: 'Import failed', kind: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const res = await api.get('/orders/export-csv-template', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'order_template.csv';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      notify('Download failed', { title: 'Error', kind: 'error' });
    }
  };

  return (
    <div className="p-6">
      <button onClick={() => navigate('/orders')} className="text-neutral-400 hover:text-neutral-700 text-sm mb-2">&larr; Back</button>
      <h2 className="text-xl font-bold text-neutral-800 mb-4">Create Order</h2>

      <div className="flex gap-3 mb-4">
        <button onClick={() => setCsvMode(false)} className={`px-4 py-2 text-sm rounded-lg ${!csvMode ? 'bg-orange-500 text-white' : 'bg-white border border-neutral-200 text-neutral-600'}`}>Manual</button>
        <button onClick={() => setCsvMode(true)} className={`px-4 py-2 text-sm rounded-lg ${csvMode ? 'bg-orange-500 text-white' : 'bg-white border border-neutral-200 text-neutral-600'}`}>CSV Import</button>
      </div>

      {csvMode ? (
        <div className="bg-white rounded-xl border border-neutral-200 p-6 space-y-4 shadow-sm">
          <button onClick={handleDownloadTemplate} className="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Download Template</button>
          <div>
            <input type="file" accept=".csv,.txt" onChange={e => setCsvFile(e.target.files[0])} className="text-sm text-neutral-600" />
          </div>
          <button onClick={handleCsvImport} disabled={!csvFile || loading} className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg">
            {loading ? 'Importing...' : 'Import CSV'}
          </button>
          {csvResult && (
            <div className="p-4 bg-[#faf8f6] rounded-lg text-sm border border-neutral-200">
              <p className="text-green-600">Created: {csvResult.created_count} orders</p>
              {csvResult.error_count > 0 && <p className="text-red-500 mt-1">Errors: {csvResult.error_count}</p>}
              {csvResult.errors?.map((e, i) => <p key={i} className="text-red-400 text-xs">{e}</p>)}
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Customer ref */}
          <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
            <label className="text-xs text-neutral-500">Ref ID <span className="text-neutral-400">(your reference, optional)</span></label>
            <input
              value={form.ref_id}
              onChange={e => setForm(f => ({ ...f, ref_id: e.target.value }))}
              placeholder="e.g. TikTok order # / your internal ref..."
              className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm"
            />
          </div>

          {/* Shipping */}
          <div className="bg-white rounded-xl border border-neutral-200 p-4 space-y-3 shadow-sm">
            <h3 className="text-sm font-semibold text-neutral-600">Shipping</h3>
            <div>
              <label className="text-xs text-neutral-500">Shipping Label (URL — Drive supported)</label>
              <input
                value={form.shipping_label}
                onChange={e => setForm(f => ({ ...f, shipping_label: e.target.value }))}
                placeholder="Paste label URL..."
                className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm"
              />
              <UrlPreview url={form.shipping_label} onOpen={setPreviewUrl} label="Preview shipping label" />
            </div>
          </div>

          {/* Items */}
          <div className="bg-white rounded-xl border border-neutral-200 p-4 space-y-3 shadow-sm">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold text-neutral-600">Items</h3>
              <button type="button" onClick={addItem} className="text-xs text-orange-500 hover:text-orange-600">+ Add Item</button>
            </div>
            {form.items.map((item, i) => {
              const product = productOfVariant(item.product_variant_id);
              const accessories = product?.accessories || [];
              const selectedAccessory = accessories.find(a => String(a.id) === String(item.accessory_id));
              const stylePrices = (selectedAccessory?.prices || []).filter(p => userTierId == null || p.tier_id === userTierId);

              return (
                <div key={i} className="border border-neutral-100 rounded-lg p-3 space-y-3">
                  <div className="grid grid-cols-6 gap-3 items-end">
                    <div>
                      <label className="text-xs text-neutral-500">Product Variant</label>
                      <select
                        value={item.product_variant_id}
                        onChange={e => updateItem(i, { product_variant_id: e.target.value, accessory_id: '', accessory_item_id: '' })}
                        className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm"
                        required
                      >
                        <option value="">Select...</option>
                        {allVariants.map(v => (
                          <option key={v.id} value={v.id}>{v.product_name} - {v.color}/{v.size}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-neutral-500">Qty</label>
                      <input type="number" min="1" value={item.quantity} onChange={e => updateItem(i, { quantity: e.target.value })} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-neutral-500">Mockup Front</label>
                      <input value={item.mockup_front} onChange={e => updateItem(i, { mockup_front: e.target.value })} placeholder="URL (Drive supported)" className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
                      <UrlPreview url={item.mockup_front} onOpen={setPreviewUrl} label="Preview mockup front" />
                    </div>
                    <div>
                      <label className="text-xs text-neutral-500">Mockup Back</label>
                      <input value={item.mockup_back} onChange={e => updateItem(i, { mockup_back: e.target.value })} placeholder="URL (Drive supported)" className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
                      <UrlPreview url={item.mockup_back} onOpen={setPreviewUrl} label="Preview mockup back" />
                    </div>
                    <div>
                      <label className="text-xs text-neutral-500">Type</label>
                      <select value={item.order_type} onChange={e => updateItem(i, { order_type: parseInt(e.target.value) })} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm">
                        <option value={0}>Greeting Card</option>
                        <option value={1}>Pass Sleeve</option>
                      </select>
                    </div>
                    <button type="button" onClick={() => removeItem(i)} className="px-3 py-2 text-red-500 hover:text-red-600 text-sm">Remove</button>
                  </div>

                  {/* Accessory + Style picker — only when product has accessories */}
                  {product && accessories.length > 0 && (
                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-neutral-100">
                      <div>
                        <label className="text-xs text-neutral-500">Accessory</label>
                        <select
                          value={item.accessory_id}
                          onChange={e => updateItem(i, { accessory_id: e.target.value, accessory_item_id: '' })}
                          className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm"
                        >
                          <option value="">— None —</option>
                          {accessories.map(a => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-neutral-500">Style {selectedAccessory && stylePrices.length === 0 && <span className="text-red-400">(no price for your tier)</span>}</label>
                        <select
                          value={item.accessory_item_id}
                          onChange={e => updateItem(i, { accessory_item_id: e.target.value })}
                          disabled={!selectedAccessory || stylePrices.length === 0}
                          className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm disabled:opacity-50"
                        >
                          <option value="">Select style...</option>
                          {stylePrices.map(p => (
                            <option key={p.id} value={p.id}>{p.style || '(no style)'} — ${p.price}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Metas */}
                  <div className="pt-2 border-t border-neutral-100">
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-xs text-neutral-500">Metas (custom fields)</label>
                      <button type="button" onClick={() => addMeta(i)} className="text-xs text-orange-500 hover:text-orange-600">+ Add Meta</button>
                    </div>
                    {(item.metas || []).length === 0 ? (
                      <p className="text-xs text-neutral-400">No metas.</p>
                    ) : (
                      <div className="space-y-2">
                        {item.metas.map((m, mi) => (
                          <div key={mi} className="grid grid-cols-[1fr_2fr_auto_auto] gap-2 items-center">
                            <select
                              value={m.key}
                              onChange={e => updateMeta(i, mi, 'key', e.target.value)}
                              className="px-2 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded text-neutral-800 text-xs"
                            >
                              {META_KEYS.map(k => (
                                <option key={k} value={k}>{k}</option>
                              ))}
                            </select>
                            <input
                              type="text"
                              value={m.value}
                              onChange={e => updateMeta(i, mi, 'value', e.target.value)}
                              placeholder="value (URL — Drive supported)"
                              className="px-2 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded text-neutral-800 text-xs"
                            />
                            {isPreviewable(m.value) ? (
                              <UrlPreview url={m.value} onOpen={setPreviewUrl} label="Preview meta" size="sm" />
                            ) : <span className="w-16" />}
                            <button type="button" onClick={() => removeMeta(i, mi)} className="text-xs text-red-400 hover:text-red-600 px-2">×</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <button type="submit" disabled={loading} className="px-6 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg font-medium">
            {loading ? 'Creating...' : 'Create Order'}
          </button>
        </form>
      )}

      <PreviewModal url={previewUrl} onClose={() => setPreviewUrl(null)} />
    </div>
  );
}
