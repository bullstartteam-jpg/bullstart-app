import { useEffect, useState } from 'react';
import {
  subscribeQrConverter,
  startQrConverter,
  stopQrConverter,
  pauseQrConverter,
  resumeQrConverter,
  runQrNow,
  subscribeQrBgJob,
  startQrBgJob,
  stopQrBgJob,
  runQrBgNow,
} from '../services/converter';
import { useAuth } from '../contexts/AuthContext';

const LEVEL_COLOR = {
  info: 'text-neutral-500',
  ok: 'text-green-600',
  error: 'text-red-500',
};

function fmt(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleTimeString();
}

export default function Convert() {
  const { user } = useAuth();
  const [s, setS] = useState(null);
  const [bg, setBg] = useState(null);

  useEffect(() => subscribeQrConverter(setS), []);
  useEffect(() => subscribeQrBgJob(setBg), []);

  if (!user?.convert) {
    return (
      <div className="p-6">
        <h2 className="text-xl font-bold text-neutral-800 mb-2">Convert</h2>
        <p className="text-sm text-neutral-500">
          Convert mode is not enabled for your account. Ask an admin to turn it on in Users.
        </p>
      </div>
    );
  }
  if (!s) return <div className="p-6 text-neutral-400">Loading…</div>;

  const statusBadge = !s.enabled
    ? { label: 'Off', cls: 'bg-neutral-100 text-neutral-500' }
    : s.paused
    ? { label: 'Paused', cls: 'bg-yellow-100 text-yellow-600' }
    : s.running
    ? { label: 'Running', cls: 'bg-blue-100 text-blue-600' }
    : { label: 'Idle', cls: 'bg-green-100 text-green-600' };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-xl font-bold text-neutral-800">Convert</h2>
          <p className="text-xs text-neutral-500 mt-1">
            Background QR-overlay job for order item metas. Runs every 60s while you're logged in.
            Auto state persists across logins.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 rounded text-xs font-medium ${statusBadge.cls}`}>{statusBadge.label}</span>
          {!s.enabled ? (
            <button onClick={startQrConverter} className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg">Start auto</button>
          ) : (
            <button onClick={stopQrConverter} className="px-3 py-1.5 bg-neutral-200 hover:bg-neutral-300 text-neutral-700 text-sm rounded-lg">Stop auto</button>
          )}
          <button
            onClick={runQrNow}
            disabled={s.running || s.paused || !s.enabled}
            className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg"
          >Run now</button>
          {s.enabled && (
            s.paused
              ? <button onClick={resumeQrConverter} className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg">Resume</button>
              : <button onClick={pauseQrConverter} className="px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white text-sm rounded-lg">Pause</button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Pending" value={s.pendingCount} hint="Metas waiting to convert" tone="text-orange-600" />
        <Stat label="Processed" value={s.processedTotal} hint="Successful uploads since login" tone="text-green-600" />
        <Stat label="Errors" value={s.errorTotal} hint="Failed conversions since login" tone="text-red-500" />
        <Stat label="Last poll" value={fmt(s.lastTickAt)} hint={s.nextTickAt ? `Next ~${fmt(s.nextTickAt)}` : '—'} tone="text-neutral-700" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending queue */}
        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm">
          <div className="px-4 py-3 border-b border-neutral-100 flex justify-between items-center">
            <h3 className="text-sm font-semibold text-neutral-700">Queue ({s.pendingCount})</h3>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {s.pending.length === 0 ? (
              <p className="text-xs text-neutral-400 p-4">Queue is empty.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-neutral-500 bg-[#faf8f6]">
                  <tr>
                    <th className="text-left px-3 py-2">System ID</th>
                    <th className="text-left px-3 py-2">Key</th>
                    <th className="text-left px-3 py-2">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {s.pending.map((p, i) => (
                    <tr key={`qr-${p.order_item_id}-${p.target_key}-${i}`} className="border-t border-neutral-50">
                      <td className="px-3 py-2 font-mono text-orange-500">{p.system_id}</td>
                      <td className="px-3 py-2 text-neutral-700">{p.target_key}</td>
                      <td className="px-3 py-2 text-neutral-500 truncate max-w-[260px]">{p.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Log */}
        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm">
          <div className="px-4 py-3 border-b border-neutral-100 flex justify-between items-center">
            <h3 className="text-sm font-semibold text-neutral-700">Activity log</h3>
            <span className="text-xs text-neutral-400">last {s.log.length}</span>
          </div>
          <div className="max-h-[420px] overflow-y-auto p-2 font-mono text-[11px] leading-5">
            {s.log.length === 0 ? (
              <p className="text-neutral-400 p-2">No activity yet.</p>
            ) : (
              s.log.map((e, i) => (
                <div key={i} className="flex gap-2 px-2 py-0.5 hover:bg-neutral-50 rounded">
                  <span className="text-neutral-400 shrink-0 w-16">{fmt(e.ts)}</span>
                  <span className={`shrink-0 w-12 ${LEVEL_COLOR[e.level] || 'text-neutral-500'}`}>{e.level}</span>
                  {e.system_id && <span className="text-orange-500 shrink-0">{e.system_id}</span>}
                  {e.key && <span className="text-neutral-500 shrink-0">/{e.key}</span>}
                  <span className="text-neutral-700 truncate">{e.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* QR background check */}
      <div className="mt-8 bg-white rounded-xl border border-neutral-200 shadow-sm">
        <div className="px-4 py-3 border-b border-neutral-100 flex justify-between items-center">
          <div>
            <h3 className="text-sm font-semibold text-neutral-700">QR background check</h3>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Quét đơn <b>chưa shipped</b>: dò ảnh <span className="font-mono">front_qr</span> có nền đen ở chỗ barcode (không quét được). Chạy mỗi 2 phút.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {bg && (
              <span className={`px-2 py-1 rounded text-xs font-medium ${
                !bg.enabled ? 'bg-neutral-100 text-neutral-500'
                : bg.running ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'}`}>
                {!bg.enabled ? 'Off' : bg.running ? 'Scanning' : 'Idle'}
              </span>
            )}
            {!bg?.enabled
              ? <button onClick={startQrBgJob} className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg">Start</button>
              : <button onClick={stopQrBgJob} className="px-3 py-1.5 bg-neutral-200 hover:bg-neutral-300 text-neutral-700 text-sm rounded-lg">Stop</button>}
            <button onClick={runQrBgNow} disabled={!bg?.enabled || bg?.running}
              className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg">Run now</button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4">
          <Stat label="To scan" value={bg?.pendingCount ?? 0} hint="Orders queued this poll" tone="text-orange-600" />
          <Stat label="Scanned" value={bg?.processedTotal ?? 0} hint="Since login" tone="text-green-600" />
          <Stat label="Flagged (đen)" value={bg?.flagged?.length ?? 0} hint="Black background found" tone="text-red-500" />
          <Stat label="Last poll" value={fmt(bg?.lastTickAt)} hint={bg?.nextTickAt ? `Next ~${fmt(bg.nextTickAt)}` : '—'} tone="text-neutral-700" />
        </div>

        <div className="px-4 pb-4">
          <h4 className="text-xs font-semibold text-neutral-600 mb-2">Đơn nền đen ({bg?.flagged?.length ?? 0})</h4>
          {!bg?.flagged?.length ? (
            <p className="text-xs text-neutral-400">Chưa phát hiện đơn nào.</p>
          ) : (
            <div className="max-h-[360px] overflow-y-auto border border-neutral-100 rounded-lg">
              <table className="w-full text-xs">
                <thead className="text-neutral-500 bg-[#faf8f6] sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">System ID</th>
                    <th className="text-left px-3 py-2">Ảnh _qr</th>
                    <th className="text-left px-3 py-2">Phát hiện</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {bg.flagged.map(f => (
                    <tr key={f.order_id} className="border-t border-neutral-50">
                      <td className="px-3 py-2 font-mono text-red-600">{f.system_id}</td>
                      <td className="px-3 py-2">
                        <a href={f.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline truncate inline-block max-w-[220px] align-bottom">{f.url}</a>
                      </td>
                      <td className="px-3 py-2 text-neutral-500">{fmt(f.ts)}</td>
                      <td className="px-3 py-2 text-right">
                        <a href={`#/orders/${f.order_id}`} className="text-orange-600 hover:text-orange-700">Mở đơn</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint, tone }) {
  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`text-xl font-bold ${tone || 'text-neutral-800'}`}>{value}</div>
      {hint && <div className="text-[11px] text-neutral-400 mt-0.5">{hint}</div>}
    </div>
  );
}
