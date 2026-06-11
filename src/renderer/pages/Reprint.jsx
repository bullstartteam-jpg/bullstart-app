import { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import { buildGangsheetForChunk, flattenQrMetas, getGangPageFormat } from '../services/gangsheetBuilder';

// Reprint scan page. A barcode/QR scanner behaves like a keyboard: it "types"
// the scanned value and presses Enter. We keep one input focused and route by
// prefix — a reason QR encodes "RSN…", anything else is treated as a system_id.
//   - scan a system_id  → create a new reprint (with the active reason if set)
//   - scan a reason QR   → fill the reason into the selected reprint, else the
//                          latest reprint that has no reason, else arm it.
// Multi-select reprints + "Tạo gangsheet" gangs their order designs (reusing the
// gangsheet builder with includeProduced, since reprints are already produced)
// and marks the selected reprints done. Admins see all reprints; others see own.
export default function Reprint() {
  const [reprints, setReprints] = useState([]);
  const [reasons, setReasons] = useState([]);
  const [activeReason, setActiveReason] = useState(null);
  const [selectedId, setSelectedId] = useState(null);   // scan reason-fill target
  const [checked, setChecked] = useState(new Set());    // multi-select for gangsheet
  const [scan, setScan] = useState('');
  const [msg, setMsg] = useState(null);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef(null);

  const refocus = () => inputRef.current?.focus();

  const load = async () => {
    const [rp, rs] = await Promise.all([api.get('/reprints'), api.get('/reasons')]);
    setReprints(rp.data || []);
    setReasons(rs.data || []);
  };
  useEffect(() => { load(); refocus(); }, []);

  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000); };

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
    setChecked(prev => { const n = new Set(prev); n.delete(reprint.id); return n; });
  };

  // ── Multi-select ───────────────────────────────────────────────────
  const toggleCheck = (id) => setChecked(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const allChecked = reprints.length > 0 && reprints.every(r => checked.has(r.id));
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(reprints.map(r => r.id)));

  const dominantLineId = (orders) => {
    const counts = {};
    for (const o of orders) for (const it of o.items || []) {
      const li = it.product_variant?.product?.line_id;
      if (li) counts[li] = (counts[li] || 0) + 1;
    }
    let best = '', max = -1;
    for (const [k, v] of Object.entries(counts)) if (v > max) { max = v; best = k; }
    return best;
  };

  // Build one gangsheet from the selected reprints' order designs, then mark
  // them done. Reuses the gangsheet builder (includeProduced — reprint designs
  // are already produced) → upload to B2 → record via POST /gangsheets.
  const createGangsheet = async () => {
    const chosen = reprints.filter(r => checked.has(r.id));
    if (!chosen.length) return;
    if (!window.electronAPI?.s3Upload) { flash('error', 'Cần mở app desktop (Electron) để upload gangsheet'); return; }

    const systemIds = [...new Set(chosen.map(r => r.system_id))];
    setCreating(true);
    try {
      const { data } = await api.post('/gangsheets/lookup-orders', { system_ids: systemIds });
      const orders = data.orders || [];
      if (!orders.length) { flash('error', 'Không tìm thấy order cho các system_id đã chọn'); return; }
      const designCount = flattenQrMetas(orders, { includeProduced: true }).length;
      if (!designCount) { flash('error', 'Các order này không có design (_qr) để gang'); return; }

      const creds = (await api.get('/gangsheets/storage-credentials')).data;
      const linePrefix = dominantLineId(orders);
      const built = await buildGangsheetForChunk(orders, {
        includeProduced: true,
        linePrefix,
        nameSuffix: 'reprint',
        seq: 1,
        pageFormat: getGangPageFormat(),
      });

      const key = `${creds.folder}/${built.filename}`;
      const bytes = new Uint8Array(await built.blob.arrayBuffer());
      await window.electronAPI.s3Upload({
        credentials: creds, bucket: creds.bucket, key, body: bytes, contentType: 'application/pdf',
      });
      const publicUrl = `${creds.public_url_base}/${key}`;

      await api.post('/gangsheets', {
        filename: built.filename,
        file_url: publicUrl,
        line_id: linePrefix || '',
        page_format: getGangPageFormat(),
        first_system_id: built.firstSid,
        last_system_id: built.lastSid,
        orders_count: built.ordersInChunk,
        metas_count: built.metasUsed,
        order_ids: built.orderIds,
        meta_ids: built.metaIds,
      });

      await api.post('/reprints/mark-gangsheet', { ids: chosen.map(r => r.id) });

      const missing = (data.missing || []).length;
      flash('ok', `Đã tạo gangsheet ${built.filename} (${built.metasUsed} design) · đánh dấu ${chosen.length} reprint`
        + (missing ? ` · ${missing} system_id không có order` : ''));
      setChecked(new Set());
      await load();
    } catch (err) {
      flash('error', err?.response?.data?.message || err?.message || 'Tạo gangsheet thất bại');
    } finally {
      setCreating(false);
    }
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
          <select value="" onClick={e => e.stopPropagation()} onChange={e => { const r = reasons.find(x => x.id === Number(e.target.value)); if (r) setActiveReason(r); }}
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

      {/* Selection toolbar */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-neutral-500">Đã chọn <b className="text-neutral-800">{checked.size}</b></span>
        <button
          onClick={(e) => { e.stopPropagation(); createGangsheet(); }}
          disabled={checked.size === 0 || creating}
          className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm rounded-lg">
          {creating ? 'Đang tạo gangsheet…' : `Tạo gangsheet (${checked.size})`}
        </button>
      </div>

      {/* Reprint list */}
      <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#faf8f6] text-neutral-500 text-xs">
            <tr>
              <th className="px-3 py-2 w-8"><input type="checkbox" checked={allChecked} onChange={toggleAll} onClick={e => e.stopPropagation()} /></th>
              <th className="text-left px-3 py-2">System ID</th>
              <th className="text-left px-3 py-2">Reason</th>
              <th className="text-left px-3 py-2">Gangsheet</th>
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
                <td className="px-3 py-2"><input type="checkbox" checked={checked.has(r.id)} onClick={e => e.stopPropagation()} onChange={() => toggleCheck(r.id)} /></td>
                <td className="px-3 py-2 font-mono text-orange-600">{r.system_id}</td>
                <td className="px-3 py-2">
                  <select value={r.reason_id || ''} onClick={e => e.stopPropagation()} onChange={e => setReason(r, e.target.value)}
                    className={`px-2 py-1 rounded text-xs border ${r.reason_id ? 'bg-white border-neutral-200' : 'bg-yellow-50 border-yellow-300 text-yellow-700'}`}>
                    <option value="">— chưa có reason —</option>
                    {reasons.map(rs => <option key={rs.id} value={rs.id}>{rs.name}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  {r.gangsheet_done
                    ? <span className="px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700">✓ đã làm</span>
                    : <span className="text-neutral-300 text-xs">—</span>}
                </td>
                <td className="px-3 py-2 text-neutral-500">{r.user?.name || '—'}</td>
                <td className="px-3 py-2 text-neutral-400 text-xs">{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={e => { e.stopPropagation(); del(r); }} className="text-xs text-neutral-400 hover:text-red-500">Xoá</button>
                </td>
              </tr>
            ))}
            {reprints.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-neutral-400">Chưa có reprint. Quét system_id để tạo.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
