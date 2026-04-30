// Google Drive URL helpers — accept any of:
//   https://drive.google.com/file/d/FILE_ID/view?...
//   https://drive.google.com/open?id=FILE_ID
//   https://drive.google.com/uc?id=FILE_ID
//   https://drive.google.com/thumbnail?id=FILE_ID
// Returns the FILE_ID if found, otherwise null.
const DRIVE_ID_RE = /(?:\/file\/d\/|[?&]id=)([a-zA-Z0-9_-]+)/;

export function driveId(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(DRIVE_ID_RE);
  return m ? m[1] : null;
}

// Image thumbnail URL (small). Falls back to original URL for non-Drive links.
export function driveThumb(url, size = 'w400') {
  const id = driveId(url);
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=${size}` : url;
}

// Embeddable preview URL (works for PDFs and images via Drive's viewer).
// Falls back to the original URL for non-Drive links so an <img> can render it.
export function drivePreview(url) {
  const id = driveId(url);
  return id ? `https://drive.google.com/file/d/${id}/preview` : url;
}

// Whether the URL looks previewable (any non-empty string with http(s) prefix or drive id).
export function isPreviewable(url) {
  if (!url) return false;
  return /^https?:\/\//i.test(url) || !!driveId(url);
}
