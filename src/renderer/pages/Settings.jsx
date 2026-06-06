import { useState, useEffect, useRef } from 'react';
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
    { id: 'telegram', label: 'Telegram' },
    { id: 'vnpay', label: 'VNPay Merchant' },
    { id: 'bank', label: 'Bank Transfer' },
    { id: 'stamp', label: 'Stamp Shipping' },
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
      {tab === 'gangsheet' && <GangsheetAutomationTab />}
    </div>
  );
}

function GangsheetAutomationTab() {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newHook, setNewHook] = useState('');

  useEffect(() => { api.get('/gangsheet-groups/automation-config').then(r => setCfg(r.data)); }, []);
  if (!cfg) return <div className="text-neutral-400 text-sm">Loading…</div>;

  const hooks = cfg.auto_close?.hooks || [];
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

  const addHook = () => {
    const v = newHook.trim();
    if (!HHMM.test(v)) { notify('Định dạng HH:mm (vd 09:00)', { title: 'Móc giờ', kind: 'error' }); return; }
    if (!hooks.includes(v)) {
      setCfg(c => ({ ...c, auto_close: { ...c.auto_close, hooks: [...hooks, v].sort() } }));
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
        group_min: Number(cfg.group_min) || 1,
        auto_close: { enabled: !!cfg.auto_close?.enabled, hooks },
      });
      setCfg(res.data);
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
          <NumField label="Tối thiểu để auto-chốt" value={cfg.group_min} onChange={v => setCfg(c => ({ ...c, group_min: v }))} step="1" />
        </div>
        <p className="text-[11px] text-neutral-500 -mt-2">
          Group gom tối đa {cfg.group_size || '?'} đơn; auto-chốt chỉ tạo gang khi group đủ ≥ {cfg.group_min || 1} đơn
          (chưa đủ thì tiếp tục gom). Chốt thủ công vẫn chốt được bất kể số lượng.
        </p>

        <div className="rounded-lg border border-neutral-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
            <input type="checkbox" checked={!!cfg.auto_close?.enabled} onChange={e => setEnabled(e.target.checked)} className="accent-orange-500" />
            Bật auto-chốt theo móc giờ
          </label>
          <p className="text-[11px] text-neutral-500 mt-1">
            Khi bật, app sẽ tự chốt các group đang mở khi tới mốc giờ. Vẫn cần job "Auto chốt"
            được bật ở tab Groups trên ít nhất 1 máy đang mở app.
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
            <input value={newHook} onChange={e => setNewHook(e.target.value)} placeholder="09:00"
              onKeyDown={e => { if (e.key === 'Enter') addHook(); }}
              className="w-28 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm font-mono" />
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
        </div>
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
