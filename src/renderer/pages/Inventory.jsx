import { useState, useEffect, useMemo } from 'react';
import api from '../services/api';
import { notify, askConfirm } from '../components/Dialog';

const MODE_PER_ITEM = 'per_item';
const MODE_PER_PACKAGE = 'per_package';

const emptyForm = {
  target: 'variant',           // 'variant' | 'accessory'
  product_variant_id: '',
  accessory_price_id: '',
  price_mode: MODE_PER_ITEM,
  quantity: '',
  unit_price: '',
  package_size: '',
  package_count: '',
  notes: '',
};

export default function Inventory() {
  const [tab, setTab] = useState('imports'); // 'imports' | 'stock'
  const [imports, setImports] = useState([]);
  const [importsMeta, setImportsMeta] = useState({});
  const [importsPage, setImportsPage] = useState(1);
  const [stock, setStock] = useState({ variants: [], accessories: [] });
  const [loading, setLoading] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  // Used for the variant / accessory pickers in the import form.
  const [products, setProducts] = useState([]);

  const fetchImports = (page = importsPage) => {
    setLoading(true);
    api.get('/inventory/imports', { params: { page, per_page: 20 } })
      .then(res => { setImports(res.data.data || []); setImportsMeta(res.data); })
      .finally(() => setLoading(false));
  };

  const fetchStock = () => {
    setLoading(true);
    api.get('/inventory/stock')
      .then(res => setStock(res.data))
      .finally(() => setLoading(false));
  };

  const fetchProducts = () => {
    api.get('/products', { params: { per_page: 200 } })
      .then(res => setProducts(res.data.data || []));
  };

  useEffect(() => {
    fetchProducts();
    fetchImports(1);
  }, []);

  useEffect(() => {
    if (tab === 'imports') fetchImports(importsPage);
    if (tab === 'stock') fetchStock();
  }, [tab, importsPage]);

  // Flatten product → variant options once for the variant picker.
  const variantOptions = useMemo(() => {
    const out = [];
    for (const p of products) {
      for (const v of p.variants || []) {
        const label = [v.color, v.size, v.paper_type].filter(Boolean).join(' / ');
        out.push({
          id: v.id,
          sku: v.sku,
          stock: v.stock ?? 0,
          display: `${p.name} — ${label || v.sku || `#${v.id}`}${v.sku ? ` [${v.sku}]` : ''}`,
        });
      }
    }
    return out;
  }, [products]);

  const accessoryOptions = useMemo(() => {
    const out = [];
    for (const p of products) {
      for (const a of p.accessories || []) {
        for (const price of a.prices || []) {
          const tier = price.tier?.name || `tier ${price.tier_id}`;
          const style = price.style ? ` (${price.style})` : '';
          out.push({
            id: price.id,
            display: `${p.name} — ${a.name} • ${tier}${style}${price.accessory_code ? ` [${price.accessory_code}]` : ''}`,
            stock: price.stock ?? 0,
          });
        }
      }
    }
    return out;
  }, [products]);

  // Computed totals for the form preview.
  const formPreview = useMemo(() => {
    const qty = form.price_mode === MODE_PER_PACKAGE
      ? (parseInt(form.package_size || 0, 10) * parseInt(form.package_count || 0, 10)) || 0
      : parseInt(form.quantity || 0, 10) || 0;
    const total = form.price_mode === MODE_PER_PACKAGE
      ? (parseFloat(form.unit_price || 0) * parseInt(form.package_count || 0, 10)) || 0
      : (parseFloat(form.unit_price || 0) * qty) || 0;
    return { qty, total };
  }, [form]);

  const resetForm = () => { setForm(emptyForm); setShowForm(false); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        price_mode: form.price_mode,
        unit_price: parseFloat(form.unit_price) || 0,
        notes: form.notes || null,
      };
      if (form.target === 'variant') {
        if (!form.product_variant_id) throw new Error('Please choose a product variant');
        payload.product_variant_id = parseInt(form.product_variant_id, 10);
      } else {
        if (!form.accessory_price_id) throw new Error('Please choose an accessory');
        payload.accessory_price_id = parseInt(form.accessory_price_id, 10);
      }
      if (form.price_mode === MODE_PER_PACKAGE) {
        payload.package_size = parseInt(form.package_size, 10);
        payload.package_count = parseInt(form.package_count, 10);
      } else {
        payload.quantity = parseInt(form.quantity, 10);
      }

      await api.post('/inventory/imports', payload);
      await notify('Stock import recorded', { title: 'Inventory', kind: 'success' });
      resetForm();
      fetchImports(1);
      setImportsPage(1);
      fetchProducts(); // refresh stock numbers in the dropdown
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to save import';
      notify(msg, { title: 'Inventory error', kind: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (imp) => {
    const ok = await askConfirm(`Delete import #${imp.id}? Stock will be reversed (-${imp.quantity}).`, { title: 'Delete import' });
    if (!ok) return;
    try {
      await api.delete(`/inventory/imports/${imp.id}`);
      fetchImports();
      fetchProducts();
    } catch (err) {
      notify(err.response?.data?.message || 'Delete failed', { title: 'Inventory', kind: 'error' });
    }
  };

  const importTargetLabel = (imp) => {
    if (imp.product_variant) {
      const v = imp.product_variant;
      const label = [v.color, v.size, v.paper_type].filter(Boolean).join(' / ');
      return `${v.product?.name ?? ''} — ${label || v.sku || `Variant #${v.id}`}`;
    }
    if (imp.accessory_price) {
      const ap = imp.accessory_price;
      return `${ap.accessory?.product?.name ?? ''} — ${ap.accessory?.name ?? ''} • ${ap.tier?.name ?? ''}${ap.style ? ` (${ap.style})` : ''}`;
    }
    return '—';
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-neutral-800">Inventory</h2>
        <button
          onClick={() => { showForm ? resetForm() : setShowForm(true); }}
          className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg"
        >
          {showForm ? 'Cancel' : 'New Import'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 border-b border-neutral-200">
        {['imports', 'stock'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-orange-500 text-orange-600 font-medium' : 'border-transparent text-neutral-500 hover:text-neutral-800'
            }`}
          >
            {t === 'imports' ? 'Import history' : 'Current stock'}
          </button>
        ))}
      </div>

      {/* New import form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mb-4 bg-white rounded-xl border border-neutral-200 p-4 shadow-sm space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-neutral-500">Target</label>
              <select
                value={form.target}
                onChange={e => setForm({ ...form, target: e.target.value, product_variant_id: '', accessory_price_id: '' })}
                className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm"
              >
                <option value="variant">Product variant</option>
                <option value="accessory">Accessory</option>
              </select>
            </div>

            {form.target === 'variant' ? (
              <div className="md:col-span-2">
                <label className="text-xs text-neutral-500">Product variant</label>
                <select
                  value={form.product_variant_id}
                  onChange={e => setForm({ ...form, product_variant_id: e.target.value })}
                  required
                  className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm"
                >
                  <option value="">— pick a variant —</option>
                  {variantOptions.map(v => (
                    <option key={v.id} value={v.id}>{v.display} (stock {v.stock})</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="md:col-span-2">
                <label className="text-xs text-neutral-500">Accessory (tier-specific row)</label>
                <select
                  value={form.accessory_price_id}
                  onChange={e => setForm({ ...form, accessory_price_id: e.target.value })}
                  required
                  className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm"
                >
                  <option value="">— pick an accessory —</option>
                  {accessoryOptions.map(a => (
                    <option key={a.id} value={a.id}>{a.display} (stock {a.stock})</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-neutral-500">Price mode</label>
              <select
                value={form.price_mode}
                onChange={e => setForm({ ...form, price_mode: e.target.value })}
                className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm"
              >
                <option value={MODE_PER_ITEM}>Per item</option>
                <option value={MODE_PER_PACKAGE}>Per package</option>
              </select>
            </div>

            {form.price_mode === MODE_PER_ITEM ? (
              <>
                <div>
                  <label className="text-xs text-neutral-500">Quantity</label>
                  <input
                    type="number" min="1" required
                    value={form.quantity}
                    onChange={e => setForm({ ...form, quantity: e.target.value })}
                    className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-500">Unit price</label>
                  <input
                    type="number" step="0.01" min="0" required
                    value={form.unit_price}
                    onChange={e => setForm({ ...form, unit_price: e.target.value })}
                    className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm"
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="text-xs text-neutral-500">Package size (units/pkg)</label>
                  <input
                    type="number" min="1" required
                    value={form.package_size}
                    onChange={e => setForm({ ...form, package_size: e.target.value })}
                    className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-500">Package count</label>
                  <input
                    type="number" min="1" required
                    value={form.package_count}
                    onChange={e => setForm({ ...form, package_count: e.target.value })}
                    className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-500">Price per package</label>
                  <input
                    type="number" step="0.01" min="0" required
                    value={form.unit_price}
                    onChange={e => setForm({ ...form, unit_price: e.target.value })}
                    className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm"
                  />
                </div>
              </>
            )}
          </div>

          <div>
            <label className="text-xs text-neutral-500">Notes</label>
            <input
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              placeholder="Supplier, invoice #, batch…"
              maxLength={500}
              className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm"
            />
          </div>

          <div className="flex justify-between items-center pt-2 border-t border-neutral-100">
            <div className="text-xs text-neutral-500">
              Will add <span className="font-semibold text-neutral-800">{formPreview.qty}</span> unit(s)
              {' '}for a total cost of <span className="font-semibold text-neutral-800">${formPreview.total.toFixed(2)}</span>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm rounded-lg"
            >
              {submitting ? 'Saving…' : 'Save import'}
            </button>
          </div>
        </form>
      )}

      {/* Tab content */}
      {tab === 'imports' && (
        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#faf8f6] text-neutral-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2">When</th>
                <th className="text-left px-3 py-2">Target</th>
                <th className="text-right px-3 py-2">Qty</th>
                <th className="text-left px-3 py-2">Price</th>
                <th className="text-right px-3 py-2">Total cost</th>
                <th className="text-left px-3 py-2">Notes</th>
                <th className="text-left px-3 py-2">By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-neutral-400">Loading…</td></tr>
              ) : imports.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-neutral-400">No imports yet</td></tr>
              ) : imports.map(imp => (
                <tr key={imp.id} className="border-t border-neutral-100">
                  <td className="px-3 py-2 text-neutral-600 whitespace-nowrap">{(imp.imported_at || '').replace('T', ' ').slice(0, 16)}</td>
                  <td className="px-3 py-2 text-neutral-800">{importTargetLabel(imp)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{imp.quantity}</td>
                  <td className="px-3 py-2 text-neutral-600">
                    {imp.price_mode === MODE_PER_PACKAGE
                      ? `${imp.package_count} pkg × ${imp.package_size}u @ $${Number(imp.unit_price).toFixed(2)}/pkg`
                      : `$${Number(imp.unit_price).toFixed(2)} / unit`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">${Number(imp.total_cost).toFixed(2)}</td>
                  <td className="px-3 py-2 text-neutral-500">{imp.notes || ''}</td>
                  <td className="px-3 py-2 text-neutral-500">{imp.importer?.name || ''}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => handleDelete(imp)} className="text-xs text-red-500 hover:text-red-600">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {importsMeta.last_page > 1 && (
            <div className="flex justify-between items-center px-3 py-2 text-xs text-neutral-500 border-t border-neutral-100">
              <span>Page {importsMeta.current_page} of {importsMeta.last_page} • {importsMeta.total} import(s)</span>
              <div className="flex gap-1">
                <button
                  disabled={importsPage <= 1}
                  onClick={() => setImportsPage(p => Math.max(1, p - 1))}
                  className="px-2 py-1 border border-neutral-200 rounded disabled:opacity-40"
                >Prev</button>
                <button
                  disabled={importsPage >= importsMeta.last_page}
                  onClick={() => setImportsPage(p => p + 1)}
                  className="px-2 py-1 border border-neutral-200 rounded disabled:opacity-40"
                >Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'stock' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <StockTable title="Product variants" rows={stock.variants} />
          <StockTable title="Accessories" rows={stock.accessories} />
        </div>
      )}
    </div>
  );
}

function StockTable({ title, rows }) {
  return (
    <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
      <div className="px-3 py-2 text-sm font-medium text-neutral-800 border-b border-neutral-100 bg-[#faf8f6]">{title}</div>
      <div className="max-h-[60vh] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-neutral-500 bg-white sticky top-0">
            <tr>
              <th className="text-left px-3 py-2">Product</th>
              <th className="text-left px-3 py-2">Item</th>
              <th className="text-left px-3 py-2">SKU/Code</th>
              <th className="text-right px-3 py-2">Stock</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-4 text-center text-neutral-400">No items</td></tr>
            ) : rows.map(r => (
              <tr key={`${r.kind}-${r.id}`} className="border-t border-neutral-100">
                <td className="px-3 py-1.5 text-neutral-600">{r.product_name || ''}</td>
                <td className="px-3 py-1.5 text-neutral-800">{r.label}</td>
                <td className="px-3 py-1.5 text-neutral-500 font-mono">{r.sku || ''}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${r.stock < 0 ? 'text-red-600' : r.stock === 0 ? 'text-neutral-400' : 'text-neutral-800'}`}>{r.stock}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
