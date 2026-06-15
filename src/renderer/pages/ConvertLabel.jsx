import { useEffect, useState } from 'react';
import {
  subscribeLabelConverter,
  startLabelConverter,
  stopLabelConverter,
  pauseLabelConverter,
  resumeLabelConverter,
  runLabelNow,
  manualConvertLabelById,
} from '../services/converter';
import { useAuth } from '../contexts/AuthContext';

// Admin/support-only page that drives the convert_label job, independent of
// the QR job on /convert. Each page has its own auto on/off persisted in
// localStorage, its own poll interval, and its own activity log.

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
  const [manualInput, setManualInput] = useState('');
  const [manualBusy, setManualBusy] = useState(false);

  useEffect(() => subscribeLabelConverter(setS), []);

  const handleManualConvert = async () => {
    const v = manualInput.trim();
    if (!v || manualBusy) return;
    setManualBusy(true);
    try {
      await manualConvertLabelById(v);
      setManualInput('');
    } catch {
      // Errors are already pushed to the activity log by manualConvertLabelById.
    } finally {
      setManualBusy(false);
    }
  };

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
            Stamps system_id barcode + accessory summary at the bottom-left of each
            order's shipping label and stores the result in <code className="bg-neutral-100 px-1 rounded">orders.convert_label</code>. Admin-only. Independent of Convert.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 rounded text-xs font-medium ${statusBadge.cls}`}>{statusBadge.label}</span>
          {!s.enabled ? (
            <button onClick={startLabelConverter} className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg">Start auto</button>
          ) : (
            <button onClick={stopLabelConverter} className="px-3 py-1.5 bg-neutral-200 hover:bg-neutral-300 text-neutral-700 text-sm rounded-lg">Stop auto</button>
          )}
          <button
            onClick={runLabelNow}
            disabled={s.running || s.paused || !s.enabled}
            className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg"
          >Run now</button>
          {s.enabled && (
            s.paused
              ? <button onClick={resumeLabelConverter} className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg">Resume</button>
              : <button onClick={pauseLabelConverter} className="px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white text-sm rounded-lg">Pause</button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Pending" value={s.pendingCount} hint="Orders waiting for convert_label" tone="text-orange-600" />
        <Stat label="Processed" value={s.processedTotal} hint="Successful uploads since login" tone="text-green-600" />
        <Stat label="Errors" value={s.errorTotal} hint="Failed conversions since login" tone="text-red-500" />
        <Stat label="Last poll" value={fmt(s.lastTickAt)} hint={s.nextTickAt ? `Next ~${fmt(s.nextTickAt)}` : '—'} tone="text-neutral-700" />
      </div>

      {/* Manual convert by ID/system_id — bypasses new_order status check */}
      <div className="bg-white rounded-xl border border-neutral-200 shadow-sm mb-6 p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <label className="text-xs font-semibold text-neutral-600 uppercase tracking-wider block mb-1.5">
              Convert by ID (force, any status)
            </label>
            <p className="text-xs text-neutral-500 mb-2">
              Enter an order ID (numeric) or system_id (e.g. <code className="bg-neutral-100 px-1 rounded">PS_C605</code>) to compose and upload a convert_label immediately. The new_order status check is skipped.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualInput}
                onChange={e => setManualInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleManualConvert(); }}
                disabled={manualBusy}
                placeholder="Order ID or system_id…"
                className="flex-1 px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-neutral-800 text-sm font-mono focus:outline-none focus:border-orange-400"
                autoFocus
              />
              <button
                onClick={handleManualConvert}
                disabled={!manualInput.trim() || manualBusy}
                className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg font-medium whitespace-nowrap"
              >
                {manualBusy ? 'Converting…' : 'Convert now'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending queue */}
        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm">
          <div className="px-4 py-3 border-b border-neutral-100">
            <h3 className="text-sm font-semibold text-neutral-700">Pending convert_label ({s.pendingCount})</h3>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {s.pending.length === 0 ? (
              <p className="text-xs text-neutral-400 p-4">No orders waiting.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-neutral-500 bg-[#faf8f6]">
                  <tr>
                    <th className="text-left px-3 py-2">System ID</th>
                    <th className="text-left px-3 py-2">Add on</th>
                    <th className="text-left px-3 py-2">Source label</th>
                  </tr>
                </thead>
                <tbody>
                  {s.pending.map((lbl, i) => (
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
