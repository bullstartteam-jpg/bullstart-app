import { useState, useEffect } from 'react';
import api from '../services/api';
import { UrlPreview, PreviewModal } from '../components/Preview';
import {
  subscribeDesignCheck, startDesignCheck, stopDesignCheck, runDesignCheckNow,
  isDesignCheckAuto, getCheckStatuses, setCheckStatuses, SPEC, CHECKER_VERSION,
} from '../services/designCheck';

// Card-skin design check. The cron measures every card-skin order's artwork in
// the selected fulfill statuses and records whether it matches the reference
// size and carries a chip cutout the right size for the chip ordered.

const STATUS_OPTIONS = [
  [0, 'new_order'], [1, 'producing'], [2, 'wrongsize'],
  [3, 'fixed'], [4, 'reprint'], [5, 'onhold'],
];

const IN = (px) => (px / 300).toFixed(2);

export default function DesignCheck() {
  const [job, setJob] = useState(null);
  const [statuses, setStatuses] = useState(getCheckStatuses);
  const [rows, setRows] = useState({ data: [] });
  const [verdict, setVerdict] = useState('fail');
  const [loading, setLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => subscribeDesignCheck(setJob), []);
  useEffect(() => { if (isDesignCheckAuto()) startDesignCheck(); }, []);

  const fetchRows = async () => {
    setLoading(true);
    try {
      const params = { per_page: 100 };
      if (verdict) params.status = verdict;
      if (statuses.length) params.statuses = statuses;
      const res = await api.get('/design-checks', { params });
      setRows(res.data);
    } finally { setLoading(false); }
  };
  useEffect(() => { fetchRows(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [verdict]);

  const toggleStatus = (s) => {
    const next = statuses.includes(s) ? statuses.filter(x => x !== s) : [...statuses, s];
    setStatuses(next);
    setCheckStatuses(next);
  };

  const auto = !!job?.enabled;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-xl font-bold text-neutral-800">Design Check (card skin)</h2>
        <p className="text-xs text-neutral-500 mt-1">
          Cron đo kích thước thiết kế và lỗ khoét chip, so với mẫu chuẩn{' '}
          <span className="font-mono">{SPEC.card.w}×{SPEC.card.h}px</span> ({IN(SPEC.card.w)}×{IN(SPEC.card.h)} in) —
          lỗ small chip <span className="font-mono">{SPEC.holes.smallchip.w}×{SPEC.holes.smallchip.h}</span>,
          big chip <span className="font-mono">{SPEC.holes.bigchip.w}×{SPEC.holes.bigchip.h}</span>.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${auto ? (job?.running ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700') : 'bg-neutral-100 text-neutral-500'}`}>
            {!auto ? 'Tắt' : job?.running ? 'Đang chạy' : 'Chờ lượt'}
          </span>
          <button
            onClick={() => (auto ? stopDesignCheck() : startDesignCheck())}
            className={`px-3 py-1.5 text-xs rounded-lg ${auto ? 'bg-neutral-200 text-neutral-700' : 'bg-emerald-500 text-white'}`}
          >
            {auto ? 'Tắt cron' : 'Bật cron'}
          </button>
          <button onClick={() => runDesignCheckNow()} disabled={!auto}
            className="px-3 py-1.5 text-xs rounded-lg bg-blue-100 text-blue-700 disabled:opacity-40">
            Chạy ngay
          </button>
          <span className="text-xs text-neutral-500">
            chờ đo <b>{job?.pendingCount ?? 0}</b> · đã đo <b className="text-emerald-600">{job?.processedTotal ?? 0}</b> · lỗi <b className="text-red-500">{job?.errorTotal ?? 0}</b>
          </span>
          <span className="text-xs text-neutral-400 ml-auto">
            10 phút/lượt · checker v{CHECKER_VERSION}
            {job?.lastTickAt ? ` · lượt cuối ${new Date(job.lastTickAt).toLocaleTimeString()}` : ''}
          </span>
        </div>

        {/* Chỉ quét đơn thuộc các fulfill_status được tick. */}
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-neutral-500 mr-1">Fulfill status cần quét:</span>
          {STATUS_OPTIONS.map(([s, label]) => (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              className={`px-2 py-0.5 rounded-full text-xs border ${statuses.includes(s)
                ? 'bg-orange-500 text-white border-orange-500'
                : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          {[['fail', 'Lỗi'], ['error', 'Không đo được'], ['ok', 'Đạt'], ['', 'Tất cả']].map(([v, l]) => (
            <button key={v} onClick={() => setVerdict(v)}
              className={`px-3 py-1 rounded-lg text-xs ${verdict === v ? 'bg-orange-500 text-white' : 'bg-neutral-100 text-neutral-600'}`}>
              {l}
            </button>
          ))}
          <button onClick={fetchRows} className="px-3 py-1 rounded-lg text-xs bg-neutral-100 text-neutral-700 ml-auto">Refresh</button>
        </div>

        {loading ? <p className="text-sm text-neutral-400">Đang tải…</p> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-neutral-500 text-xs border-b border-neutral-200">
                <th className="py-2 text-left">System ID</th>
                <th className="py-2 text-left">Item</th>
                <th className="py-2 text-left">Chip</th>
                <th className="py-2 text-left">Kích thước</th>
                <th className="py-2 text-left">Lỗ khoét</th>
                <th className="py-2 text-left">Kết quả</th>
                <th className="py-2 text-left">Design</th>
              </tr>
            </thead>
            <tbody>
              {(rows.data || []).map(r => (
                <tr key={r.id} className="border-b border-neutral-100 hover:bg-orange-50/40">
                  <td className="py-1.5 font-mono text-orange-500 text-xs">{r.order?.system_id}</td>
                  <td className="py-1.5 text-xs text-neutral-500">#{r.order_item_id} · {r.field}</td>
                  <td className="py-1.5 text-xs">{r.chip}</td>
                  <td className="py-1.5 text-xs font-mono">
                    {r.width ? `${r.width}×${r.height}` : '—'}
                  </td>
                  <td className="py-1.5 text-xs font-mono">
                    {r.hole_w ? `${r.hole_w}×${r.hole_h}` : <span className="text-red-500">không có</span>}
                  </td>
                  <td className={`py-1.5 text-xs ${r.status === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
                    {r.status === 'ok' ? 'Đạt' : r.reason || r.status}
                  </td>
                  <td className="py-1.5"><UrlPreview url={r.url} onOpen={setPreviewUrl} label="Design" size="sm" /></td>
                </tr>
              ))}
              {(rows.data || []).length === 0 && (
                <tr><td colSpan={7} className="py-4 text-center text-neutral-400 text-sm">Chưa có kết quả nào.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {job?.log?.length > 0 && (
        <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-700 mb-2">Nhật ký</h3>
          <div className="max-h-56 overflow-y-auto text-xs font-mono space-y-0.5">
            {job.log.map((l, i) => (
              <div key={i} className={l.level === 'error' ? 'text-red-600' : l.level === 'ok' ? 'text-emerald-600' : 'text-neutral-600'}>
                [{new Date(l.ts).toLocaleTimeString()}] {l.system_id ? `${l.system_id} · ` : ''}{l.key ? `${l.key} · ` : ''}{l.message}
              </div>
            ))}
          </div>
        </div>
      )}

      <PreviewModal url={previewUrl} onClose={() => setPreviewUrl(null)} />
    </div>
  );
}
