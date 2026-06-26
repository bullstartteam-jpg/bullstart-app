import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

export default function Products() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', style: '', line_id: '' });
  const [dup, setDup] = useState(null);        // product pending duplicate (drives the modal)
  const [dupName, setDupName] = useState('');
  const [dupBusy, setDupBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(null); // id of product whose status is toggling
  const { hasRole } = useAuth();
  const navigate = useNavigate();

  const fetchProducts = (searchTerm) => {
    setLoading(true);
    const params = { per_page: 50 };
    if (searchTerm) params.search = searchTerm;
    api.get('/products', { params }).then(res => setProducts(res.data.data || [])).finally(() => setLoading(false));
  };

  useEffect(() => { fetchProducts(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    await api.post('/products', form);
    setForm({ name: '', style: '', line_id: '' });
    setShowCreate(false);
    fetchProducts();
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this product?')) return;
    await api.delete(`/products/${id}`);
    fetchProducts();
  };

  // Quick Active/Inactive toggle straight from the list (admin only). Sends just
  // the status field (PUT /products/{id} updates only the keys present) and
  // patches local state so the badge flips without a full refetch.
  const toggleStatus = async (product, e) => {
    e.stopPropagation();
    if (statusBusy) return;
    const next = product.status ? 0 : 1;
    setStatusBusy(product.id);
    try {
      await api.put(`/products/${product.id}`, { status: next });
      setProducts(prev => prev.map(p => (p.id === product.id ? { ...p, status: next } : p)));
    } catch (err) {
      alert(err?.response?.data?.message || 'Đổi trạng thái thất bại');
    } finally {
      setStatusBusy(null);
    }
  };

  // Deep-copy a product (variants + prices + accessories + materials) into a new
  // one under a different name, then jump to it. Stock/line_id start fresh.
  // Electron's renderer has no window.prompt(), so the new name is collected
  // via an inline modal instead.
  const openDuplicate = (product, e) => {
    e.stopPropagation();
    setDup(product);
    setDupName(`${product.name} (Copy)`);
  };

  const submitDuplicate = async (e) => {
    e.preventDefault();
    if (!dupName.trim() || dupBusy) return;
    setDupBusy(true);
    try {
      const res = await api.post(`/products/${dup.id}/duplicate`, { name: dupName.trim() });
      setDup(null);
      navigate(`/products/${res.data.product.id}`);
    } catch (err) {
      alert(err?.response?.data?.message || 'Nhân bản thất bại');
    } finally {
      setDupBusy(false);
    }
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-neutral-800">Products</h2>
        {hasRole('admin') && (
          <button onClick={() => setShowCreate(!showCreate)} className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg">
            {showCreate ? 'Cancel' : 'New Product'}
          </button>
        )}
      </div>

      {/* Search */}
      <div className="mb-4">
        <form onSubmit={e => { e.preventDefault(); fetchProducts(search); }} className="flex gap-2">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products..." className="px-3 py-1.5 bg-white border border-neutral-200 rounded-lg text-neutral-800 text-sm w-64 focus:outline-none focus:border-orange-400" />
          <button type="submit" className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Search</button>
        </form>
      </div>

      {/* Create form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="mb-4 bg-white rounded-xl border border-neutral-200 p-4 flex gap-3 items-end shadow-sm">
          <div>
            <label className="text-xs text-neutral-500">Name</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
          </div>
          <div>
            <label className="text-xs text-neutral-500">Style</label>
            <input value={form.style} onChange={e => setForm({ ...form, style: e.target.value })} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
          </div>
          <div>
            <label className="text-xs text-neutral-500">Line ID <span className="text-neutral-400">(prefix for system_id)</span></label>
            <input value={form.line_id} onChange={e => setForm({ ...form, line_id: e.target.value })} placeholder="e.g. GC" maxLength={16} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm font-mono" />
          </div>
          <button type="submit" className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg">Create</button>
        </form>
      )}

      {/* Products list */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <p className="text-neutral-400 col-span-3">Loading...</p>
        ) : products.length === 0 ? (
          <p className="text-neutral-400 col-span-3">No products found</p>
        ) : products.map(product => (
          <div key={product.id} onClick={() => navigate(`/products/${product.id}`)} className="bg-white rounded-xl border border-neutral-200 p-4 hover:border-orange-300 hover:shadow-md cursor-pointer transition-all shadow-sm">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-neutral-800 font-medium">{product.name}</h3>
                {product.style && <p className="text-neutral-500 text-xs mt-1">Style: {product.style}</p>}
                <p className="text-neutral-400 text-xs mt-1">{product.variants?.length || 0} variants</p>
              </div>
              {hasRole('admin') ? (
                <button
                  onClick={e => toggleStatus(product, e)}
                  disabled={statusBusy === product.id}
                  title="Bấm để đổi trạng thái"
                  className={`px-2 py-0.5 rounded text-xs font-medium transition-colors disabled:opacity-50 ${product.status ? 'bg-green-100 text-green-600 hover:bg-green-200' : 'bg-red-100 text-red-500 hover:bg-red-200'}`}
                >
                  {statusBusy === product.id ? '…' : (product.status ? 'Active' : 'Inactive')}
                </button>
              ) : (
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${product.status ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500'}`}>
                  {product.status ? 'Active' : 'Inactive'}
                </span>
              )}
            </div>
            {hasRole('admin') && (
              <div className="mt-3 flex gap-3">
                <button onClick={e => openDuplicate(product, e)} className="text-xs text-orange-500 hover:text-orange-600">Nhân bản</button>
                <button onClick={e => { e.stopPropagation(); handleDelete(product.id); }} className="text-xs text-red-500 hover:text-red-600">Delete</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Duplicate-product modal (replaces native prompt, unsupported in Electron) */}
      {dup && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => !dupBusy && setDup(null)}>
          <form onSubmit={submitDuplicate} onClick={e => e.stopPropagation()} className="bg-white rounded-xl p-5 w-[440px] max-w-[92vw] shadow-xl">
            <h3 className="text-lg font-bold text-neutral-800 mb-1">Nhân bản sản phẩm</h3>
            <p className="text-xs text-neutral-500 mb-3">
              Copy toàn bộ variants, giá, add-ons, materials từ <span className="font-medium">{dup.name}</span>. Stock và Line ID để trống.
            </p>
            <label className="text-xs text-neutral-500">Tên sản phẩm mới</label>
            <input
              autoFocus
              value={dupName}
              onChange={e => setDupName(e.target.value)}
              className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setDup(null)} disabled={dupBusy} className="px-4 py-2 text-sm text-neutral-600 hover:text-neutral-800">Huỷ</button>
              <button type="submit" disabled={dupBusy || !dupName.trim()} className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg">
                {dupBusy ? 'Đang nhân bản…' : 'Nhân bản'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
