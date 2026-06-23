import { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import UploadButton from '../components/UploadButton';
import { notify } from '../components/Dialog';
import { setGangMarks } from '../services/gangsheetBuilder';
import { getUiPrefs, setUiPrefs } from '../utils/uiPrefs';

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
    { id: 'telegram', label: 'Telegram' },
    { id: 'vnpay', label: 'VNPay Merchant' },
    { id: 'bank', label: 'Bank Transfer' },
    { id: 'stamp', label: 'Stamp Shipping' },
    { id: 'shippo', label: 'Shippo' },
    { id: 'resend', label: 'Resend' },
    { id: 'appearance', label: 'Giao diện' },
    { id: 'qr', label: 'QR Portal' },
    { id: 'gangsheet', label: 'Gangsheet Auto' },
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
      {tab === 'telegram' && <TelegramTab />}
      {tab === 'vnpay' && <VnpayMerchantTab />}
      {tab === 'bank' && <BankTransferTab />}
      {tab === 'stamp' && <StampConfigTab />}
      {tab === 'shippo' && <ShippoConfigTab />}
      {tab === 'resend' && <ResendConfigTab />}
      {tab === 'appearance' && <AppearanceTab />}
      {tab === 'qr' && <QrConfigTab />}
      {tab === 'gangsheet' && <GangsheetAutomationTab />}
    </div>
  );
}

function GangsheetAutomationTab() {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newHook, setNewHook] = useState('');
  const [userOpts, setUserOpts] = useState([]);

  useEffect(() => {
    api.get('/gangsheet-groups/automation-config').then(r => setCfg(r.data));
    api.get('/gangsheet-groups/assign-user-options').then(r => setUserOpts(r.data || [])).catch(() => {});
  }, []);
  if (!cfg) return <div className="text-neutral-400 text-sm">Loading…</div>;

  const hooks = cfg.auto_close?.hooks || [];
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

  const addHook = () => {
    // Accept several at once, e.g. "09:00, 15:00 21:00".
    const tokens = newHook.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    const invalid = tokens.filter(t => !HHMM.test(t));
    const valid = tokens.filter(t => HHMM.test(t));
    if (invalid.length) notify(`Sai định dạng (HH:mm): ${invalid.join(', ')}`, { title: 'Móc giờ', kind: 'error' });
    if (valid.length) {
      setCfg(c => ({ ...c, auto_close: { ...c.auto_close, hooks: [...new Set([...hooks, ...valid])].sort() } }));
    }
    setNewHook('');
  };
  const removeHook = (h) => setCfg(c => ({ ...c, auto_close: { ...c.auto_close, hooks: hooks.filter(x => x !== h) } }));
  const setEnabled = (v) => setCfg(c => ({ ...c, auto_close: { ...c.auto_close, enabled: v } }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put('/gangsheet-groups/automation-config', {
        group_size: Number(cfg.group_size) || 1,
        assign_rules: (cfg.assign_rules || []).filter(r => r.user_id),
        marks: cfg.marks || {},
        auto_close: { enabled: !!cfg.auto_close?.enabled, hooks },
      });
      setCfg(res.data);
      setGangMarks(res.data.marks || {});   // cache for the local build pipeline
      notify('Saved gangsheet automation', { title: 'Settings', kind: 'success' });
    } catch (err) {
      notify(err.response?.data?.message || 'Save failed', { title: 'Settings', kind: 'error' });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <section className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-neutral-700 mb-1">Automation Gangsheet</h3>
          <p className="text-[11px] text-neutral-500">
            Cron gom đơn vào group chạy <b>trong app</b> (không phải server). Mốc giờ tính theo
            giờ Việt Nam; ngày sản xuất reset 08:00. Ngày SX hiện tại: <b>{cfg.production_day}</b>.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <NumField label="Số đơn mỗi group (tối đa)" value={cfg.group_size} onChange={v => setCfg(c => ({ ...c, group_size: v }))} step="1" />
        </div>

        <div>
          <label className="text-xs text-neutral-500 block mb-1">Quy tắc gom theo user — mỗi user chọn status riêng (rỗng = mọi đơn chưa ship)</label>
          {(cfg.assign_rules || []).map((r, idx) => {
            const u = userOpts.find(x => x.id === r.user_id);
            return (
              <div key={idx} className="border border-neutral-200 rounded-lg p-2 mb-2">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm font-medium text-neutral-800">{u ? u.name : `#${r.user_id}`}{u?.role ? ` · ${u.role}` : ''}</span>
                  <button type="button" onClick={() => setCfg(c => ({ ...c, assign_rules: c.assign_rules.filter((_, i) => i !== idx) }))}
                    className="text-red-500 hover:text-red-600 text-xs">× xoá</button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {[[0,'new_order'],[1,'producing'],[2,'wrongsize'],[3,'fixed'],[4,'reprint'],[5,'onhold'],[7,'cancelled']].map(([s,label]) => {
                    const on = (r.statuses || []).includes(s);
                    return (
                      <button key={s} type="button"
                        onClick={() => setCfg(c => {
                          const rules = [...c.assign_rules];
                          const set = new Set(rules[idx].statuses || []);
                          on ? set.delete(s) : set.add(s);
                          rules[idx] = { ...rules[idx], statuses: [...set] };
                          return { ...c, assign_rules: rules };
                        })}
                        className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${on ? 'bg-orange-500 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-orange-50'}`}>
                        {label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-neutral-400 mt-1">Không chọn status nào = mọi status của user này.</p>
              </div>
            );
          })}
          <select value="" onChange={e => {
              const id = Number(e.target.value);
              if (id) setCfg(c => ({ ...c, assign_rules: [...(c.assign_rules || []), { user_id: id, statuses: [] }] }));
            }}
            className="mt-1 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm">
            <option value="">+ Thêm user…</option>
            {userOpts.filter(u => !(cfg.assign_rules || []).some(r => r.user_id === u.id)).map(u => (
              <option key={u.id} value={u.id}>{u.name}{u.role ? ` · ${u.role}` : ''}</option>
            ))}
          </select>
        </div>

        <p className="text-[11px] text-neutral-500 -mt-2">
          Group gom tối đa {cfg.group_size || '?'} đơn/bucket. Tới mỗi móc giờ, app gom hết đơn pending
          (bao nhiêu cũng group) rồi chốt tạo gang ngay cho tất cả group. Chốt thủ công luôn chốt được.
        </p>

        <div className="rounded-lg border border-neutral-200 p-3">
          <div className="text-sm font-medium text-neutral-700 mb-1">Registration marks (canh in) — lưu trên hub (chung)</div>
          <p className="text-[11px] text-neutral-500 mb-2">Kích thước dấu canh ở góc gang (px @300dpi). Áp dụng cho khổ Letter/A4 (khổ Gốc 10×7 không có marks). Lưu cùng nút "Save changes".</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <NumField label="Khoảng hở mép (gap)" value={cfg.marks?.gap ?? 30} onChange={v => setCfg(c => ({ ...c, marks: { ...c.marks, gap: Number(v) || 0 } }))} step="1" />
            <NumField label="Dài cánh L (arm)" value={cfg.marks?.arm ?? 90} onChange={v => setCfg(c => ({ ...c, marks: { ...c.marks, arm: Number(v) || 0 } }))} step="1" />
            <NumField label="Độ dày nét (thick)" value={cfg.marks?.thick ?? 10} onChange={v => setCfg(c => ({ ...c, marks: { ...c.marks, thick: Number(v) || 0 } }))} step="1" />
            <NumField label="Dài vạch giữa (tick, 0=ẩn)" value={cfg.marks?.tick ?? 70} onChange={v => setCfg(c => ({ ...c, marks: { ...c.marks, tick: Number(v) || 0 } }))} step="1" />
          </div>
        </div>

        <div className="rounded-lg border border-neutral-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
            <input type="checkbox" checked={!!cfg.auto_close?.enabled} onChange={e => setEnabled(e.target.checked)} className="accent-orange-500" />
            Bật auto-chốt theo móc giờ
          </label>
          <p className="text-[11px] text-neutral-500 mt-1">
            Khi bật, app sẽ tự chốt các group đang mở khi tới mỗi mốc giờ. Thêm <b>nhiều móc</b> tuỳ ý
            (vd 09:00, 15:00, 21:00) — mỗi mốc chốt một đợt. Vẫn cần job "Auto chốt" bật ở tab Groups
            trên ít nhất 1 máy đang mở app.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {hooks.length === 0 && <span className="text-xs text-neutral-400">Chưa có móc giờ nào.</span>}
            {hooks.map(h => (
              <span key={h} className="inline-flex items-center gap-1 px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded-lg text-xs font-mono">
                {h}
                <button onClick={() => removeHook(h)} className="text-red-500 hover:text-red-600 ml-1">×</button>
              </span>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input value={newHook} onChange={e => setNewHook(e.target.value)} placeholder="09:00, 15:00, 21:00"
              onKeyDown={e => { if (e.key === 'Enter') addHook(); }}
              className="w-56 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm font-mono" />
            <button onClick={addHook} className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Thêm móc</button>
          </div>
        </div>

        <button onClick={save} disabled={saving} className="px-6 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg font-medium">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </section>
    </div>
  );
}

function StampConfigTab() {
  const [c, setC] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.get('/settings/stamp-config').then(res => setC(res.data)); }, []);
  if (!c) return <div className="text-neutral-400 text-sm">Loading…</div>;

  const set = (k, v) => setC(prev => ({ ...prev, [k]: v }));
  const num = (v) => v === '' ? '' : Number(v);

  // Live preview using the same formula as the backend.
  const fee = Number(c.fee) || 0;
  const handling = Number(c.handling_fee) || 0;
  const base = Number(c.base_items) || 1;
  const preview = (qty) => (fee + Math.max(0, qty - base) * fee + handling).toFixed(2);

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put('/settings/stamp-config', {
        fee: num(c.fee), handling_fee: num(c.handling_fee),
        base_items: num(c.base_items), max_items: num(c.max_items),
      });
      setC(res.data);
      notify('Saved stamp config', { title: 'Settings', kind: 'success' });
    } catch (err) {
      notify(err.response?.data?.message || 'Save failed', { title: 'Settings', kind: 'error' });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <section className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-neutral-700 mb-1">Stamp Shipping</h3>
        <p className="text-[11px] text-neutral-500 mb-3">Phí ship bằng tem (handling fee). Base fee phủ {base} item đầu; mỗi item vượt cộng thêm fee.</p>
        <div className="grid grid-cols-2 gap-3">
          <NumField label="Fee per stamp/item ($)" value={c.fee} onChange={v => set('fee', v)} step="0.01" />
          <NumField label="Handling fee ($, flat)" value={c.handling_fee} onChange={v => set('handling_fee', v)} step="0.01" />
          <NumField label="Base items (covered by base fee)" value={c.base_items} onChange={v => set('base_items', v)} step="1" />
          <NumField label="Max items (limit)" value={c.max_items} onChange={v => set('max_items', v)} step="1" />
        </div>
        <div className="mt-3 p-3 bg-[#faf8f6] border border-neutral-200 rounded text-xs text-neutral-600 space-y-0.5">
          <div className="font-semibold mb-1">Preview</div>
          <div>1-{base} item: <b>${preview(base)}</b></div>
          <div>{base + 1} item: <b>${preview(base + 1)}</b></div>
          <div>{Number(c.max_items) || base + 2} item (max): <b>${preview(Number(c.max_items) || base + 2)}</b></div>
        </div>
        <button onClick={save} disabled={saving} className="mt-4 px-6 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg font-medium">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </section>
    </div>
  );
}

// Hoisted so it keeps a stable component identity across renders (an inline
// component would remount on each keystroke and drop input focus).
function ShippoInp({ label, value, onChange, ph, type = 'text' }) {
  return (
    <label className="block">
      <span className="text-[11px] text-neutral-500">{label}</span>
      <input type={type} value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={ph}
        className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
    </label>
  );
}

function ShippoConfigTab() {
  const [c, setC] = useState(null);
  const [testToken, setTestToken] = useState('');
  const [liveToken, setLiveToken] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.get('/settings/shippo-config').then(res => setC(res.data)); }, []);
  if (!c) return <div className="text-neutral-400 text-sm">Loading…</div>;

  const setFrom = (k, v) => setC(p => ({ ...p, from_address: { ...p.from_address, [k]: v } }));
  const setParcel = (k, v) => setC(p => ({ ...p, parcel: { ...p.parcel, [k]: v } }));
  const setRate = (k, v) => setC(p => ({ ...p, rate: { ...p.rate, [k]: v } }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        test_mode: !!c.test_mode,
        from_address: c.from_address,
        parcel: {
          length: Number(c.parcel.length) || 0, width: Number(c.parcel.width) || 0, height: Number(c.parcel.height) || 0,
          distance_unit: c.parcel.distance_unit, weight: Number(c.parcel.weight) || 0, mass_unit: c.parcel.mass_unit,
        },
        rate: c.rate,
      };
      if (testToken.trim()) payload.test_token = testToken.trim();
      if (liveToken.trim()) payload.live_token = liveToken.trim();
      const res = await api.put('/settings/shippo-config', payload);
      setC(res.data);
      setTestToken(''); setLiveToken('');
      notify('Saved Shippo config', { title: 'Settings', kind: 'success' });
    } catch (err) {
      notify(err.response?.data?.message || 'Save failed', { title: 'Settings', kind: 'error' });
    } finally { setSaving(false); }
  };

  const Inp = ShippoInp;

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Tokens + test mode */}
      <section className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-neutral-700 mb-1">Shippo API</h3>
        <p className="text-[11px] text-neutral-500 mb-3">
          Token không hiển thị lại sau khi lưu — để trống = giữ token cũ. Khi <b>Test mode</b> bật, mọi lần mua dùng <b>test token</b> → label miễn phí, không thật.
        </p>
        <label className="flex items-center gap-2 mb-3 text-sm">
          <input type="checkbox" checked={!!c.test_mode} onChange={e => setC(p => ({ ...p, test_mode: e.target.checked }))} className="accent-orange-500" />
          <span>Test mode (mua label test, miễn phí)</span>
          <span className={`ml-2 px-2 py-0.5 rounded text-[10px] font-medium ${c.test_mode ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
            {c.test_mode ? 'TEST' : 'LIVE — mua thật, tốn tiền'}
          </span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Inp label={`Test token (shippo_test_…) ${c.has_test_token ? '✓ đã đặt' : '— chưa có'}`} value={testToken} onChange={setTestToken} ph={c.has_test_token ? '•••• (để trống = giữ)' : 'shippo_test_…'} type="password" />
          <Inp label={`Live token (shippo_live_…) ${c.has_live_token ? '✓ đã đặt' : '— chưa có'}`} value={liveToken} onChange={setLiveToken} ph={c.has_live_token ? '•••• (để trống = giữ)' : 'shippo_live_…'} type="password" />
        </div>
      </section>

      {/* From / return address */}
      <section className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-neutral-700 mb-3">From / return address</h3>
        <div className="grid grid-cols-2 gap-3">
          <Inp label="Name" value={c.from_address.name} onChange={v => setFrom('name', v)} />
          <Inp label="Company" value={c.from_address.company} onChange={v => setFrom('company', v)} />
          <Inp label="Street 1" value={c.from_address.street1} onChange={v => setFrom('street1', v)} />
          <Inp label="Street 2" value={c.from_address.street2} onChange={v => setFrom('street2', v)} />
          <Inp label="City" value={c.from_address.city} onChange={v => setFrom('city', v)} />
          <Inp label="State" value={c.from_address.state} onChange={v => setFrom('state', v)} />
          <Inp label="Zip" value={c.from_address.zip} onChange={v => setFrom('zip', v)} />
          <Inp label="Country" value={c.from_address.country} onChange={v => setFrom('country', v)} />
          <Inp label="Phone" value={c.from_address.phone} onChange={v => setFrom('phone', v)} />
          <Inp label="Email" value={c.from_address.email} onChange={v => setFrom('email', v)} />
        </div>
      </section>

      {/* Default parcel */}
      <section className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-neutral-700 mb-1">Default parcel</h3>
        <p className="text-[11px] text-neutral-500 mb-3">Kích thước + cân nặng mặc định dùng khi mua label (Shippo bắt buộc).</p>
        <div className="grid grid-cols-3 gap-3">
          <NumField label="Length" value={c.parcel.length} onChange={v => setParcel('length', v)} step="0.1" />
          <NumField label="Width" value={c.parcel.width} onChange={v => setParcel('width', v)} step="0.1" />
          <NumField label="Height" value={c.parcel.height} onChange={v => setParcel('height', v)} step="0.1" />
          <label className="block">
            <span className="text-[11px] text-neutral-500">Distance unit</span>
            <select value={c.parcel.distance_unit} onChange={e => setParcel('distance_unit', e.target.value)} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm">
              <option value="in">in</option><option value="cm">cm</option>
            </select>
          </label>
          <NumField label="Weight" value={c.parcel.weight} onChange={v => setParcel('weight', v)} step="0.1" />
          <label className="block">
            <span className="text-[11px] text-neutral-500">Mass unit</span>
            <select value={c.parcel.mass_unit} onChange={e => setParcel('mass_unit', e.target.value)} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm">
              <option value="oz">oz</option><option value="lb">lb</option><option value="g">g</option><option value="kg">kg</option>
            </select>
          </label>
        </div>
      </section>

      {/* Rate selection */}
      <section className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-neutral-700 mb-3">Rate selection</h3>
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="text-[11px] text-neutral-500">Strategy</span>
            <select value={c.rate.strategy} onChange={e => setRate('strategy', e.target.value)} className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm">
              <option value="cheapest">Cheapest</option>
              <option value="carrier">Cheapest in carrier</option>
              <option value="service">Fixed carrier + service</option>
            </select>
          </label>
          <Inp label="Carrier (vd usps)" value={c.rate.carrier} onChange={v => setRate('carrier', v)} ph="usps" />
          <Inp label="Service level token" value={c.rate.servicelevel} onChange={v => setRate('servicelevel', v)} ph="usps_ground_advantage" />
        </div>
      </section>

      <button onClick={save} disabled={saving} className="px-6 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg font-medium">
        {saving ? 'Saving…' : 'Save Shippo config'}
      </button>
    </div>
  );
}

function AppearanceTab() {
  const [prefs, setPrefs] = useState(getUiPrefs);
  const toggle = (k) => setPrefs(setUiPrefs({ [k]: !prefs[k] }));
  return (
    <div className="space-y-4 max-w-md">
      <section className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm space-y-3">
        <h3 className="text-sm font-semibold text-neutral-700 mb-1">Sidebar</h3>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={prefs.showLogo} onChange={() => toggle('showLogo')} /> Hiện logo
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={prefs.showAppName} onChange={() => toggle('showAppName')} /> Hiện tên app
        </label>
        <p className="text-[11px] text-neutral-500">Lưu trên máy này; áp dụng ngay.</p>
      </section>
    </div>
  );
}

function ResendConfigTab() {
  const [c, setC] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.get('/settings/resend-config').then(res => setC(res.data)); }, []);
  if (!c) return <div className="text-neutral-400 text-sm">Loading…</div>;

  const setMethod = (i, k, v) => setC(p => ({ ...p, methods: p.methods.map((m, j) => j === i ? { ...m, [k]: v } : m) }));
  const setReason = (i, k, v) => setC(p => ({ ...p, reasons: p.reasons.map((r, j) => j === i ? { ...r, [k]: v } : r) }));
  const setQuota = (k, v) => setC(p => ({ ...p, quota: { ...p.quota, [k]: v } }));
  const addMethod = () => setC(p => ({ ...p, methods: [...p.methods, { key: '', label: '', price: 0, ship_type: 'seller_ship', desc: '' }] }));
  const delMethod = (i) => setC(p => ({ ...p, methods: p.methods.filter((_, j) => j !== i) }));
  const addReason = () => setC(p => ({ ...p, reasons: [...p.reasons, { key: '', label: '', quota_based: true, support: { base_cost: 0, '2nd_fee': 0, accessory: 0 } }] }));
  const delReason = (i) => setC(p => ({ ...p, reasons: p.reasons.filter((_, j) => j !== i) }));
  const setSupportPct = (i, comp, v) => setC(p => ({ ...p, reasons: p.reasons.map((r, j) =>
    j === i ? { ...r, support: { ...(r.support || {}), [comp]: v === '' ? 0 : Number(v) } } : r) }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put('/settings/resend-config', {
        methods: c.methods.map(m => ({ ...m, price: Number(m.price) || 0 })),
        reasons: c.reasons,
        quota: { default_free: Number(c.quota.default_free) || 0, after_free_support_pct: Number(c.quota.after_free_support_pct) || 0 },
      });
      setC(res.data);
      notify('Saved resend config', { title: 'Settings', kind: 'success' });
    } catch (err) {
      notify(err.response?.data?.message || 'Save failed', { title: 'Settings', kind: 'error' });
    } finally { setSaving(false); }
  };

  const inp = 'px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded text-sm';

  return (
    <div className="space-y-4 max-w-3xl">
      <section className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-neutral-700 mb-2">Phương thức gửi lại</h3>
        <div className="space-y-2">
          {c.methods.map((m, i) => (
            <div key={i} className="flex gap-2 items-center flex-wrap">
              <input className={`${inp} w-24 font-mono`} placeholder="key" value={m.key} onChange={e => setMethod(i, 'key', e.target.value)} />
              <input className={`${inp} flex-1 min-w-[160px]`} placeholder="label" value={m.label} onChange={e => setMethod(i, 'label', e.target.value)} />
              <input className={`${inp} w-20 text-right`} type="number" step="0.01" placeholder="$" value={m.price} onChange={e => setMethod(i, 'price', e.target.value)} />
              <select className={inp} value={m.ship_type} onChange={e => setMethod(i, 'ship_type', e.target.value)}>
                <option value="seller_ship">seller_ship (tracking)</option>
                <option value="stamp">stamp</option>
                <option value="tiktok_ship">tiktok_ship</option>
              </select>
              <input className={`${inp} flex-1 min-w-[140px]`} placeholder="desc" value={m.desc || ''} onChange={e => setMethod(i, 'desc', e.target.value)} />
              <button onClick={() => delMethod(i)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
            </div>
          ))}
        </div>
        <button onClick={addMethod} className="mt-2 text-xs text-orange-600">+ thêm phương thức</button>
      </section>

      <section className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-neutral-700 mb-1">Trường hợp resend (reason)</h3>
        <p className="text-[11px] text-neutral-500 mb-2">Mỗi reason đặt <b>% xưởng hỗ trợ</b> cho từng khoản phí (0–100). <b>Theo quota</b>: bật = chỉ hỗ trợ trong số đơn free/tháng, hết quota thì hỗ trợ × {c.quota.after_free_support_pct}%. Shipping luôn seller trả.</p>
        <div className="space-y-2">
          {c.reasons.map((r, i) => (
            <div key={i} className="border border-neutral-100 rounded-lg p-2 space-y-2">
              <div className="flex gap-2 items-center flex-wrap">
                <input className={`${inp} w-28 font-mono`} placeholder="key" value={r.key} onChange={e => setReason(i, 'key', e.target.value)} />
                <input className={`${inp} flex-1 min-w-[180px]`} placeholder="label" value={r.label} onChange={e => setReason(i, 'label', e.target.value)} />
                <label className="flex items-center gap-1 text-xs text-neutral-600">
                  <input type="checkbox" checked={!!r.quota_based} onChange={e => setReason(i, 'quota_based', e.target.checked)} /> theo quota
                </label>
                <button onClick={() => delReason(i)} className="text-red-400 hover:text-red-600 text-xs ml-auto">✕</button>
              </div>
              <div className="flex gap-4 flex-wrap pl-1">
                {(c.fee_components || [{ key: 'base_cost', label: 'Base cost' }, { key: '2nd_fee', label: 'Phí mặt thêm' }, { key: 'accessory', label: 'Add on' }]).map(fc => (
                  <label key={fc.key} className="flex items-center gap-1 text-xs text-neutral-600">
                    {fc.label}
                    <input type="number" min={0} max={100} value={r.support?.[fc.key] ?? 0}
                      onChange={e => setSupportPct(i, fc.key, e.target.value)}
                      className="w-16 px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded text-sm text-right" />%
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <button onClick={addReason} className="mt-2 text-xs text-orange-600">+ thêm reason</button>
      </section>

      <section className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-neutral-700 mb-2">Quota tháng (mặc định mỗi seller)</h3>
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <NumField label="Số đơn free base / tháng" value={c.quota.default_free} onChange={v => setQuota('default_free', v)} step="1" />
          <NumField label="% hỗ trợ base sau khi hết free" value={c.quota.after_free_support_pct} onChange={v => setQuota('after_free_support_pct', v)} step="1" />
        </div>
        <p className="text-[11px] text-neutral-500 mt-2">Override theo từng seller ở trang Users (resend_free_quota). Seller luôn trả đủ shipping.</p>
      </section>

      <button onClick={save} disabled={saving} className="px-6 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg font-medium">
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}

function QrConfigTab() {
  const [c, setC] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.get('/settings/qr-config').then(res => setC(res.data)); }, []);
  if (!c) return <div className="text-neutral-400 text-sm">Loading…</div>;

  const save = async (next) => {
    setSaving(true);
    try {
      const res = await api.put('/settings/qr-config', { auto_ship_print: !!next.auto_ship_print });
      setC(res.data);
      notify('Saved QR config', { title: 'Settings', kind: 'success' });
    } catch (err) {
      notify(err.response?.data?.message || 'Save failed', { title: 'Settings', kind: 'error' });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <section className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-neutral-700 mb-1">QR Portal</h3>
        <p className="text-[11px] text-neutral-500 mb-3">Hành vi khi mở trang <code className="font-mono">/qr/&#123;system_id&#125;</code> trên hub.</p>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={!!c.auto_ship_print}
            disabled={saving}
            onChange={e => { const v = e.target.checked; setC(p => ({ ...p, auto_ship_print: v })); save({ auto_ship_print: v }); }}
            className="mt-0.5 w-4 h-4 accent-orange-500"
          />
          <span className="text-sm text-neutral-700">
            Tự động Ship &amp; Print khi mở trang QR
            <span className="block text-[11px] text-neutral-500 mt-0.5">
              Khi quét/mở 1 đơn <b>chưa shipped</b>, hệ thống tự đánh dấu shipped rồi bung hộp thoại in label. Đơn đã shipped thì bỏ qua.
            </span>
          </span>
        </label>
      </section>
    </div>
  );
}

function NumField({ label, value, onChange, step }) {
  return (
    <div>
      <label className="text-xs text-neutral-500">{label}</label>
      <input type="number" step={step} min="0" value={value ?? ''} onChange={e => onChange(e.target.value)}
        className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
    </div>
  );
}

function VnpayMerchantTab() {
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/settings/vnpay-merchant').then((res) => setData(res.data));
  }, []);

  if (!data) return <div className="text-neutral-400 text-sm">Loading…</div>;

  const setMerchant = (field, value) =>
    setData(d => ({ ...d, merchant: { ...d.merchant, [field]: value } }));
  const setRate = (value) =>
    setData(d => ({ ...d, rate: { vnd_per_usd: parseFloat(value) || 0 } }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.put('/settings/vnpay-merchant', data);
      setData(res.data);
      notify('Saved VNPay settings', { title: 'Settings', kind: 'success' });
    } catch (err) {
      notify(err.response?.data?.message || 'Save failed', { title: 'Settings', kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const copy = (text) => { navigator.clipboard?.writeText(text); notify('Đã copy', { title: 'Copied', kind: 'success' }); };

  return (
    <div className="space-y-6 max-w-3xl">
      <section className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-neutral-700">VNPay Merchant Gateway</h3>
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-500">Active env:</label>
            <select
              value={data.merchant.env || 'sandbox'}
              onChange={(e) => setMerchant('env', e.target.value)}
              className="px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm"
            >
              <option value="sandbox">Sandbox (test)</option>
              <option value="production">Production (live)</option>
            </select>
          </div>
        </div>

        {/* Sandbox creds */}
        <div className={`rounded-lg border p-3 mb-3 ${data.merchant.env === 'sandbox' ? 'border-orange-300 bg-orange-50/40' : 'border-neutral-200'}`}>
          <div className="text-xs font-semibold text-neutral-600 mb-2">Sandbox {data.merchant.env === 'sandbox' && <span className="text-orange-600">(đang dùng)</span>}</div>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="vnp_TmnCode" value={data.merchant.sandbox_tmn_code} onChange={v => setMerchant('sandbox_tmn_code', v)} />
            <TextField label="vnp_HashSecret" value={data.merchant.sandbox_hash_secret} onChange={v => setMerchant('sandbox_hash_secret', v)} />
          </div>
        </div>

        {/* Production creds */}
        <div className={`rounded-lg border p-3 mb-3 ${data.merchant.env === 'production' ? 'border-orange-300 bg-orange-50/40' : 'border-neutral-200'}`}>
          <div className="text-xs font-semibold text-neutral-600 mb-2">Production {data.merchant.env === 'production' && <span className="text-orange-600">(đang dùng — tiền thật)</span>}</div>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="vnp_TmnCode" value={data.merchant.production_tmn_code} onChange={v => setMerchant('production_tmn_code', v)} />
            <TextField label="vnp_HashSecret" value={data.merchant.production_hash_secret} onChange={v => setMerchant('production_hash_secret', v)} />
          </div>
        </div>

        <TextField label="Return URL (browser redirect)" value={data.merchant.return_url} onChange={v => setMerchant('return_url', v)} full />

        {/* URLs to register at VNPay portal */}
        <div className="mt-3 p-3 bg-blue-50 border border-blue-100 rounded text-xs text-blue-800 space-y-2">
          <p className="font-semibold">Khai báo 2 URL này ở VNPay merchant portal:</p>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0">IPN URL:</span>
            <code className="flex-1 truncate bg-white px-2 py-1 rounded border border-blue-200">{data.ipn_url}</code>
            <button onClick={() => copy(data.ipn_url)} className="shrink-0 px-2 py-1 bg-blue-100 hover:bg-blue-200 rounded">Copy</button>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0">Return:</span>
            <code className="flex-1 truncate bg-white px-2 py-1 rounded border border-blue-200">{data.return_url}</code>
            <button onClick={() => copy(data.return_url)} className="shrink-0 px-2 py-1 bg-blue-100 hover:bg-blue-200 rounded">Copy</button>
          </div>
          <p className="text-[11px] opacity-75">Sandbox portal: sandbox.vnpayment.vn/merchantv2/ · Production: doitac.vnpay.vn</p>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-neutral-700 mb-3">Exchange Rate</h3>
        <p className="text-[11px] text-neutral-500 mb-2">Số VND để credit $1 vào wallet. VD: 25000 = 25,000,000 VND nạp → $1,000 wallet.</p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min="1000"
            max="100000"
            step="100"
            value={data.rate?.vnd_per_usd || 25000}
            onChange={e => setRate(e.target.value)}
            className="w-40 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm"
          />
          <span className="text-xs text-neutral-500">VND per $1</span>
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

// localStorage keys the renderer cron uses — kept per-device so multiple
// admins opening the desktop app don't all spam the same chat.
const CRON_KEY = 'telegram_app_cron_interval';
const DAILY_LAST_FIRE_KEY = 'telegram_daily_last_fire_date'; // YYYY-MM-DD

function TelegramTab() {
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [settingHook, setSettingHook] = useState(false);

  // App-side cron — interval persisted per-device in localStorage.
  const [cronInterval, setCronInterval] = useState(() => localStorage.getItem(CRON_KEY) || 'off');
  const [lastCron, setLastCron] = useState(null);
  const cronTimerRef = useRef(null);

  useEffect(() => {
    api.get('/settings/telegram').then((res) => setData(res.data));
  }, []);

  // (Re)schedule the in-app cron whenever the interval changes or the
  // component mounts. Clears any previous timer first.
  useEffect(() => {
    if (cronTimerRef.current) clearInterval(cronTimerRef.current);
    if (cronInterval === 'off') return;
    const ms = { '1m': 60_000, '30m': 30 * 60_000, '1h': 60 * 60_000 }[cronInterval];
    if (!ms) return;
    cronTimerRef.current = setInterval(() => fireReport(true), ms);
    return () => clearInterval(cronTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cronInterval]);

  // Daily 7:00 AM trigger — runs in-app while the window is open.
  // Tick every minute; fire once per local-date when the hour reaches 7.
  // Tracking in localStorage means re-mounting the tab doesn't re-fire.
  useEffect(() => {
    if (!data?.daily_cron_enabled) return;
    const check = () => {
      const now = new Date();
      if (now.getHours() !== 7) return;
      const today = now.toISOString().slice(0, 10);
      if (localStorage.getItem(DAILY_LAST_FIRE_KEY) === today) return;
      localStorage.setItem(DAILY_LAST_FIRE_KEY, today);
      fireReport(true);
    };
    const id = setInterval(check, 60_000);
    check(); // immediate check in case we mount past 7am
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.daily_cron_enabled]);

  if (!data) return <div className="text-neutral-400 text-sm">Loading…</div>;

  const setField = (field, value) => setData(d => ({ ...d, [field]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.put('/settings/telegram', data);
      setData(res.data);
      notify('Saved Telegram settings', { title: 'Settings', kind: 'success' });
    } catch (err) {
      notify(err.response?.data?.message || 'Save failed', { title: 'Telegram', kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const refreshGroups = async () => {
    setGroupsLoading(true);
    try {
      const res = await api.get('/settings/telegram/groups');
      setGroups(res.data.groups || []);
      if ((res.data.groups || []).length === 0) {
        notify('No groups found. Add the bot to a group and send a message there, then refresh.', { title: 'Telegram groups', kind: 'info' });
      }
    } catch (err) {
      notify(err.response?.data?.message || 'Refresh failed', { title: 'Telegram groups', kind: 'error' });
    } finally {
      setGroupsLoading(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await api.post('/settings/telegram/test', {
        chat_id: data.default_chat_id || undefined,
        thread_id: data.default_thread_id || undefined,
      });
      notify(`Test sent (message #${res.data.message_id})`, { title: 'Telegram', kind: 'success' });
    } catch (err) {
      notify(err.response?.data?.message || 'Test failed', { title: 'Telegram', kind: 'error' });
    } finally {
      setTesting(false);
    }
  };

  const handleSetWebhook = async () => {
    setSettingHook(true);
    try {
      const res = await api.post('/settings/telegram/set-webhook', {});
      notify(`Webhook registered:\n${res.data.url}`, { title: 'Telegram', kind: 'success' });
    } catch (err) {
      notify(err.response?.data?.message || 'Set webhook failed', { title: 'Telegram', kind: 'error' });
    } finally {
      setSettingHook(false);
    }
  };

  const fireReport = async (silent = false) => {
    setReporting(true);
    try {
      const res = await api.post('/settings/telegram/report', {});
      setLastCron(new Date());
      if (!silent) notify(`Report sent (${res.data.from} → ${res.data.to})`, { title: 'Telegram', kind: 'success' });
    } catch (err) {
      if (!silent) notify(err.response?.data?.message || 'Report failed', { title: 'Telegram', kind: 'error' });
    } finally {
      setReporting(false);
    }
  };

  const pickChat = (chat) => {
    setField('default_chat_id', String(chat.id));
  };

  const pickThread = (chat, thread) => {
    setField('default_chat_id', String(chat.id));
    setField('default_thread_id', thread.id);
  };

  const pickTopupChat = (chat) => {
    setField('topup_chat_id', String(chat.id));
    setField('topup_thread_id', null);
  };
  const pickTopupThread = (chat, thread) => {
    setField('topup_chat_id', String(chat.id));
    setField('topup_thread_id', thread.id);
  };

  const updateCronInterval = (value) => {
    setCronInterval(value);
    localStorage.setItem(CRON_KEY, value);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Bot config */}
      <section className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-neutral-700 mb-3">Telegram Settings</h3>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Bot Token"               value={data.bot_token}         onChange={v => setField('bot_token', v)} full />
          <TextField label="Bot Username (without @, for user link)" value={data.bot_username ?? ''} onChange={v => setField('bot_username', v)} />
          <TextField label="Webhook Secret (for /login linking)"     value={data.webhook_secret ?? ''} onChange={v => setField('webhook_secret', v)} />
          <TextField label="Default Report Days"     value={String(data.report_days ?? 0)} onChange={v => setField('report_days', parseInt(v || '0', 10))} />
          <TextField label="Default Chat ID"         value={data.default_chat_id}   onChange={v => setField('default_chat_id', v)} />
          <TextField label="Default Thread/Topic ID (optional)" value={data.default_thread_id ?? ''} onChange={v => setField('default_thread_id', v === '' ? null : parseInt(v, 10))} full />
          <TextField label="Topup Chat ID (notification: tạo + duyệt topup)" value={data.topup_chat_id ?? ''} onChange={v => setField('topup_chat_id', v)} />
          <TextField label="Topup Thread/Topic ID (optional)" value={data.topup_thread_id ?? ''} onChange={v => setField('topup_thread_id', v === '' ? null : parseInt(v, 10))} full />
        </div>
        <label className="flex items-center gap-2 mt-3 text-sm text-neutral-700 cursor-pointer">
          <input
            type="checkbox"
            checked={!!data.daily_cron_enabled}
            onChange={e => setField('daily_cron_enabled', e.target.checked)}
            className="w-4 h-4"
          />
          Enable Daily Cron (7:00 AM, app-side — fires once when the app is open and the hour ticks to 7)
        </label>
        <div className="flex gap-2 mt-4">
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg font-medium">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button onClick={handleTest} disabled={testing || !data.default_chat_id} className="px-5 py-2 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 text-blue-700 text-sm rounded-lg font-medium">
            {testing ? 'Sending…' : 'Send test message'}
          </button>
          <button onClick={handleSetWebhook} disabled={settingHook || !data.bot_token} className="px-5 py-2 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 text-emerald-700 text-sm rounded-lg font-medium">
            {settingHook ? 'Registering…' : 'Register webhook'}
          </button>
        </div>
        <p className="text-[11px] text-neutral-500 mt-2">
          Set Bot Token, Bot Username, Webhook Secret and your APP_URL (or ngrok URL) → Save → Register webhook.
          Users then DM the bot <span className="font-mono">/login email password</span> to receive order notifications.
        </p>
      </section>

      {/* Group picker */}
      <section className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-neutral-700">Telegram Groups</h3>
            <p className="text-[11px] text-neutral-500 mt-0.5">Click refresh to load groups the bot has been added to. The bot must have received a recent message in each group to appear.</p>
          </div>
          <button onClick={refreshGroups} disabled={groupsLoading} className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 disabled:opacity-50 text-neutral-700 text-xs rounded-lg">
            {groupsLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {groups.length === 0 ? (
          <p className="text-xs text-neutral-400">No groups loaded yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {groups.map((g) => (
              <li key={g.id} className="py-2">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-sm font-medium text-neutral-800">{g.title || g.username || `Chat ${g.id}`}</div>
                    <div className="text-[11px] text-neutral-500">{g.type} · id: <span className="font-mono">{g.id}</span></div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => pickChat(g)} title="Use as default (report) chat" className={`text-xs px-2 py-1 rounded ${String(data.default_chat_id) === String(g.id) ? 'bg-orange-100 text-orange-700' : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-700'}`}>
                      📊 {String(data.default_chat_id) === String(g.id) ? '✓' : 'Default'}
                    </button>
                    <button onClick={() => pickTopupChat(g)} title="Use as topup notification chat" className={`text-xs px-2 py-1 rounded ${String(data.topup_chat_id) === String(g.id) ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-700'}`}>
                      💸 {String(data.topup_chat_id) === String(g.id) ? '✓' : 'Topup'}
                    </button>
                  </div>
                </div>
                {(g.threads || []).length > 0 && (
                  <div className="ml-3 mt-2 flex flex-wrap gap-1.5">
                    {g.threads.map((t) => (
                      <span key={t.id} className="inline-flex gap-0.5">
                        <button
                          onClick={() => pickThread(g, t)}
                          title="Use as default thread"
                          className={`text-[11px] px-2 py-0.5 rounded border ${String(data.default_chat_id) === String(g.id) && data.default_thread_id === t.id ? 'bg-orange-50 border-orange-300 text-orange-700' : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50'}`}
                        >
                          📊 🧵 {t.title} (#{t.id})
                        </button>
                        <button
                          onClick={() => pickTopupThread(g, t)}
                          title="Use as topup thread"
                          className={`text-[11px] px-2 py-0.5 rounded border ${String(data.topup_chat_id) === String(g.id) && data.topup_thread_id === t.id ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50'}`}
                        >
                          💸
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* App-side cron */}
      <section className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-neutral-700 mb-1">App-side Cron</h3>
        <p className="text-[11px] text-neutral-500 mb-3">Schedules a recurring report from this desktop app while it's running. Saved per-device (localStorage) so only the admin who turns it on triggers it.</p>
        <div className="flex items-center gap-3">
          <label className="text-xs text-neutral-500">Interval:</label>
          <select value={cronInterval} onChange={(e) => updateCronInterval(e.target.value)} className="px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded text-sm">
            <option value="off">Off</option>
            <option value="1m">Every 1 minute</option>
            <option value="30m">Every 30 minutes</option>
            <option value="1h">Every 1 hour</option>
          </select>
          <button onClick={() => fireReport(false)} disabled={reporting || !data.default_chat_id} className="px-4 py-1.5 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 text-emerald-700 text-sm rounded-lg font-medium">
            {reporting ? 'Sending…' : 'Run cron now'}
          </button>
          {lastCron && (
            <span className="text-[11px] text-neutral-500">Last run: {lastCron.toLocaleTimeString()}</span>
          )}
        </div>
        {cronInterval !== 'off' && (
          <p className="text-[11px] text-amber-700 mt-2">⚠ Cron runs only while this app window is open.</p>
        )}
      </section>
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

function BankTransferTab() {
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.get('/settings/bank-transfer').then(res => setData(res.data)); }, []);
  if (!data) return <p className="text-sm text-neutral-500">Loading…</p>;
  const setField = (k, v) => setData(d => ({ ...d, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put('/settings/bank-transfer', data);
      setData(res.data);
      notify('Saved bank-transfer settings', { title: 'Bank Transfer', kind: 'success' });
    } catch (err) {
      notify(err.response?.data?.message || 'Save failed', { title: 'Bank Transfer', kind: 'error' });
    } finally { setSaving(false); }
  };

  const sampleAmount = 26000;
  const sampleContent = (data.content_template || 'BS {ref}').replace('{ref}', 'BTABC123');
  const previewQr = (data.qr_template_url || '')
    .replace('{bank}', (data.bank_name || '').replace(/[^A-Za-z0-9]/g, ''))
    .replace('{account}', (data.account_no || '').replace(/[^A-Za-z0-9]/g, ''))
    .replace('{amount}', String(sampleAmount))
    .replace('{content}', encodeURIComponent(sampleContent))
    .replace('{holder}', encodeURIComponent(data.account_holder || ''));

  return (
    <div className="space-y-5 max-w-3xl">
      <section className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-neutral-700 mb-3">Bank Transfer (manual / simulated VNPay)</h3>
        <p className="text-[11px] text-neutral-500 mb-3">Khi seller nạp tiền, app hiện popup QR + thông tin chuyển khoản này. Sau khi chuyển xong, admin nhận notify Telegram và vào Wallet duyệt deposit.</p>
        <label className="flex items-center gap-2 mb-3 text-sm text-neutral-700">
          <input type="checkbox" checked={!!data.enabled} onChange={e => setField('enabled', e.target.checked)} className="w-4 h-4" />
          Enabled (hiện nút Bank Transfer trên Wallet của seller)
        </label>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Rate (VND / 1 USD)" value={String(data.rate ?? '')} onChange={v => setField('rate', Number(v) || 0)} />
          <TextField label="Min USD" value={String(data.min_usd ?? '')} onChange={v => setField('min_usd', Number(v) || 0)} />
          <TextField label="Bank name (VietQR short code, vd VCB / TCB / MB)" value={data.bank_name} onChange={v => setField('bank_name', v)} />
          <TextField label="Account number" value={data.account_no} onChange={v => setField('account_no', v)} />
          <TextField label="Account holder" value={data.account_holder} onChange={v => setField('account_holder', v)} full />
          <TextField label="Branch (optional)" value={data.branch} onChange={v => setField('branch', v)} full />
          <TextField label="Content template (dùng {ref} cho mã CK duy nhất)" value={data.content_template} onChange={v => setField('content_template', v)} full />
          <TextField label="QR template URL (placeholders: {bank} {account} {amount} {content} {holder})" value={data.qr_template_url} onChange={v => setField('qr_template_url', v)} full />
        </div>
        <button onClick={save} disabled={saving} className="mt-4 px-5 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg font-medium">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </section>

      <section className="bg-white rounded-xl border border-neutral-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-neutral-700 mb-3">Preview</h3>
        <p className="text-[11px] text-neutral-500 mb-3">Mẫu QR + content nếu seller nạp {`₫${sampleAmount.toLocaleString()}`} với reference <code>BTABC123</code>.</p>
        <div className="flex gap-4 items-start">
          {previewQr ? (
            <img src={previewQr} alt="QR preview" className="h-48 w-48 object-contain border border-neutral-200 rounded" onError={e => { e.currentTarget.style.opacity = 0.3; }} />
          ) : (
            <div className="h-48 w-48 grid place-items-center text-xs text-neutral-400 border border-neutral-200 rounded">No QR template</div>
          )}
          <div className="text-sm space-y-1">
            <div><span className="text-neutral-500">Bank:</span> {data.bank_name || '—'}</div>
            <div><span className="text-neutral-500">Account:</span> <span className="font-mono">{data.account_no || '—'}</span></div>
            <div><span className="text-neutral-500">Holder:</span> {data.account_holder || '—'}</div>
            <div><span className="text-neutral-500">Content:</span> <code className="bg-amber-50 px-1.5 py-0.5 rounded">{sampleContent}</code></div>
          </div>
        </div>
      </section>
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
