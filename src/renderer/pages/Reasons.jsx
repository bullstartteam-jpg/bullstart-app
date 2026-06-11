import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

// Reason management. Reasons are shared config; creating/editing is admin-only
// (the API enforces it). Everyone can view + print the QR (which encodes the
// reason's code, e.g. "RSN7K2A") to scan on the Reprint page.
export default function Reasons() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('admin');
  const [reasons, setReasons] = useState([]);
  const [qrMap, setQrMap] = useState({});   // code -> data URL
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await api.get('/reasons');
    setReasons(data || []);
    const map = {};
    for (const r of data || []) {
      try { map[r.code] = await QRCode.toDataURL(r.code, { width: 160, margin: 1 }); } catch { /* noop */ }
    }
    setQrMap(map);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try { await api.post('/reasons', { name: name.trim() }); setName(''); await load(); }
    catch (err) { alert(err?.response?.data?.message || 'Tạo reason thất bại'); }
    finally { setBusy(false); }
  };
  const rename = async (r) => {
    const next = prompt('Tên reason:', r.name);
    if (next == null || !next.trim() || next === r.name) return;
    await api.put(`/reasons/${r.id}`, { name: next.trim() });
    load();
  };
  const del = async (r) => {
    if (!confirm(`Xoá reason "${r.name}"?`)) return;
    await api.delete(`/reasons/${r.id}`);
    load();
  };
  const printQr = (r) => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<body style="text-align:center;font-family:sans-serif;padding:40px">
      <img src="${qrMap[r.code]}" style="width:240px;height:240px" />
      <div style="font-size:22px;font-weight:700;margin-top:8px">${r.name}</div>
      <div style="font-family:monospace;color:#666">${r.code}</div>
      <script>window.onload=()=>window.print()</script></body>`);
    w.document.close();
  };

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-xl font-bold text-neutral-800">Reasons</h2>

      {isAdmin && (
        <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-xs text-neutral-500 block mb-1">Tên reason mới (code tự sinh)</label>
            <input value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && create()}
              placeholder="vd: Sai size"
              className="w-full px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
          </div>
          <button onClick={create} disabled={busy}
            className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg">
            {busy ? 'Đang tạo…' : 'Tạo'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {reasons.map(r => (
          <div key={r.id} className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm flex flex-col items-center text-center">
            {qrMap[r.code]
              ? <img src={qrMap[r.code]} alt={r.code} className="w-32 h-32" />
              : <div className="w-32 h-32 bg-neutral-100 rounded" />}
            <div className="mt-2 font-semibold text-neutral-800">{r.name}</div>
            <div className="font-mono text-xs text-neutral-500">{r.code}</div>
            <div className="flex gap-2 mt-3">
              <button onClick={() => printQr(r)} className="text-xs px-2 py-1 bg-neutral-100 hover:bg-neutral-200 rounded">In QR</button>
              {isAdmin && <button onClick={() => rename(r)} className="text-xs px-2 py-1 bg-neutral-100 hover:bg-neutral-200 rounded">Sửa</button>}
              {isAdmin && <button onClick={() => del(r)} className="text-xs px-2 py-1 text-red-500 hover:bg-red-50 rounded">Xoá</button>}
            </div>
          </div>
        ))}
        {reasons.length === 0 && <div className="col-span-full text-center text-neutral-400 py-8">Chưa có reason.</div>}
      </div>
    </div>
  );
}
