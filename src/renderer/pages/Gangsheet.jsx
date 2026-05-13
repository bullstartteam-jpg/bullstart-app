import { useEffect, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { buildGangsheetForChunk, chunkArray, flattenQrMetas, isQrKey, splitOrdersBySideCount } from '../services/gangsheetBuilder';

export default function Gangsheet() {
  const { hasRole } = useAuth();
  const [tab, setTab] = useState('compose');

  if (!hasRole('admin') && !hasRole('support')) {
    return (
      <div className="p-6">
        <h2 className="text-xl font-bold text-neutral-800 mb-2">Gangsheet</h2>
        <p className="text-sm text-neutral-500">Admin or Support access required.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-xl font-bold text-neutral-800">Gangsheet</h2>
          <p className="text-xs text-neutral-500 mt-1">Compose order item _qr designs into 8.5×11" PDF gang sheets, save to Backblaze.</p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-neutral-200">
        <TabBtn active={tab === 'compose'} onClick={() => setTab('compose')}>Compose</TabBtn>
        <TabBtn active={tab === 'find'} onClick={() => setTab('find')}>Find / Re-gang</TabBtn>
        <TabBtn active={tab === 'manage'} onClick={() => setTab('manage')}>Manage</TabBtn>
      </div>

      {tab === 'compose' && <ComposeTab />}
      {tab === 'find' && <FindTab />}
      {tab === 'manage' && <ManageTab isAdmin={hasRole('admin')} />}
    </div>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active ? 'border-orange-500 text-orange-600' : 'border-transparent text-neutral-500 hover:text-neutral-700'
      }`}
    >{children}</button>
  );
}

function ComposeTab() {
  const [pending, setPending] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [batchSize, setBatchSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState([]);

  const fetchPending = async () => {
    setLoading(true);
    try {
      const res = await api.get('/gangsheets/pending-orders', { params: { per_page: 200 } });
      setPending(res.data.data || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { fetchPending(); }, []);

  const toggle = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => {
    if (selectedIds.size === pending.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(pending.map(o => o.id)));
  };

  const countQrMetas = (order) => {
    let n = 0;
    for (const it of order.items || []) for (const m of it.metas || [])
      if (isQrKey(m.key) && !m.production) n++;
    return n;
  };

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

  const handleGenerate = async () => {
    const selected = pending.filter(o => selectedIds.has(o.id));
    if (selected.length === 0) { alert('Select at least 1 order'); return; }
    // Split two-sided orders out so they get their own gangsheet (named with
    // `_two_size` suffix). One-side orders ship in the normal sheets.
    const { oneSide, twoSide } = splitOrdersBySideCount(selected);
    const chunks = [
      ...chunkArray(oneSide, batchSize).map(chunk => ({ chunk, suffix: '' })),
      ...chunkArray(twoSide, batchSize).map(chunk => ({ chunk, suffix: 'two_size' })),
    ];
    setRunning(true); setResults([]);
    const out = [];
    try {
      // Fetch B2 credentials once for the whole batch.
      const credsRes = await api.get('/gangsheets/storage-credentials');
      const creds = credsRes.data;
      if (!window.electronAPI?.s3Upload) {
        throw new Error('Direct S3 upload requires the desktop app (Electron). Open from the BullStart desktop client.');
      }

      for (let ci = 0; ci < chunks.length; ci++) {
        const { chunk, suffix } = chunks[ci];
        const linePrefix = dominantLineId(chunk);
        const totalInChunk = flattenQrMetas(chunk).length;
        setProgress({ chunkIndex: ci, totalChunks: chunks.length, done: 0, total: totalInChunk, system_id: '', key: '' });

        const built = await buildGangsheetForChunk(chunk, {
          linePrefix,
          nameSuffix: suffix,
          onProgress: (p) => setProgress(prev => ({ ...prev, ...p })),
        });

        // 1) Upload PDF directly to B2 from the desktop app — hub is not involved.
        const key = `${creds.folder}/${built.filename}`;
        const arrayBuffer = await built.blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        await window.electronAPI.s3Upload({
          credentials: creds,
          bucket: creds.bucket,
          key,
          body: bytes,
          contentType: 'application/pdf',
        });
        const publicUrl = `${creds.public_url_base}/${key}`;

        // 2) Tell the hub to record the gangsheet + flip productions=true.
        const res = await api.post('/gangsheets', {
          filename: built.filename,
          file_url: publicUrl,
          line_id: linePrefix || '',
          first_system_id: built.firstSid,
          last_system_id: built.lastSid,
          orders_count: built.ordersInChunk,
          metas_count: built.metasUsed,
          order_ids: built.orderIds,
          meta_ids: built.metaIds,
        });
        out.push(res.data.gangsheet);
      }
      setResults(out);
      setSelectedIds(new Set());
      await fetchPending();
    } catch (err) {
      const detail = err?.response?.data?.message
        || err?.response?.data?.errors
        || err?.message
        || 'Gangsheet generation failed';
      const status = err?.response?.status ? ` [HTTP ${err.response.status}]` : '';
      console.error('[gangsheet] generate error', err);
      alert(`Gangsheet failed${status}:\n${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm space-y-3">
        <div className="flex justify-between items-end gap-3">
          <div>
            <h3 className="text-sm font-semibold text-neutral-700">Pending orders ({pending.length})</h3>
            <p className="text-xs text-neutral-500">Orders with at least one un-produced <span className="font-mono">_qr</span> meta.</p>
          </div>
          <div className="flex gap-2 items-end">
            <div>
              <label className="text-xs text-neutral-500 block">Orders / batch</label>
              <input type="number" min="1" value={batchSize}
                onChange={e => setBatchSize(Math.max(1, parseInt(e.target.value) || 1))}
                className="mt-1 w-24 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
            </div>
            <button onClick={handleGenerate} disabled={running || selectedIds.size === 0}
              className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg font-medium">
              {running ? 'Generating…' : `Generate (${selectedIds.size})`}
            </button>
            <button onClick={fetchPending} className="px-3 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Refresh</button>
          </div>
        </div>

        {loading ? (
          <p className="text-neutral-400 text-sm">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="text-neutral-400 text-sm">No pending orders.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-neutral-500 text-xs border-b border-neutral-200">
                <th className="py-2 text-left w-8"><input type="checkbox" onChange={toggleAll} checked={selectedIds.size === pending.length && pending.length > 0} className="accent-orange-500" /></th>
                <th className="py-2 text-left">System ID</th>
                <th className="py-2 text-left">Ref</th>
                <th className="py-2 text-left">Line</th>
                <th className="py-2 text-right">_qr metas</th>
                <th className="py-2 text-right">Created</th>
              </tr>
            </thead>
            <tbody>
              {pending.map(o => {
                const li = o.items?.[0]?.product_variant?.product?.line_id;
                return (
                  <tr key={o.id} className="border-b border-neutral-100 hover:bg-orange-50/40">
                    <td className="py-1.5"><input type="checkbox" checked={selectedIds.has(o.id)} onChange={() => toggle(o.id)} className="accent-orange-500" /></td>
                    <td className="py-1.5 font-mono text-orange-500 text-xs">{o.system_id}</td>
                    <td className="py-1.5 text-xs text-neutral-600">{o.ref_id || '-'}</td>
                    <td className="py-1.5 text-xs text-neutral-600 font-mono">{li || '-'}</td>
                    <td className="py-1.5 text-right text-neutral-700">{countQrMetas(o)}</td>
                    <td className="py-1.5 text-right text-xs text-neutral-500">{new Date(o.created_at).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {progress && (
        <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-700 mb-2">Working…</h3>
          <div className="text-xs text-neutral-600">
            Chunk <span className="font-medium">{progress.chunkIndex + 1}/{progress.totalChunks}</span>
            {' · '}meta <span className="font-medium">{progress.done}/{progress.total}</span>
            {progress.system_id && <> · <span className="font-mono text-orange-500">{progress.system_id}</span> / {progress.key}</>}
          </div>
          <div className="mt-2 h-2 bg-neutral-100 rounded overflow-hidden">
            <div className="h-full bg-orange-500 transition-all"
              style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : '0%' }} />
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="bg-white rounded-xl border border-green-200 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-green-700 mb-2">Just generated</h3>
          <ul className="text-sm space-y-1">
            {results.map(g => (
              <li key={g.id} className="flex justify-between gap-3">
                <span className="font-mono text-neutral-700 truncate">{g.filename}</span>
                <a href={g.file_url} target="_blank" rel="noreferrer" className="text-orange-500 text-xs">Download</a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FindTab() {
  const [input, setInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [orders, setOrders] = useState([]);
  const [missing, setMissing] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [batchSize, setBatchSize] = useState(10);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState([]);

  const parseIds = (raw) => Array.from(new Set(
    raw.split(/[\s,;\n\r\t]+/).map(s => s.trim()).filter(Boolean)
  ));

  const handleFind = async () => {
    const ids = parseIds(input);
    if (ids.length === 0) { alert('Paste at least one system_id'); return; }
    setSearching(true);
    try {
      const res = await api.post('/gangsheets/lookup-orders', { system_ids: ids });
      setOrders(res.data.orders || []);
      setMissing(res.data.missing || []);
      setSelectedIds(new Set((res.data.orders || []).map(o => o.id)));
    } catch (err) {
      alert(err?.response?.data?.message || 'Lookup failed');
    } finally { setSearching(false); }
  };

  const toggle = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => {
    if (selectedIds.size === orders.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(orders.map(o => o.id)));
  };

  const countQrMetas = (order) => {
    let n = 0;
    for (const it of order.items || []) for (const m of it.metas || [])
      if (isQrKey(m.key)) n++;
    return n;
  };

  const dominantLineId = (chunkOrders) => {
    const counts = {};
    for (const o of chunkOrders) for (const it of o.items || []) {
      const li = it.product_variant?.product?.line_id;
      if (li) counts[li] = (counts[li] || 0) + 1;
    }
    let best = '', max = -1;
    for (const [k, v] of Object.entries(counts)) if (v > max) { max = v; best = k; }
    return best;
  };

  const handleGenerate = async () => {
    const selected = orders.filter(o => selectedIds.has(o.id));
    if (selected.length === 0) { alert('Select at least 1 order'); return; }
    // includeProduced=true here, so two-sidedness check must consider all metas.
    const { oneSide, twoSide } = splitOrdersBySideCount(selected, { includeProduced: true });
    const chunks = [
      ...chunkArray(oneSide, batchSize).map(chunk => ({ chunk, suffix: '' })),
      ...chunkArray(twoSide, batchSize).map(chunk => ({ chunk, suffix: 'two_size' })),
    ];
    setRunning(true); setResults([]);
    const out = [];
    try {
      const credsRes = await api.get('/gangsheets/storage-credentials');
      const creds = credsRes.data;
      if (!window.electronAPI?.s3Upload) {
        throw new Error('Direct S3 upload requires the desktop app (Electron).');
      }

      for (let ci = 0; ci < chunks.length; ci++) {
        const { chunk, suffix } = chunks[ci];
        const linePrefix = dominantLineId(chunk);
        const totalInChunk = flattenQrMetas(chunk, { includeProduced: true }).length;
        setProgress({ chunkIndex: ci, totalChunks: chunks.length, done: 0, total: totalInChunk, system_id: '', key: '' });

        const built = await buildGangsheetForChunk(chunk, {
          linePrefix,
          includeProduced: true,
          nameSuffix: suffix,
          onProgress: (p) => setProgress(prev => ({ ...prev, ...p })),
        });

        const key = `${creds.folder}/${built.filename}`;
        const arrayBuffer = await built.blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        await window.electronAPI.s3Upload({
          credentials: creds,
          bucket: creds.bucket,
          key,
          body: bytes,
          contentType: 'application/pdf',
        });
        const publicUrl = `${creds.public_url_base}/${key}`;

        const res = await api.post('/gangsheets', {
          filename: built.filename,
          file_url: publicUrl,
          line_id: linePrefix || '',
          first_system_id: built.firstSid,
          last_system_id: built.lastSid,
          orders_count: built.ordersInChunk,
          metas_count: built.metasUsed,
          order_ids: built.orderIds,
          meta_ids: built.metaIds,
        });
        out.push(res.data.gangsheet);
      }
      setResults(out);
    } catch (err) {
      alert(err?.response?.data?.message || err?.message || 'Generation failed');
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-700">Find by system IDs</h3>
          <p className="text-xs text-neutral-500">Paste system IDs (one per line, or separated by space/comma). Builds a gangsheet from those orders even if they were already produced.</p>
        </div>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={`GC2182\nGC2229\nGC2231\n...`}
          rows={6}
          className="w-full px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm font-mono"
        />
        <div className="flex items-center gap-2">
          <button onClick={handleFind} disabled={searching}
            className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg">
            {searching ? 'Searching…' : 'Find'}
          </button>
          {orders.length > 0 && (
            <span className="text-xs text-neutral-500">Found {orders.length} order(s)</span>
          )}
          {missing.length > 0 && (
            <span className="text-xs text-red-500">Missing: {missing.length}</span>
          )}
        </div>

        {missing.length > 0 && (
          <div className="text-xs bg-red-50 border border-red-200 rounded p-2 text-red-700">
            <div className="font-medium mb-1">Not found ({missing.length}):</div>
            <div className="font-mono break-all">{missing.join(', ')}</div>
          </div>
        )}
      </div>

      {/* Found orders */}
      {orders.length > 0 && (
        <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm space-y-3">
          <div className="flex justify-between items-end gap-3">
            <h3 className="text-sm font-semibold text-neutral-700">Found orders ({orders.length})</h3>
            <div className="flex gap-2 items-end">
              <div>
                <label className="text-xs text-neutral-500 block">Orders / batch</label>
                <input type="number" min="1" value={batchSize}
                  onChange={e => setBatchSize(Math.max(1, parseInt(e.target.value) || 1))}
                  className="mt-1 w-24 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
              </div>
              <button onClick={handleGenerate} disabled={running || selectedIds.size === 0}
                className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg font-medium">
                {running ? 'Generating…' : `Re-gang (${selectedIds.size})`}
              </button>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-neutral-500 text-xs border-b border-neutral-200">
                <th className="py-2 text-left w-8"><input type="checkbox" onChange={toggleAll} checked={selectedIds.size === orders.length && orders.length > 0} className="accent-orange-500" /></th>
                <th className="py-2 text-left">System ID</th>
                <th className="py-2 text-left">Ref</th>
                <th className="py-2 text-left">Line</th>
                <th className="py-2 text-right">_qr metas</th>
                <th className="py-2 text-center">Production</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => {
                const li = o.items?.[0]?.product_variant?.product?.line_id;
                return (
                  <tr key={o.id} className="border-b border-neutral-100 hover:bg-orange-50/40">
                    <td className="py-1.5"><input type="checkbox" checked={selectedIds.has(o.id)} onChange={() => toggle(o.id)} className="accent-orange-500" /></td>
                    <td className="py-1.5 font-mono text-orange-500 text-xs">{o.system_id}</td>
                    <td className="py-1.5 text-xs text-neutral-600">{o.ref_id || '-'}</td>
                    <td className="py-1.5 text-xs text-neutral-600 font-mono">{li || '-'}</td>
                    <td className="py-1.5 text-right text-neutral-700">{countQrMetas(o)}</td>
                    <td className="py-1.5 text-center">
                      {o.production ? (
                        <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded">already</span>
                      ) : (
                        <span className="text-xs px-1.5 py-0.5 bg-neutral-100 text-neutral-500 rounded">no</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {progress && (
        <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-700 mb-2">Working…</h3>
          <div className="text-xs text-neutral-600">
            Chunk <span className="font-medium">{progress.chunkIndex + 1}/{progress.totalChunks}</span>
            {' · '}meta <span className="font-medium">{progress.done}/{progress.total}</span>
            {progress.system_id && <> · <span className="font-mono text-orange-500">{progress.system_id}</span> / {progress.key}</>}
          </div>
          <div className="mt-2 h-2 bg-neutral-100 rounded overflow-hidden">
            <div className="h-full bg-orange-500 transition-all"
              style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : '0%' }} />
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="bg-white rounded-xl border border-green-200 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-green-700 mb-2">Just generated</h3>
          <ul className="text-sm space-y-1">
            {results.map(g => (
              <li key={g.id} className="flex justify-between gap-3">
                <span className="font-mono text-neutral-700 truncate">{g.filename}</span>
                <a href={g.file_url} target="_blank" rel="noreferrer" className="text-orange-500 text-xs">Download</a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Track which gangsheets the current admin has already downloaded. Stored
// per-machine in localStorage so the checkmark survives reloads but doesn't
// require backend changes / a shared table.
const DOWNLOADED_KEY = 'gangsheet_downloaded_ids';
function loadDownloadedSet() {
  try {
    const raw = JSON.parse(localStorage.getItem(DOWNLOADED_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}
function saveDownloadedSet(s) {
  localStorage.setItem(DOWNLOADED_KEY, JSON.stringify([...s]));
}

function ManageTab({ isAdmin }) {
  const [filters, setFilters] = useState({ date_from: '', date_to: '', line_id: '', page: 1 });
  const [list, setList] = useState({ data: [], current_page: 1, last_page: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [downloadedSet, setDownloadedSet] = useState(loadDownloadedSet);

  const markDownloaded = (id) => {
    setDownloadedSet(prev => {
      const next = new Set(prev);
      next.add(id);
      saveDownloadedSet(next);
      return next;
    });
  };
  const toggleDownloaded = (id) => {
    setDownloadedSet(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveDownloadedSet(next);
      return next;
    });
  };

  const fetchList = async () => {
    setLoading(true);
    try {
      const params = { page: filters.page, per_page: 20 };
      if (filters.date_from) params.date_from = filters.date_from;
      if (filters.date_to) params.date_to = filters.date_to;
      if (filters.line_id) params.line_id = filters.line_id;
      const res = await api.get('/gangsheets', { params });
      setList(res.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchList(); }, [filters.page]);

  const applyFilters = (e) => {
    e?.preventDefault();
    setFilters(f => ({ ...f, page: 1 }));
    fetchList();
  };
  const clearFilters = () => {
    setFilters({ date_from: '', date_to: '', line_id: '', page: 1 });
    setTimeout(fetchList, 0);
  };

  const handleDelete = async (g) => {
    if (!confirm(`Delete gangsheet ${g.filename}?\n(Orders/metas remain marked as production.)`)) return;
    try {
      await api.delete(`/gangsheets/${g.id}`);
      fetchList();
    } catch (err) {
      alert(err?.response?.data?.message || 'Delete failed');
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <form onSubmit={applyFilters} className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-neutral-500 block">From</label>
          <input type="date" value={filters.date_from} onChange={e => setFilters(f => ({ ...f, date_from: e.target.value }))}
            className="mt-1 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
        </div>
        <div>
          <label className="text-xs text-neutral-500 block">To</label>
          <input type="date" value={filters.date_to} onChange={e => setFilters(f => ({ ...f, date_to: e.target.value }))}
            className="mt-1 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
        </div>
        <div>
          <label className="text-xs text-neutral-500 block">Line ID</label>
          <input type="text" value={filters.line_id} onChange={e => setFilters(f => ({ ...f, line_id: e.target.value }))} placeholder="e.g. GC"
            className="mt-1 w-32 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm font-mono" />
        </div>
        <button type="submit" className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg">Apply</button>
        <button type="button" onClick={clearFilters} className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Clear</button>
        <span className="text-xs text-neutral-500 ml-auto">
          <span className="font-semibold text-emerald-600">{[...downloadedSet].filter(id => list.data.some(g => g.id === id)).length}</span>
          {' / '}
          <span className="font-semibold">{list.data.length}</span>
          {' downloaded · Total: '}
          {list.total ?? 0}
        </span>
      </form>

      {/* Table */}
      <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-neutral-500 text-xs bg-[#faf8f6] border-b border-neutral-200">
              <th className="px-3 py-2 text-center w-10" title="Click to toggle downloaded mark">✓</th>
              <th className="px-3 py-2 text-left">Filename</th>
              <th className="px-3 py-2 text-left">Range</th>
              <th className="px-3 py-2 text-left">Line</th>
              <th className="px-3 py-2 text-right">Orders</th>
              <th className="px-3 py-2 text-right">Metas</th>
              <th className="px-3 py-2 text-left">Creator</th>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="9" className="p-6 text-center text-neutral-400">Loading…</td></tr>
            ) : list.data.length === 0 ? (
              <tr><td colSpan="9" className="p-6 text-center text-neutral-400">No gangsheets found.</td></tr>
            ) : list.data.map(g => {
              const isDl = downloadedSet.has(g.id);
              return (
              <tr key={g.id} className={`border-b border-neutral-100 hover:bg-orange-50/30 ${isDl ? 'bg-green-50/40' : ''}`}>
                <td className="px-3 py-2 text-center">
                  <button
                    onClick={() => toggleDownloaded(g.id)}
                    title={isDl ? 'Đã download — click để bỏ đánh dấu' : 'Chưa download — click để đánh dấu'}
                    className={`w-6 h-6 rounded border-2 flex items-center justify-center text-base transition ${
                      isDl
                        ? 'bg-emerald-500 border-emerald-600 text-white'
                        : 'bg-white border-neutral-300 hover:border-emerald-400 text-transparent hover:text-emerald-300'
                    }`}
                  >
                    ✓
                  </button>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-neutral-700 truncate max-w-[260px]">{g.filename}</td>
                <td className="px-3 py-2 font-mono text-xs text-neutral-500">
                  {g.first_system_id}{g.first_system_id !== g.last_system_id && <> → {g.last_system_id}</>}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{g.line_id || '-'}</td>
                <td className="px-3 py-2 text-right">{g.orders_count}</td>
                <td className="px-3 py-2 text-right">{g.metas_count}</td>
                <td className="px-3 py-2 text-xs">{g.creator?.name || '-'}</td>
                <td className="px-3 py-2 text-xs text-neutral-500">{new Date(g.created_at).toLocaleString()}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex gap-3 justify-end">
                    <button onClick={() => setDetail(g)} className="text-xs text-neutral-600 hover:text-neutral-800">Detail</button>
                    <a
                      href={g.file_url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => markDownloaded(g.id)}
                      className="text-xs text-orange-500 hover:text-orange-600"
                    >
                      Download
                    </a>
                    {isAdmin && (
                      <button onClick={() => handleDelete(g)} className="text-xs text-red-500 hover:text-red-600">Delete</button>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {list.last_page > 1 && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: Math.min(list.last_page, 10) }, (_, i) => i + 1).map(p => (
            <button key={p} onClick={() => setFilters(f => ({ ...f, page: p }))}
              className={`px-3 py-1 rounded text-sm ${filters.page === p ? 'bg-orange-500 text-white' : 'bg-white border border-neutral-200 text-neutral-600'}`}>
              {p}
            </button>
          ))}
        </div>
      )}

      {detail && <DetailModal gs={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function DetailModal({ gs, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/gangsheets/${gs.id}`).then(res => setData(res.data)).finally(() => setLoading(false));
  }, [gs.id]);

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6">
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-[90vw] max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200 flex justify-between items-center">
          <div>
            <h3 className="text-sm font-semibold text-neutral-800 font-mono">{gs.filename}</h3>
            <p className="text-xs text-neutral-500 mt-0.5">{gs.orders_count} orders · {gs.metas_count} metas · {new Date(gs.created_at).toLocaleString()}</p>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-800 text-xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="text-neutral-400 text-sm">Loading…</p>
          ) : !data ? (
            <p className="text-neutral-400 text-sm">No data.</p>
          ) : (
            <>
              <div className="mb-3">
                <a href={data.gangsheet.file_url} target="_blank" rel="noreferrer" className="text-orange-500 text-xs break-all">{data.gangsheet.file_url}</a>
              </div>
              <h4 className="text-xs font-semibold text-neutral-600 uppercase mb-2">Orders ({data.orders.length})</h4>
              {data.orders.length === 0 ? (
                <p className="text-neutral-400 text-sm">No orders found (may have been deleted).</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-neutral-500 text-xs border-b border-neutral-200">
                      <th className="py-2 text-left">System ID</th>
                      <th className="py-2 text-left">Ref</th>
                      <th className="py-2 text-left">User</th>
                      <th className="py-2 text-right">Total</th>
                      <th className="py-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.orders.map(o => (
                      <tr key={o.id} className="border-b border-neutral-100">
                        <td className="py-1.5 font-mono text-orange-500 text-xs">{o.system_id}</td>
                        <td className="py-1.5 text-xs text-neutral-600">{o.ref_id || '-'}</td>
                        <td className="py-1.5 text-xs">{o.user?.name || '-'}</td>
                        <td className="py-1.5 text-right">${o.total_cost}</td>
                        <td className="py-1.5 text-right text-xs">{o.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
