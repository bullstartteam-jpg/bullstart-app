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
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${product.status ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500'}`}>
                {product.status ? 'Active' : 'Inactive'}
              </span>
            </div>
            {hasRole('admin') && (
              <button onClick={e => { e.stopPropagation(); handleDelete(product.id); }} className="mt-3 text-xs text-red-500 hover:text-red-600">Delete</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
