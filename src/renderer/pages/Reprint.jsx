import { useState, useEffect, useRef } from 'react';
import api from '../services/api';

// Reprint scan page. A barcode/QR scanner behaves like a keyboard: it "types"
// the scanned value and presses Enter. We keep one input focused and route by
// prefix — a reason QR encodes "RSN…", anything else is treated as a system_id.
//   - scan a system_id  → create a new reprint (with the active reason if set)
//   - scan a reason QR   → fill the reason into the selected reprint, else the
//                          latest reprint that has no reason, else arm it as the
//                          "active reason" for the next created reprint.
// Admins see all reprints; everyone else sees only their own (API-scoped).
export default function Reprint() {
  const [reprints, setReprints] = useState([]);
  const [reasons, setReasons] = useState([]);
  const [activeReason, setActiveReason] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [scan, setScan] = useState('');
  const [msg, setMsg] = useState(null);
  const inputRef = useRef(null);

  const refocus = () => inputRef.current?.focus();

  const load = async () => {
    const [rp, rs] = await Promise.all([api.get('/reprints'), api.get('/reasons')]);
    setReprints(rp.data || []);
    setReasons(rs.data || []);
  };
  useEffect(() => { load(); refocus(); }, []);

  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 3500); };

  const applyReason = async (reason) => {
    let target = reprints.find(r => r.id === selectedId && !r.reason_id)
      || reprints.find(r => !r.reason_id);
    if (target) {
      const { data } = await api.put(`/reprints/${target.id}`, { reason_id: reason.id });
      setReprints(p => p.map(r => (r.id === target.id ? data : r)));
      flash('ok', `Reason "${reason.name}" → ${target.system_id}`);
    } else {
      setActiveReason(reason);
      flash('ok', `Đã chọn reason "${reason.name}" cho reprint kế tiếp`);
    }
  };

  const onScan = async (e) => {
    e?.preventDefault();
    const value = scan.trim();
    setScan('');
    if (!value) return;
    try {
      if (/^RSN/i.test(value)) {
        const { data: reason } = await api.get(`/reasons/by-code/${encodeURIComponent(value)}`);
        await applyReason(reason);
      } else {
        const { data: reprint } = await api.post('/reprints', {
          system_id: value,
          reason_id: activeReason?.id ?? null,
        });
        setReprints(p => [reprint, ...p]);
        setSelectedId(reprint.id);
        flash('ok', `Tạo reprint ${reprint.system_id}${reprint.reason ? ` · ${reprint.reason.name}` : ''}`);
      }
    } catch (err) {
      flash('error', err?.response?.data?.message || 'Lỗi scan');
    } finally {
      refocus();
    }
  };

  const setReason = async (reprint, reasonId) => {
    const { data } = await api.put(`/reprints/${reprint.id}`, { reason_id: reasonId || null });
    setReprints(p => p.map(r => (r.id === reprint.id ? data : r)));
  };
  const del = async (reprint) => {
    if (!confirm(`Xoá reprint ${reprint.system_id}?`)) return;
    await api.delete(`/reprints/${reprint.id}`);
    setReprints(p => p.filter(r => r.id !== reprint.id));
  };

  return (
    <div className="p-6 space-y-4" onClick={refocus}>
      <h2 className="text-xl font-bold text-neutral-800">Reprint</h2>

      {/* Scan box */}
      <form onSubmit={onScan} className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
        <label className="text-xs text-neutral-500 block mb-1">
          Quét barcode (system_id) hoặc QR reason — máy quét tự gõ + Enter
        </label>
        <input
          ref={inputRef}
          value={scan}
          onChange={e => setScan(e.target.value)}
          onBlur={() => setTimeout(refocus, 50)}
          autoFocus
          placeholder="Đưa máy quét vào đây…"
          className="w-full px-3 py-2 bg-[#faf8f6] border border-orange-300 rounded-lg text-base font-mono focus:outline-none focus:ring-2 focus:ring-orange-400"
        />
        <div className="flex items-center gap-3 mt-2 text-sm">
          <span className="text-neutral-500">Reason đang chọn:</span>
          {activeReason
            ? <span className="px-2 py-0.5 rounded bg-orange-100 text-orange-700 font-medium">{activeReason.name} ({activeReason.code})</span>
            : <span className="text-neutral-400">— (chưa chọn)</span>}
          {activeReason && (
            <button type="button" onClick={() => setActiveReason(null)} className="text-xs text-neutral-400 hover:text-red-500">bỏ</button>
          )}
          <select value="" onChange={e => { const r = reasons.find(x => x.id === Number(e.target.value)); if (r) setActiveReason(r); }}
            className="ml-auto px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded-lg text-xs">
            <option value="">+ chọn reason thủ công</option>
            {reasons.map(r => <option key={r.id} value={r.id}>{r.name} ({r.code})</option>)}
          </select>
        </div>
      </form>

      {msg && (
        <div className={`px-3 py-2 rounded-lg text-sm ${msg.type === 'error' ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
          {msg.text}
        </div>
      )}

      {/* Reprint list */}
      <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#faf8f6] text-neutral-500 text-xs">
            <tr>
              <th className="text-left px-3 py-2">System ID</th>
              <th className="text-left px-3 py-2">Reason</th>
              <th className="text-left px-3 py-2">Người tạo</th>
              <th className="text-left px-3 py-2">Lúc</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {reprints.map(r => (
              <tr key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={`border-t border-neutral-100 cursor-pointer ${selectedId === r.id ? 'bg-orange-50' : 'hover:bg-neutral-50'}`}>
                <td className="px-3 py-2 font-mono text-orange-600">{r.system_id}</td>
                <td className="px-3 py-2">
                  <select value={r.reason_id || ''} onClick={e => e.stopPropagation()} onChange={e => setReason(r, e.target.value)}
                    className={`px-2 py-1 rounded text-xs border ${r.reason_id ? 'bg-white border-neutral-200' : 'bg-yellow-50 border-yellow-300 text-yellow-700'}`}>
                    <option value="">— chưa có reason —</option>
                    {reasons.map(rs => <option key={rs.id} value={rs.id}>{rs.name}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2 text-neutral-500">{r.user?.name || '—'}</td>
                <td className="px-3 py-2 text-neutral-400 text-xs">{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={e => { e.stopPropagation(); del(r); }} className="text-xs text-neutral-400 hover:text-red-500">Xoá</button>
                </td>
              </tr>
            ))}
            {reprints.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-neutral-400">Chưa có reprint. Quét system_id để tạo.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
