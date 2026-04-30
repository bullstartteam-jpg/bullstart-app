import { useEffect, useState } from 'react';
import { driveId, driveThumb, drivePreview, isPreviewable } from '../utils/drive';

export function UrlPreview({ url, onOpen, label, size = 'md' }) {
  if (!isPreviewable(url)) return null;
  const sizeClass = size === 'sm' ? 'w-16 h-16' : 'w-24 h-24';
  return (
    <button
      type="button"
      onClick={() => onOpen(url)}
      title={label || 'Click to preview'}
      className={`inline-block ${sizeClass} rounded border border-neutral-200 bg-neutral-100 overflow-hidden hover:ring-2 hover:ring-orange-400 transition align-middle`}
    >
      <img
        src={driveThumb(url, 'w200')}
        alt="preview"
        className="w-full h-full object-cover"
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
    </button>
  );
}

function isImageUrl(url) {
  if (!url) return false;
  if (driveId(url)) return false; // Drive uses iframe viewer
  const path = url.split('?')[0].toLowerCase();
  return /\.(jpe?g|png|gif|webp|bmp|svg|avif)$/.test(path);
}

function openInBrowser(url) {
  if (window.electronAPI?.openExternal) {
    window.electronAPI.openExternal(url);
  } else {
    window.open(url, '_blank', 'noreferrer');
  }
}

export function PreviewModal({ url, onClose }) {
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);

  // Reset zoom whenever a new URL opens.
  useEffect(() => {
    setZoom(1);
    setFit(true);
  }, [url]);

  if (!url) return null;

  const isImage = isImageUrl(url);
  const iframeSrc = drivePreview(url);

  const zoomIn = () => { setFit(false); setZoom(z => Math.min(6, +(z + 0.25).toFixed(2))); };
  const zoomOut = () => { setFit(false); setZoom(z => Math.max(0.25, +(z - 0.25).toFixed(2))); };
  const resetZoom = () => { setZoom(1); setFit(true); };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
    >
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-[90vw] h-[90vh] max-w-5xl flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-200">
          <button
            onClick={() => openInBrowser(url)}
            title="Open URL in default browser"
            className="text-xs px-2 py-1 rounded bg-neutral-100 hover:bg-neutral-200 text-neutral-700"
          >Open in browser</button>

          {isImage && (
            <div className="flex items-center gap-1 ml-2">
              <button onClick={zoomOut} title="Zoom out" className="px-2 py-1 rounded bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm">−</button>
              <button onClick={resetZoom} title="Fit to window" className="px-2 py-1 rounded bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs">{fit ? 'Fit' : `${Math.round(zoom * 100)}%`}</button>
              <button onClick={zoomIn} title="Zoom in" className="px-2 py-1 rounded bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm">+</button>
            </div>
          )}

          <a
            href={url}
            onClick={(e) => { e.preventDefault(); openInBrowser(url); }}
            className="text-orange-500 text-xs truncate flex-1 ml-2"
            title={url}
          >{url}</a>

          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-800 text-xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 bg-neutral-50 overflow-auto flex items-center justify-center">
          {isImage ? (
            fit ? (
              <img
                src={url}
                alt="preview"
                className="max-w-full max-h-full object-contain select-none"
                draggable={false}
              />
            ) : (
              <div className="p-6">
                <img
                  src={url}
                  alt="preview"
                  draggable={false}
                  style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
                  className="select-none transition-transform"
                />
              </div>
            )
          ) : (
            <iframe src={iframeSrc} className="w-full h-full bg-white" title="preview" />
          )}
        </div>
      </div>
    </div>
  );
}
