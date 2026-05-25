import api from './api';

// Cache B2 credentials in-memory per renderer process. They contain a
// per-day folder prefix that the desktop app uses verbatim, so refreshing
// once per session is enough; if a credential rotation happens, restart
// the app or call `clearCredentialsCache()`.
let cachedCreds = null;
let cachedAt = 0;
const CRED_TTL_MS = 30 * 60 * 1000; // 30 min

async function getCreds() {
  if (cachedCreds && Date.now() - cachedAt < CRED_TTL_MS) return cachedCreds;
  const res = await api.get('/gangsheets/storage-credentials');
  cachedCreds = res.data;
  cachedAt = Date.now();
  return cachedCreds;
}

export function clearCredentialsCache() {
  cachedCreds = null;
  cachedAt = 0;
}

/**
 * Upload a File / Blob to Backblaze B2 from the desktop app via Electron
 * main process (window.electronAPI.s3Upload). Returns the public URL.
 *
 * Throws if Electron API is missing (browser-only) or upload fails.
 *
 * @param {File|Blob} file
 * @param {{ folder?: string, filename?: string, onProgress?: (p:{loaded,total}) => void }} opts
 *   folder: relative path under the date-based folder (vd 'mockup' → "gangsheet/2026-05-25/mockup/...")
 *   filename: override the file's name. If omitted, uses file.name or a uuid.
 * @returns {Promise<{ url: string, key: string, size: number, contentType: string }>}
 */
export async function uploadFileToB2(file, { folder = 'uploads', filename = '', onProgress } = {}) {
  if (!window.electronAPI?.s3Upload) {
    throw new Error('Cần mở từ desktop app để upload file lên B2.');
  }
  if (!file) throw new Error('No file selected');

  const creds = await getCreds();
  // creds.folder is like "gangsheet/2026-05-25" — reuse the same date prefix.
  const baseFolder = creds.folder?.replace(/\/+$/, '') || 'uploads';
  const finalName = sanitizeFilename(filename || file.name || `upload_${Date.now()}`);
  const key = `${baseFolder}/${folder}/${Date.now()}_${finalName}`;

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  onProgress?.({ loaded: 0, total: bytes.length });
  await window.electronAPI.s3Upload({
    credentials: creds,
    bucket: creds.bucket,
    key,
    body: bytes,
    contentType: file.type || guessContentType(finalName),
  });
  onProgress?.({ loaded: bytes.length, total: bytes.length });

  const url = `${creds.public_url_base}/${key}`;
  return { url, key, size: bytes.length, contentType: file.type || guessContentType(finalName) };
}

function sanitizeFilename(name) {
  // Strip path separators + collapse whitespace + keep alnum/dot/dash/underscore.
  return String(name)
    .replace(/[\\/]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '');
}

function guessContentType(name) {
  const ext = name.toLowerCase().split('.').pop();
  return {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    bmp: 'image/bmp',
  }[ext] || 'application/octet-stream';
}
