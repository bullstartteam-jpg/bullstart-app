import { useRef, useState } from 'react';
import { uploadFileToB2 } from '../services/uploadB2';
import { notify } from './Dialog';

/**
 * Small button that pops a file picker, uploads the chosen file to B2 via
 * the desktop app, then fires `onUrl(publicUrl)` so the caller can stuff
 * it into an input. Used next to Mockup Front/Back, Shipping Label, Meta
 * value fields in OrderCreate.
 *
 * Props:
 *   - onUrl: (url:string) => void   required
 *   - folder?: string               B2 sub-folder (default 'uploads')
 *   - accept?: string               <input accept="...">
 *   - title?: string                tooltip + aria-label
 *   - size?: 'sm' | 'md'            default 'sm'
 *
 * Behavior:
 *   - On success: toast success + fires onUrl
 *   - On failure: toast error, doesn't fire onUrl
 *   - Disables button + shows spinner while uploading
 */
export default function UploadButton({
  onUrl,
  folder = 'uploads',
  accept = 'image/*,application/pdf',
  title = 'Upload',
  size = 'sm',
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);

  const handlePick = () => inputRef.current?.click();

  const handleChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking same file later
    if (!file) return;

    setBusy(true);
    setPct(0);
    try {
      const { url } = await uploadFileToB2(file, {
        folder,
        onProgress: ({ loaded, total }) => setPct(total ? Math.floor((loaded / total) * 100) : 0),
      });
      onUrl(url);
      notify(`Uploaded: ${file.name}`, { kind: 'success', title: 'Upload' });
    } catch (err) {
      notify(err?.message || 'Upload failed', { kind: 'error', title: 'Upload failed' });
    } finally {
      setBusy(false);
      setPct(0);
    }
  };

  const padding = size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs';

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        className="hidden"
      />
      <button
        type="button"
        onClick={handlePick}
        disabled={busy}
        title={title}
        className={`inline-flex items-center gap-1 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 text-blue-700 rounded font-medium transition-colors ${padding}`}
      >
        {busy ? (
          <>
            <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>{pct}%</span>
          </>
        ) : (
          <>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span>Upload</span>
          </>
        )}
      </button>
    </>
  );
}
