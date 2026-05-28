import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [variantForm, setVariantForm] = useState({ sku: '', color: '', size: '', paper_type: '', weight: '', length: '', width: '', height: '' });
  const [showVariantForm, setShowVariantForm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', style: '', line_id: '', status: 1 });
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const csvFileRef = useRef(null);
  const [tiers, setTiers] = useState([]);
  const [accessoryName, setAccessoryName] = useState('');
  const [showAccessoryForm, setShowAccessoryForm] = useState(false);

  const fetchProduct = () => {
    api.get(`/products/${id}`).then(res => {
      setProduct(res.data.product);
      setEditForm({ name: res.data.product.name, style: res.data.product.style || '', line_id: res.data.product.line_id || '', status: res.data.product.status });
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchProduct(); }, [id]);

  useEffect(() => {
    if (hasRole('admin')) {
      api.get('/settings/tiers').then(res => setTiers(res.data || []));
    }
  }, [hasRole]);

  const handleAddAccessory = async (e) => {
    e.preventDefault();
    if (!accessoryName.trim()) return;
    await api.post(`/products/${id}/accessories`, { name: accessoryName });
    setAccessoryName('');
    setShowAccessoryForm(false);
    fetchProduct();
  };

  const handleDeleteAccessory = async (accessoryId) => {
    if (!confirm('Delete this accessory and all its prices?')) return;
    await api.delete(`/accessories/${accessoryId}`);
    fetchProduct();
  };

  const handleDeleteAccessoryPrice = async (priceId) => {
    if (!confirm('Delete this price?')) return;
    await api.delete(`/accessory-prices/${priceId}`);
    fetchProduct();
  };

  const handleUpdateProduct = async () => {
    await api.put(`/products/${id}`, editForm);
    setEditing(false);
    fetchProduct();
  };

  const handleAddVariant = async (e) => {
    e.preventDefault();
    const numFields = ['weight', 'length', 'width', 'height'];
    const payload = { ...variantForm };
    numFields.forEach(k => {
      payload[k] = payload[k] === '' ? null : Number(payload[k]);
    });
    await api.post(`/products/${id}/variants`, payload);
    setVariantForm({ sku: '', color: '', size: '', paper_type: '', weight: '', length: '', width: '', height: '' });
    setShowVariantForm(false);
    fetchProduct();
  };

  const handleDeleteVariant = async (variantId) => {
    if (!confirm('Delete this variant?')) return;
    await api.delete(`/variants/${variantId}`);
    fetchProduct();
  };

  const handleImportCsv = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post('/product-prices/import-csv', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportResult(res.data);
      fetchProduct();
    } catch (err) {
      setImportResult({ message: err.response?.data?.message || 'Import failed', error_count: 1 });
    } finally {
      setImporting(false);
      if (csvFileRef.current) csvFileRef.current.value = '';
    }
  };

  const handleExportPrices = async () => {
    try {
      const res = await api.get('/product-prices/export', {
        params: { product_id: id },
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `prices_product_${id}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert('Export failed');
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const res = await api.get('/product-prices/export-template', { params: { product_id: id }, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'price_template.csv';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert('Download failed');
    }
  };

  if (loading) return <div className="p-6 text-neutral-400">Loading...</div>;
  if (!product) return <div className="p-6 text-red-500">Product not found</div>;

  return (
    <div className="p-6">
      <button onClick={() => navigate('/products')} className="text-neutral-400 hover:text-neutral-700 text-sm mb-2">&larr; Back</button>

      {/* Product info */}
      <div className="bg-white rounded-xl border border-neutral-200 p-4 mb-6 shadow-sm">
        {editing ? (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-neutral-500">Name</label>
                <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
              </div>
              <div>
                <label className="text-xs text-neutral-500">Style</label>
                <input value={editForm.style} onChange={e => setEditForm({ ...editForm, style: e.target.value })} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
              </div>
              <div>
                <label className="text-xs text-neutral-500">Line ID</label>
                <input value={editForm.line_id} onChange={e => setEditForm({ ...editForm, line_id: e.target.value })} placeholder="e.g. GC" maxLength={16} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm font-mono" />
              </div>
              <div>
                <label className="text-xs text-neutral-500">Status</label>
                <select value={editForm.status} onChange={e => setEditForm({ ...editForm, status: parseInt(e.target.value) })} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm">
                  <option value={1}>Active</option>
                  <option value={0}>Inactive</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleUpdateProduct} className="px-4 py-2 bg-orange-500 text-white text-sm rounded-lg">Save</button>
              <button onClick={() => setEditing(false)} className="px-4 py-2 bg-neutral-100 text-neutral-600 text-sm rounded-lg">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-bold text-neutral-800">{product.name}</h2>
              <p className="text-neutral-500 text-sm">
                Style: {product.style || '-'}
                {' | '}Line ID: <span className="font-mono">{product.line_id || '-'}</span>
                {' | '}Variants: {product.variants?.length || 0}
              </p>
            </div>
            {hasRole('admin') && (
              <button onClick={() => setEditing(true)} className="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Edit</button>
            )}
          </div>
        )}
      </div>

      {/* Variants */}
      <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-sm font-semibold text-neutral-600">Variants</h3>
          {hasRole('admin') && (
            <button onClick={() => setShowVariantForm(!showVariantForm)} className="text-xs text-orange-500 hover:text-orange-600">
              {showVariantForm ? 'Cancel' : '+ Add Variant'}
            </button>
          )}
        </div>

        {showVariantForm && (
          <form onSubmit={handleAddVariant} className="mb-4 grid grid-cols-8 gap-2 items-end">
            {['sku', 'color', 'size', 'paper_type', 'weight', 'length', 'width', 'height'].map(field => (
              <div key={field}>
                <label className="text-xs text-neutral-500 capitalize">{field}</label>
                <input value={variantForm[field]} onChange={e => setVariantForm({ ...variantForm, [field]: e.target.value })} className="w-full mt-1 px-2 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded text-neutral-800 text-xs" />
              </div>
            ))}
            <button type="submit" className="px-3 py-1.5 bg-orange-500 text-white text-xs rounded">Add</button>
          </form>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr className="text-neutral-500 text-xs border-b border-neutral-200">
              <th className="pb-2 text-left">SKU</th>
              <th className="pb-2 text-left">Color</th>
              <th className="pb-2 text-left">Size</th>
              <th className="pb-2 text-left">Paper</th>
              <th className="pb-2 text-right">Weight</th>
              <th className="pb-2 text-right">L x W x H</th>
              <th className="pb-2 text-right">Prices</th>
              <th className="pb-2 text-right">Status</th>
              {hasRole('admin') && <th className="pb-2"></th>}
            </tr>
          </thead>
          <tbody>
            {product.variants?.map(v => (
              <VariantRow
                key={v.id}
                variant={v}
                tiers={tiers}
                isAdmin={hasRole('admin')}
                onSaved={fetchProduct}
                onDelete={() => handleDeleteVariant(v.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Accessories */}
      <div className="bg-white rounded-xl border border-neutral-200 p-4 mt-6 shadow-sm">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-sm font-semibold text-neutral-600">Accessories</h3>
          {hasRole('admin') && (
            <button onClick={() => setShowAccessoryForm(!showAccessoryForm)} className="text-xs text-orange-500 hover:text-orange-600">
              {showAccessoryForm ? 'Cancel' : '+ Add Accessory'}
            </button>
          )}
        </div>

        {showAccessoryForm && hasRole('admin') && (
          <form onSubmit={handleAddAccessory} className="mb-4 flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-xs text-neutral-500">Name</label>
              <input value={accessoryName} onChange={e => setAccessoryName(e.target.value)} required placeholder="e.g. Gift Box, Ribbon..." className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
            </div>
            <button type="submit" className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg">Add</button>
          </form>
        )}

        {(!product.accessories || product.accessories.length === 0) ? (
          <p className="text-neutral-400 text-xs">No accessories yet.</p>
        ) : (
          <div className="space-y-3">
            {product.accessories.map(acc => (
              <AccessoryRow
                key={acc.id}
                accessory={acc}
                tiers={tiers}
                isAdmin={hasRole('admin')}
                onDeleteAccessory={() => handleDeleteAccessory(acc.id)}
                onDeletePrice={handleDeleteAccessoryPrice}
                onSaved={fetchProduct}
              />
            ))}
          </div>
        )}
      </div>

      {/* Price Import / Export */}
      {hasRole('admin') && (
        <div className="bg-white rounded-xl border border-neutral-200 p-4 mt-6 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-600 mb-3">Price Import / Export</h3>

          <div className="flex flex-wrap gap-3 items-center">
            <label className={`px-4 py-2 text-sm rounded-lg cursor-pointer ${importing ? 'bg-neutral-200 text-neutral-400' : 'bg-green-500 hover:bg-green-600 text-white'}`}>
              {importing ? 'Importing...' : 'Import CSV'}
              <input ref={csvFileRef} type="file" accept=".csv,.txt" onChange={handleImportCsv} disabled={importing} className="hidden" />
            </label>

            <button onClick={handleExportPrices} className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg">
              Export Prices
            </button>

            <button onClick={handleDownloadTemplate} className="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-600 text-sm rounded-lg">
              Download Template
            </button>
          </div>

          {importResult && (
            <div className={`mt-3 p-3 rounded-lg text-sm ${importResult.error_count > 0 ? 'bg-yellow-50 border border-yellow-200' : 'bg-green-50 border border-green-200'}`}>
              <p className={importResult.error_count > 0 ? 'text-yellow-600' : 'text-green-600'}>{importResult.message}</p>
              {importResult.error_count > 0 && (
                <p className="text-yellow-500 text-xs mt-1">{importResult.error_count} error(s)</p>
              )}
              {importResult.errors?.length > 0 && (
                <ul className="mt-1 text-xs text-yellow-500 list-disc list-inside">
                  {importResult.errors.slice(0, 5).map((err, i) => <li key={i}>{err}</li>)}
                  {importResult.errors.length > 5 && <li>...and {importResult.errors.length - 5} more</li>}
                </ul>
              )}
            </div>
          )}

          <p className="text-xs text-neutral-400 mt-3">
            Export lists all variants x tiers x keys (base_cost, label_fee, shipping_cost). Update the "price" column and import back.
          </p>
        </div>
      )}
    </div>
  );
}

const PRICE_KEYS = ['base_cost', 'label_fee', 'shipping_cost', 'addition_fee', '2nd_fee'];
const PRICE_LABEL = { base_cost: 'base', label_fee: 'label', shipping_cost: 'ship', addition_fee: 'add', '2nd_fee': '2nd' };

function VariantPriceSummary({ prices }) {
  if (!prices || prices.length === 0) {
    return <span className="text-neutral-400 text-xs">No price</span>;
  }
  // Group by tier
  const byTier = {};
  prices.forEach(p => {
    const tid = p.tier_id;
    if (!byTier[tid]) byTier[tid] = { name: p.tier?.name || `Tier ${tid}`, prices: {} };
    byTier[tid].prices[p.key] = p.price;
  });
  return (
    <div className="space-y-0.5 inline-block text-left">
      {Object.entries(byTier).map(([tid, data]) => (
        <div key={tid} className="flex items-center gap-1.5 text-[11px] whitespace-nowrap">
          <span className="px-1.5 py-0.5 bg-neutral-100 text-neutral-700 rounded font-medium">{data.name}</span>
          {PRICE_KEYS.map(k => data.prices[k] !== undefined && (
            <span key={k} className="text-neutral-600">
              <span className="text-neutral-400">{PRICE_LABEL[k]}</span>{' '}
              <span className="font-medium tabular-nums">${data.prices[k]}</span>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function VariantRow({ variant, tiers, isAdmin, onSaved, onDelete }) {
  const [editing, setEditing] = useState(false);
  const initialForm = () => ({
    sku: variant.sku ?? '',
    color: variant.color ?? '',
    size: variant.size ?? '',
    paper_type: variant.paper_type ?? '',
    weight: variant.weight ?? '',
    length: variant.length ?? '',
    width: variant.width ?? '',
    height: variant.height ?? '',
    status: variant.status ?? 1,
  });
  const [form, setForm] = useState(initialForm);
  const [priceMatrix, setPriceMatrix] = useState({});
  const [saving, setSaving] = useState(false);

  const buildPriceMatrix = () => {
    const m = {};
    (tiers || []).forEach(t => {
      PRICE_KEYS.forEach(k => {
        const found = (variant.prices || []).find(p => p.tier_id === t.id && p.key === k);
        m[`${t.id}-${k}`] = found ? String(found.price) : '';
      });
    });
    return m;
  };

  const startEdit = () => {
    setForm(initialForm());
    setPriceMatrix(buildPriceMatrix());
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        sku: form.sku || null,
        color: form.color,
        size: form.size,
        paper_type: form.paper_type || null,
        status: parseInt(form.status),
      };
      ['weight', 'length', 'width', 'height'].forEach(k => {
        payload[k] = form[k] === '' ? null : Number(form[k]);
      });
      await api.put(`/variants/${variant.id}`, payload);

      // Upsert prices that have a value entered
      const prices = [];
      (tiers || []).forEach(t => {
        PRICE_KEYS.forEach(k => {
          const v = priceMatrix[`${t.id}-${k}`];
          if (v !== '' && v !== undefined && v !== null) {
            const num = Number(v);
            if (!Number.isNaN(num)) {
              prices.push({
                product_variant_id: variant.id,
                tier_id: t.id,
                key: k,
                price: num,
              });
            }
          }
        });
      });
      if (prices.length > 0) {
        await api.post('/product-prices/import', { prices });
      }

      setEditing(false);
      onSaved();
    } catch (err) {
      alert(err.response?.data?.message || JSON.stringify(err.response?.data?.errors) || 'Error saving variant');
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <>
        <tr className="border-b border-neutral-100 bg-orange-50/40">
          <td className="py-2 pr-2"><input value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} className="w-full px-2 py-1 bg-white border border-neutral-200 rounded text-xs" placeholder="sku" /></td>
          <td className="py-2 pr-2"><input value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} className="w-full px-2 py-1 bg-white border border-neutral-200 rounded text-xs" placeholder="color" /></td>
          <td className="py-2 pr-2"><input value={form.size} onChange={e => setForm(f => ({ ...f, size: e.target.value }))} className="w-full px-2 py-1 bg-white border border-neutral-200 rounded text-xs" placeholder="size" /></td>
          <td className="py-2 pr-2"><input value={form.paper_type} onChange={e => setForm(f => ({ ...f, paper_type: e.target.value }))} className="w-full px-2 py-1 bg-white border border-neutral-200 rounded text-xs" placeholder="paper" /></td>
          <td className="py-2 pr-2"><input type="text" inputMode="decimal" value={form.weight} onChange={e => setForm(f => ({ ...f, weight: e.target.value }))} className="w-full px-2 py-1 bg-white border border-neutral-200 rounded text-xs text-right" placeholder="weight" /></td>
          <td className="py-2 pr-2">
            <div className="grid grid-cols-3 gap-1">
              <input type="text" inputMode="decimal" value={form.length} onChange={e => setForm(f => ({ ...f, length: e.target.value }))} className="px-1 py-1 bg-white border border-neutral-200 rounded text-xs text-right" placeholder="L" />
              <input type="text" inputMode="decimal" value={form.width} onChange={e => setForm(f => ({ ...f, width: e.target.value }))} className="px-1 py-1 bg-white border border-neutral-200 rounded text-xs text-right" placeholder="W" />
              <input type="text" inputMode="decimal" value={form.height} onChange={e => setForm(f => ({ ...f, height: e.target.value }))} className="px-1 py-1 bg-white border border-neutral-200 rounded text-xs text-right" placeholder="H" />
            </div>
          </td>
          <td className="py-2 text-right text-neutral-400 text-xs">edit ↓</td>
          <td className="py-2 text-right">
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="px-2 py-1 bg-white border border-neutral-200 rounded text-xs">
              <option value={1}>Active</option>
              <option value={0}>Inactive</option>
            </select>
          </td>
          <td className="py-2 text-right">
            <div className="flex gap-2 justify-end">
              <button onClick={handleSave} disabled={saving} className="text-xs text-orange-500 hover:text-orange-600 disabled:opacity-50">{saving ? '...' : 'Save'}</button>
              <button onClick={() => setEditing(false)} disabled={saving} className="text-xs text-neutral-500 hover:text-neutral-700">Cancel</button>
            </div>
          </td>
        </tr>
        <tr className="border-b border-neutral-100 bg-orange-50/20">
          <td colSpan={8} className="py-3 px-2">
            <div className="text-xs text-neutral-500 mb-2 font-medium">Prices (tier × key)</div>
            {(!tiers || tiers.length === 0) ? (
              <p className="text-xs text-neutral-400">No tiers found.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-neutral-500 border-b border-neutral-200">
                    <th className="py-1 px-2 text-left">Tier</th>
                    {PRICE_KEYS.map(k => (
                      <th key={k} className="py-1 px-2 text-right">{k.replace('_', ' ')}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tiers.map(t => (
                    <tr key={t.id} className="border-b border-neutral-100">
                      <td className="py-1 px-2 text-neutral-700">{t.name}</td>
                      {PRICE_KEYS.map(k => {
                        const cellKey = `${t.id}-${k}`;
                        return (
                          <td key={k} className="py-1 px-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={priceMatrix[cellKey] ?? ''}
                              onChange={e => setPriceMatrix(prev => ({ ...prev, [cellKey]: e.target.value }))}
                              placeholder="—"
                              className="w-full px-2 py-1 bg-white border border-neutral-200 rounded text-xs text-right"
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-[11px] text-neutral-400 mt-2">Empty cells are skipped (existing values preserved). Enter a number to upsert.</p>
          </td>
        </tr>
      </>
    );
  }

  return (
    <tr className="border-b border-neutral-100">
      <td className="py-2 text-neutral-700 font-mono text-xs">{variant.sku || '-'}</td>
      <td className="py-2 text-neutral-800">{variant.color || '-'}</td>
      <td className="py-2 text-neutral-800">{variant.size || '-'}</td>
      <td className="py-2 text-neutral-800">{variant.paper_type || '-'}</td>
      <td className="py-2 text-right text-neutral-600">{variant.weight || '-'}</td>
      <td className="py-2 text-right text-neutral-600">{variant.length && variant.width && variant.height ? `${variant.length}x${variant.width}x${variant.height}` : '-'}</td>
      <td className="py-2 text-right">
        <VariantPriceSummary prices={variant.prices} />
      </td>
      <td className="py-2 text-right">
        <span className={`text-xs font-medium ${variant.status ? 'text-green-600' : 'text-red-500'}`}>{variant.status ? 'Active' : 'Inactive'}</span>
      </td>
      {isAdmin && (
        <td className="py-2 text-right">
          <div className="flex gap-3 justify-end">
            <button onClick={startEdit} className="text-xs text-orange-500 hover:text-orange-600">Edit</button>
            <button onClick={onDelete} className="text-xs text-red-500 hover:text-red-600">Delete</button>
          </div>
        </td>
      )}
    </tr>
  );
}

function AccessoryPriceRow({ price, tiers, isAdmin, onSaved, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [tierId, setTierId] = useState(String(price.tier_id ?? ''));
  const [style, setStyle] = useState(price.style ?? '');
  const [code, setCode] = useState(price.accessory_code ?? '');
  const [val, setVal] = useState(String(price.price ?? ''));
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setTierId(String(price.tier_id ?? ''));
    setStyle(price.style ?? '');
    setCode(price.accessory_code ?? '');
    setVal(String(price.price ?? ''));
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/accessory-prices/${price.id}`, {
        tier_id: tierId ? parseInt(tierId) : null,
        style: style || null,
        accessory_code: code || null,
        price: val === '' ? 0 : parseFloat(val),
      });
      setEditing(false);
      onSaved();
    } catch (err) {
      alert(err.response?.data?.message || 'Error saving price');
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <tr className="border-b border-neutral-50 bg-orange-50/40">
        <td className="py-1 pr-1">
          <select value={tierId} onChange={e => setTierId(e.target.value)} className="w-full px-1.5 py-1 bg-white border border-neutral-200 rounded text-xs">
            {(tiers || []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </td>
        <td className="py-1 pr-1">
          <input value={style} onChange={e => setStyle(e.target.value)} className="w-full px-1.5 py-1 bg-white border border-neutral-200 rounded text-xs" placeholder="optional" />
        </td>
        <td className="py-1 pr-1">
          <input value={code} onChange={e => setCode(e.target.value)} className="w-full px-1.5 py-1 bg-white border border-neutral-200 rounded text-xs font-mono" placeholder="code" />
        </td>
        <td className="py-1 pr-1 text-right">
          <input type="text" inputMode="decimal" value={val} onChange={e => setVal(e.target.value)} className="w-full px-1.5 py-1 bg-white border border-neutral-200 rounded text-xs text-right" />
        </td>
        {isAdmin && (
          <td className="py-1 text-right">
            <div className="flex gap-2 justify-end">
              <button onClick={handleSave} disabled={saving} className="text-xs text-orange-500 hover:text-orange-600 disabled:opacity-50">{saving ? '...' : 'Save'}</button>
              <button onClick={() => setEditing(false)} disabled={saving} className="text-xs text-neutral-500 hover:text-neutral-700">Cancel</button>
            </div>
          </td>
        )}
      </tr>
    );
  }

  return (
    <tr className="border-b border-neutral-50">
      <td className="py-1 text-neutral-700">{price.tier?.name || `#${price.tier_id}`}</td>
      <td className="py-1 text-neutral-600">{price.style || '-'}</td>
      <td className="py-1 text-neutral-600 font-mono">{price.accessory_code || '-'}</td>
      <td className="py-1 text-right text-neutral-800 font-medium">${price.price}</td>
      {isAdmin && (
        <td className="py-1 text-right">
          <div className="flex gap-2 justify-end">
            <button onClick={startEdit} className="text-xs text-orange-500 hover:text-orange-600">Edit</button>
            <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-600">×</button>
          </div>
        </td>
      )}
    </tr>
  );
}

function AccessoryRow({ accessory, tiers, isAdmin, onDeleteAccessory, onDeletePrice, onSaved }) {
  const [tierId, setTierId] = useState('');
  const [style, setStyle] = useState('');
  const [accessoryCode, setAccessoryCode] = useState('');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(accessory.name);
  const [savingName, setSavingName] = useState(false);

  const handleSave = async () => {
    if (!tierId || price === '') {
      alert('Pick a tier and enter a price');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/accessories/${accessory.id}/prices`, {
        tier_id: parseInt(tierId),
        style: style || null,
        accessory_code: accessoryCode || null,
        price: parseFloat(price),
      });
      setTierId('');
      setStyle('');
      setAccessoryCode('');
      setPrice('');
      onSaved();
    } catch (err) {
      alert(err.response?.data?.message || 'Error saving price');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveName = async () => {
    if (!name.trim()) return;
    setSavingName(true);
    try {
      await api.put(`/accessories/${accessory.id}`, { name });
      setEditingName(false);
      onSaved();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    } finally {
      setSavingName(false);
    }
  };

  // Toggle whether this accessory gets a Gangsheet Compose chip + filename
  // tag. Off = physical-only add-on (e.g. envelope) that needs no gangsheet.
  const toggleGangsheetSplit = async () => {
    try {
      await api.put(`/accessories/${accessory.id}`, {
        name: accessory.name,
        gangsheet_split: !(accessory.gangsheet_split ?? true),
      });
      onSaved();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  return (
    <div className="border border-neutral-200 rounded-lg p-3">
      <div className="flex justify-between items-center mb-2">
        {editingName ? (
          <div className="flex gap-2 items-center flex-1">
            <input value={name} onChange={e => setName(e.target.value)} className="flex-1 px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded text-neutral-800 text-sm" />
            <button onClick={handleSaveName} disabled={savingName} className="text-xs text-orange-500 hover:text-orange-600 disabled:opacity-50">{savingName ? '...' : 'Save'}</button>
            <button onClick={() => { setName(accessory.name); setEditingName(false); }} disabled={savingName} className="text-xs text-neutral-500 hover:text-neutral-700">Cancel</button>
          </div>
        ) : (
          <div className="text-neutral-800 font-medium text-sm">{accessory.name}</div>
        )}
        {isAdmin && !editingName && (
          <div className="flex gap-3 items-center">
            <label className="flex items-center gap-1 text-xs text-neutral-500 cursor-pointer" title="Hiện chip + tag tên gangsheet riêng cho accessory này (tắt với add-on vật lý như envelope)">
              <input
                type="checkbox"
                checked={accessory.gangsheet_split ?? true}
                onChange={toggleGangsheetSplit}
                className="accent-orange-500"
              />
              Gangsheet chip
            </label>
            <button onClick={() => { setName(accessory.name); setEditingName(true); }} className="text-xs text-orange-500 hover:text-orange-600">Edit</button>
            <button onClick={onDeleteAccessory} className="text-xs text-red-500 hover:text-red-600">Delete</button>
          </div>
        )}
      </div>

      {accessory.prices && accessory.prices.length > 0 ? (
        <table className="w-full text-xs mb-2">
          <thead>
            <tr className="text-neutral-500 border-b border-neutral-100">
              <th className="py-1 text-left">Tier</th>
              <th className="py-1 text-left">Style</th>
              <th className="py-1 text-left">Code</th>
              <th className="py-1 text-right">Price</th>
              {isAdmin && <th className="py-1 text-right"></th>}
            </tr>
          </thead>
          <tbody>
            {accessory.prices.map(p => (
              <AccessoryPriceRow
                key={p.id}
                price={p}
                tiers={tiers}
                isAdmin={isAdmin}
                onSaved={onSaved}
                onDelete={() => onDeletePrice(p.id)}
              />
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-neutral-400 text-xs mb-2">No prices configured.</p>
      )}

      {isAdmin && (
        <div className="grid grid-cols-5 gap-2 items-end pt-2 border-t border-neutral-100">
          <div>
            <label className="text-xs text-neutral-500">Tier</label>
            <select value={tierId} onChange={e => setTierId(e.target.value)} className="w-full mt-1 px-2 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded text-neutral-800 text-xs">
              <option value="">Select...</option>
              {tiers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-neutral-500">Style</label>
            <input
              type="text"
              value={style}
              onChange={e => setStyle(e.target.value)}
              placeholder="optional"
              className="w-full mt-1 px-2 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded text-neutral-800 text-xs"
            />
          </div>
          <div>
            <label className="text-xs text-neutral-500">Code</label>
            <input
              type="text"
              value={accessoryCode}
              onChange={e => setAccessoryCode(e.target.value)}
              placeholder="for CSV import"
              className="w-full mt-1 px-2 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded text-neutral-800 text-xs"
            />
          </div>
          <div>
            <label className="text-xs text-neutral-500">Price</label>
            <input
              type="text"
              inputMode="decimal"
              value={price}
              onChange={e => setPrice(e.target.value)}
              placeholder="0.00"
              className="w-full mt-1 px-2 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded text-neutral-800 text-xs"
            />
          </div>
          <button type="button" onClick={handleSave} disabled={saving} className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs rounded">
            {saving ? 'Saving...' : 'Save Price'}
          </button>
        </div>
      )}
    </div>
  );
}
