import { useState, useEffect } from 'react';
import api from '../services/api';

export default function Users() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roles, setRoles] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role_id: '', tier_id: '' });
  const [editing, setEditing] = useState(null); // user object being edited or null

  useEffect(() => {
    fetchUsers();
    api.get('/settings/roles').then(res => setRoles(res.data));
    api.get('/settings/tiers').then(res => setTiers(res.data));
  }, []);

  const fetchUsers = (searchTerm) => {
    setLoading(true);
    const params = { per_page: 50 };
    if (searchTerm) params.search = searchTerm;
    api.get('/users', { params }).then(res => setUsers(res.data.data || [])).finally(() => setLoading(false));
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await api.post('/users', form);
      setForm({ name: '', email: '', password: '', role_id: '', tier_id: '' });
      setShowCreate(false);
      fetchUsers();
    } catch (err) {
      alert(err.response?.data?.message || JSON.stringify(err.response?.data?.errors) || 'Error');
    }
  };

  const handleToggleStatus = async (user) => {
    await api.put(`/users/${user.id}`, { status: user.status ? 0 : 1 });
    fetchUsers(search);
  };

  const handleToggleConvert = async (user) => {
    await api.put(`/users/${user.id}`, { convert: !user.convert });
    fetchUsers(search);
  };

  const handleToggleAutoPay = async (user) => {
    await api.put(`/users/${user.id}`, { auto_pay: !user.auto_pay });
    fetchUsers(search);
  };

  const handleRegenApiKey = async (userId) => {
    if (!confirm('Regenerate API key?')) return;
    const res = await api.post(`/users/${userId}/regenerate-api-key`);
    alert(`New API key: ${res.data.api_key}`);
  };

  const handleShowApiKey = async (userId) => {
    const res = await api.get(`/users/${userId}/api-key`);
    alert(`API Key: ${res.data.api_key}`);
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-neutral-800">Users</h2>
        <button onClick={() => setShowCreate(!showCreate)} className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg">
          {showCreate ? 'Cancel' : 'New User'}
        </button>
      </div>

      <form onSubmit={e => { e.preventDefault(); fetchUsers(search); }} className="mb-4 flex gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or email..." className="px-3 py-1.5 bg-white border border-neutral-200 rounded-lg text-neutral-800 text-sm w-64 focus:outline-none focus:border-orange-400" />
        <button type="submit" className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Search</button>
      </form>

      {showCreate && (
        <form onSubmit={handleCreate} className="mb-4 bg-white rounded-xl border border-neutral-200 p-4 grid grid-cols-5 gap-3 items-end shadow-sm">
          <div><label className="text-xs text-neutral-500">Name</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" /></div>
          <div><label className="text-xs text-neutral-500">Email</label><input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" /></div>
          <div><label className="text-xs text-neutral-500">Password</label><input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" /></div>
          <div>
            <label className="text-xs text-neutral-500">Role</label>
            <select value={form.role_id} onChange={e => setForm({ ...form, role_id: e.target.value })} required className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm">
              <option value="">Select...</option>
              {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <button type="submit" className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg">Create</button>
        </form>
      )}

      {editing && (
        <EditUserModal
          user={editing}
          roles={roles}
          tiers={tiers}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); fetchUsers(search); }}
        />
      )}

      <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-neutral-500 text-xs bg-[#faf8f6]">
              <th className="p-3 text-left">Name</th>
              <th className="p-3 text-left">Email</th>
              <th className="p-3 text-left">Role</th>
              <th className="p-3 text-left">Tier</th>
              <th className="p-3 text-right">Wallet</th>
              <th className="p-3 text-center">Status</th>
              <th className="p-3 text-center">Convert</th>
              <th className="p-3 text-center">Auto-pay</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="9" className="p-6 text-center text-neutral-400">Loading...</td></tr>
            ) : users.map(user => (
              <tr key={user.id} className="border-b border-neutral-100 hover:bg-orange-50/50 transition-colors">
                <td className="p-3 text-neutral-800 font-medium">{user.name}</td>
                <td className="p-3 text-neutral-600 text-xs">{user.email}</td>
                <td className="p-3"><span className="px-2 py-0.5 bg-neutral-100 rounded text-xs text-neutral-600">{user.role?.name || '-'}</span></td>
                <td className="p-3 text-neutral-600 text-xs">{user.tier?.name || '-'}</td>
                <td className="p-3 text-right text-neutral-800 font-medium">${user.wallet}</td>
                <td className="p-3 text-center">
                  <button onClick={() => handleToggleStatus(user)} className={`px-2 py-0.5 rounded text-xs font-medium ${user.status ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500'}`}>
                    {user.status ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td className="p-3 text-center">
                  <button onClick={() => handleToggleConvert(user)} className={`px-2 py-0.5 rounded text-xs font-medium ${user.convert ? 'bg-blue-100 text-blue-600' : 'bg-neutral-100 text-neutral-500'}`}>
                    {user.convert ? 'On' : 'Off'}
                  </button>
                </td>
                <td className="p-3 text-center">
                  <button onClick={() => handleToggleAutoPay(user)} className={`px-2 py-0.5 rounded text-xs font-medium ${user.auto_pay ? 'bg-green-100 text-green-600' : 'bg-neutral-100 text-neutral-500'}`}>
                    {user.auto_pay ? `On${user.auto_pay_delay_hours ? ` · ${user.auto_pay_delay_hours}h` : ''}` : 'Off'}
                  </button>
                </td>
                <td className="p-3 text-right space-x-2">
                  <button onClick={() => setEditing(user)} className="text-xs text-orange-500 hover:text-orange-600">Edit</button>
                  <button onClick={() => handleShowApiKey(user.id)} className="text-xs text-neutral-500 hover:text-neutral-700">API Key</button>
                  <button onClick={() => handleRegenApiKey(user.id)} className="text-xs text-yellow-600 hover:text-yellow-700">Regen Key</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EditUserModal({ user, roles, tiers, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: user.name || '',
    email: user.email || '',
    password: '',
    role_id: user.role_id || '',
    tier_id: user.tier_id || '',
    status: user.status ?? 1,
    convert: user.convert ?? false,
    wallet: user.wallet ?? 0,
    auto_pay: user.auto_pay ?? false,
    auto_pay_delay_hours: user.auto_pay_delay_hours ?? 0,
    resend_free_quota: user.resend_free_quota ?? '',
  });
  const [saving, setSaving] = useState(false);
  // Per-seller resend support % override (empty cell = use global config).
  const [resendCfg, setResendCfg] = useState(null);
  const [override, setOverride] = useState(() => user.resend_support_override || {});
  useEffect(() => { api.get('/settings/resend-config').then(r => setResendCfg(r.data)).catch(() => setResendCfg({ reasons: [], fee_components: [] })); }, []);
  const setOv = (rk, comp, v) => setOverride(prev => {
    const next = { ...prev, [rk]: { ...(prev[rk] || {}) } };
    if (v === '') delete next[rk][comp]; else next[rk][comp] = Number(v);
    if (Object.keys(next[rk]).length === 0) delete next[rk];
    return next;
  });

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        email: form.email,
        role_id: parseInt(form.role_id),
        tier_id: form.tier_id ? parseInt(form.tier_id) : null,
        status: parseInt(form.status),
        convert: !!form.convert,
        wallet: form.wallet === '' ? 0 : Number(form.wallet),
        auto_pay: !!form.auto_pay,
        auto_pay_delay_hours: form.auto_pay_delay_hours === '' ? 0 : Number(form.auto_pay_delay_hours),
        resend_free_quota: form.resend_free_quota === '' ? null : Number(form.resend_free_quota),
        resend_support_override: Object.keys(override).length ? override : null,
      };
      if (form.password && form.password.length >= 6) {
        payload.password = form.password;
      }
      await api.put(`/users/${user.id}`, payload);
      onSaved();
    } catch (err) {
      alert(err.response?.data?.message || JSON.stringify(err.response?.data?.errors) || 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6">
      <form onClick={e => e.stopPropagation()} onSubmit={handleSave} className="bg-white rounded-xl shadow-xl w-[90vw] max-w-2xl flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200 flex justify-between items-center">
          <h3 className="text-sm font-semibold text-neutral-800">Edit user · <span className="font-mono">{user.email}</span></h3>
          <button type="button" onClick={onClose} className="text-neutral-500 hover:text-neutral-800 text-xl leading-none">×</button>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-neutral-500">Name</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
          </div>
          <div>
            <label className="text-xs text-neutral-500">Email</label>
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
          </div>
          <div>
            <label className="text-xs text-neutral-500">Password <span className="text-neutral-400">(leave empty to keep current)</span></label>
            <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} minLength={6} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
          </div>
          <div>
            <label className="text-xs text-neutral-500">Wallet</label>
            <input type="text" inputMode="decimal" value={form.wallet} onChange={e => setForm(f => ({ ...f, wallet: e.target.value }))} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
          </div>
          <div>
            <label className="text-xs text-neutral-500">Resend free / tháng (trống = mặc định)</label>
            <input type="number" min={0} max={1000} value={form.resend_free_quota} onChange={e => setForm(f => ({ ...f, resend_free_quota: e.target.value }))} placeholder="mặc định" className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-neutral-500">Override % hỗ trợ resend (trống = dùng config chung)</label>
            <div className="mt-1 border border-neutral-200 rounded-lg p-2 space-y-1.5 bg-[#faf8f6]">
              {!resendCfg ? <div className="text-xs text-neutral-400">Loading…</div> : (resendCfg.reasons || []).map(r => (
                <div key={r.key} className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="w-32 text-neutral-600 truncate" title={r.label}>{r.label}</span>
                  {(resendCfg.fee_components || []).map(fc => (
                    <label key={fc.key} className="flex items-center gap-1 text-neutral-500">
                      {fc.label}
                      <input type="number" min={0} max={100}
                        value={override[r.key]?.[fc.key] ?? ''}
                        placeholder={`${r.support?.[fc.key] ?? 0}`}
                        onChange={e => setOv(r.key, fc.key, e.target.value)}
                        className="w-14 px-1.5 py-1 bg-white border border-neutral-200 rounded text-right" />%
                    </label>
                  ))}
                </div>
              ))}
              {resendCfg && (resendCfg.reasons || []).length === 0 && <div className="text-xs text-neutral-400">Chưa có reason nào.</div>}
            </div>
          </div>
          <div>
            <label className="text-xs text-neutral-500">Role</label>
            <select value={form.role_id} onChange={e => setForm(f => ({ ...f, role_id: e.target.value }))} required className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm">
              <option value="">Select…</option>
              {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-neutral-500">Tier</label>
            <select value={form.tier_id} onChange={e => setForm(f => ({ ...f, tier_id: e.target.value }))} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm">
              <option value="">— None —</option>
              {tiers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-neutral-500">Status</label>
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm">
              <option value={1}>Active</option>
              <option value={0}>Inactive</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-neutral-500">Convert mode</label>
            <select value={form.convert ? '1' : '0'} onChange={e => setForm(f => ({ ...f, convert: e.target.value === '1' }))} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm">
              <option value="0">Off</option>
              <option value="1">On</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-neutral-500">Auto-pay</label>
            <select value={form.auto_pay ? '1' : '0'} onChange={e => setForm(f => ({ ...f, auto_pay: e.target.value === '1' }))} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm">
              <option value="0">Off</option>
              <option value="1">On</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-neutral-500">Auto-pay delay (giờ) <span className="text-neutral-400">0 = ngay</span></label>
            <input type="number" min={0} max={72} disabled={!form.auto_pay} value={form.auto_pay_delay_hours}
              onChange={e => setForm(f => ({ ...f, auto_pay_delay_hours: e.target.value }))}
              className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm disabled:opacity-50" />
          </div>
        </div>
        <div className="px-4 py-3 border-t border-neutral-200 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
