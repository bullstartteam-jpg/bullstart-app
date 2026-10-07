import { useEffect, useState } from 'react';
import api from '../services/api';
import { notify, askConfirm, askChoice } from '../components/Dialog';
import { buildPushScanLabelPdf } from '../services/pushScanLabelBuilder';

// push_trackings.status
const PT_STATUS = {
  1: { label: 'Pending', cls: 'bg-amber-100 text-amber-700' },
  2: { label: 'Merged', cls: 'bg-blue-100 text-blue-700' },
  3: { label: 'Run', cls: 'bg-emerald-100 text-emerald-700' },
};
// merged_labels.status
const ML_STATUS = {
  1: { label: 'Chưa gửi', cls: 'bg-amber-100 text-amber-700' },
  2: { label: 'Đã gửi', cls: 'bg-emerald-100 text-emerald-700' },
};

// Delivery-tracking status → badge colors (same as Orders).
const TRACKING_COLOR = {
  delivered: 'bg-emerald-100 text-emerald-700',
  in_transit: 'bg-blue-100 text-blue-700',
  out_for_delivery: 'bg-cyan-100 text-cyan-700',
  accepted: 'bg-neutral-100 text-neutral-600',
  pre_shipment: 'bg-neutral-100 text-neutral-500',
  delivery_attempted: 'bg-orange-100 text-orange-700',
  exception: 'bg-red-100 text-red-700',
  unknown: 'bg-neutral-100 text-neutral-500',
};

const Pill = ({ s }) => <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${s?.cls || ''}`}>{s?.label || '?'}</span>;

/**
 * Push scan (staff). Orders sellers pushed for a same-day tracking run. Tick
 * pending orders → their shipping labels are bundled into one merged label
 * PDF (uploaded to B2) and the rows move to "merged". The cron-tracking app
 * flips them to "run" once the order is in transit.
 */
export default function PushScan() {
  const [tab, setTab] = useState('orders'); // 'orders' | 'merged' | 'stale'
  return (
    <div className="p-6">
      <h2 className="text-xl font-bold text-neutral-800 mb-4">Push Scan</h2>
      <div className="flex gap-2 mb-4">
        {[['orders', 'Đơn push scan'], ['merged', 'Merged labels'], ['stale', 'Cần chú ý']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm rounded-lg ${tab === id ? 'bg-orange-500 text-white' : 'bg-white border border-neutral-200 text-neutral-600'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'orders' ? <PushOrders /> : tab === 'merged' ? <MergedLabels /> : <StaleOrders />}
    </div>
  );
}

function PushOrders() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('1');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);
  const [merging, setMerging] = useState(false);
  const [progress, setProgress] = useState(null);

  const fetchRows = () => {
    setLoading(true);
    api.get('/push-scan', { params: { status: status || undefined, search: search || undefined, per_page: 500 } })
      .then(res => setRows(res.data.data || []))
      .catch(err => notify(err.response?.data?.message || 'Load failed', { title: 'Push scan', kind: 'error' }))
      .finally(() => setLoading(false));
  };
  useEffect(() => { setSelected([]); fetchRows(); }, [status]);

  const pending = rows.filter(r => r.status === 1);
  const toggle = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const toggleAll = () => setSelected(s => s.length === pending.length ? [] : pending.map(r => r.id));

  const handleMerge = async () => {
    const picked = rows.filter(r => selected.includes(r.id) && r.status === 1);
    if (picked.length === 0) return;
    if (!window.electronAPI?.s3Upload) { notify('Cần mở từ desktop app để upload PDF lên B2.', { title: 'Push scan', kind: 'error' }); return; }
    if (!await askConfirm(`Gộp shipping label của ${picked.length} đơn thành 1 merged label?`, { title: 'Merge labels', okText: 'Merge' })) return;

    setMerging(true);
    setProgress(null);
    try {
      const name = `push_scan_${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
      const built = await buildPushScanLabelPdf({ rows: picked, name, onProgress: setProgress });
      if (built.included.length === 0) {
        notify(`Không lấy được label nào:\n${built.skipped.join('\n')}`, { title: 'Merge labels', kind: 'error' });
        return;
      }

      const creds = (await api.get('/gangsheets/storage-credentials')).data;
      const key = `${creds.folder}/push-scan/${built.filename}`;
      await window.electronAPI.s3Upload({
        credentials: creds,
        bucket: creds.bucket,
        key,
        body: new Uint8Array(await built.blob.arrayBuffer()),
        contentType: 'application/pdf',
      });
      const labelUrl = `${creds.public_url_base}/${key}`;

      // Only the orders whose label made it into the PDF become "merged".
      const res = await api.post('/push-scan/merge', { push_tracking_ids: built.included, label_url: labelUrl });
      const skippedMsg = built.skipped.length ? `\n\nBỏ qua ${built.skipped.length} đơn (vẫn pending):\n${built.skipped.join('\n')}` : '';
      notify(`${res.data.message} · ${built.pageCount} trang${skippedMsg}`, { title: 'Merge labels', kind: built.skipped.length ? 'info' : 'success' });
      setSelected([]);
      fetchRows();
    } catch (err) {
      notify(err.response?.data?.message || err.message || 'Merge failed', { title: 'Merge labels', kind: 'error' });
    } finally {
      setMerging(false);
      setProgress(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <select value={status} onChange={e => setStatus(e.target.value)} className="px-3 py-2 bg-white border border-neutral-200 rounded-lg text-sm">
          <option value="">Tất cả</option>
          <option value="1">Pending</option>
          <option value="2">Merged</option>
          <option value="3">Run</option>
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && fetchRows()}
          placeholder="System ID / Ref ID / Tracking…" className="px-3 py-2 bg-white border border-neutral-200 rounded-lg text-sm w-64" />
        <button onClick={fetchRows} className="px-3 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Tìm</button>
        <div className="ml-auto flex items-center gap-2">
          {progress && <span className="text-xs text-neutral-500">{progress.done}/{progress.total} {progress.system_id || ''}</span>}
          <button onClick={handleMerge} disabled={merging || selected.length === 0}
            className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg font-medium">
            {merging ? 'Đang gộp…' : `Gộp label (${selected.length})`}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-neutral-200 overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-[#faf8f6] text-left text-xs text-neutral-500">
            <tr>
              <th className="p-2 w-8">
                <input type="checkbox" checked={pending.length > 0 && selected.length === pending.length} onChange={toggleAll} disabled={pending.length === 0} className="accent-orange-500" />
              </th>
              <th className="p-2">System ID</th>
              <th className="p-2">Ref ID</th>
              <th className="p-2">Seller</th>
              <th className="p-2">Tracking</th>
              <th className="p-2">Shipping label</th>
              <th className="p-2 text-right">Fee</th>
              <th className="p-2">Status</th>
              <th className="p-2">Merged</th>
              <th className="p-2">Pushed at</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="10" className="p-6 text-center text-neutral-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan="10" className="p-6 text-center text-neutral-400">Không có đơn nào.</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="border-t border-neutral-100">
                <td className="p-2">
                  {r.status === 1 && <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} className="accent-orange-500" />}
                </td>
                <td className="p-2 font-mono text-xs text-orange-600">{r.order?.system_id}</td>
                <td className="p-2 text-xs">{r.order?.ref_id || '—'}</td>
                <td className="p-2 text-xs">{r.order?.user?.name || '—'}</td>
                <td className="p-2 text-xs">
                  <div className="font-mono">{r.order?.tracking_id || '—'}</div>
                  {r.order?.tracking?.status ? (
                    <span
                      className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${TRACKING_COLOR[r.order.tracking.status] || TRACKING_COLOR.unknown}`}
                      title={[
                        r.order.tracking.status_description,
                        r.order.tracking.last_event_at && `Event: ${new Date(r.order.tracking.last_event_at).toLocaleString()}`,
                        r.order.tracking.checked_at && `Quét lúc: ${new Date(r.order.tracking.checked_at).toLocaleString()}`,
                      ].filter(Boolean).join('\n')}
                    >
                      {r.order.tracking.status.replace(/_/g, ' ')}
                    </span>
                  ) : r.order?.tracking_id ? (
                    <span className="inline-block mt-0.5 text-[10px] text-neutral-400">chưa quét</span>
                  ) : null}
                </td>
                <td className="p-2 text-xs">
                  {r.order?.shipping_label
                    ? <a href={r.order.shipping_label} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Xem</a>
                    : <span className="text-red-500">Không có</span>}
                </td>
                <td className="p-2 text-right tabular-nums">${Number(r.fee).toFixed(2)}</td>
                <td className="p-2"><Pill s={PT_STATUS[r.status]} /></td>
                <td className="p-2 text-xs">
                  {r.merged_label
                    ? <a href={r.merged_label.label_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">#{r.merged_label.id}</a>
                    : '—'}
                </td>
                <td className="p-2 text-xs text-neutral-500">{new Date(r.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MergedLabels() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');

  const fetchRows = () => {
    setLoading(true);
    api.get('/push-scan/merged-labels', { params: { status: status || undefined } })
      .then(res => setRows(res.data.data || []))
      .catch(err => notify(err.response?.data?.message || 'Load failed', { title: 'Merged labels', kind: 'error' }))
      .finally(() => setLoading(false));
  };
  useEffect(fetchRows, [status]);

  const changeStatus = async (row, next) => {
    try {
      const res = await api.put(`/push-scan/merged-labels/${row.id}/status`, { status: next });
      setRows(rs => rs.map(r => r.id === row.id ? { ...r, status: res.data.merged_label.status } : r));
    } catch (err) {
      notify(err.response?.data?.message || 'Update failed', { title: 'Merged labels', kind: 'error' });
    }
  };

  // Undo a merge: its orders go back to pending (can be merged again); orders
  // already run by the tracking cron stay on the label.
  const cancelScan = async (row) => {
    const lines = [
      `Huỷ scan merged label #${row.id}?`,
      `${row.push_trackings_count} đơn sẽ trả về pending (đơn đã run giữ nguyên).`,
      row.status === 2 ? 'Label này đang ở trạng thái "Đã gửi".' : null,
    ].filter(Boolean);
    if (!await askConfirm(lines.join('\n'), { title: 'Huỷ scan', okText: 'Huỷ scan', cancelText: 'Không' })) return;
    try {
      const res = await api.post(`/push-scan/merged-labels/${row.id}/cancel`);
      notify(res.data.message, { title: 'Huỷ scan', kind: 'success' });
      fetchRows();
    } catch (err) {
      notify(err.response?.data?.message || 'Huỷ scan thất bại', { title: 'Huỷ scan', kind: 'error' });
    }
  };

  // Delete the label and drop its orders from push scan (as if never pushed).
  // The operator picks whether the push-scan fee goes back to the seller.
  const deleteLabel = async (row) => {
    const choice = await askChoice(
      [
        `Xoá merged label #${row.id}?`,
        `${row.push_trackings_count} đơn sẽ bị BỎ khỏi push scan (kể cả đơn đã run) — như chưa từng push.`,
        '',
        'Hoàn phí: trừ phí push scan khỏi total đơn; đơn đã trả tiền thì hoàn phần đó về ví seller.',
        'Giữ phí: đơn vẫn giữ phí push scan đã tính.',
      ].join('\n'),
      {
        title: 'Xoá merged label',
        cancelText: 'Không',
        choices: [
          { value: 'keep', label: 'Xoá · giữ phí', className: 'bg-neutral-500 hover:bg-neutral-600' },
          { value: 'refund', label: 'Xoá · hoàn phí', className: 'bg-red-500 hover:bg-red-600' },
        ],
      },
    );
    if (!choice) return;
    try {
      const res = await api.delete(`/push-scan/merged-labels/${row.id}`, { params: { refund: choice === 'refund' ? 1 : 0 } });
      notify(res.data.message, { title: 'Xoá merged label', kind: 'success' });
      fetchRows();
    } catch (err) {
      notify(err.response?.data?.message || 'Xoá thất bại', { title: 'Xoá merged label', kind: 'error' });
    }
  };

  const copyLink = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      notify('Đã copy link merged label', { title: 'Copy', kind: 'success' });
    } catch {
      notify('Copy thất bại', { title: 'Copy', kind: 'error' });
    }
  };

  return (
    <div className="space-y-3">
      <select value={status} onChange={e => setStatus(e.target.value)} className="px-3 py-2 bg-white border border-neutral-200 rounded-lg text-sm">
        <option value="">Tất cả</option>
        <option value="1">Chưa gửi</option>
        <option value="2">Đã gửi</option>
      </select>
      <div className="bg-white rounded-xl border border-neutral-200 overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-[#faf8f6] text-left text-xs text-neutral-500">
            <tr>
              <th className="p-2">#</th>
              <th className="p-2">Label</th>
              <th className="p-2">Đơn</th>
              <th className="p-2">Status</th>
              <th className="p-2">Created</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="6" className="p-6 text-center text-neutral-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan="6" className="p-6 text-center text-neutral-400">Chưa có merged label.</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="border-t border-neutral-100 align-top">
                <td className="p-2 font-mono text-xs">#{r.id}</td>
                <td className="p-2 text-xs">
                  {r.label_url ? (
                    <div className="space-y-1">
                      <div className="font-mono text-neutral-600 max-w-sm break-all select-all">{r.label_url}</div>
                      <div className="flex gap-2">
                        <button onClick={() => copyLink(r.label_url)}
                          className="px-2 py-0.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded">
                          📋 Copy link
                        </button>
                        <a href={r.label_url} target="_blank" rel="noreferrer" className="px-2 py-0.5 text-blue-600 hover:underline">Mở PDF</a>
                      </div>
                    </div>
                  ) : '—'}
                </td>
                <td className="p-2 text-xs">
                  <div className="font-semibold">{r.push_trackings_count} đơn</div>
                  <div className="text-neutral-500 font-mono max-w-md break-words">
                    {(r.push_trackings || []).map(p => p.order?.system_id).filter(Boolean).join(', ')}
                  </div>
                </td>
                <td className="p-2">
                  <select value={r.status} onChange={e => changeStatus(r, Number(e.target.value))}
                    className={`px-2 py-1 rounded text-xs font-semibold border-0 ${ML_STATUS[r.status]?.cls || ''}`}>
                    <option value={1}>Chưa gửi</option>
                    <option value={2}>Đã gửi</option>
                  </select>
                </td>
                <td className="p-2 text-xs text-neutral-500">{new Date(r.created_at).toLocaleString()}</td>
                <td className="p-2 text-right">
                  <button onClick={() => cancelScan(r)}
                    className="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-600 text-xs rounded-lg whitespace-nowrap"
                    title="Trả các đơn của merged label này về pending">
                    Huỷ scan
                  </button>
                  <button onClick={() => deleteLabel(r)}
                    className="ml-1 px-2 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded-lg whitespace-nowrap"
                    title="Xoá label và bỏ các đơn khỏi push scan">
                    Xoá
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// "Cần chú ý": orders created > 1.5 days ago but still stuck at pre_shipment /
// accepted — the label exists yet USPS hasn't really moved the package. Staff
// can (re)push scan them straight from here.
function StaleOrders() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);
  const [pushing, setPushing] = useState(false);

  const fetchRows = () => {
    setLoading(true);
    api.get('/push-scan/stale', { params: { search: search || undefined, per_page: 500 } })
      .then(res => setRows(res.data.data || []))
      .catch(err => notify(err.response?.data?.message || 'Load failed', { title: 'Cần chú ý', kind: 'error' }))
      .finally(() => setLoading(false));
  };
  useEffect(() => { setSelected([]); fetchRows(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Only orders not already queued in push_trackings can be (re)pushed.
  const selectable = rows.filter(r => !r.already_pushed);
  const toggle = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const toggleAll = () => setSelected(s => s.length === selectable.length ? [] : selectable.map(r => r.id));

  const ageDays = (iso) => iso ? ((Date.now() - new Date(iso).getTime()) / 86400000).toFixed(1) : '?';

  const handlePush = async () => {
    const ids = selected.filter(id => selectable.some(r => r.id === id));
    if (ids.length === 0) return;
    const mode = await askChoice(
      [`Push scan ${ids.length} đơn để run tracking ngay?`, '', 'Tính phí: cộng phí push scan vào đơn.', 'Free: push scan không thu phí.'].join('\n'),
      {
        title: 'Push scan — tính phí hay free?',
        cancelText: 'Huỷ',
        choices: [
          { value: 'charge', label: 'Tính phí', className: 'bg-orange-500 hover:bg-orange-600' },
          { value: 'free', label: 'Free', className: 'bg-neutral-500 hover:bg-neutral-600' },
        ],
      },
    );
    if (!mode) return;
    setPushing(true);
    try {
      const res = await api.post('/orders/push-scan', { order_ids: ids, free: mode === 'free' });
      const failed = (res.data.results || []).filter(r => !r.ok).map(r => r.message);
      notify([res.data.message, ...failed].join('\n'), { title: 'Push scan', kind: failed.length ? 'info' : 'success' });
      setSelected([]);
      fetchRows();
    } catch (err) {
      notify(err.response?.data?.message || 'Push scan failed', { title: 'Push scan', kind: 'error' });
    } finally {
      setPushing(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && fetchRows()}
          placeholder="System ID / Ref ID / Tracking…" className="px-3 py-2 bg-white border border-neutral-200 rounded-lg text-sm w-64" />
        <button onClick={fetchRows} className="px-3 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Tìm</button>
        <span className="text-xs text-neutral-500">Quá 1.5 ngày còn pre-shipment / accepted · {rows.length} đơn</span>
        <div className="ml-auto">
          <button onClick={handlePush} disabled={pushing || selected.length === 0}
            className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg font-medium">
            {pushing ? 'Đang push…' : `Push scan (${selected.length})`}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-neutral-200 overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-[#faf8f6] text-left text-xs text-neutral-500">
            <tr>
              <th className="p-2 w-8">
                <input type="checkbox" checked={selectable.length > 0 && selected.length === selectable.length} onChange={toggleAll} disabled={selectable.length === 0} className="accent-orange-500" />
              </th>
              <th className="p-2">System ID</th>
              <th className="p-2">Ref ID</th>
              <th className="p-2">Seller</th>
              <th className="p-2">Tracking</th>
              <th className="p-2">Shipping label</th>
              <th className="p-2 text-right">Tuổi (ngày)</th>
              <th className="p-2">Tạo lúc</th>
              <th className="p-2">Push scan</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="9" className="p-6 text-center text-neutral-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan="9" className="p-6 text-center text-neutral-400">Không có đơn nào quá hạn.</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="border-t border-neutral-100">
                <td className="p-2">
                  {!r.already_pushed && <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} className="accent-orange-500" />}
                </td>
                <td className="p-2 font-mono text-xs text-orange-600">{r.system_id}</td>
                <td className="p-2 text-xs">{r.ref_id || '—'}</td>
                <td className="p-2 text-xs">{r.user?.name || '—'}</td>
                <td className="p-2 text-xs">
                  <div className="font-mono">{r.tracking_id || '—'}</div>
                  {r.tracking?.status && (
                    <span
                      className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${TRACKING_COLOR[r.tracking.status] || TRACKING_COLOR.unknown}`}
                      title={[
                        r.tracking.status_description,
                        r.tracking.last_event_at && `Event: ${new Date(r.tracking.last_event_at).toLocaleString()}`,
                        r.tracking.checked_at && `Quét lúc: ${new Date(r.tracking.checked_at).toLocaleString()}`,
                      ].filter(Boolean).join('\n')}
                    >
                      {r.tracking.status.replace(/_/g, ' ')}
                    </span>
                  )}
                </td>
                <td className="p-2 text-xs">
                  {r.shipping_label
                    ? <a href={r.shipping_label} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Xem</a>
                    : <span className="text-red-500">Không có</span>}
                </td>
                <td className="p-2 text-right tabular-nums font-semibold text-orange-600">{ageDays(r.created_at)}</td>
                <td className="p-2 text-xs text-neutral-500">{new Date(r.created_at).toLocaleString()}</td>
                <td className="p-2 text-xs">
                  {r.already_pushed
                    ? <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-700">Đã push</span>
                    : <span className="text-neutral-400">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
