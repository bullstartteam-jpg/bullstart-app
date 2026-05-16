import { useEffect, useState } from 'react';
import { subscribeConverter, runNow, pauseConverter, resumeConverter, startConverter } from '../services/converter';
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

  useEffect(() => subscribeConverter(setS), []);

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
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 rounded text-xs font-medium ${statusBadge.cls}`}>{statusBadge.label}</span>
          {!s.enabled && (
            <button onClick={startConverter} className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg">Start</button>
          )}
          <button
            onClick={runNow}
            disabled={s.running || s.paused || !s.enabled}
            className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg"
          >Run now</button>
          {s.enabled && (
            s.paused
              ? <button onClick={resumeConverter} className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg">Resume</button>
              : <button onClick={pauseConverter} className="px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white text-sm rounded-lg">Pause</button>
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
            <h3 className="text-sm font-semibold text-neutral-700">
              Queue ({s.pendingCount})
              {(s.pendingLabels?.length > 0) && (
                <span className="ml-2 text-xs font-normal text-neutral-400">
                  {s.pending.length} _qr + {s.pendingLabels.length} label
                </span>
              )}
            </h3>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {s.pending.length === 0 && (!s.pendingLabels || s.pendingLabels.length === 0) ? (
              <p className="text-xs text-neutral-400 p-4">Queue is empty.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-neutral-500 bg-[#faf8f6]">
                  <tr>
                    <th className="text-left px-3 py-2">System ID</th>
                    <th className="text-left px-3 py-2">Kind</th>
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
                  {(s.pendingLabels || []).map((lbl, i) => (
                    <tr key={`label-${lbl.order_id}-${i}`} className="border-t border-neutral-50 bg-blue-50/30">
                      <td className="px-3 py-2 font-mono text-orange-500">{lbl.system_id}</td>
                      <td className="px-3 py-2 text-blue-700">shipping_label</td>
                      <td className="px-3 py-2 text-neutral-500 truncate max-w-[260px]">{lbl.shipping_label}</td>
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
