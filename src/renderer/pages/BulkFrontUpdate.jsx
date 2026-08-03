import { useState, useEffect } from 'react';
import api from '../services/api';
import { notify, askConfirm } from '../components/Dialog';
import { UrlPreview, PreviewModal } from '../components/Preview';

// Bulk-swap the `front` design of every order in one status, choosing the new
// artwork by the item's chip add-on (small chip and big chip get different
// files). Built for the recurring "on-hold orders need the new design" job.
//
// Always preview first: the table below IS the list the server would write, so
// nothing is guessed on this side — the classification, the URL check and the
// row set all come back from POST /orders/bulk-update-front with dry_run.

const STATUS_OPTIONS = [
  [5, 'On-hold'],
  [0, 'New order'],
  [1, 'Producing'],
  [2, 'Wrong size'],
  [3, 'Fixed'],
  [4, 'Reprint'],
];

// Chips the server can map. Holo is listed so a URL can be given for it too,
// even though today's on-hold queue only has big/small.
const CHIPS = [
  { key: 'smallchip', label: 'Small chip', hint: 'style/code chứa "small" hoặc SMC' },
  { key: 'bigchip', label: 'Big chip', hint: 'style/code chứa "big" hoặc BC' },
  { key: 'holo', label: 'Holo', hint: 'style/code chứa "holo" hoặc HLG' },
];

export default function BulkFrontUpdate() {
  const [status, setStatus] = useState(5);
  const [userId, setUserId] = useState('');       // '' = mọi seller
  const [users, setUsers] = useState([]);
  const [urls, setUrls] = useState({ smallchip: '', bigchip: '', holo: '' });
  const [reconvert, setReconvert] = useState(true);
  const [preview, setPreview] = useState(null);   // dry-run response
  const [picked, setPicked] = useState(new Set()); // item_id đã tick
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    api.get('/users', { params: { per_page: 100 } })
      .then(res => setUsers(res.data.data || []))
      .catch(() => {});
  }, []);

  const mapping = () => Object.fromEntries(
    Object.entries(urls).filter(([, v]) => v.trim() !== ''),
  );

  const runPreview = async () => {
    const m = mapping();
    if (Object.keys(m).length === 0) {
      notify('Nhập ít nhất một link cho một loại chip.', { title: 'Thiếu link', kind: 'error' });
      return;
    }
    setLoading(true);
    setPreview(null);
    try {
      const res = await api.post('/orders/bulk-update-front', {
        status, user_id: userId || null, mapping: m, dry_run: true,
      });
      setPreview(res.data);
      // Mặc định tick những dòng thực sự đổi.
      setPicked(new Set((res.data.rows || []).filter(r => r.changed).map(r => r.item_id)));
    } catch (err) {
      notify(err.response?.data?.message || 'Xem trước thất bại', { title: 'Lỗi', kind: 'error' });
    } finally { setLoading(false); }
  };

  const badUrls = Object.entries(preview?.url_check || {}).filter(([, c]) => !c.ok);

  const apply = async () => {
    const rows = (preview?.rows || []).filter(r => picked.has(r.item_id));
    if (rows.length === 0) return;
    if (badUrls.length > 0) {
      notify('Còn link không tải được — sửa quyền chia sẻ trước khi áp dụng.', { title: 'Link lỗi', kind: 'error' });
      return;
    }
    const orderIds = [...new Set(rows.map(r => r.order_id))];
    const qr = rows.reduce((n, r) => n + r.qr_count, 0);
    const ok = await askConfirm(
      `Đổi front cho ${rows.length} item thuộc ${orderIds.length} đơn?`
      + (reconvert ? `\nSẽ xoá ${qr} meta _qr và đưa các đơn về hàng đợi convert.` : '\nGiữ nguyên _qr — bản in sẽ KHÔNG đổi.'),
      { title: 'Xác nhận đổi front', okText: 'Áp dụng' },
    );
    if (!ok) return;

    setApplying(true);
    try {
      const res = await api.post('/orders/bulk-update-front', {
        status, user_id: userId || null, mapping: mapping(), order_ids: orderIds, reconvert, dry_run: false,
      });
      notify(res.data.message, { title: 'Đã áp dụng', kind: 'success' });
      await runPreview();   // tải lại để thấy trạng thái sau khi ghi
    } catch (err) {
      notify(err.response?.data?.message || 'Áp dụng thất bại', { title: 'Lỗi', kind: 'error' });
    } finally { setApplying(false); }
  };

  const rows = preview?.rows || [];
  const toggle = (id) => setPicked(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleAll = () => setPicked(prev =>
    prev.size === rows.length ? new Set() : new Set(rows.map(r => r.item_id)));

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-xl font-bold text-neutral-800">Update Front hàng loạt</h2>
        <p className="text-xs text-neutral-500 mt-1">
          Đổi link thiết kế <span className="font-mono">front</span> của các đơn theo trạng thái, chọn file theo loại chip của item.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="text-xs text-neutral-500 block">Trạng thái đơn</label>
            <select
              value={status}
              onChange={e => { setStatus(Number(e.target.value)); setPreview(null); }}
              className="mt-1 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm"
            >
              {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-neutral-500 block">Seller</label>
            <select
              value={userId}
              onChange={e => { setUserId(e.target.value); setPreview(null); }}
              className="mt-1 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm max-w-[220px]"
            >
              <option value="">Tất cả seller</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
            </select>
          </div>
          <button
            onClick={runPreview}
            disabled={loading}
            className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg font-medium"
          >
            {loading ? 'Đang quét…' : 'Xem trước'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {CHIPS.map(c => (
            <div key={c.key}>
              <label className="text-xs text-neutral-500 block">{c.label}</label>
              <input
                type="text"
                value={urls[c.key]}
                onChange={e => { setUrls(u => ({ ...u, [c.key]: e.target.value })); setPreview(null); }}
                placeholder="Link Drive hoặc URL ảnh — để trống là bỏ qua"
                className="w-full mt-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm"
              />
              <div className="flex items-center justify-between mt-1">
                <span className="text-[11px] text-neutral-400">{c.hint}</span>
                <UrlPreview url={urls[c.key]} onOpen={setPreviewUrl} label={`Xem ${c.label}`} size="sm" />
              </div>
            </div>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer select-none">
          <input type="checkbox" checked={reconvert} onChange={e => setReconvert(e.target.checked)} className="accent-orange-500" />
          Xoá <span className="font-mono text-xs">_qr</span> để convert lại
          <span className="text-xs text-neutral-400">— tắt thì bản in vẫn là thiết kế cũ</span>
        </label>
      </div>

      {preview && (
        <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm space-y-3">
          <div className="flex flex-wrap gap-4 items-center text-sm">
            <span>Khớp <b>{preview.summary.matched_items}</b> item</span>
            <span>Sẽ đổi <b className="text-orange-600">{preview.summary.will_change}</b></span>
            {Object.entries(preview.summary.by_chip || {}).map(([k, v]) => (
              <span key={k} className="text-neutral-600">{k}: <b>{v}</b></span>
            ))}
            <span className="text-neutral-600">meta <span className="font-mono text-xs">_qr</span> sẽ xoá: <b>{preview.summary.qr_to_delete}</b></span>
            {preview.summary.skipped > 0 && <span className="text-red-500">bỏ qua {preview.summary.skipped}</span>}
          </div>

          {/* Phân bổ theo seller — thấy ngay đơn đang dồn ở ai. */}
          {Object.keys(preview.summary.by_user || {}).length > 1 && (
            <div className="flex flex-wrap gap-2 text-xs text-neutral-600">
              {Object.entries(preview.summary.by_user).map(([name, n]) => (
                <span key={name} className="px-2 py-0.5 bg-neutral-100 rounded">{name}: <b>{n}</b></span>
              ))}
            </div>
          )}

          {/* Kiểm tra link: Drive chưa mở quyền sẽ trả HTML trang đăng nhập,
              ghi vào DB là hỏng convert hàng loạt nên chặn ngay ở đây. */}
          <div className="space-y-1">
            {Object.entries(preview.url_check || {}).map(([u, c]) => (
              <div key={u} className={`text-xs rounded px-2 py-1 ${c.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                {c.ok ? '✓' : '✕'} <span className="font-mono break-all">{u}</span>
                {' — '}{c.ok ? `${c.content_type}, ${Math.round((c.bytes || 0) / 1024)} KB` : c.reason}
              </div>
            ))}
          </div>

          {rows.length > 0 && (
            <>
              <div className="flex justify-between items-center">
                <span className="text-xs text-neutral-500">Đã chọn {picked.size}/{rows.length}</span>
                <button
                  onClick={apply}
                  disabled={applying || picked.size === 0 || badUrls.length > 0}
                  className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm rounded-lg font-medium"
                >
                  {applying ? 'Đang ghi…' : `Áp dụng (${picked.size})`}
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-neutral-500 text-xs border-b border-neutral-200">
                      <th className="py-2 text-left w-8">
                        <input type="checkbox" onChange={toggleAll}
                          checked={rows.length > 0 && picked.size === rows.length}
                          className="accent-orange-500" />
                      </th>
                      <th className="py-2 text-left">System ID</th>
                      <th className="py-2 text-left">Seller</th>
                      <th className="py-2 text-left">Item</th>
                      <th className="py-2 text-left">Chip</th>
                      <th className="py-2 text-left">Front hiện tại</th>
                      <th className="py-2 text-left">Front mới</th>
                      <th className="py-2 text-center">_qr</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.item_id} className="border-b border-neutral-100 hover:bg-orange-50/40">
                        <td className="py-1.5">
                          <input type="checkbox" checked={picked.has(r.item_id)} onChange={() => toggle(r.item_id)} className="accent-orange-500" />
                        </td>
                        <td className="py-1.5 font-mono text-orange-500 text-xs">{r.system_id}</td>
                        <td className="py-1.5 text-xs text-neutral-600">{r.user_name || `#${r.user_id}`}</td>
                        <td className="py-1.5 text-xs text-neutral-500">#{r.item_id}</td>
                        <td className="py-1.5 text-xs">{r.chip}</td>
                        <td className="py-1.5 text-xs text-neutral-500">
                          <UrlPreview url={r.front_old} onOpen={setPreviewUrl} label="Front cũ" size="sm" />
                        </td>
                        <td className="py-1.5 text-xs">
                          {r.changed
                            ? <UrlPreview url={r.front_new} onOpen={setPreviewUrl} label="Front mới" size="sm" />
                            : <span className="text-neutral-400">không đổi</span>}
                        </td>
                        <td className="py-1.5 text-center text-xs">
                          {r.qr_count === 0
                            ? <span className="text-neutral-300">—</span>
                            : <span className={r.qr_in_gang > 0 ? 'text-red-500' : 'text-neutral-600'}>
                                {r.qr_count}{r.qr_in_gang > 0 ? ` (${r.qr_in_gang} đã vào gang)` : ''}
                              </span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {preview.skipped?.length > 0 && (
            <details className="text-xs text-neutral-500">
              <summary className="cursor-pointer">Bỏ qua {preview.skipped.length} item</summary>
              <ul className="mt-1 space-y-0.5">
                {preview.skipped.map((s, i) => (
                  <li key={i} className="font-mono">{s.system_id} · item #{s.item_id} — {s.reason}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <PreviewModal url={previewUrl} onClose={() => setPreviewUrl(null)} />
    </div>
  );
}
