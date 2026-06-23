import { useEffect, useState } from 'react';

// Module-level, non-modal toast store. Mirrors Dialog.jsx: pushToast()/
// updateToast()/dismissToast() can be called from anywhere (components OR
// plain modules like services) without prop-drilling or a context.
//
// Unlike Dialog (one blocking modal at a time), toasts stack and are passive —
// used for background-job progress + completion. A `progress` toast is sticky;
// success/warning/error/info auto-dismiss after `durationMs` unless `sticky`.
let _setToasts = null;
let _seq = 0;
let _toasts = [];

function sync() {
  _setToasts?.([..._toasts]);
}

// Add a toast. Returns its id so callers can updateToast()/dismissToast() it.
export function pushToast({ kind = 'info', title, message, sticky, durationMs = 6000, action } = {}) {
  const id = ++_seq;
  _toasts.push({ id, kind, title, message, sticky: sticky ?? kind === 'progress', durationMs, action });
  sync();
  return id;
}

// Patch an existing toast in place (e.g. update a progress counter, or flip a
// progress toast into a success/warning result). No-op if the id is gone.
export function updateToast(id, patch) {
  let found = false;
  _toasts = _toasts.map((t) => {
    if (t.id !== id) return t;
    found = true;
    return { ...t, ...patch };
  });
  if (found) sync();
}

export function dismissToast(id) {
  const before = _toasts.length;
  _toasts = _toasts.filter((t) => t.id !== id);
  if (_toasts.length !== before) sync();
}

const KIND_STYLES = {
  info: 'border-neutral-200 bg-white',
  success: 'border-green-200 bg-green-50',
  warning: 'border-amber-200 bg-amber-50',
  error: 'border-red-200 bg-red-50',
  progress: 'border-neutral-200 bg-white',
};

const TITLE_STYLES = {
  info: 'text-neutral-800',
  success: 'text-green-700',
  warning: 'text-amber-700',
  error: 'text-red-600',
  progress: 'text-neutral-800',
};

function ToastCard({ toast }) {
  // Auto-dismiss non-sticky toasts after their duration.
  useEffect(() => {
    if (toast.sticky || toast.kind === 'progress') return;
    const ms = toast.durationMs ?? 6000;
    const t = setTimeout(() => dismissToast(toast.id), ms);
    return () => clearTimeout(t);
  }, [toast.id, toast.sticky, toast.kind, toast.durationMs]);

  return (
    <div className={`w-80 rounded-xl border shadow-lg p-3 ${KIND_STYLES[toast.kind] || KIND_STYLES.info}`}>
      <div className="flex items-start gap-2">
        {toast.kind === 'progress' && (
          <span className="mt-0.5 inline-block w-3.5 h-3.5 rounded-full border-2 border-orange-400 border-t-transparent animate-spin shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          {toast.title && <p className={`text-sm font-semibold ${TITLE_STYLES[toast.kind] || TITLE_STYLES.info}`}>{toast.title}</p>}
          {toast.message && <p className="text-xs text-neutral-600 whitespace-pre-line mt-0.5">{toast.message}</p>}
          {toast.action && (
            <button
              onClick={() => { toast.action.onClick?.(); dismissToast(toast.id); }}
              className="mt-2 px-2.5 py-1 bg-orange-500 hover:bg-orange-600 text-white text-xs rounded-lg"
            >
              {toast.action.label}
            </button>
          )}
        </div>
        <button
          onClick={() => dismissToast(toast.id)}
          className="text-neutral-400 hover:text-neutral-700 text-sm leading-none shrink-0"
          title="Dismiss"
        >×</button>
      </div>
    </div>
  );
}

export function ToastHost() {
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    _setToasts = setToasts;
    setToasts([..._toasts]);
    return () => { _setToasts = null; };
  }, []);

  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => <ToastCard key={t.id} toast={t} />)}
    </div>
  );
}
