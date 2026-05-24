import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import api from '../services/api';
import { getApiUrl } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { buildMergedLabelPdf } from '../services/mergedLabelBuilder';

// Admin/support-only list of gangsheet labels. Each row links out to the
// public scan page (/gs/{code}) hosted by hubbullstart so warehouse staff
// can scan the barcode and bulk-complete from a tablet/laptop.

export default function GangsheetLabel() {
  const { hasRole } = useAuth();
  const [data, setData] = useState({ data: [], current_page: 1, last_page: 1 });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', line_id: '', date_from: '', date_to: '', page: 1, per_page: 20 });
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [merging, setMerging] = useState(false);
  const [mergeProgress, setMergeProgress] = useState(null);   // {done, total, system_id}
  const [mergeResult, setMergeResult] = useState(null);       // last merged label info
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const params = { page: filters.page, per_page: filters.per_page };
      if (filters.status) params.status = filters.status;
      if (filters.line_id) params.line_id = filters.line_id;
      if (filters.date_from) params.date_from = filters.date_from;
      if (filters.date_to) params.date_to = filters.date_to;
      const res = await api.get('/gangsheet-labels', { params });
      setData(res.data);
    } finally { setLoading(false); }
  };
  useEffect(() => { fetch(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filters.page]);

  const openDetail = async (label) => {
    setOpenId(label.id);
    setDetail(null);
    setDetailError(null);
    try {
      const res = await api.get(`/gangsheet-labels/${label.id}`);
      setDetail(res.data);
    } catch (err) {
      const status = err.response?.status ? ` [HTTP ${err.response.status}]` : '';
      const msg = err.response?.data?.message || err.message || 'Unknown error';
      setDetailError(`${msg}${status}`);
      console.error('[gangsheet-label] detail load failed', err);
    }
  };

  const completeAll = async (id) => {
    if (!confirm('Mark every order in this gangsheet label as SHIPPED?')) return;
    const res = await api.post(`/gangsheet-labels/${id}/complete-all`);
    alert(res.data.message);
    fetch();
    if (openId === id) openDetail({ id });
  };

  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleSelectAll = () => {
    if (selectedIds.size === data.data.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(data.data.map(l => l.id)));
  };

  /**
   * Bulk delete selected labels. Orders/metas keep production=true so
   * we don't re-gang the same prints — same semantics as single delete.
   */
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} gangsheet label(s)?\n(Orders/metas remain marked as production.)`)) return;
    setBulkDeleting(true);
    try {
      const res = await api.post('/gangsheet-labels/bulk-delete', { label_ids: [...selectedIds] });
      alert(res.data.message || `Deleted ${selectedIds.size}`);
      setSelectedIds(new Set());
      fetch();
    } catch (err) {
      alert(err?.response?.data?.message || 'Bulk delete failed');
    } finally {
      setBulkDeleting(false);
    }
  };

  /**
   * Merge selected labels: backend creates a master GSL row, then renderer
   * fetches each member order's convert_label, builds the merged PDF
   * (page-per-label + final QR), uploads to B2, and saves file_url back.
   */
  const handleMerge = async () => {
    if (selectedIds.size === 0) {
      alert('Chọn tối thiểu 1 gangsheet label để merge.');
      return;
    }
    const action = selectedIds.size === 1 ? 'Build PDF cho' : 'Merge';
    if (!confirm(`${action} ${selectedIds.size} label(s) → 1 PDF master?`)) return;
    if (!window.electronAPI?.s3Upload) {
      alert('Cần mở từ desktop app để upload PDF lên B2.');
      return;
    }

    setMerging(true);
    setMergeProgress(null);
    setMergeResult(null);

    try {
      // 1) Backend create merged master + return scan_code + order_ids
      const mergeRes = await api.post('/gangsheet-labels/merge', {
        label_ids: [...selectedIds],
      });
      const merged = mergeRes.data.merged_label;
      const scanCode = mergeRes.data.scan_code;
      const orderIds = mergeRes.data.order_ids;
      const scanUrl = `${scanBase}/gs/${scanCode}`;

      // 2) Fetch order details (convert_label URLs) preserving order_ids sequence
      const ordersRes = await api.post('/gangsheets/lookup-orders', {
        system_ids: [], // we'll filter by id below
      }).catch(() => null);
      // Lookup endpoint expects system_ids; easier to use the show endpoint
      // for the merged label which already returns orders with convert_label.
      const showRes = await api.get(`/gangsheet-labels/${merged.id}`);
      const orders = (showRes.data.orders || []).filter(o => orderIds.includes(o.id));
      if (orders.length === 0) throw new Error('Backend returned 0 orders for merged label');

      // 3) Build PDF
      const built = await buildMergedLabelPdf({
        orders,
        scanUrl,
        name: merged.name,
        onProgress: (p) => setMergeProgress(p),
      });

      // 4) Upload to B2 (reuse gangsheet credentials endpoint)
      const credsRes = await api.get('/gangsheets/storage-credentials');
      const creds = credsRes.data;
      const key = `${creds.folder}/labels/${built.filename}`;
      const bytes = new Uint8Array(await built.blob.arrayBuffer());
      await window.electronAPI.s3Upload({
        credentials: creds,
        bucket: creds.bucket,
        key,
        body: bytes,
        contentType: 'application/pdf',
      });
      const publicUrl = `${creds.public_url_base}/${key}`;

      // 5) Save file_url back to merged label
      await api.put(`/gangsheet-labels/${merged.id}/file-url`, { file_url: publicUrl });

      setMergeResult({
        id: merged.id,
        scanCode,
        scanUrl,
        fileUrl: publicUrl,
        orderCount: orders.length,
        pageCount: built.pageCount,
        skipped: built.skipped,
      });
      setSelectedIds(new Set());
      fetch();
    } catch (err) {
      const detail = err?.response?.data?.message || err?.message || 'Merge failed';
      const status = err?.response?.status ? ` [HTTP ${err.response.status}]` : '';
      console.error('[merge] error', err);
      alert(`Merge failed${status}:\n${detail}`);
    } finally {
      setMerging(false);
      setMergeProgress(null);
    }
  };

  if (!hasRole('admin') && !hasRole('support')) {
    return (
      <div className="p-6">
        <h2 className="text-xl font-bold text-neutral-800 mb-2">Gangsheet Label</h2>
        <p className="text-sm text-neutral-500">Admin or Support access required.</p>
      </div>
    );
  }

  const scanBase = getApiUrl().replace(/\/api\/?$/, '');

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-xl font-bold text-neutral-800">Gangsheet Label</h2>
          <p className="text-xs text-neutral-500 mt-1">
            Auto-created when a <Link to="/gangsheet" className="text-orange-600 hover:underline">_qr gangsheet</Link> is generated. Scan the GSL barcode at the QC station to bulk-complete all orders in the group.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleMerge}
            disabled={merging || selectedIds.size === 0}
            title="Tạo 1 PDF master gồm convert_label của mọi đơn trong các label đã chọn + QR ở trang cuối"
            className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm rounded-lg"
          >
            {merging ? 'Merging…' : `⤵ Merge selected (${selectedIds.size})`}
          </button>
          <button
            onClick={handleBulkDelete}
            disabled={bulkDeleting || selectedIds.size === 0}
            title="Xoá nhiều gangsheet label đã chọn"
            className="px-3 py-1.5 bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white text-sm rounded-lg"
          >
            {bulkDeleting ? 'Deleting…' : `🗑 Delete selected (${selectedIds.size})`}
          </button>
          <button onClick={fetch} className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-sm rounded-lg">Refresh</button>
        </div>
      </div>

      {/* Merge progress + result */}
      {mergeProgress && (
        <div className="bg-white rounded-xl border border-orange-200 p-3 shadow-sm text-sm">
          <div className="font-medium text-orange-700 mb-1">Building merged PDF…</div>
          <div className="text-xs text-neutral-600">
            Page {mergeProgress.done}/{mergeProgress.total}
            {mergeProgress.system_id && <> · <span className="font-mono text-orange-600">{mergeProgress.system_id}</span></>}
          </div>
          <div className="mt-2 h-1.5 bg-neutral-100 rounded overflow-hidden">
            <div className="h-full bg-orange-500 transition-all" style={{ width: mergeProgress.total ? `${(mergeProgress.done / mergeProgress.total) * 100}%` : '0%' }} />
          </div>
        </div>
      )}
      {mergeResult && (
        <div className="bg-white rounded-xl border border-green-200 p-4 shadow-sm text-sm">
          <div className="font-semibold text-green-700 mb-1">
            ✓ Merged label GSL{mergeResult.id} created — {mergeResult.orderCount} order(s), {mergeResult.pageCount} page(s)
          </div>
          <div className="text-xs text-neutral-600 space-y-1">
            <div>
              <span className="text-neutral-500">PDF:</span>{' '}
              <a href={mergeResult.fileUrl} target="_blank" rel="noreferrer" className="text-orange-600 hover:underline break-all">{mergeResult.fileUrl}</a>
            </div>
            <div>
              <span className="text-neutral-500">Scan URL:</span>{' '}
              <a href={mergeResult.scanUrl} target="_blank" rel="noreferrer" className="text-orange-600 hover:underline break-all">{mergeResult.scanUrl}</a>
            </div>
            {mergeResult.skipped.length > 0 && (
              <div className="text-yellow-700">
                Skipped {mergeResult.skipped.length} order(s) (no convert_label): {mergeResult.skipped.slice(0, 5).join(', ')}{mergeResult.skipped.length > 5 ? '…' : ''}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-end bg-white p-3 rounded-xl border border-neutral-200">
        <Field label="Status">
          <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value, page: 1 }))} className="px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded text-sm">
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
          </select>
        </Field>
        <Field label="Line ID">
          <input value={filters.line_id} onChange={e => setFilters(f => ({ ...f, line_id: e.target.value, page: 1 }))} className="px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded text-sm w-24" />
        </Field>
        <Field label="From">
          <input type="date" value={filters.date_from} onChange={e => setFilters(f => ({ ...f, date_from: e.target.value, page: 1 }))} className="px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded text-sm" />
        </Field>
        <Field label="To">
          <input type="date" value={filters.date_to} onChange={e => setFilters(f => ({ ...f, date_to: e.target.value, page: 1 }))} className="px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded text-sm" />
        </Field>
        <button onClick={fetch} className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg">Apply</button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-neutral-500 bg-[#faf8f6]">
            <tr>
              <th className="text-center px-3 py-2 w-8">
                <input
                  type="checkbox"
                  onChange={toggleSelectAll}
                  checked={data.data.length > 0 && selectedIds.size === data.data.length}
                  className="accent-orange-500"
                  title="Select all on this page"
                />
              </th>
              <th className="text-left px-3 py-2">Scan code</th>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Line</th>
              <th className="text-right px-3 py-2">Orders</th>
              <th className="text-right px-3 py-2">Items × qty</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Created</th>
              <th className="text-right px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {loading ? (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-neutral-400">Loading…</td></tr>
            ) : data.data.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-neutral-400">No gangsheet labels yet.</td></tr>
            ) : data.data.map(l => {
              const isSel = selectedIds.has(l.id);
              const isMerged = Array.isArray(l.merged_from_label_ids) && l.merged_from_label_ids.length > 0;
              return (
              <tr key={l.id} className={`hover:bg-orange-50/30 cursor-pointer ${isSel ? 'bg-orange-50/60' : ''}`} onClick={() => openDetail(l)}>
                <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => toggleSelect(l.id)}
                    className="accent-orange-500"
                  />
                </td>
                <td className="px-3 py-2 font-mono text-orange-600 font-semibold">
                  GSL{l.id}
                  {isMerged && <span className="ml-1 text-[9px] uppercase tracking-wide px-1 py-0.5 bg-purple-100 text-purple-700 rounded">merged</span>}
                </td>
                <td className="px-3 py-2 text-neutral-700 text-xs">{l.name}</td>
                <td className="px-3 py-2 text-neutral-600 text-xs">{l.line_id || '-'}</td>
                <td className="px-3 py-2 text-right">{l.orders_count}</td>
                <td className="px-3 py-2 text-right font-semibold text-orange-600">{l.total_items_qty}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${l.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{l.status}</span>
                </td>
                <td className="px-3 py-2 text-neutral-500 text-xs">{new Date(l.created_at).toLocaleString()}</td>
                <td className="px-3 py-2 text-right" onClick={e => e.stopPropagation()}>
                  <div className="flex gap-2 justify-end">
                    {l.file_url && (
                      <a href={l.file_url} target="_blank" rel="noreferrer" className="text-xs text-orange-600 hover:text-orange-700">PDF</a>
                    )}
                    {l.status !== 'completed' && (
                      <button onClick={() => completeAll(l.id)} className="px-2 py-1 bg-green-500 hover:bg-green-600 text-white text-xs rounded">Complete all</button>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>

        {/* Pagination */}
        {data.last_page > 1 && (
          <div className="flex justify-between items-center px-4 py-3 bg-[#faf8f6] text-xs border-t border-neutral-200">
            <span className="text-neutral-500">Page {data.current_page} / {data.last_page}</span>
            <div className="flex gap-1">
              <button disabled={data.current_page <= 1} onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))} className="px-2 py-1 bg-white border border-neutral-200 rounded disabled:opacity-50">Prev</button>
              <button disabled={data.current_page >= data.last_page} onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))} className="px-2 py-1 bg-white border border-neutral-200 rounded disabled:opacity-50">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {openId && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setOpenId(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-neutral-200 flex justify-between items-center sticky top-0 bg-white">
              <h3 className="font-bold text-neutral-800">Gangsheet Label <span className="font-mono text-orange-600">GSL{openId}</span></h3>
              <button onClick={() => setOpenId(null)} className="text-neutral-400 hover:text-neutral-700">×</button>
            </div>
            <div className="p-5">
              {detailError ? (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                  <div className="font-semibold mb-1">Không load được detail</div>
                  <div className="text-xs">{detailError}</div>
                  <div className="text-xs text-neutral-500 mt-2">Mở DevTools (Ctrl+Shift+I) tab Network để xem response thật.</div>
                </div>
              ) : !detail ? (
                <p className="text-neutral-400 text-sm">Loading…</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="bg-[#faf8f6] rounded-lg p-3">
                      <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">Scan to open</div>
                      <div className="flex items-center gap-3">
                        <div className="bg-white p-2 rounded border border-neutral-200"><QRCodeSVG value={`${scanBase}/gs/${detail.scan_code}`} size={96} level="M" /></div>
                        <div className="text-xs">
                          <div className="font-mono text-orange-600 font-semibold">{detail.scan_code}</div>
                          <a href={`${scanBase}/gs/${detail.scan_code}`} target="_blank" rel="noreferrer" className="text-orange-500 break-all">{scanBase}/gs/{detail.scan_code}</a>
                        </div>
                      </div>
                    </div>
                    <div className="bg-orange-50 rounded-lg p-3 text-center flex flex-col justify-center">
                      <div className="text-xs text-orange-700 uppercase tracking-wider">Total items × qty</div>
                      <div className="text-5xl font-extrabold text-orange-600 leading-none mt-1">{detail.total_items_qty}</div>
                      <div className="text-xs text-neutral-500 mt-2">{detail.orders.length} order(s)</div>
                    </div>
                  </div>
                  <table className="w-full text-xs">
                    <thead className="text-neutral-500 bg-[#faf8f6]">
                      <tr>
                        <th className="text-left px-2 py-1.5">System ID</th>
                        <th className="text-left px-2 py-1.5">Ref</th>
                        <th className="text-right px-2 py-1.5">Qty</th>
                        <th className="text-left px-2 py-1.5">Status</th>
                        <th className="text-left px-2 py-1.5">Tracking</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {detail.orders.map(o => {
                        const qty = (o.items || []).reduce((s, it) => s + (it.quantity || 0), 0);
                        return (
                          <tr key={o.id}>
                            <td className="px-2 py-1.5 font-mono text-orange-600">{o.system_id}</td>
                            <td className="px-2 py-1.5 text-neutral-500">{o.ref_id || '-'}</td>
                            <td className="px-2 py-1.5 text-right font-semibold">{qty}</td>
                            <td className="px-2 py-1.5">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] ${o.status === 6 ? 'bg-green-100 text-green-700' : 'bg-neutral-100 text-neutral-600'}`}>
                                {o.status === 6 ? 'shipped' : `status ${o.status}`}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 font-mono text-neutral-500">{o.tracking_id || '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider block mb-1">{label}</label>
      {children}
    </div>
  );
}
