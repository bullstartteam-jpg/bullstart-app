import { useState, useEffect, useMemo } from 'react';
import api from '../services/api';
import { notify, askConfirm } from '../components/Dialog';

const MODE_PER_ITEM = 'per_item';
const MODE_PER_PACKAGE = 'per_package';

const emptyForm = {
  target: 'variant',           // 'variant' | 'accessory' | 'supply'
  product_variant_id: '',
  accessory_id: '',            // unified per-accessory stock (no longer tier-scoped)
  supply_id: '',               // consumables (label paper, etc.) — 1 ship = 1 trừ default label
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
  const [stock, setStock] = useState({ variants: [], accessories: [], supplies: [] });
  const [loading, setLoading] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [csvFile, setCsvFile] = useState(null);
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvResult, setCsvResult] = useState(null);
  const [showCsv, setShowCsv] = useState(false);

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

  // Stock is per-code (grouped by accessory_code across tiers). For each
  // accessory we deduplicate the price rows by `accessory_code` and pick the
  // canonical (lowest id) row — that's where the shared stock lives.
  const accessoryOptions = useMemo(() => {
    const out = [];
    for (const p of products) {
      for (const a of p.accessories || []) {
        const seen = new Map(); // code → canonical price row
        for (const pr of (a.prices || [])) {
          const code = pr.accessory_code || `#${pr.id}`;
          if (!seen.has(code) || seen.get(code).id > pr.id) {
            seen.set(code, pr);
          }
        }
        for (const pr of seen.values()) {
          out.push({
            id: pr.id,
            display: `${p.name} — ${a.name}${pr.accessory_code ? ` [${pr.accessory_code}]` : ''}`,
            stock: Math.max(0, pr.stock ?? 0),
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
      } else if (form.target === 'accessory') {
        if (!form.accessory_id) throw new Error('Please choose an accessory');
        // form.accessory_id now holds accessory_price.id (per-code target).
        payload.accessory_price_id = parseInt(form.accessory_id, 10);
      } else {
        if (!form.supply_id) throw new Error('Please choose a supply');
        payload.supply_id = parseInt(form.supply_id, 10);
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

  const handleDownloadTemplate = async () => {
    try {
      const res = await api.get('/inventory/imports/template', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `inventory_import_template_${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      notify(err.response?.data?.message || 'Download failed', { title: 'Template', kind: 'error' });
    }
  };

  const handleCsvUpload = async (e) => {
    e.preventDefault();
    if (!csvFile) return;
    setCsvUploading(true);
    setCsvResult(null);
    try {
      const fd = new FormData();
      fd.append('file', csvFile);
      const res = await api.post('/inventory/imports/bulk', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setCsvResult(res.data);
      fetchImports(1);
      setImportsPage(1);
      fetchProducts();
    } catch (err) {
      const d = err.response?.data;
      setCsvResult({
        message: d?.message || 'Upload failed',
        error_count: d?.errors?.length || 0,
        errors: d?.errors || [],
        created: 0,
      });
    } finally {
      setCsvUploading(false);
    }
  };

  const handleResync = async () => {
    const ok = await askConfirm(
      'Tính lại stock từ lịch sử?\n\n' +
      'Mỗi variant + accessory: stock = Σ imports − Σ shipped (order item qty).\n' +
      'Mọi đơn đã shipped sẽ được đánh dấu "đã trừ" để tương lai không trừ lặp.\n\n' +
      'An toàn để chạy nhiều lần.',
      { title: 'Resync stock', okText: 'Tính lại' }
    );
    if (!ok) return;
    setResyncing(true);
    try {
      const res = await api.post('/inventory/resync');
      await notify(
        `Đã resync: ${res.data.variants_updated} variant, ${res.data.accessories_updated} accessory, ${res.data.orders_marked} đơn đánh dấu.`,
        { title: 'Resync stock', kind: 'success' }
      );
      fetchStock();
      fetchProducts();
    } catch (err) {
      notify(err.response?.data?.message || 'Resync failed', { title: 'Resync stock', kind: 'error' });
    } finally {
      setResyncing(false);
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
    // New unified accessory target
    if (imp.accessory) {
      const a = imp.accessory;
      return `${a.product?.name ?? ''} — ${a.name}`;
    }
    // Legacy row pre-unification — still shows tier for transparency
    if (imp.accessory_price) {
      const ap = imp.accessory_price;
      return `${ap.accessory?.product?.name ?? ''} — ${ap.accessory?.name ?? ''} • ${ap.tier?.name ?? ''}${ap.style ? ` (${ap.style})` : ''} (legacy)`;
    }
    return '—';
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-neutral-800">Inventory</h2>
        <div className="flex gap-2">
          <button
            onClick={handleDownloadTemplate}
            title="Tải file CSV mẫu (có sẵn list variants + accessories)"
            className="px-3 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg"
          >
            ⬇ Template
          </button>
          <button
            onClick={() => { setShowCsv(v => !v); setCsvResult(null); setCsvFile(null); }}
            className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-sm rounded-lg border border-emerald-200"
          >
            {showCsv ? 'Cancel CSV' : '⤴ Import CSV'}
          </button>
          <button
            onClick={handleResync}
            disabled={resyncing}
            title="Tính lại stock từ Σ imports - Σ shipped và đánh dấu đơn cũ"
            className="px-3 py-2 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 text-blue-700 text-sm rounded-lg border border-blue-200"
          >
            {resyncing ? 'Resyncing…' : '↻ Resync stock'}
          </button>
          <button
            onClick={() => { showForm ? resetForm() : setShowForm(true); }}
            className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg"
          >
            {showForm ? 'Cancel' : 'New Import'}
          </button>
        </div>
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

      {/* CSV bulk import panel */}
      {showCsv && (
        <form onSubmit={handleCsvUpload} className="mb-4 bg-white rounded-xl border border-emerald-200 p-4 shadow-sm space-y-3">
          <div className="text-sm text-neutral-700">
            <div className="font-semibold text-emerald-700 mb-1">Import CSV — nhập kho hàng loạt</div>
            <ol className="text-xs text-neutral-600 space-y-0.5 list-decimal list-inside">
              <li>Bấm <b>⬇ Template</b> phía trên để tải file CSV mẫu (đã có sẵn list mọi variant + accessory).</li>
              <li>Mở file trong Excel/Sheets, điền các cột: <code className="bg-neutral-100 px-1 rounded">price_mode</code> (per_item / per_package), <code className="bg-neutral-100 px-1 rounded">quantity</code> hoặc <code className="bg-neutral-100 px-1 rounded">package_size + package_count</code>, <code className="bg-neutral-100 px-1 rounded">unit_price</code>, <code className="bg-neutral-100 px-1 rounded">notes</code>.</li>
              <li>Dòng nào <b>để trống <code>price_mode</code></b> sẽ bị bỏ qua — không bắt buộc điền hết file.</li>
              <li>Save as CSV (UTF-8) rồi upload bên dưới.</li>
            </ol>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={e => setCsvFile(e.target.files[0])}
              className="text-sm text-neutral-700 file:mr-3 file:px-3 file:py-1.5 file:bg-neutral-100 file:border-0 file:rounded file:text-neutral-700 file:cursor-pointer"
            />
            <button
              type="submit"
              disabled={!csvFile || csvUploading}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm rounded-lg"
            >
              {csvUploading ? 'Uploading…' : 'Upload + Import'}
            </button>
          </div>

          {csvResult && (
            <div className={`text-xs p-3 rounded ${csvResult.error_count > 0 ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>
              <div className="font-semibold mb-1">{csvResult.message}</div>
              <div>Tạo: {csvResult.created || 0} · Bỏ qua: {csvResult.skipped || 0} · Lỗi: {csvResult.error_count || 0}</div>
              {csvResult.errors?.length > 0 && (
                <ul className="mt-2 space-y-0.5 max-h-40 overflow-y-auto">
                  {csvResult.errors.slice(0, 50).map((e, i) => <li key={i} className="text-red-600">• {e}</li>)}
                  {csvResult.errors.length > 50 && <li className="text-neutral-500">… +{csvResult.errors.length - 50} more</li>}
                </ul>
              )}
            </div>
          )}
        </form>
      )}

      {/* New import form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mb-4 bg-white rounded-xl border border-neutral-200 p-4 shadow-sm space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-neutral-500">Target</label>
              <select
                value={form.target}
                onChange={e => setForm({ ...form, target: e.target.value, product_variant_id: '', accessory_id: '', supply_id: '' })}
                className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm"
              >
                <option value="variant">Product variant</option>
                <option value="accessory">Accessory</option>
                <option value="supply">Supply (label paper, etc.)</option>
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
            ) : form.target === 'accessory' ? (
              <div className="md:col-span-2">
                <label className="text-xs text-neutral-500">Accessory (stock dùng chung mọi tier)</label>
                <select
                  value={form.accessory_id}
                  onChange={e => setForm({ ...form, accessory_id: e.target.value })}
                  required
                  className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm"
                >
                  <option value="">— pick an accessory —</option>
                  {accessoryOptions.map(a => (
                    <option key={a.id} value={a.id}>{a.display} (stock {a.stock})</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="md:col-span-2">
                <label className="text-xs text-neutral-500">Supply (vật tư tiêu hao)</label>
                <select
                  value={form.supply_id}
                  onChange={e => setForm({ ...form, supply_id: e.target.value })}
                  required
                  className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm"
                >
                  <option value="">— pick a supply —</option>
                  {(stock.supplies || []).map(s => (
                    <option key={s.id} value={s.id}>{s.label} (stock {s.stock})</option>
                  ))}
                </select>
                <p className="text-[10px] text-neutral-400 mt-1">
                  Default label supply tự trừ 1 mỗi khi đơn ship.
                </p>
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
                  <label className="text-xs text-neutral-500">Số sản phẩm / package</label>
                  <input
                    type="number" min="1" required
                    value={form.package_size}
                    onChange={e => setForm({ ...form, package_size: e.target.value })}
                    placeholder="vd 50"
                    className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm"
                  />
                  <p className="text-[10px] text-neutral-400 mt-0.5">1 package có bao nhiêu cái</p>
                </div>
                <div>
                  <label className="text-xs text-neutral-500">Số package</label>
                  <input
                    type="number" min="1" required
                    value={form.package_count}
                    onChange={e => setForm({ ...form, package_count: e.target.value })}
                    placeholder="vd 10"
                    className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm"
                  />
                  <p className="text-[10px] text-neutral-400 mt-0.5">Nhập bao nhiêu package</p>
                </div>
                <div>
                  <label className="text-xs text-neutral-500">Giá / package</label>
                  <input
                    type="number" step="0.01" min="0" required
                    value={form.unit_price}
                    onChange={e => setForm({ ...form, unit_price: e.target.value })}
                    className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm"
                  />
                  <p className="text-[10px] text-neutral-400 mt-0.5">Giá cho 1 package</p>
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
              {form.price_mode === MODE_PER_PACKAGE && form.package_size && form.package_count ? (
                <>
                  <span className="font-mono">{form.package_count} package × {form.package_size} sp = </span>
                  <span className="font-semibold text-neutral-800">{formPreview.qty}</span> sp,
                  {' '}tổng tiền <span className="font-semibold text-neutral-800">${formPreview.total.toFixed(2)}</span>
                </>
              ) : (
                <>
                  Sẽ cộng <span className="font-semibold text-neutral-800">{formPreview.qty}</span> sp vào kho,
                  {' '}tổng tiền <span className="font-semibold text-neutral-800">${formPreview.total.toFixed(2)}</span>
                </>
              )}
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
        <div className="space-y-4">
          {stock.supplies?.length > 0 && (
            <StockTable title="Supplies (vật tư tiêu hao)" rows={stock.supplies} />
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <StockTable title="Product variants" rows={stock.variants} />
            <StockTable title="Accessories" rows={stock.accessories} />
          </div>
        </div>
      )}
    </div>
  );
}

function StockTable({ title, rows }) {
  // Backend now returns one row per accessory_price (per-code stock), so
  // we don't need to expand here anymore — render rows as-is.
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
                <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${r.stock === 0 ? 'text-neutral-400' : 'text-neutral-800'}`}>{r.stock}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
