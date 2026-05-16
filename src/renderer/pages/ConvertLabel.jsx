import { useEffect, useState } from 'react';
import { subscribeConverter, runNow, pauseConverter, resumeConverter, startConverter } from '../services/converter';
import { useAuth } from '../contexts/AuthContext';

// Admin/support-only view focused on the convert_label workflow (carrier
// label + system_id barcode overlay). The underlying converter service is
// shared with the seller-facing Convert page; this page just filters the
// snapshot down to the label queue and the label log.

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

export default function ConvertLabel() {
  const { user } = useAuth();
  const [s, setS] = useState(null);

  useEffect(() => subscribeConverter(setS), []);

  const isStaff = user?.role?.slug === 'admin' || user?.role?.slug === 'support';
  if (!isStaff) {
    return (
      <div className="p-6">
        <h2 className="text-xl font-bold text-neutral-800 mb-2">Convert Label</h2>
        <p className="text-sm text-neutral-500">This page is for admin and support only.</p>
      </div>
    );
  }
  if (!user?.convert) {
    return (
      <div className="p-6">
        <h2 className="text-xl font-bold text-neutral-800 mb-2">Convert Label</h2>
        <p className="text-sm text-neutral-500">
          Convert mode is not enabled for your account. Ask an admin to turn it on in Users.
        </p>
      </div>
    );
  }
  if (!s) return <div className="p-6 text-neutral-400">Loading…</div>;

  const labelLog = (s.log || []).filter(l => l.key === 'convert_label' || l.key === 'shipping_label');
  const pendingLabels = s.pendingLabels || [];

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
          <h2 className="text-xl font-bold text-neutral-800">Convert Label</h2>
          <p className="text-xs text-neutral-500 mt-1">
            Stamps system_id barcode + accessory summary onto each order's shipping label and stores the result in <code className="bg-neutral-100 px-1 rounded">orders.convert_label</code>. Admin-only.
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
        <Stat label="Pending labels" value={pendingLabels.length} hint="Orders waiting for convert_label" tone="text-orange-600" />
        <Stat label="Processed" value={s.processedTotal} hint="Successful uploads since login (all keys)" tone="text-green-600" />
        <Stat label="Errors" value={s.errorTotal} hint="Failed conversions since login (all keys)" tone="text-red-500" />
        <Stat label="Last poll" value={fmt(s.lastTickAt)} hint={s.nextTickAt ? `Next ~${fmt(s.nextTickAt)}` : '—'} tone="text-neutral-700" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending queue */}
        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm">
          <div className="px-4 py-3 border-b border-neutral-100">
            <h3 className="text-sm font-semibold text-neutral-700">Pending convert_label ({pendingLabels.length})</h3>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {pendingLabels.length === 0 ? (
              <p className="text-xs text-neutral-400 p-4">No orders waiting.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-neutral-500 bg-[#faf8f6]">
                  <tr>
                    <th className="text-left px-3 py-2">System ID</th>
                    <th className="text-left px-3 py-2">Accessory</th>
                    <th className="text-left px-3 py-2">Source label</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingLabels.map((lbl, i) => (
                    <tr key={`label-${lbl.order_id}-${i}`} className="border-t border-neutral-50">
                      <td className="px-3 py-2 font-mono text-orange-500">{lbl.system_id}</td>
                      <td className="px-3 py-2 text-neutral-700">{lbl.accessory_summary || '-'}</td>
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
          <div className="px-4 py-3 border-b border-neutral-100">
            <h3 className="text-sm font-semibold text-neutral-700">Recent label activity</h3>
          </div>
          <div className="max-h-[420px] overflow-y-auto p-2 space-y-1">
            {labelLog.length === 0 ? (
              <p className="text-xs text-neutral-400 p-4">No activity yet.</p>
            ) : (
              labelLog.map((l, i) => (
                <div key={i} className="flex items-start gap-2 text-xs px-2 py-1">
                  <span className="text-neutral-400 font-mono whitespace-nowrap">{fmt(l.ts)}</span>
                  <span className={`font-medium ${LEVEL_COLOR[l.level] || 'text-neutral-500'}`}>[{l.level}]</span>
                  {l.system_id && <span className="font-mono text-orange-500">{l.system_id}</span>}
                  <span className="text-neutral-700 break-all">{l.message}</span>
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
      <div className="text-xs uppercase tracking-wider text-neutral-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
      {hint && <div className="text-xs text-neutral-400 mt-1">{hint}</div>}
    </div>
  );
}
