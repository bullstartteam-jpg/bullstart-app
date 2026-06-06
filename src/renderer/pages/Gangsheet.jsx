import { useEffect, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { buildGangsheetForChunk, chunkArray, flattenQrMetas, isQrKey, splitOrdersBySideCount } from '../services/gangsheetBuilder';
import { generateClaimedGroups, runGroupAssign, removeDesignAndRegen, deleteGroup, deleteOpenGroups } from '../services/groupGang';
import {
  subscribeAssignJob, startAssignJob, stopAssignJob, runAssignNow,
  subscribeAutoCloseJob, startAutoCloseJob, stopAutoCloseJob,
} from '../services/converter';
import Pagination from '../components/Pagination';

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
        <TabBtn active={tab === 'groups'} onClick={() => setTab('groups')}>Groups</TabBtn>
        <TabBtn active={tab === 'find'} onClick={() => setTab('find')}>Find / Re-gang</TabBtn>
        <TabBtn active={tab === 'manage'} onClick={() => setTab('manage')}>Manage</TabBtn>
      </div>

      {tab === 'compose' && <ComposeTab />}
      {tab === 'groups' && <GroupsTab />}
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

// Pill-style sub-tab chip (used inside ComposeTab for One/Two/Scratch filters).
function SubChip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
        active
          ? 'bg-orange-500 text-white'
          : 'bg-neutral-100 text-neutral-600 hover:bg-orange-50 hover:text-orange-700'
      }`}
    >{children}</button>
  );
}

function CountBadge({ n }) {
  // Translucent over orange (active chip) AND looks fine on gray (inactive)
  // because background opacity adapts.
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-black/10">{n}</span>
  );
}

// Turn an accessory name into a filename-safe token: "Scratch Card" → "scratch-card".
function slugifyAccessory(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

// An order's material = the first item that has one (mirrors the backend bucket
// rule). Returns { id, name }; id=0 when the order has no material.
function orderMaterial(order) {
  for (const it of order.items || []) {
    const id = it.material_id ?? it.material?.id;
    if (id) return { id, name: it.material?.name || '' };
  }
  return { id: 0, name: '' };
}

/**
 * Pull every accessory_id linked to an order's items, from both the multi-acc
 * pivot (item.accessory_prices[]) and the legacy single accessory_price.
 */
function orderAccessoryIds(order) {
  const ids = new Set();
  for (const it of order.items || []) {
    for (const ap of it.accessory_prices || []) {
      const aid = ap.accessory_id ?? ap.accessory?.id;
      if (aid) ids.add(aid);
    }
    const legacy = it.accessory_price?.accessory_id ?? it.accessory_price?.accessory?.id;
    if (legacy) ids.add(legacy);
  }
  return ids;
}

function orderSideCount(order) {
  let hasFront = false, hasBack = false;
  for (const it of order.items || []) {
    for (const m of it.metas || []) {
      if (m.production) continue;
      if (m.key === 'front_qr' || /^front_qr(_\d+)?$/.test(m.key)) hasFront = true;
      if (m.key === 'back_qr'  || /^back_qr(_\d+)?$/.test(m.key))  hasBack  = true;
      if (hasFront && hasBack) return 'two';
    }
  }
  return hasFront || hasBack ? 'one' : 'none';
}

// The split-accessory (e.g. Scratch Card) of an order: smallest id among items'
// gangsheet_split=true accessories (mirrors backend computeBucket). {id:0} none.
function orderSplitAccessory(order) {
  let id = 0, name = '';
  const consider = (acc) => {
    if (!acc?.id || acc.gangsheet_split === false) return;
    if (id === 0 || acc.id < id) { id = acc.id; name = acc.name || ''; }
  };
  for (const it of order.items || []) {
    for (const ap of it.accessory_prices || []) consider(ap.accessory);
    consider(it.accessory_price?.accessory);
  }
  return { id, name };
}

// Full gang bucket of an order: side × split-accessory × material. Mirrors the
// backend computeBucket so the Compose chips show the real gang division
// ("1 mặt · Gloss", "2 mặt · Scratch Card · Matte", …).
function orderBucketInfo(order) {
  const side = orderSideCount(order) === 'two' ? 'two' : 'one';
  const acc = orderSplitAccessory(order);
  const mat = orderMaterial(order);
  const key = `${side}|${acc.id}|${mat.id}`;
  const parts = [side === 'two' ? '2 mặt' : '1 mặt'];
  if (acc.id) parts.push(acc.name || `Acc#${acc.id}`);
  parts.push(mat.id ? (mat.name || `Mat#${mat.id}`) : 'Không chất liệu');
  return { side, acc, mat, key, label: parts.join(' · ') };
}

function ComposeTab() {
  const [pending, setPending] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [batchSize, setBatchSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState([]);
  // Sub-tab filter: 'all' | a bucket key "<side>|<accId>|<matId>".
  const [subTab, setSubTab] = useState('all');

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

  // Combined gang buckets: each chip is one real gang division
  // (side × split-accessory × material), e.g. "1 mặt · Gloss 300gsm" or
  // "2 mặt · Scratch Card · Matte". Built dynamically from the pending orders —
  // no hard-coded material/accessory list.
  const buckets = (() => {
    const map = new Map();   // key → { label, side, acc, mat, orders[] }
    for (const o of pending) {
      const b = orderBucketInfo(o);
      if (!map.has(b.key)) map.set(b.key, { label: b.label, side: b.side, acc: b.acc, mat: b.mat, orders: [] });
      map.get(b.key).orders.push(o);
    }
    return map;
  })();
  // 1 mặt before 2 mặt, then larger buckets first.
  const bucketList = [...buckets.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => (a.side === b.side ? b.orders.length - a.orders.length : (a.side === 'one' ? -1 : 1)));

  const filteredPending = subTab === 'all' ? pending : (buckets.get(subTab)?.orders || []);

  const toggleAll = () => {
    // Toggle-all operates on the CURRENTLY VISIBLE filter only — clicking
    // the header checkbox in "Scratch Card" tab selects only scratch orders.
    const visibleIds = new Set(filteredPending.map(o => o.id));
    const allSelected = filteredPending.length > 0 && filteredPending.every(o => selectedIds.has(o.id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) visibleIds.forEach(id => next.delete(id));
      else visibleIds.forEach(id => next.add(id));
      return next;
    });
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

    // Group selected orders by their FULL bucket (side × accessory × material)
    // so every gang is homogeneous — never mixes side, accessory or paper. Each
    // bucket is single-side already, so just chunk it. Filename gets the
    // accessory + material + two_size tags of that bucket.
    const joinTags = (...xs) => xs.filter(Boolean).join('_');
    const bucketGroups = new Map();   // key → { acc, mat, side, orders[] }
    for (const o of selected) {
      const b = orderBucketInfo(o);
      if (!bucketGroups.has(b.key)) bucketGroups.set(b.key, { acc: b.acc, mat: b.mat, side: b.side, orders: [] });
      bucketGroups.get(b.key).orders.push(o);
    }

    const chunks = [];
    for (const [, g] of bucketGroups) {
      const tag = joinTags(
        g.acc.id ? slugifyAccessory(g.acc.name) : '',
        g.mat.id ? slugifyAccessory(g.mat.name) : '',
        g.side === 'two' ? 'two_size' : '',
      );
      for (const chunk of chunkArray(g.orders, batchSize)) chunks.push({ chunk, suffix: tag });
    }
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
          seq: ci + 1,
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

        {/* Sub-tabs: All + một chip cho mỗi bucket gang thật
            (mặt × Scratch × chất liệu), auto theo pending orders. */}
        <div className="flex flex-wrap items-center gap-1 border-b border-neutral-100 pb-2">
          <SubChip active={subTab === 'all'} onClick={() => setSubTab('all')}>All <CountBadge n={pending.length} /></SubChip>
          {bucketList.map(b => (
            <SubChip key={b.key} active={subTab === b.key} onClick={() => setSubTab(b.key)}>
              {b.label} <CountBadge n={b.orders.length} />
            </SubChip>
          ))}
        </div>

        {loading ? (
          <p className="text-neutral-400 text-sm">Loading…</p>
        ) : filteredPending.length === 0 ? (
          <p className="text-neutral-400 text-sm">
            {subTab === 'all' ? `Không có đơn nào.` : `Không có đơn nào trong nhóm này.`}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-neutral-500 text-xs border-b border-neutral-200">
                <th className="py-2 text-left w-8"><input
                  type="checkbox"
                  onChange={toggleAll}
                  checked={filteredPending.length > 0 && filteredPending.every(o => selectedIds.has(o.id))}
                  className="accent-orange-500"
                /></th>
                <th className="py-2 text-left">System ID</th>
                <th className="py-2 text-left">Ref</th>
                <th className="py-2 text-left">Line</th>
                <th className="py-2 text-right">_qr metas</th>
                <th className="py-2 text-right">Created</th>
              </tr>
            </thead>
            <tbody>
              {filteredPending.map(o => {
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

// ─────────────────────────── Groups (automation) ───────────────────────────

function bucketLabel(g) {
  const side = g.side_type === 'two' ? '2 mặt' : '1 mặt';
  const acc = g.accessory_id ? ` · acc#${g.accessory_id}` : '';
  const mat = g.material_id ? ` · mat#${g.material_id}` : '';
  return `${g.line_id || '-'} · ${side}${acc}${mat}`;
}

const GROUP_STATUS_STYLE = {
  open:      'bg-neutral-100 text-neutral-600',
  closing:   'bg-amber-100 text-amber-700',
  generated: 'bg-green-100 text-green-700',
};

// Small start/stop chip for an app-side cron job (assign / auto-close).
function JobChip({ label, state, onStart, onStop, onRunNow }) {
  const enabled = !!state?.enabled;
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-xs">
      <span className={`w-2 h-2 rounded-full ${enabled ? (state?.running ? 'bg-amber-400 animate-pulse' : 'bg-green-500') : 'bg-neutral-300'}`} />
      <span className="font-medium text-neutral-700">{label}</span>
      {enabled ? (
        <>
          {onRunNow && <button onClick={onRunNow} className="text-orange-600 hover:text-orange-700">Run now</button>}
          <button onClick={onStop} className="text-red-500 hover:text-red-600">Tắt</button>
        </>
      ) : (
        <button onClick={onStart} className="text-green-600 hover:text-green-700">Bật</button>
      )}
      {state?.processedTotal > 0 && <span className="text-neutral-400">· {state.processedTotal}</span>}
    </div>
  );
}

function GroupsTab() {
  const [list, setList] = useState({ data: [], current_page: 1, last_page: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [detail, setDetail] = useState(null);
  const [assignState, setAssignState] = useState(null);
  const [autoCloseState, setAutoCloseState] = useState(null);

  useEffect(() => subscribeAssignJob(setAssignState), []);
  useEffect(() => subscribeAutoCloseJob(setAutoCloseState), []);

  const fetchList = async () => {
    setLoading(true);
    try {
      const params = { page, per_page: 50 };
      if (statusFilter) params.status = statusFilter;
      const res = await api.get('/gangsheet-groups', { params });
      setList(res.data);
      setSelected(new Set());
    } finally { setLoading(false); }
  };
  useEffect(() => { fetchList(); }, [page, statusFilter]);

  const selectableIds = list.data.filter(g => g.status === 'open' && (g.order_ids?.length || 0) > 0).map(g => g.id);
  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => {
    const all = selectableIds.length > 0 && selectableIds.every(id => selected.has(id));
    setSelected(all ? new Set() : new Set(selectableIds));
  };

  const handleAssignNow = async () => {
    try {
      const r = await runGroupAssign();
      alert(`Gom ${r.assigned ?? 0} đơn vào group (touched ${r.groups_touched ?? 0}).`);
      fetchList();
    } catch (err) {
      alert(err?.response?.data?.message || err?.message || 'Assign failed');
    }
  };

  const handleClose = async (ids) => {
    if (!ids.length) { alert('Chọn ít nhất 1 group đang mở.'); return; }
    if (!window.electronAPI?.s3Upload) { alert('Cần mở từ app desktop (Electron) để build gangsheet.'); return; }
    if (!confirm(`Chốt ${ids.length} group → tạo gangsheet?`)) return;
    setRunning(true); setProgress(null);
    try {
      const results = await generateClaimedGroups({ groupIds: ids, onProgress: (p) => setProgress(p) });
      alert(`Đã tạo ${results.length} gang.`);
      fetchList();
    } catch (err) {
      alert(err?.response?.data?.message || err?.message || 'Chốt thất bại');
    } finally {
      setRunning(false); setProgress(null);
    }
  };

  const handleDeleteGroup = async (g) => {
    const warn = g.status === 'generated'
      ? `Xoá group #${g.seq}? Gang đã tạo + file PDF sẽ bị xoá, các đơn trả về pending.`
      : `Xoá group #${g.seq}? Các đơn trả về pending.`;
    if (!confirm(warn)) return;
    try {
      await deleteGroup(g.id);
      fetchList();
    } catch (err) {
      alert(err?.response?.data?.message || err?.message || 'Xoá group thất bại');
    }
  };

  const handleDeleteOpen = async () => {
    if (!confirm('Xoá TẤT CẢ group đang mở? Đơn trả về pending để gom lại (vd sau khi đổi group size).')) return;
    try {
      const res = await deleteOpenGroups();
      alert(res?.message || 'Đã xoá group đang mở.');
      fetchList();
    } catch (err) {
      alert(err?.response?.data?.message || err?.message || 'Xoá thất bại');
    }
  };

  return (
    <div className="space-y-4">
      {/* Job controls + assign-now */}
      <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm flex flex-wrap items-center gap-3">
        <JobChip
          label="Auto gom (1h)"
          state={assignState}
          onStart={startAssignJob} onStop={stopAssignJob} onRunNow={runAssignNow}
        />
        <JobChip
          label="Auto chốt (móc giờ)"
          state={autoCloseState}
          onStart={startAutoCloseJob} onStop={stopAutoCloseJob}
        />
        <span className="text-xs text-neutral-400">Cấu hình group size + móc giờ ở Settings.</span>
        <div className="ml-auto flex gap-2">
          <button onClick={handleAssignNow} className="px-3 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Gom ngay</button>
          <button onClick={handleDeleteOpen} className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-600 text-sm rounded-lg">Xoá group mở</button>
          <button onClick={fetchList} className="px-3 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Refresh</button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm space-y-3">
        <div className="flex justify-between items-center gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-neutral-700">Groups ({list.total ?? 0})</h3>
            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
              className="px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded-lg text-xs">
              <option value="">Tất cả</option>
              <option value="open">open</option>
              <option value="closing">closing</option>
              <option value="generated">generated</option>
            </select>
          </div>
          <button onClick={() => handleClose([...selected])} disabled={running || selected.size === 0}
            className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg font-medium">
            {running ? 'Đang chốt…' : `Chốt (${selected.size})`}
          </button>
        </div>

        {loading ? (
          <p className="text-neutral-400 text-sm">Loading…</p>
        ) : list.data.length === 0 ? (
          <p className="text-neutral-400 text-sm">Chưa có group nào. Bấm "Gom ngay" hoặc bật Auto gom.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-neutral-500 text-xs border-b border-neutral-200">
                <th className="py-2 text-left w-8"><input type="checkbox" onChange={toggleAll}
                  checked={selectableIds.length > 0 && selectableIds.every(id => selected.has(id))}
                  className="accent-orange-500" /></th>
                <th className="py-2 text-left">Seq</th>
                <th className="py-2 text-left">Bucket</th>
                <th className="py-2 text-right">Đơn</th>
                <th className="py-2 text-center">Status</th>
                <th className="py-2 text-left">Gangsheet</th>
                <th className="py-2 text-left">Ngày SX</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map(g => {
                const canSelect = g.status === 'open' && (g.order_ids?.length || 0) > 0;
                return (
                  <tr key={g.id} className="border-b border-neutral-100 hover:bg-orange-50/40">
                    <td className="py-1.5">
                      <input type="checkbox" disabled={!canSelect} checked={selected.has(g.id)}
                        onChange={() => toggle(g.id)} className="accent-orange-500 disabled:opacity-30" />
                    </td>
                    <td className="py-1.5 font-mono text-orange-500">#{g.seq}</td>
                    <td className="py-1.5 text-xs text-neutral-700 font-mono">{bucketLabel(g)}</td>
                    <td className="py-1.5 text-right text-neutral-700">{g.order_ids?.length || 0}</td>
                    <td className="py-1.5 text-center">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${GROUP_STATUS_STYLE[g.status] || 'bg-neutral-100'}`}>{g.status}</span>
                    </td>
                    <td className="py-1.5 text-xs">
                      {g.gangsheet
                        ? <a href={g.gangsheet.file_url} target="_blank" rel="noreferrer" className="text-orange-500 truncate inline-block max-w-[200px] align-bottom">{g.gangsheet.filename}</a>
                        : <span className="text-neutral-400">-</span>}
                    </td>
                    <td className="py-1.5 text-xs text-neutral-500">{g.production_day}</td>
                    <td className="py-1.5 text-right">
                      <div className="flex gap-3 justify-end">
                        <button onClick={() => setDetail(g)} className="text-xs text-neutral-600 hover:text-neutral-800">Detail</button>
                        <button onClick={() => handleDeleteGroup(g)} className="text-xs text-red-500 hover:text-red-600">Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {progress && (
        <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-700 mb-2">Đang chốt…</h3>
          <div className="text-xs text-neutral-600">
            Group <span className="font-medium">{(progress.groupIndex ?? 0) + 1}/{progress.totalGroups ?? '?'}</span>
            {progress.group && <> · seq <span className="font-mono text-orange-500">#{progress.group.seq}</span></>}
            {progress.system_id && <> · <span className="font-mono">{progress.system_id}</span> / {progress.key}</>}
          </div>
        </div>
      )}

      <Pagination page={page} lastPage={list.last_page} onChange={setPage} />

      {detail && <GroupDetailModal group={detail} onClose={() => setDetail(null)} onChanged={fetchList} />}
    </div>
  );
}

function GroupDetailModal({ group, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);

  const fetchDetail = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/gangsheet-groups/${group.id}`);
      setData(res.data);
      setSelected(new Set());
    } finally { setLoading(false); }
  };
  useEffect(() => { fetchDetail(); }, [group.id]);

  const orders = data?.orders || [];
  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleRemove = async () => {
    const ids = [...selected];
    if (!ids.length) { alert('Chọn đơn cần gỡ.'); return; }
    if (!confirm(`Gỡ ${ids.length} đơn khỏi group #${group.seq}?\nĐơn sẽ về pending; gang cũ bị xoá và tạo lại (giữ nguyên seq).`)) return;
    setBusy(true);
    try {
      const res = await removeDesignAndRegen(group.id, ids);
      if (!res.group) {
        alert('Đã gỡ hết đơn — group rỗng nên đã bị xoá.');
        onClose();
      } else {
        alert(`Đã gỡ ${res.detached?.length ?? ids.length} đơn và tạo lại gang (seq #${group.seq}).`);
        await fetchDetail();
      }
      onChanged?.();
    } catch (err) {
      alert(err?.response?.data?.message || err?.message || 'Gỡ design thất bại');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6">
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-[90vw] max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200 flex justify-between items-center">
          <div>
            <h3 className="text-sm font-semibold text-neutral-800 font-mono">Group #{group.seq} · {bucketLabel(group)}</h3>
            <p className="text-xs text-neutral-500 mt-0.5">{group.status} · {orders.length} đơn · ngày SX {group.production_day}</p>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-800 text-xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="text-neutral-400 text-sm">Loading…</p>
          ) : orders.length === 0 ? (
            <p className="text-neutral-400 text-sm">Không có đơn.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-neutral-500 text-xs border-b border-neutral-200">
                  <th className="py-2 text-left w-8"></th>
                  <th className="py-2 text-left">System ID</th>
                  <th className="py-2 text-left">Ref</th>
                  <th className="py-2 text-left">Line</th>
                  <th className="py-2 text-right">_qr metas</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => {
                  const li = o.items?.[0]?.product_variant?.product?.line_id;
                  let qn = 0;
                  for (const it of o.items || []) for (const m of it.metas || []) if (isQrKey(m.key)) qn++;
                  return (
                    <tr key={o.id} className="border-b border-neutral-100">
                      <td className="py-1.5"><input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} className="accent-orange-500" /></td>
                      <td className="py-1.5 font-mono text-orange-500 text-xs">{o.system_id}</td>
                      <td className="py-1.5 text-xs text-neutral-600">{o.ref_id || '-'}</td>
                      <td className="py-1.5 text-xs text-neutral-600 font-mono">{li || '-'}</td>
                      <td className="py-1.5 text-right text-neutral-700">{qn}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-4 py-3 border-t border-neutral-200 flex justify-end gap-2">
          <button onClick={handleRemove} disabled={busy || selected.size === 0}
            className="px-4 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm rounded-lg">
            {busy ? 'Đang xử lý…' : `Gỡ design (${selected.size})`}
          </button>
        </div>
      </div>
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
    // Split by material first (so a re-gang never mixes paper stock), then by
    // side. includeProduced=true here, so two-sidedness considers all metas.
    const matGroups = new Map();   // matId → { name, orders[] }
    for (const o of selected) {
      const m = orderMaterial(o);
      if (!matGroups.has(m.id)) matGroups.set(m.id, { name: m.name, orders: [] });
      matGroups.get(m.id).orders.push(o);
    }
    const joinTags = (...xs) => xs.filter(Boolean).join('_');
    const chunks = [];
    for (const [matId, { name, orders: matOrders }] of matGroups) {
      const matTag = matId ? slugifyAccessory(name) : '';
      const { oneSide, twoSide } = splitOrdersBySideCount(matOrders, { includeProduced: true });
      for (const chunk of chunkArray(oneSide, batchSize)) chunks.push({ chunk, suffix: joinTags(matTag, '') });
      for (const chunk of chunkArray(twoSide, batchSize)) chunks.push({ chunk, suffix: joinTags(matTag, 'two_size') });
    }
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
          seq: ci + 1,
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

// Category of a gangsheet, parsed from the filename tail after the date token
// (MMMDD), e.g. "..._JUN06_gloss-300gsm.pdf" → "gloss-300gsm",
// "..._JUN06_scratch-card_gloss-300gsm.pdf" → "scratch-card_gloss-300gsm",
// "..._JUN06_gloss-300gsm_two_size.pdf" → "gloss-300gsm_two_size".
// No suffix (plain) → '' (shown as "Khác").
function gangCategory(filename) {
  const m = String(filename || '').match(/_[A-Za-z]{3}\d{2}_(.+)\.pdf$/i);
  return m ? m[1] : '';
}
const gangCategoryLabel = (cat) => cat ? cat.replace(/_/g, ' · ') : 'Khác';

function ManageTab({ isAdmin }) {
  const [filters, setFilters] = useState({ date_from: '', date_to: '', line_id: '', page: 1 });
  const [list, setList] = useState({ data: [], current_page: 1, last_page: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [downloadedSet, setDownloadedSet] = useState(loadDownloadedSet);
  // Bulk-select state for the Manage tab. Reset whenever the visible page
  // changes so a hidden selection can't survive a page flip.
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [reconvertingId, setReconvertingId] = useState(null);
  // Sub-tab filter (client-side) by filename category — material / scratch /
  // two_size — so the loaded page is easy to tell apart. 'all' = no filter.
  const [subTab, setSubTab] = useState('all');

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
      setSelectedIds(new Set()); // reset on every re-fetch
      setSubTab('all');          // category chips reflect the new page
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchList(); }, [filters.page]);

  // Category chips + filtered rows (client-side, on the current page).
  const catCounts = {};
  for (const g of list.data) {
    const c = gangCategory(g.filename);
    catCounts[c] = (catCounts[c] || 0) + 1;
  }
  const cats = Object.keys(catCounts).sort((a, b) => catCounts[b] - catCounts[a]);
  const visible = subTab === 'all' ? list.data : list.data.filter(g => gangCategory(g.filename) === subTab);

  const toggleSelected = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleSelectAll = () => {
    const allSel = visible.length > 0 && visible.every(g => selectedIds.has(g.id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSel) visible.forEach(g => next.delete(g.id));
      else visible.forEach(g => next.add(g.id));
      return next;
    });
  };
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} gangsheet(s)?\n(Orders/metas remain marked as production.)`)) return;
    setBulkDeleting(true);
    try {
      const res = await api.post('/gangsheets/bulk-delete', { gangsheet_ids: [...selectedIds] });
      alert(res.data.message || `Deleted ${selectedIds.size}`);
      fetchList();
    } catch (err) {
      alert(err?.response?.data?.message || 'Bulk delete failed');
    } finally {
      setBulkDeleting(false);
    }
  };

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

  // Re-fetch source images + regenerate the _qr metas for every order in
  // this gangsheet. Reuses POST /orders/bulk-reconvert — it deletes the
  // existing _qr metas and unsets `production`, so the converter cron
  // picks them up and rebuilds from the mockup URLs on next run.
  const handleReconvertGang = async (g) => {
    const ids = g.order_ids || [];
    if (ids.length === 0) {
      alert('Gangsheet này không có order_ids để reconvert.');
      return;
    }
    if (!confirm(`Reconvert ${ids.length} đơn trong gangsheet ${g.filename}?\nCác meta _qr sẽ bị xoá và converter cron sẽ build lại.`)) return;
    setReconvertingId(g.id);
    try {
      const res = await api.post('/orders/bulk-reconvert', { order_ids: ids });
      alert(res?.data?.message || `Reconvert queued for ${ids.length} order(s)`);
    } catch (err) {
      alert(err?.response?.data?.message || 'Reconvert failed');
    } finally {
      setReconvertingId(null);
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
        {isAdmin && (
          <button
            type="button"
            onClick={handleBulkDelete}
            disabled={selectedIds.size === 0 || bulkDeleting}
            className="px-3 py-1.5 bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white text-sm rounded-lg"
          >
            {bulkDeleting ? 'Deleting…' : `Delete selected (${selectedIds.size})`}
          </button>
        )}
        <span className="text-xs text-neutral-500 ml-auto">
          <span className="font-semibold text-emerald-600">{[...downloadedSet].filter(id => list.data.some(g => g.id === id)).length}</span>
          {' / '}
          <span className="font-semibold">{list.data.length}</span>
          {' downloaded · Total: '}
          {list.total ?? 0}
        </span>
      </form>

      {/* Category chips (parsed from filename) — easy to tell batches apart. */}
      {!loading && list.data.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <SubChip active={subTab === 'all'} onClick={() => setSubTab('all')}>All <CountBadge n={list.data.length} /></SubChip>
          {cats.map(c => (
            <SubChip key={c || '_plain'} active={subTab === c} onClick={() => setSubTab(c)}>
              {gangCategoryLabel(c)} <CountBadge n={catCounts[c]} />
            </SubChip>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-neutral-500 text-xs bg-[#faf8f6] border-b border-neutral-200">
              {isAdmin && (
                <th className="px-3 py-2 text-center w-8">
                  <input
                    type="checkbox"
                    onChange={toggleSelectAll}
                    checked={visible.length > 0 && visible.every(g => selectedIds.has(g.id))}
                    className="accent-orange-500"
                    title="Select all visible"
                  />
                </th>
              )}
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
              <tr><td colSpan={isAdmin ? 10 : 9} className="p-6 text-center text-neutral-400">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={isAdmin ? 10 : 9} className="p-6 text-center text-neutral-400">No gangsheets found.</td></tr>
            ) : visible.map(g => {
              const isDl = downloadedSet.has(g.id);
              const isSel = selectedIds.has(g.id);
              return (
              <tr key={g.id} className={`border-b border-neutral-100 hover:bg-orange-50/30 ${isSel ? 'bg-orange-50/60' : isDl ? 'bg-green-50/40' : ''}`}>
                {isAdmin && (
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggleSelected(g.id)}
                      className="accent-orange-500"
                    />
                  </td>
                )}
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
                      <button
                        onClick={() => handleReconvertGang(g)}
                        disabled={reconvertingId === g.id}
                        className="text-xs text-blue-600 hover:text-blue-700 disabled:opacity-40"
                        title="Xoá meta _qr của các đơn trong gang này; cron build lại từ mockup URL"
                      >
                        {reconvertingId === g.id ? 'Reconverting…' : 'Reconvert'}
                      </button>
                    )}
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
      <Pagination
        page={filters.page}
        lastPage={list.last_page}
        onChange={(p) => setFilters(f => ({ ...f, page: p }))}
      />

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
