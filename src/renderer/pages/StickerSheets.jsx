import { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { notify, askConfirm } from '../components/Dialog';
import { analyzeDesignUrl } from '../services/stickerAnalyzer';
import { createStickerGangs } from './Gangsheet';
import { driveThumb } from '../utils/drive';
import ImagePicker from '../components/ImagePicker';

// Sticker Sheet analysis. Each Sticker Sheet design FILE is downloaded once,
// its stickers counted and its image fingerprinted; the hub stores the result,
// copies it to every other order using the same link (no re-analysis), and
// matches it to a saved template ("mẫu") — now and for every later order.
//
//   Tổng hợp đơn   open orders (not shipped / cancelled) grouped by sheet,
//                  with their ID lists and the design of each group
//   Thu thập mẫu   repeating sheets not on a template yet → save as template;
//                  the saved templates
//   Tất cả sheet   every analysed design: count, template, order (edit here)

const BATCH = 10;   // designs analysed per POST

const thumb = (url, size = 'w400') => driveThumb(url, size);

export default function StickerSheets() {
  const [tab, setTab] = useState('summary');
  const [pendingTotal, setPendingTotal] = useState(null);
  const [run, setRun] = useState(null);          // { done, total, ok, failed, current }
  const [errors, setErrors] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [templates, setTemplates] = useState([]);
  const [detail, setDetail] = useState(null);    // analysis row in the modal
  const [jumpTemplate, setJumpTemplate] = useState('');   // "Xem đơn" from a template
  const stopRef = useRef(false);

  const loadPending = () => api.get('/sticker-sheets/pending', { params: { limit: 1 } })
    .then(res => setPendingTotal(res.data?.total ?? 0)).catch(() => {});
  const loadTemplates = () => api.get('/sticker-templates').then(res => setTemplates(res.data || [])).catch(() => {});
  const refreshAll = () => { loadPending(); loadTemplates(); setReloadKey(k => k + 1); };

  useEffect(() => { loadPending(); loadTemplates(); }, []);

  // Pull pending designs page by page, analyse each, post per batch so a
  // stopped / crashed run keeps everything finished so far.
  const runAnalysis = async () => {
    stopRef.current = false;
    setErrors([]);
    const errs = [];
    let done = 0, ok = 0, failed = 0;
    const skip = new Set();   // failed this run — don't refetch them forever
    try {
      for (;;) {
        if (stopRef.current) break;
        const res = await api.get('/sticker-sheets/pending', { params: { limit: BATCH + skip.size } });
        const total = res.data?.total ?? 0;
        const items = (res.data?.items || []).filter(it => !skip.has(it.order_item_meta_id)).slice(0, BATCH);
        if (items.length === 0) break;
        const results = [];
        for (const it of items) {
          if (stopRef.current) break;
          setRun({ done, total: done + total - skip.size, ok, failed, current: `${it.system_id} · ${it.meta_key}` });
          try {
            const r = await analyzeDesignUrl(it.url);
            results.push({ order_item_meta_id: it.order_item_meta_id, source_url: it.url, ...r });
            ok++;
          } catch (err) {
            failed++;
            skip.add(it.order_item_meta_id);
            errs.push(`${it.system_id} (${it.meta_key}): ${err?.message || err}`);
            setErrors([...errs]);
          }
          done++;
        }
        if (results.length) await api.post('/sticker-sheets/analyses', { results });
      }
      notify(`Đã phân tích ${ok} thiết kế${failed ? `, lỗi ${failed}` : ''}.`, { title: 'Sticker Sheet', kind: failed ? 'error' : 'success' });
    } catch (err) {
      notify(err?.response?.data?.message || err?.message || 'Phân tích thất bại', { title: 'Sticker Sheet', kind: 'error' });
    } finally {
      setRun(null);
      refreshAll();
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h2 className="text-xl font-bold text-neutral-800">Sticker Sheet</h2>
          <p className="text-xs text-neutral-500 mt-1 max-w-2xl">
            Phân tích thiết kế Sticker Sheet của từng đơn: đếm số sticker con, so vân tay ảnh để biết sheet nào trùng nhau.
            Sheet được tự gán vào <b>mẫu</b> đã lưu khi giống mẫu đó; đơn mới phân tích sau cũng tự khớp.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {run ? (
            <>
              <span className="text-xs text-neutral-600">
                Đang phân tích {run.done}/{run.total} · <span className="font-mono">{run.current}</span>
                {run.failed > 0 && <span className="text-red-600"> · lỗi {run.failed}</span>}
              </span>
              <button onClick={() => { stopRef.current = true; }}
                className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Dừng</button>
            </>
          ) : (
            <button onClick={runAnalysis} disabled={!pendingTotal}
              className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm rounded-lg">
              Phân tích sheet mới ({pendingTotal ?? "…"} file)
            </button>
          )}
        </div>
      </div>

      {errors.length > 0 && (
        <details className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
          <summary className="cursor-pointer">{errors.length} thiết kế không phân tích được</summary>
          <ul className="mt-1 space-y-0.5 font-mono">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </details>
      )}

      <div className="flex gap-2">
        {[['summary', 'Tổng hợp đơn'], ['collect', `Thu thập mẫu (${templates.length})`], ['analyses', 'Tất cả sheet']].map(([id, label]) => (
          <button key={id} onClick={() => { setTab(id); if (id === 'analyses') setJumpTemplate(''); }}
            className={`px-4 py-2 text-sm rounded-lg ${tab === id ? 'bg-orange-500 text-white' : 'bg-white border border-neutral-200 text-neutral-600'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'analyses' && <AnalysesTab key={`${reloadKey}-${jumpTemplate}`} initialTemplate={jumpTemplate} templates={templates} onOpen={setDetail} />}
      {tab === 'summary' && <SummaryTab key={reloadKey} onOpen={setDetail} onSaved={refreshAll} />}
      {tab === 'collect' && (
        <div className="space-y-6">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-neutral-700">Sheet giống nhau chưa có mẫu</h3>
            <GroupsTab key={reloadKey} onSaved={refreshAll} />
          </section>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-neutral-700">Mẫu đã thu thập</h3>
            <TemplatesTab templates={templates} onChanged={refreshAll} onOpenTemplate={(t) => { setJumpTemplate(String(t.id)); setTab('analyses'); }} />
          </section>
        </div>
      )}

      {detail && (
        <AnalysisModal
          row={detail}
          templates={templates}
          onClose={() => setDetail(null)}
          onChanged={() => { loadTemplates(); setReloadKey(k => k + 1); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- analyses

function AnalysesTab({ templates, onOpen, initialTemplate = '' }) {
  const [filters, setFilters] = useState({ template: initialTemplate, search: '', page: 1 });
  const [data, setData] = useState({ data: [], total: 0, current_page: 1, last_page: 1 });
  const [loading, setLoading] = useState(true);

  const load = (f = filters) => {
    setLoading(true);
    const params = { page: f.page, per_page: 50 };
    if (f.template === 'none') params.unmatched = 1;
    else if (f.template) params.template_id = f.template;
    if (f.search) params.search = f.search;
    api.get('/sticker-sheets/analyses', { params })
      .then(res => setData(res.data))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [filters.page, filters.template]);

  return (
    <div className="space-y-3">
      <form onSubmit={e => { e.preventDefault(); const f = { ...filters, page: 1 }; setFilters(f); load(f); }}
        className="bg-white rounded-xl border border-neutral-200 p-3 flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-neutral-500 block">Mẫu</label>
          <ImagePicker value={filters.template} onChange={v => setFilters(f => ({ ...f, template: v, page: 1 }))}
            options={[
              { value: 'none', label: 'Chưa có mẫu' },
              ...templates.map(t => ({ value: String(t.id), label: t.name, image: t.sample_url, sub: `${t.sticker_count} sticker · ${t.orders_count} đơn` })),
            ]} />
        </div>
        <div>
          <label className="text-xs text-neutral-500 block">System ID (nhiều, cách nhau dấu phẩy)</label>
          <input value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            placeholder="SS14491, SS14495"
            className="mt-1 w-64 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm font-mono" />
        </div>
        <button type="submit" className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg">Lọc</button>
        <span className="ml-auto text-xs text-neutral-500">Tổng: {data.total ?? 0}</span>
      </form>

      <div className="bg-white rounded-xl border border-neutral-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-neutral-500 bg-[#faf8f6]">
            <tr>
              <th className="px-3 py-2 text-left">Ảnh</th>
              <th className="px-3 py-2 text-left">Đơn</th>
              <th className="px-3 py-2 text-left">Mặt</th>
              <th className="px-3 py-2 text-right">Số sticker</th>
              <th className="px-3 py-2 text-right">SL tờ</th>
              <th className="px-3 py-2 text-left">Mẫu</th>
              <th className="px-3 py-2 text-left">Seller</th>
              <th className="px-3 py-2 text-left">Ngày tạo đơn</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {loading ? (
              <tr><td colSpan={8} className="p-6 text-center text-neutral-400">Loading…</td></tr>
            ) : data.data.length === 0 ? (
              <tr><td colSpan={8} className="p-6 text-center text-neutral-400">Chưa có sheet nào. Bấm "Phân tích sheet mới".</td></tr>
            ) : data.data.map(r => (
              <tr key={r.id} onClick={() => onOpen(r)} className="hover:bg-orange-50/40 cursor-pointer">
                <td className="px-3 py-1.5">
                  <img src={thumb(r.source_url, 'w120')} alt="" loading="lazy" className="h-14 w-10 object-contain bg-neutral-100 rounded" />
                </td>
                <td className="px-3 py-1.5 font-mono text-xs text-orange-600">{r.order?.system_id || `#${r.order_id}`}</td>
                <td className="px-3 py-1.5 text-xs text-neutral-600">{r.meta_key}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-semibold">
                  {r.sticker_count}
                  {r.count_edited && <span className="ml-1 text-[10px] text-amber-600 font-normal" title={`Máy đếm ${r.auto_count}`}>sửa</span>}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.order_item?.quantity ?? '—'}</td>
                <td className="px-3 py-1.5 text-xs">
                  {r.template
                    ? <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">{r.template.name}</span>
                    : <span className="text-neutral-400">—</span>}
                </td>
                <td className="px-3 py-1.5 text-xs text-neutral-600">{r.order?.user?.name || '—'}</td>
                <td className="px-3 py-1.5 text-xs text-neutral-500">{r.order?.created_at ? new Date(r.order.created_at).toLocaleDateString('vi-VN') : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.last_page > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <button disabled={filters.page <= 1} onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}
            className="px-3 py-1 rounded border border-neutral-200 disabled:opacity-40">‹</button>
          <span className="text-neutral-600">Trang {data.current_page}/{data.last_page}</span>
          <button disabled={filters.page >= data.last_page} onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
            className="px-3 py-1 rounded border border-neutral-200 disabled:opacity-40">›</button>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- summary

const STATUS_LABEL = { 0: 'New', 1: 'Processing', 2: 'Wrong size', 3: 'Fixed', 4: 'Reprint', 5: 'On hold', 6: 'Shipped', 7: 'Cancelled', 8: 'Resend' };
const OPEN_STATUSES = [0, 1, 2, 3, 4, 5, 8];   // default scope: not shipped / cancelled

// "Tìm System ID": one or many IDs (comma / space / newline), substring match.
const parseSearch = (q) => String(q || '').split(/[\s,;]+/).map(t => t.trim().toUpperCase()).filter(Boolean);
const orderMatches = (terms) => (o) => !terms.length || terms.some(t => String(o.system_id || '').toUpperCase().includes(t));

// A single-tab group narrowed to the searched orders. Its analysis ids follow,
// so "Tạo gang" / "Chia partner" act on just those orders.
const narrowGroup = (g, match, active) => {
  if (!active) return g;
  const orders = g.orders.filter(match);
  const ids = orders.flatMap(o => o.analysis_ids || []);
  return { ...g, orders, analysis_ids: ids.length ? ids : g.analysis_ids };
};

// Ganged state of an order / design: all its _qr on a gang, some, or none.
const gangState = (x) => (!x?.qr_total ? 'none' : x.qr_ganged >= x.qr_total ? 'done' : x.qr_ganged > 0 ? 'part' : 'none');

function GangBadge({ x }) {
  const st = gangState(x);
  if (st === 'done') return <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-semibold whitespace-nowrap">✓ Đã gang</span>;
  if (st === 'part') return <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold whitespace-nowrap">Gang {x.qr_ganged}/{x.qr_total}</span>;
  return <span className="px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500 text-[10px] whitespace-nowrap">Chưa gang</span>;
}

// Order chip in a group: green once ganged, amber when part-ganged.
const orderChipCls = (o) => ({
  done: 'bg-emerald-50 border-emerald-300 text-emerald-700',
  part: 'bg-amber-50 border-amber-300 text-amber-700',
  none: 'bg-[#faf8f6] border-neutral-200 text-neutral-700',
})[gangState(o)];

// Open orders grouped by the sheet they print — one card per template, then
// repeats with no template yet. Each card carries its ID list for copying.
function SummaryTab({ onOpen, onSaved }) {
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(null);   // unmatched group index being saved
  const [statuses, setStatuses] = useState(() => new Set(OPEN_STATUSES));
  // single = orders printing one sheet; multi = 2+ sheets, possibly mixed designs.
  const [mode, setMode] = useState('single');

  const load = (st = statuses, m = mode) => {
    setData(null);
    return api.get('/sticker-sheets/summary', { params: { mode: m, statuses: [...st] } }).then(res => setData(res.data))
      .catch(err => { setData({ groups: [], unmatched: [], orders: [], design_options: [], not_analysed: [], totals: {}, counts: {} }); notify(err?.response?.data?.message || 'Không tải được tổng hợp', { title: 'Sticker Sheet', kind: 'error' }); });
  };
  const [design, setDesign] = useState('');   // multi: show orders containing this design key
  const [hideGanged, setHideGanged] = useState(false);
  const [search, setSearch] = useState('');
  const terms = parseSearch(search);
  const match = orderMatches(terms);
  const searching = terms.length > 0;
  // Partner the gangs go to: new gangs on create, made gangs via "Chia partner".
  const [partners, setPartners] = useState([]);
  const [partnerId, setPartnerId] = useState('');
  useEffect(() => {
    api.get('/gangsheets/partner-users').then(res => setPartners(res.data || [])).catch(() => {});
  }, []);
  const partnerName = partners.find(p => String(p.id) === String(partnerId))?.name;

  // Hand the gangs ALREADY made for these designs to the chosen partner, or
  // take them back from whoever has them (remove = true).
  const assignPartner = async (analysisIds, label, { remove = false } = {}) => {
    if (!analysisIds?.length) return;
    if (!remove && !partnerId) return;
    const ok = await askConfirm(
      !remove
        ? `Chia các gang đã tạo của ${label} cho ${partnerName}?\nĐơn trong gang cũng được giao cho partner này (đơn đã chốt giữ nguyên).`
        : `Gỡ partner khỏi các gang đã tạo của ${label}?\nĐơn được trả lại, số tiền partner đã tính bị xoá (đơn đã chốt giữ nguyên).`,
      { title: remove ? 'Gỡ partner' : 'Chia partner', okText: remove ? 'Gỡ partner' : 'Chia' },
    );
    if (!ok) return;
    try {
      const res = await api.post('/sticker-sheets/assign-partner', {
        analysis_ids: analysisIds, user_ids: remove ? [] : [Number(partnerId)],
      });
      notify(res.data?.message, { title: 'Chia partner', kind: res.data?.gangs ? 'success' : 'info' });
      load();
    } catch (err) {
      notify(err?.response?.data?.message || 'Chia partner thất bại', { title: 'Chia partner', kind: 'error' });
    }
  };
  const [ganging, setGanging] = useState(null); // { label, done, total, system_id }

  // Gang the _qr of these analysed designs: one gang per _qr, tagged by the
  // hub with its template. Only unproduced _qr of open orders are taken.
  const makeGangs = async (analysisIds, label) => {
    if (ganging || !analysisIds?.length) return;
    try {
      setGanging({ label, done: 0, total: 0 });
      const src = (await api.post('/sticker-sheets/gang-source', { analysis_ids: analysisIds })).data;
      const orders = src.orders || [];
      const qrCount = orders.reduce((n, o) => n + o.items.reduce((m, it) => m + it.metas.length, 0), 0);
      const skipNote = src.skipped?.length ? `\n${src.skipped.length} đơn không còn _qr để gang (chưa convert hoặc đã có gang).` : '';
      if (qrCount === 0) {
        setGanging(null);
        notify(`Không có _qr nào để tạo gang.${skipNote}`, { title: 'Tạo gang', kind: 'error' });
        return;
      }
      const ok = await askConfirm(
        `Tạo ${qrCount} gang (mỗi _qr 1 gang) cho ${orders.length} đơn — ${label}?`
        + (partnerName ? `\nChia luôn cho partner: ${partnerName}.` : '') + skipNote,
        { title: 'Tạo gang Sticker Sheet', okText: `Tạo ${qrCount} gang` },
      );
      if (!ok) { setGanging(null); return; }
      const created = await createStickerGangs(orders, {
        onProgress: (p) => setGanging({ label, ...p }),
      });
      // Same hand-off as the Compose tab: each new gang (and its orders) to the partner.
      let shared = 0;
      if (partnerId) {
        for (const g of created) {
          try { await api.put(`/gangsheets/${g.id}/partners`, { user_ids: [Number(partnerId)] }); shared++; }
          catch (e) { console.error('[sticker] partner assign failed', e); }
        }
      }
      const shareNote = partnerId ? ` · chia ${shared}/${created.length} gang cho ${partnerName}` : '';
      notify(`Đã tạo ${created.length} gang${shareNote} — xem ở Gangsheet → Manage (lọc theo mẫu).${skipNote}`, { title: 'Tạo gang', kind: 'success' });
      load();
    } catch (err) {
      notify(err?.response?.data?.message || err?.message || 'Tạo gang thất bại', { title: 'Tạo gang', kind: 'error' });
    } finally {
      setGanging(null);
    }
  };
  const pickMode = (m) => { setMode(m); setDesign(''); load(statuses, m); };
  useEffect(() => { load(); }, []);

  const toggleStatus = (k) => {
    const next = new Set(statuses);
    next.has(k) ? next.delete(k) : next.add(k);
    if (next.size === 0) return;   // keep at least one
    setStatuses(next);
    load(next);
  };
  const setPreset = (list) => { const next = new Set(list); setStatuses(next); load(next); };

  const statusFilter = (
    <div className="bg-white rounded-xl border border-neutral-200 p-3 flex flex-wrap items-center gap-1.5">
      <div className="flex rounded-lg overflow-hidden border border-neutral-200 mr-3">
        {[['single', 'Single (1 tờ)'], ['multi', 'Multi (2+ tờ)']].map(([m, label]) => (
          <button key={m} onClick={() => pickMode(m)}
            className={`px-3 py-1.5 text-sm ${mode === m ? 'bg-neutral-800 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'}`}>
            {label}{data?.counts?.[m] != null && <span className="ml-1 opacity-70">({data.counts[m]})</span>}
          </button>
        ))}
      </div>
      <span className="text-xs text-neutral-500 mr-1">Trạng thái đơn:</span>
      {Object.entries(STATUS_LABEL).map(([k, label]) => {
        const on = statuses.has(Number(k));
        return (
          <button key={k} onClick={() => toggleStatus(Number(k))}
            className={`px-2.5 py-1 text-xs rounded-full border ${on ? 'bg-orange-500 border-orange-500 text-white' : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50'}`}>
            {label}
          </button>
        );
      })}
      <span className="mx-1 text-neutral-300">|</span>
      <button onClick={() => setPreset(OPEN_STATUSES)} className="px-2 py-1 text-xs text-neutral-600 underline">Đang làm</button>
      <button onClick={() => setPreset(Object.keys(STATUS_LABEL).map(Number))} className="px-2 py-1 text-xs text-neutral-600 underline">Tất cả</button>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm System ID (nhiều, cách nhau dấu phẩy)"
        className="w-64 px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded text-xs font-mono" />
      <label className="ml-auto flex items-center gap-1.5 text-xs text-neutral-600">
        Partner
        <select value={partnerId} onChange={e => setPartnerId(e.target.value)}
          className="px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded text-xs"
          title="Tạo gang sẽ chia luôn cho partner này; nút Chia partner chia các gang đã tạo">
          <option value="">Không chia</option>
          {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-xs text-neutral-600 cursor-pointer">
        <input type="checkbox" checked={hideGanged} onChange={e => setHideGanged(e.target.checked)} className="accent-orange-500" />
        Ẩn đơn đã gang
      </label>
    </div>
  );

  const saveGroup = async (g, name) => {
    try {
      const res = await api.post('/sticker-templates', {
        name, from_analysis_id: g.sample_analysis_id, sticker_count: g.sticker_count, analysis_ids: g.analysis_ids,
      });
      notify(`${res.data.message} — gán ${res.data.assigned} sheet`, { title: 'Lưu mẫu', kind: 'success' });
      setSaving(null);
      load();
      onSaved?.();
    } catch (err) {
      notify(err?.response?.data?.message || 'Lưu mẫu thất bại', { title: 'Lưu mẫu', kind: 'error' });
    }
  };

  if (data === null) return <div className="space-y-4">{statusFilter}<p className="text-sm text-neutral-400">Đang tổng hợp…</p></div>;

  return (
    <div className="space-y-4">
      {statusFilter}
      {ganging && (
        <div className="px-3 py-2 rounded-lg bg-orange-50 border border-orange-200 text-sm text-orange-800">
          Đang tạo gang · {ganging.label}{ganging.total ? ` · ${ganging.done}/${ganging.total}` : ' · đang lấy đơn…'}
          {ganging.system_id && <span className="font-mono"> · {ganging.system_id}</span>}
        </div>
      )}
      <div className="flex flex-wrap gap-3 text-sm">
        <span className="px-3 py-1.5 rounded-lg bg-white border border-neutral-200">
          <b>{data.totals?.orders ?? 0}</b> đơn · <b>{data.totals?.sheets ?? 0}</b> tờ
        </span>
        {mode === 'single' ? (
          <span className="px-3 py-1.5 rounded-lg bg-white border border-neutral-200">
            <b>{data.groups.length}</b> mẫu · <b>{data.unmatched.length}</b> nhóm chưa có mẫu
          </span>
        ) : null}
        {data.not_analysed.length > 0 && (
          <span className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700"
            title={data.not_analysed.join(', ')}>
            {data.not_analysed.length} đơn chưa phân tích — bấm "Phân tích sheet mới"
          </span>
        )}
      </div>

      {mode === 'multi' && <MultiOrders orders={(data.orders || []).filter(o => (!hideGanged || gangState(o) !== 'done') && match(o))} options={data.design_options || []}
        design={design} onDesign={setDesign} onOpen={onOpen} onGang={makeGangs} busy={!!ganging}
        onAssign={assignPartner} partnerName={partnerName} />}

      {mode === 'single' && data.groups.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-neutral-700">Theo mẫu</h3>
          {data.groups.map(g0 => narrowGroup(g0, match, searching)).filter(g => !searching || g.orders.length).map(g => <SummaryCard key={`t${g.template.id}`} g={g} onOpen={onOpen} hideGanged={hideGanged}
            action={<>
              <GangButton busy={!!ganging} onClick={() => makeGangs(g.analysis_ids, g.label)} />
              <PartnerButtons g={g} partnerName={partnerName}
                onAssign={() => assignPartner(g.analysis_ids, g.label)}
                onRemove={() => assignPartner(g.analysis_ids, g.label, { remove: true })} />
            </>} />)}
        </div>
      )}

      {mode === 'single' && data.unmatched.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-neutral-700">Chưa có mẫu</h3>
          {data.unmatched.map((g0, i) => [narrowGroup(g0, match, searching), i]).filter(([g]) => !searching || g.orders.length).map(([g, i]) => (
            <SummaryCard key={`u${i}`} g={g} onOpen={onOpen} hideGanged={hideGanged}
              action={saving === i
                ? <SaveTemplateForm onCancel={() => setSaving(null)} onSave={(name) => saveGroup(g, name)} />
                : <>
                    <button onClick={() => setSaving(i)} className="px-3 py-1 text-xs rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white">Lưu làm mẫu</button>
                    <GangButton busy={!!ganging} onClick={() => makeGangs(g.analysis_ids, g.label)} />
                    <PartnerButtons g={g} partnerName={partnerName}
                      onAssign={() => assignPartner(g.analysis_ids, g.label)}
                      onRemove={() => assignPartner(g.analysis_ids, g.label, { remove: true })} />
                  </>} />
          ))}
        </div>
      )}

      {searching && mode === 'single' && ![...data.groups, ...data.unmatched].some(g => g.orders.some(match)) && (
        <p className="text-sm text-neutral-500">Không tìm thấy System ID này trong các trạng thái đang chọn.</p>
      )}

      {data.groups.length === 0 && data.unmatched.length === 0 && (data.orders || []).length === 0 && (
        <p className="text-sm text-neutral-500">Không có đơn Sticker Sheet nào đã phân tích ở các trạng thái đang chọn.</p>
      )}
    </div>
  );
}

// A group's IDs in two labelled rows — still to gang, then already ganged —
// so it is obvious at a glance which orders are done.
function OrderChipRows({ orders }) {
  const todo = orders.filter(o => gangState(o) !== 'done');
  const done = orders.filter(o => gangState(o) === 'done');
  const chip = (o) => (
    <span key={o.order_id} className={`px-1.5 py-0.5 rounded border text-[11px] font-mono ${orderChipCls(o)}`}
      title={`${STATUS_LABEL[o.status] || ''}${gangState(o) === 'part' ? ` · gang ${o.qr_ganged}/${o.qr_total}` : ''}${o.partner ? ` · partner ${o.partner.name}` : ''}`}>
      {gangState(o) === 'done' && '✓ '}{o.system_id}{o.sheets > 1 && <span className="text-orange-600"> ×{o.sheets}</span>}
      {o.partner && <span className="ml-1 text-sky-600 font-sans">· {o.partner.name}</span>}
    </span>
  );
  const row = (label, cls, list) => list.length > 0 && (
    <div className="flex gap-2">
      <span className={`shrink-0 w-24 text-[11px] font-semibold pt-0.5 ${cls}`}>{label} ({list.length})</span>
      <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">{list.map(chip)}</div>
    </div>
  );
  return (
    <div className="space-y-1.5">
      {row('Chưa gang', 'text-neutral-600', todo)}
      {row('✓ Đã gang', 'text-emerald-700', done)}
      {orders.length === 0 && <span className="text-xs text-neutral-400">Đã gang hết.</span>}
    </div>
  );
}

function SummaryCard({ g, onOpen, action, hideGanged }) {
  const orders = hideGanged ? g.orders.filter(o => gangState(o) !== 'done') : g.orders;
  const ids = orders.map(o => o.system_id).filter(Boolean);
  const copy = async () => {
    try { await navigator.clipboard.writeText(ids.join('\n')); notify(`Đã copy ${ids.length} ID`, { title: 'Copy', kind: 'success' }); }
    catch { notify('Không copy được', { title: 'Copy', kind: 'error' }); }
  };
  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-3 flex gap-4">
      <button type="button" onClick={() => onOpen?.({ id: g.sample_analysis_id, _load: true })} title="Xem thiết kế"
        className="shrink-0">
        <img src={thumb(g.sample_url, 'w400')} alt="" loading="lazy" className="h-48 w-32 object-contain bg-neutral-100 rounded" />
      </button>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {g.template
            ? <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 text-sm font-semibold">{g.template.name}</span>
            : <span className="px-2 py-0.5 rounded bg-neutral-100 text-neutral-600 text-sm">{g.label || 'Chưa có mẫu'}</span>}
          <span className="text-sm text-neutral-700"><b>{g.orders_count}</b> đơn · <b>{g.sheets}</b> tờ · {g.sticker_count} sticker/tờ</span>
          {g.orders_ganged != null && (
            <span className={`text-xs ${g.orders_ganged >= g.orders_count ? 'text-emerald-700' : 'text-neutral-500'}`}>
              ✓ {g.orders_ganged}/{g.orders_count} đơn đã gang
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {action}
            <button onClick={copy} className="px-3 py-1 text-xs rounded-lg border border-neutral-200 hover:bg-neutral-50">Copy ID ({ids.length})</button>
          </div>
        </div>
        {g.template?.note && <div className="text-[11px] text-neutral-500">{g.template.note}</div>}
        <OrderChipRows orders={orders} />
      </div>
    </div>
  );
}

// Multi tab: one row per order with what it prints (design × sheets), filtered
// to the orders containing the chosen design.
function GangButton({ onClick, busy }) {
  return (
    <button onClick={onClick} disabled={busy}
      className="px-3 py-1 text-xs rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white"
      title="Mỗi _qr chưa gang thành 1 gang riêng, gắn mẫu này">Tạo gang</button>
  );
}

// "Chia" needs a partner picked in the filter bar; "Gỡ partner" only shows
// when some order here is actually with a partner.
function PartnerButtons({ g, partnerName, onAssign, onRemove }) {
  const anyAssigned = (g.orders || []).some(o => o.partner);
  return (
    <>
      <button onClick={onAssign} disabled={!partnerName}
        className="px-3 py-1 text-xs rounded-lg border border-sky-300 text-sky-700 hover:bg-sky-50 disabled:opacity-40"
        title={partnerName ? `Chia các gang đã tạo cho ${partnerName}` : 'Chọn Partner ở thanh lọc trước'}>
        {partnerName ? `Chia ${partnerName}` : 'Chia partner'}
      </button>
      {anyAssigned && (
        <button onClick={onRemove}
          className="px-3 py-1 text-xs rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
          title="Lấy gang về, trả đơn lại (đơn đã chốt giữ nguyên)">Gỡ partner</button>
      )}
    </>
  );
}

function MultiOrders({ orders, options, design, onDesign, onOpen, onGang, busy, onAssign, partnerName }) {
  const shown = design ? orders.filter(o => o.parts.some(p => p.key === design)) : orders;
  // Ticked orders; the actions run on them, or on every shown order when none is ticked.
  const [picked, setPicked] = useState(() => new Set());
  const pickedShown = shown.filter(o => picked.has(o.order_id));
  const target = pickedShown.length ? pickedShown : shown;
  const scope = pickedShown.length ? `${pickedShown.length} đơn đã chọn` : `${shown.length} đơn`;
  const allPicked = shown.length > 0 && shown.every(o => picked.has(o.order_id));
  const togglePick = (id) => setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const togglePickAll = () => setPicked(prev => {
    const n = new Set(prev);
    if (allPicked) shown.forEach(o => n.delete(o.order_id)); else shown.forEach(o => n.add(o.order_id));
    return n;
  });
  // With a design picked, gang only that design's sheets of these orders.
  const gangIds = target.flatMap(o => o.parts.filter(p => !design || p.key === design).flatMap(p => p.analysis_ids || []));
  const designLabel = design ? (options.find(o => o.key === design)?.label || '') : 'tất cả mẫu';
  const ids = target.map(o => o.system_id).filter(Boolean);
  const copy = async () => {
    try { await navigator.clipboard.writeText(ids.join('\n')); notify(`Đã copy ${ids.length} ID`, { title: 'Copy', kind: 'success' }); }
    catch { notify('Không copy được', { title: 'Copy', kind: 'error' }); }
  };

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-neutral-200 p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-neutral-500 block">Mẫu thiết kế</label>
          <ImagePicker value={design} onChange={onDesign} allLabel={`Tất cả (${orders.length} đơn)`}
            options={options.map(o => ({ value: o.key, label: o.label, image: o.sample_url, sub: `${o.orders} đơn · ${o.sheets} tờ` }))} />
        </div>
        <span className="text-sm text-neutral-600"><b>{shown.length}</b> đơn · <b>{shown.reduce((n, o) => n + o.sheets, 0)}</b> tờ</span>
        {pickedShown.length > 0 && (
          <span className="text-sm text-orange-700">
            Đã chọn <b>{pickedShown.length}</b> đơn
            <button onClick={() => setPicked(new Set())} className="ml-2 text-xs text-neutral-500 underline">Bỏ chọn</button>
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <button onClick={copy} disabled={!ids.length}
            className="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 hover:bg-neutral-50 disabled:opacity-40">Copy ID ({ids.length})</button>
          <button onClick={() => onAssign(gangIds, `multi · ${designLabel}`)} disabled={!gangIds.length || !partnerName}
            className="px-3 py-1.5 text-xs rounded-lg border border-sky-300 text-sky-700 hover:bg-sky-50 disabled:opacity-40"
            title={partnerName ? '' : 'Chọn Partner ở thanh lọc trước'}>
            {partnerName ? `Chia ${partnerName}` : 'Chia partner'} ({scope})
          </button>
          {target.some(o => o.partner) && (
            <button onClick={() => onAssign(gangIds, `multi · ${designLabel}`, { remove: true })}
              className="px-3 py-1.5 text-xs rounded-lg border border-red-200 text-red-600 hover:bg-red-50">Gỡ partner</button>
          )}
          <button onClick={() => onGang(gangIds, `multi · ${designLabel}`)} disabled={busy || !gangIds.length}
            className="px-3 py-1.5 text-xs rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white"
            title={design ? 'Tạo gang các tờ của mẫu đang lọc trong các đơn này' : 'Tạo gang mọi tờ của các đơn này'}>
            Tạo gang ({scope})
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-neutral-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-neutral-500 bg-[#faf8f6]">
            <tr>
              <th className="px-3 py-2 w-8">
                <input type="checkbox" checked={allPicked} onChange={togglePickAll} className="accent-orange-500" title="Chọn tất cả đơn đang hiện" />
              </th>
              <th className="px-3 py-2 text-left">Đơn</th>
              <th className="px-3 py-2 text-left">Trạng thái</th>
              <th className="px-3 py-2 text-right">Tờ</th>
              <th className="px-3 py-2 text-left">Gang</th>
              <th className="px-3 py-2 text-left">Partner</th>
              <th className="px-3 py-2 text-left">Mẫu trong đơn</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {shown.length === 0 ? (
              <tr><td colSpan={7} className="p-6 text-center text-neutral-400">Không có đơn.</td></tr>
            ) : shown.map(o => (
              <tr key={o.order_id} className={`align-top ${picked.has(o.order_id) ? 'bg-orange-50/60' : ''}`}>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={picked.has(o.order_id)} onChange={() => togglePick(o.order_id)} className="accent-orange-500" />
                </td>
                <td className="px-3 py-2 font-mono text-xs text-orange-600 whitespace-nowrap">{o.system_id}</td>
                <td className="px-3 py-2 text-xs text-neutral-600 whitespace-nowrap">{STATUS_LABEL[o.status] || o.status}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{o.sheets}</td>
                <td className="px-3 py-2"><GangBadge x={o} /></td>
                <td className="px-3 py-2 text-xs text-sky-700 whitespace-nowrap">{o.partner?.name || <span className="text-neutral-400">—</span>}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    {o.parts.map(p => (
                      <button key={p.key} type="button" onClick={() => onOpen?.({ id: p.sample_analysis_id, _load: true })}
                        className={`flex gap-2 items-center p-1.5 rounded-lg border text-left hover:bg-orange-50/40 ${design === p.key ? 'border-orange-400 bg-orange-50' : 'border-neutral-200'}`}
                        title="Xem thiết kế">
                        <img src={thumb(p.sample_url, 'w120')} alt="" loading="lazy" className="h-14 w-10 object-contain bg-neutral-100 rounded" />
                        <div>
                          <div className={`text-xs font-semibold ${p.template ? 'text-emerald-700' : 'text-neutral-500'}`}>{p.label}</div>
                          <div className="text-xs text-orange-600 font-semibold">× {p.qty} tờ</div>
                          <div className="text-[10px] text-neutral-400">{p.sticker_count} sticker/tờ</div>
                          <div className="mt-0.5"><GangBadge x={p} /></div>
                        </div>
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ groups

function GroupsTab({ onSaved }) {
  const [groups, setGroups] = useState(null);
  const [saving, setSaving] = useState(null);   // group being saved as template

  const load = () => api.get('/sticker-sheets/groups').then(res => setGroups(res.data?.groups || [])).catch(() => setGroups([]));
  useEffect(() => { load(); }, []);

  const saveGroup = async (g, name) => {
    try {
      const res = await api.post('/sticker-templates', {
        name, from_analysis_id: g.sample.id, sticker_count: g.sticker_count, analysis_ids: g.analysis_ids,
      });
      notify(`${res.data.message} — gán ${res.data.assigned} sheet`, { title: 'Lưu mẫu', kind: 'success' });
      setSaving(null);
      load();
      onSaved?.();
    } catch (err) {
      notify(err?.response?.data?.message || 'Lưu mẫu thất bại', { title: 'Lưu mẫu', kind: 'error' });
    }
  };

  if (groups === null) return <p className="text-sm text-neutral-400">Đang gom nhóm…</p>;
  if (groups.length === 0) return <p className="text-sm text-neutral-500">Không có sheet nào lặp lại ngoài các mẫu đã lưu.</p>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {groups.map((g, i) => (
        <div key={i} className="bg-white rounded-xl border border-neutral-200 p-3 flex gap-3">
          <img src={thumb(g.sample.url, 'w240')} alt="" loading="lazy" className="h-36 w-24 object-contain bg-neutral-100 rounded shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="text-sm font-semibold text-neutral-800">
              {g.size} sheet · {g.orders.length} đơn · {g.sticker_count} sticker
            </div>
            {Object.keys(g.counts).length > 1 && (
              <div className="text-[11px] text-amber-600">Số đếm khác nhau: {Object.entries(g.counts).map(([c, n]) => `${c} (${n})`).join(', ')}</div>
            )}
            <div className="text-[11px] font-mono text-neutral-600 max-h-16 overflow-y-auto break-words">{g.orders.join(', ')}</div>
            {saving === i ? (
              <SaveTemplateForm defaultCount={g.sticker_count} onCancel={() => setSaving(null)}
                onSave={(name) => saveGroup(g, name)} />
            ) : (
              <button onClick={() => setSaving(i)}
                className="px-3 py-1 text-xs rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white">Lưu làm mẫu</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function SaveTemplateForm({ onSave, onCancel, defaultName = '' }) {
  const [name, setName] = useState(defaultName);
  return (
    <form onSubmit={e => { e.preventDefault(); if (name.trim()) onSave(name.trim()); }} className="flex gap-1.5">
      <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Tên mẫu, vd: Racing 42"
        className="flex-1 min-w-0 px-2 py-1 text-xs bg-[#faf8f6] border border-neutral-200 rounded" />
      <button type="submit" disabled={!name.trim()} className="px-2 py-1 text-xs rounded bg-emerald-500 text-white disabled:opacity-40">Lưu</button>
      <button type="button" onClick={onCancel} className="px-2 py-1 text-xs rounded bg-neutral-100 text-neutral-600">Huỷ</button>
    </form>
  );
}

// --------------------------------------------------------------- templates

function TemplatesTab({ templates, onChanged, onOpenTemplate }) {
  const [editing, setEditing] = useState(null);   // { id, name, sticker_count, note }

  const save = async () => {
    try {
      await api.put(`/sticker-templates/${editing.id}`, {
        name: editing.name, note: editing.note || null, sticker_count: Number(editing.sticker_count) || 0,
      });
      setEditing(null);
      onChanged?.();
    } catch (err) {
      notify(err?.response?.data?.message || 'Lưu thất bại', { title: 'Mẫu', kind: 'error' });
    }
  };

  const remove = async (t) => {
    const ok = await askConfirm(`Xoá mẫu "${t.name}"?\n${t.analyses_count} sheet sẽ về "chưa có mẫu".`, { title: 'Xoá mẫu', okText: 'Xoá' });
    if (!ok) return;
    await api.delete(`/sticker-templates/${t.id}`);
    onChanged?.();
  };

  const rematch = async () => {
    const res = await api.post('/sticker-templates/rematch');
    notify(res.data?.message, { title: 'Khớp lại mẫu', kind: 'success' });
    onChanged?.();
  };

  if (templates.length === 0) {
    return <p className="text-sm text-neutral-500">Chưa có mẫu. Lưu mẫu từ tab "Giống nhau" hoặc từ chi tiết một sheet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex">
        <button onClick={rematch} className="ml-auto px-3 py-1.5 text-sm rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50"
          title="So lại mọi sheet chưa có mẫu với các mẫu hiện có">Khớp lại sheet chưa có mẫu</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {templates.map(t => (
          <div key={t.id} className="bg-white rounded-xl border border-neutral-200 p-3 flex gap-3">
            <img src={thumb(t.sample_url, 'w240')} alt="" loading="lazy" className="h-36 w-24 object-contain bg-neutral-100 rounded shrink-0" />
            {editing?.id === t.id ? (
              <div className="flex-1 space-y-1.5">
                <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                  className="w-full px-2 py-1 text-sm bg-[#faf8f6] border border-neutral-200 rounded" />
                <label className="text-[11px] text-neutral-500 flex items-center gap-1.5">Số sticker
                  <input type="number" min="0" value={editing.sticker_count} onChange={e => setEditing({ ...editing, sticker_count: e.target.value })}
                    className="w-20 px-2 py-1 text-sm bg-[#faf8f6] border border-neutral-200 rounded" />
                </label>
                <textarea rows={2} value={editing.note || ''} onChange={e => setEditing({ ...editing, note: e.target.value })} placeholder="Ghi chú"
                  className="w-full px-2 py-1 text-xs bg-[#faf8f6] border border-neutral-200 rounded" />
                <div className="flex gap-1.5">
                  <button onClick={save} className="px-2 py-1 text-xs rounded bg-emerald-500 text-white">Lưu</button>
                  <button onClick={() => setEditing(null)} className="px-2 py-1 text-xs rounded bg-neutral-100 text-neutral-600">Huỷ</button>
                </div>
              </div>
            ) : (
              <div className="flex-1 min-w-0 space-y-1">
                <div className="text-sm font-semibold text-neutral-800 break-words">{t.name}</div>
                <div className="text-xs text-neutral-600">{t.sticker_count} sticker / tờ</div>
                <div className="text-xs text-neutral-600">{t.orders_count} đơn · {t.analyses_count} sheet</div>
                {t.note && <div className="text-[11px] text-neutral-500 whitespace-pre-wrap">{t.note}</div>}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <button onClick={() => onOpenTemplate(t)} className="px-2 py-0.5 text-[11px] rounded border border-neutral-200 hover:bg-neutral-50">Xem đơn</button>
                  <button onClick={() => setEditing({ id: t.id, name: t.name, sticker_count: t.sticker_count, note: t.note })}
                    className="px-2 py-0.5 text-[11px] rounded border border-neutral-200 hover:bg-neutral-50">Sửa</button>
                  <button onClick={() => remove(t)} className="px-2 py-0.5 text-[11px] rounded border border-red-200 text-red-600 hover:bg-red-50">Xoá</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ detail modal

function AnalysisModal({ row, templates, onClose, onChanged }) {
  // Opened from a summary card with only an id → load the full row.
  if (row._load) return <LoadAnalysis id={row.id} templates={templates} onClose={onClose} onChanged={onChanged} />;
  return <AnalysisModalBody row={row} templates={templates} onClose={onClose} onChanged={onChanged} />;
}

function LoadAnalysis({ id, ...rest }) {
  const [row, setRow] = useState(null);
  useEffect(() => {
    api.get(`/sticker-sheets/analyses/${id}`).then(res => setRow(res.data))
      .catch(() => { notify('Không tải được sheet', { title: 'Sticker Sheet', kind: 'error' }); rest.onClose(); });
  }, [id]);
  if (!row) return null;
  return <AnalysisModalBody row={row} {...rest} />;
}

function AnalysisModalBody({ row, templates, onClose, onChanged }) {
  const [r, setR] = useState(row);
  const [count, setCount] = useState(String(row.sticker_count));
  const [savingTpl, setSavingTpl] = useState(false);
  const [showBoxes, setShowBoxes] = useState(true);

  const put = async (body) => {
    try {
      const res = await api.put(`/sticker-sheets/analyses/${r.id}`, body);
      setR(prev => ({ ...prev, ...res.data.analysis }));
      if (res.data.same_file > 1) {
        notify(`Đã áp dụng cho ${res.data.same_file} sheet dùng cùng file thiết kế.`, { title: 'Sticker Sheet', kind: 'success' });
      }
      onChanged?.();
    } catch (err) {
      notify(err?.response?.data?.message || 'Lưu thất bại', { title: 'Sticker Sheet', kind: 'error' });
    }
  };

  const saveAsTemplate = async (name) => {
    try {
      const res = await api.post('/sticker-templates', { name, from_analysis_id: r.id, sticker_count: Number(count) || r.sticker_count });
      notify(`${res.data.message} — gán ${res.data.assigned} sheet`, { title: 'Lưu mẫu', kind: 'success' });
      setR(prev => ({ ...prev, template_id: res.data.template.id, template: res.data.template }));
      setSavingTpl(false);
      onChanged?.();
    } catch (err) {
      notify(err?.response?.data?.message || 'Lưu mẫu thất bại', { title: 'Lưu mẫu', kind: 'error' });
    }
  };

  const boxes = Array.isArray(r.boxes) ? r.boxes : [];

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6">
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-[92vw] max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200 flex items-center gap-3">
          <h3 className="text-sm font-semibold text-neutral-800">
            <span className="font-mono text-orange-600">{r.order?.system_id}</span> · {r.meta_key}
          </h3>
          <a href={r.source_url} target="_blank" rel="noreferrer" className="text-xs text-orange-500 underline">mở ảnh gốc</a>
          <button onClick={onClose} className="ml-auto text-neutral-500 hover:text-neutral-800 text-xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          <div className="flex-1 overflow-auto bg-neutral-100 p-3">
            {/* Boxes are stored as fractions, so they overlay the thumbnail at any size. */}
            <div className="relative inline-block">
              <img src={thumb(r.source_url, 'w1200')} alt="" className="max-h-[75vh] block" />
              {showBoxes && boxes.map(([x, y, w, h], i) => (
                <div key={i} className="absolute border-2 border-emerald-500"
                  style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}>
                  <span className="absolute -top-0.5 -left-0.5 px-1 text-[10px] font-bold bg-emerald-500 text-white leading-tight">{i + 1}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="w-full md:w-72 border-t md:border-t-0 md:border-l border-neutral-200 p-4 space-y-4 overflow-y-auto">
            <div>
              <div className="text-xs text-neutral-500">Số sticker</div>
              <div className="flex items-center gap-2 mt-1">
                <input type="number" min="0" value={count} onChange={e => setCount(e.target.value)}
                  className="w-24 px-2 py-1 text-lg font-semibold bg-[#faf8f6] border border-neutral-200 rounded" />
                <button disabled={Number(count) === r.sticker_count} onClick={() => put({ sticker_count: Number(count) || 0 })}
                  className="px-2 py-1 text-xs rounded bg-orange-500 text-white disabled:opacity-40">Lưu</button>
              </div>
              <div className="text-[11px] text-neutral-500 mt-1">
                Máy đếm: {r.auto_count}{r.count_edited ? ' (đã sửa tay)' : ''} · khung xanh = sticker máy nhận ra
              </div>
              <label className="flex items-center gap-1.5 text-xs text-neutral-600 mt-1">
                <input type="checkbox" checked={showBoxes} onChange={e => setShowBoxes(e.target.checked)} className="accent-emerald-500" />
                Hiện khung
              </label>
            </div>

            <div>
              <div className="text-xs text-neutral-500">Mẫu</div>
              <select value={r.template_id || ''} onChange={e => put({ template_id: e.target.value ? Number(e.target.value) : null })}
                className="mt-1 w-full px-2 py-1.5 text-sm bg-[#faf8f6] border border-neutral-200 rounded">
                <option value="">— Chưa có mẫu —</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name} ({t.sticker_count})</option>)}
              </select>
              {r.template_id && r.match_distance != null && (
                <div className="text-[11px] text-neutral-500 mt-1">Độ lệch vân tay: {r.match_distance}/256 (≤ 24 là cùng mẫu)</div>
              )}
              <div className="mt-2">
                {savingTpl ? (
                  <SaveTemplateForm onCancel={() => setSavingTpl(false)} onSave={saveAsTemplate} />
                ) : (
                  <button onClick={() => setSavingTpl(true)}
                    className="px-3 py-1 text-xs rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white">Lưu sheet này làm mẫu mới</button>
                )}
              </div>
            </div>

            <div className="text-[11px] text-neutral-500 space-y-0.5">
              <div>Kích thước ảnh: {r.width}×{r.height}</div>
              <div>Kiểu nền: {r.mode === 'transparent' ? 'trong suốt' : 'nền đặc'}</div>
              <div>SL tờ trong đơn: {r.order_item?.quantity ?? '—'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
