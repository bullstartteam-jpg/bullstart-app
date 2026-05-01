import { useEffect, useState } from 'react';

// Module-level subscriber for dialogs. notify()/askConfirm() can be called
// from any component without prop-drilling.
let _setQueue = null;
let _seq = 0;
const _queue = [];

function push(item) {
  _queue.push(item);
  _setQueue?.([..._queue]);
}

function shift() {
  _queue.shift();
  _setQueue?.([..._queue]);
}

export function notify(message, { title = 'Notice', kind = 'info' } = {}) {
  return new Promise((resolve) => {
    push({ id: ++_seq, type: 'notify', title, kind, message, resolve });
  });
}

export function askConfirm(message, { title = 'Confirm', okText = 'OK', cancelText = 'Cancel' } = {}) {
  return new Promise((resolve) => {
    push({ id: ++_seq, type: 'confirm', title, okText, cancelText, message, resolve });
  });
}

export function DialogHost() {
  const [queue, setQueue] = useState([]);
  useEffect(() => {
    _setQueue = setQueue;
    return () => { _setQueue = null; };
  }, []);

  const top = queue[0];
  if (!top) return null;

  const close = (value) => {
    top.resolve?.(value);
    shift();
  };

  const accent = top.kind === 'error' ? 'text-red-600' : top.kind === 'success' ? 'text-green-600' : 'text-neutral-800';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => top.type === 'confirm' ? close(false) : close(true)}>
      <div className="bg-white rounded-xl shadow-2xl w-[420px] max-w-[90%] p-5" onClick={e => e.stopPropagation()}>
        <h3 className={`text-base font-semibold mb-2 ${accent}`}>{top.title}</h3>
        <div className="text-sm text-neutral-700 whitespace-pre-line mb-4">{top.message}</div>
        <div className="flex justify-end gap-2">
          {top.type === 'confirm' && (
            <button
              autoFocus
              onClick={() => close(false)}
              className="px-4 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg"
            >
              {top.cancelText}
            </button>
          )}
          <button
            onClick={() => close(top.type === 'confirm' ? true : true)}
            className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg"
          >
            {top.type === 'confirm' ? top.okText : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
