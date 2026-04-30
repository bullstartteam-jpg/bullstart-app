import { useState, useEffect } from 'react';
import api from '../services/api';

export default function Tiers() {
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formName, setFormName] = useState('');

  const fetchTiers = () => {
    setLoading(true);
    api.get('/settings/tiers').then(res => setTiers(res.data)).finally(() => setLoading(false));
  };

  useEffect(() => { fetchTiers(); }, []);

  const resetForm = () => {
    setFormName('');
    setEditingId(null);
    setShowForm(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingId) {
        await api.put(`/settings/tiers/${editingId}`, { name: formName });
      } else {
        await api.post('/settings/tiers', { name: formName });
      }
      resetForm();
      fetchTiers();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  const handleEdit = (tier) => {
    setFormName(tier.name || '');
    setEditingId(tier.id);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this tier?')) return;
    try {
      await api.delete(`/settings/tiers/${id}`);
      fetchTiers();
    } catch (err) {
      alert(err.response?.data?.message || 'Cannot delete tier');
    }
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-neutral-800">Tiers</h2>
        <button onClick={() => { showForm ? resetForm() : setShowForm(true); }} className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg">
          {showForm ? 'Cancel' : 'New Tier'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-4 bg-white rounded-xl border border-neutral-200 p-4 flex gap-3 items-end shadow-sm">
          <div className="flex-1">
            <label className="text-xs text-neutral-500">{editingId ? `Edit Tier #${editingId}` : 'Tier Name'}</label>
            <input
              value={formName}
              onChange={e => setFormName(e.target.value)}
              required
              autoFocus
              placeholder="e.g. Tier 1, Gold, VIP..."
              className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm focus:outline-none focus:border-orange-400"
            />
          </div>
          <button type="submit" className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg">
            {editingId ? 'Update' : 'Create'}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-neutral-400">Loading...</p>
      ) : (
        <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-neutral-500 text-xs bg-[#faf8f6]">
                <th className="p-3 text-left">ID</th>
                <th className="p-3 text-left">Name</th>
                <th className="p-3 text-right">Users</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tiers.length === 0 ? (
                <tr><td colSpan="4" className="p-3 text-center text-neutral-400">No tiers found</td></tr>
              ) : tiers.map(tier => (
                <tr key={tier.id} className="border-b border-neutral-100 hover:bg-orange-50/50 transition-colors">
                  <td className="p-3 text-neutral-500">{tier.id}</td>
                  <td className="p-3 text-neutral-800 font-medium">{tier.name}</td>
                  <td className="p-3 text-right text-neutral-600">{tier.users_count ?? 0}</td>
                  <td className="p-3 text-right">
                    <div className="flex gap-3 justify-end">
                      <button onClick={() => handleEdit(tier)} className="text-xs text-orange-500 hover:text-orange-600">Edit</button>
                      <button onClick={() => handleDelete(tier.id)} className="text-xs text-red-500 hover:text-red-600">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
