/**
 * Windowed pagination control. Always shows First / Prev / Next / Last,
 * plus the current page ± `siblingCount` and ellipses for the gaps.
 *
 *   « ‹ 1 … 8 9 [10] 11 12 … 38 › »
 *
 * Backend pagination payloads from Laravel (`current_page`, `last_page`)
 * map 1:1 to this component's props.
 */
export default function Pagination({ page, lastPage, onChange, siblingCount = 2 }) {
  if (!lastPage || lastPage <= 1) return null;

  const pages = buildPageList(page, lastPage, siblingCount);

  return (
    <div className="flex justify-center items-center gap-1 mt-4 text-sm flex-wrap">
      <ArrowBtn label="«" disabled={page === 1} onClick={() => onChange(1)} title="First" />
      <ArrowBtn label="‹" disabled={page === 1} onClick={() => onChange(page - 1)} title="Previous" />

      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`gap-${i}`} className="px-2 text-neutral-400">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={`px-3 py-1 rounded ${
              page === p
                ? 'bg-orange-500 text-white'
                : 'bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50'
            }`}
          >
            {p}
          </button>
        ),
      )}

      <ArrowBtn label="›" disabled={page === lastPage} onClick={() => onChange(page + 1)} title="Next" />
      <ArrowBtn label="»" disabled={page === lastPage} onClick={() => onChange(lastPage)} title="Last" />

      <span className="ml-3 text-xs text-neutral-500">
        Page {page} / {lastPage}
      </span>
    </div>
  );
}

function ArrowBtn({ label, disabled, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="px-2 py-1 rounded bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50 disabled:opacity-30 disabled:cursor-not-allowed"
    >
      {label}
    </button>
  );
}

// Build [1, '…', 8, 9, 10, 11, 12, '…', 38] given (current, last, sibling).
function buildPageList(current, last, sibling) {
  const window = sibling * 2 + 1; // current + N on each side
  // If everything fits without ellipses, just emit a plain range.
  if (last <= window + 2) {
    return Array.from({ length: last }, (_, i) => i + 1);
  }
  const startSibling = Math.max(current - sibling, 2);
  const endSibling   = Math.min(current + sibling, last - 1);

  const pages = [1];
  if (startSibling > 2) pages.push('…');
  for (let p = startSibling; p <= endSibling; p++) pages.push(p);
  if (endSibling < last - 1) pages.push('…');
  pages.push(last);
  return pages;
}
