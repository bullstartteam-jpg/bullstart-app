import { PDFDocument } from 'pdf-lib';
import api from './api';

// Push scan: bundle the raw shipping_label of each pushed order into one PDF.
// PDF labels are copied page-for-page; image labels get a 4×6" page each.
// Bytes come through the backend proxy (/push-scan/{id}/shipping-label-blob)
// to dodge B2/Drive CORS in the renderer.

const LABEL_W_PT = 4 * 72;
const LABEL_H_PT = 6 * 72;

/**
 * @param {{ rows: Array<{id, order: {system_id, shipping_label}}>,
 *           name: string,
 *           onProgress?: (p: {done: number, total: number, system_id?: string}) => void }} opts
 * @returns {Promise<{ blob: Blob, filename: string, pageCount: number, included: number[], skipped: string[] }>}
 */
export async function buildPushScanLabelPdf({ rows, name, onProgress }) {
  const pdf = await PDFDocument.create();
  const included = [];
  const skipped = [];
  let done = 0;

  for (const row of rows) {
    const sid = row.order?.system_id || `#${row.id}`;
    onProgress?.({ done, total: rows.length, system_id: sid });
    if (!row.order?.shipping_label) {
      skipped.push(`${sid} (no shipping_label)`);
      done++;
      continue;
    }
    try {
      const res = await api.get(`/push-scan/${row.id}/shipping-label-blob`, { responseType: 'arraybuffer' });
      const bytes = new Uint8Array(res.data);
      if (isPdf(bytes)) {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await pdf.copyPages(src, src.getPageIndices());
        pages.forEach(p => pdf.addPage(p));
      } else {
        if (!isPng(bytes) && !isJpg(bytes)) throw new Error('label không phải PDF/PNG/JPEG');
        const image = isPng(bytes) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
        const page = pdf.addPage([LABEL_W_PT, LABEL_H_PT]);
        const { width: iw, height: ih } = image.scale(1);
        const scale = Math.min(LABEL_W_PT / iw, LABEL_H_PT / ih);
        page.drawImage(image, {
          x: (LABEL_W_PT - iw * scale) / 2,
          y: (LABEL_H_PT - ih * scale) / 2,
          width: iw * scale,
          height: ih * scale,
        });
      }
      included.push(row.id);
    } catch (err) {
      // arraybuffer responses carry the hub's JSON error as bytes — decode it.
      let reason = err?.response?.status ? `HTTP ${err.response.status}` : (err?.message || 'load failed');
      try {
        const msg = JSON.parse(new TextDecoder().decode(err?.response?.data))?.message;
        if (msg) reason += `: ${msg}`;
      } catch { /* not JSON */ }
      console.warn('[push-scan] failed label for', sid, err);
      skipped.push(`${sid} (${reason})`);
    }
    done++;
  }
  onProgress?.({ done, total: rows.length });

  const pdfBytes = await pdf.save();
  const safeName = (name || 'push_scan').replace(/[^a-zA-Z0-9._-]/g, '_');
  return {
    blob: new Blob([pdfBytes], { type: 'application/pdf' }),
    filename: `${safeName}.pdf`,
    pageCount: pdf.getPageCount(),
    included,
    skipped,
  };
}

const isPdf = (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
const isPng = (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpg = (b) => b[0] === 0xff && b[1] === 0xd8;
