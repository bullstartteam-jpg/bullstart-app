import { useEffect, useRef, useState } from 'react';
import { driveThumb } from '../utils/drive';

/**
 * Select-like picker that shows each option's image — for choices that are
 * recognised by eye, not by name (Sticker Sheet templates).
 *
 *   options: [{ value, label, image, sub? }]
 *   value:   selected value ('' = none)
 *   allLabel: text of the "no filter" choice
 */
export default function ImagePicker({ options, value, onChange, allLabel = 'Tất cả', className = '' }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const current = options.find(o => String(o.value) === String(value));
  const shown = q ? options.filter(o => o.label.toLowerCase().includes(q.toLowerCase())) : options;
  const pick = (v) => { onChange(v); setOpen(false); setQ(''); };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="mt-1 flex items-center gap-2 pl-1 pr-3 py-1 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm min-w-[12rem] text-left">
        {current?.image
          ? <img src={driveThumb(current.image, 'w120')} alt="" className="h-8 w-6 object-contain bg-white rounded" />
          : <span className="h-8 w-6 rounded bg-neutral-100" />}
        <span className="flex-1 truncate">{current ? current.label : allLabel}</span>
        <span className="text-neutral-400 text-xs">▾</span>
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-[34rem] max-w-[90vw] bg-white border border-neutral-200 rounded-xl shadow-xl p-3 space-y-2">
          <div className="flex gap-2">
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm theo tên…"
              className="flex-1 px-2 py-1 text-sm bg-[#faf8f6] border border-neutral-200 rounded" />
            <button type="button" onClick={() => pick('')}
              className={`px-3 py-1 text-xs rounded border ${!value ? 'bg-orange-500 border-orange-500 text-white' : 'border-neutral-200 hover:bg-neutral-50'}`}>
              {allLabel}
            </button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[60vh] overflow-y-auto">
            {shown.map(o => {
              const on = String(o.value) === String(value);
              return (
                <button key={o.value} type="button" onClick={() => pick(o.value)} title={o.label}
                  className={`p-1.5 rounded-lg border text-left hover:bg-orange-50/50 ${on ? 'border-orange-500 ring-2 ring-orange-200' : 'border-neutral-200'}`}>
                  {o.image
                    ? <img src={driveThumb(o.image, 'w240')} alt="" loading="lazy" className="w-full h-32 object-contain bg-neutral-100 rounded" />
                    : <div className="w-full h-32 bg-neutral-100 rounded" />}
                  <div className="mt-1 text-xs font-semibold text-neutral-800 truncate">{o.label}</div>
                  {o.sub && <div className="text-[10px] text-neutral-500 truncate">{o.sub}</div>}
                </button>
              );
            })}
            {shown.length === 0 && <p className="col-span-full text-xs text-neutral-400 p-2">Không có mẫu nào.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
