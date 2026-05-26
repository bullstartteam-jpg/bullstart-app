import { useState, useEffect } from 'react';
import api from '../services/api';
import UploadButton from '../components/UploadButton';
import { notify } from '../components/Dialog';

export default function Settings() {
  const [tab, setTab] = useState('roles');
  const [roles, setRoles] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/settings/roles'),
      api.get('/settings/tiers'),
      api.get('/settings/modules'),
    ]).then(([rolesRes, tiersRes, modulesRes]) => {
      setRoles(rolesRes.data);
      setTiers(tiersRes.data);
      setModules(modulesRes.data.modules);
    }).finally(() => setLoading(false));
  }, []);

  const tabs = [
    { id: 'roles', label: 'Roles & Permissions' },
    { id: 'tiers', label: 'Tiers' },
    { id: 'invoice', label: 'Invoice Payment' },
  ];

  if (loading) return <div className="p-6 text-neutral-400">Loading...</div>;

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold text-neutral-800 mb-4">Settings</h2>

      <div className="flex gap-2 mb-6">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2 text-sm rounded-lg ${tab === t.id ? 'bg-orange-500 text-white' : 'bg-white border border-neutral-200 text-neutral-600'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'roles' && <RolesTab roles={roles} setRoles={setRoles} modules={modules} />}
      {tab === 'tiers' && <TiersTab tiers={tiers} setTiers={setTiers} />}
      {tab === 'invoice' && <InvoicePaymentTab />}
    </div>
  );
}

function InvoicePaymentTab() {
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/settings/invoice-payment').then((res) => setData(res.data));
  }, []);

  if (!data) return <div className="text-neutral-400 text-sm">Loading…</div>;

  const setField = (group, field, value) =>
    setData(d => ({ ...d, [group]: { ...d[group], [field]: value } }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.put('/settings/invoice-payment', data);
      setData(res.data);
      notify('Saved invoice payment info', { title: 'Settings', kind: 'success' });
    } catch (err) {
      notify(err.response?.data?.message || 'Save failed', { title: 'Settings', kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* PingPong section — international USD transfer info shown on the
          PingPong invoice variant. */}
      <section className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-neutral-700">PingPong (USD transfer)</h3>
          <span className="text-[11px] text-neutral-400">Shown on Invoice PDF — PingPong variant</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Account name"   value={data.pingpong.account_name}   onChange={v => setField('pingpong', 'account_name', v)} />
          <TextField label="Account number" value={data.pingpong.account_number} onChange={v => setField('pingpong', 'account_number', v)} />
          <TextField label="Bank name"      value={data.pingpong.bank_name}      onChange={v => setField('pingpong', 'bank_name', v)} />
          <TextField label="SWIFT/BIC code" value={data.pingpong.swift_code}     onChange={v => setField('pingpong', 'swift_code', v)} />
          <TextField label="Bank address"   value={data.pingpong.bank_address}   onChange={v => setField('pingpong', 'bank_address', v)} full />
          <TextField label="Notes"          value={data.pingpong.notes}          onChange={v => setField('pingpong', 'notes', v)} full />
        </div>
      </section>

      {/* VNPay section — QR image + supplementary bank info shown on the
          VNPay invoice variant. QR comes from B2 (uploaded via the existing
          UploadButton helper). */}
      <section className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-neutral-700">VNPay (VND QR transfer)</h3>
          <span className="text-[11px] text-neutral-400">Shown on Invoice PDF — VNPay variant</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-neutral-500">QR code image URL</label>
              <UploadButton
                folder="invoice/vnpay-qr"
                accept="image/*"
                onUrl={(url) => setField('vnpay', 'qr_url', url)}
                title="Upload VNPay QR to B2"
              />
            </div>
            <input
              value={data.vnpay.qr_url || ''}
              onChange={e => setField('vnpay', 'qr_url', e.target.value)}
              placeholder="https://… (uploaded image or paste a public URL)"
              className="w-full px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm"
            />
            {data.vnpay.qr_url && (
              <img src={data.vnpay.qr_url} alt="VNPay QR preview" className="mt-2 h-32 w-32 object-contain border border-neutral-200 rounded" />
            )}
          </div>
          <TextField label="Account name"   value={data.vnpay.account_name}   onChange={v => setField('vnpay', 'account_name', v)} />
          <TextField label="Account number" value={data.vnpay.account_number} onChange={v => setField('vnpay', 'account_number', v)} />
          <TextField label="Bank name"      value={data.vnpay.bank_name}      onChange={v => setField('vnpay', 'bank_name', v)} full />
          <TextField label="Notes"          value={data.vnpay.notes}          onChange={v => setField('vnpay', 'notes', v)} full />
        </div>
      </section>

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-6 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg font-medium"
      >
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}

function TextField({ label, value, onChange, full }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="text-xs text-neutral-500">{label}</label>
      <input
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm"
      />
    </div>
  );
}

function RolesTab({ roles, setRoles, modules }) {
  const [newRole, setNewRole] = useState({ name: '', slug: '' });
  const [showNew, setShowNew] = useState(false);

  const refreshRoles = () => api.get('/settings/roles').then(res => setRoles(res.data));

  const handleCreateRole = async (e) => {
    e.preventDefault();
    await api.post('/settings/roles', newRole);
    setNewRole({ name: '', slug: '' });
    setShowNew(false);
    refreshRoles();
  };

  const handlePermChange = async (role, module, action, value) => {
    const existing = role.permissions.find(p => p.module === module) || {};
    const perm = {
      module,
      can_view: existing.can_view || false,
      can_create: existing.can_create || false,
      can_edit: existing.can_edit || false,
      can_delete: existing.can_delete || false,
      [action]: value,
    };
    await api.put(`/settings/roles/${role.id}/permissions`, { permissions: [perm] });
    refreshRoles();
  };

  return (
    <div className="space-y-4">
      <button onClick={() => setShowNew(!showNew)} className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg">
        {showNew ? 'Cancel' : 'New Role'}
      </button>

      {showNew && (
        <form onSubmit={handleCreateRole} className="bg-white rounded-xl border border-neutral-200 p-4 flex gap-3 items-end shadow-sm">
          <div><label className="text-xs text-neutral-500">Name</label><input value={newRole.name} onChange={e => setNewRole({ ...newRole, name: e.target.value })} required className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" /></div>
          <div><label className="text-xs text-neutral-500">Slug</label><input value={newRole.slug} onChange={e => setNewRole({ ...newRole, slug: e.target.value })} required className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm" /></div>
          <button type="submit" className="px-4 py-2 bg-orange-500 text-white text-sm rounded-lg">Create</button>
        </form>
      )}

      {roles.map(role => (
        <div key={role.id} className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
          <h3 className="text-neutral-800 font-medium mb-3">{role.name} <span className="text-neutral-400 text-xs">({role.slug})</span></h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-neutral-500 border-b border-neutral-200">
                <th className="pb-2 text-left">Module</th>
                <th className="pb-2 text-center">View</th>
                <th className="pb-2 text-center">Create</th>
                <th className="pb-2 text-center">Edit</th>
                <th className="pb-2 text-center">Delete</th>
              </tr>
            </thead>
            <tbody>
              {modules.map(mod => {
                const perm = role.permissions?.find(p => p.module === mod) || {};
                return (
                  <tr key={mod} className="border-b border-neutral-100">
                    <td className="py-2 text-neutral-600 capitalize">{mod}</td>
                    {['can_view', 'can_create', 'can_edit', 'can_delete'].map(action => (
                      <td key={action} className="py-2 text-center">
                        <input type="checkbox" checked={perm[action] || false} onChange={e => handlePermChange(role, mod, action, e.target.checked)} className="accent-orange-500" />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function TiersTab({ tiers, setTiers }) {
  const [newTier, setNewTier] = useState('');

  const refreshTiers = () => api.get('/settings/tiers').then(res => setTiers(res.data));

  const handleCreate = async (e) => {
    e.preventDefault();
    await api.post('/settings/tiers', { name: newTier });
    setNewTier('');
    refreshTiers();
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete tier?')) return;
    try {
      await api.delete(`/settings/tiers/${id}`);
      refreshTiers();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleCreate} className="flex gap-3 items-end">
        <div>
          <label className="text-xs text-neutral-500">Tier Name</label>
          <input value={newTier} onChange={e => setNewTier(e.target.value)} required className="w-full mt-1 px-3 py-2 bg-white border border-neutral-200 rounded-lg text-neutral-800 text-sm focus:outline-none focus:border-orange-400" placeholder="e.g. Tier 4" />
        </div>
        <button type="submit" className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg">Add Tier</button>
      </form>

      <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-neutral-500 text-xs bg-[#faf8f6]">
              <th className="p-3 text-left">Name</th>
              <th className="p-3 text-right">Users</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map(tier => (
              <tr key={tier.id} className="border-b border-neutral-100">
                <td className="p-3 text-neutral-800 font-medium">{tier.name}</td>
                <td className="p-3 text-right text-neutral-600">{tier.users_count ?? '-'}</td>
                <td className="p-3 text-right">
                  <button onClick={() => handleDelete(tier.id)} className="text-xs text-red-500 hover:text-red-600">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
