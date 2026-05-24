import { PDFDocument } from 'pdf-lib';
import QRCode from 'qrcode';
import api from './api';

// Build a merged-label PDF: 1 page per order's convert_label image (carrier
// label with system_id barcode overlay), followed by a final page containing
// a large QR code pointing at the merged scan URL.
//
// Page format: 4×6" thermal label canvas at 300 DPI (1200×1800 px → 288×432 pt)
// because that's what the existing convert_label output ships at — see
// converter.composeConvertLabel(). Embedding source-size images keeps barcodes
// crisp; PDF viewer scales to fit when printing.

const DPI = 300;
const PT_PER_IN = 72;

// 4×6" label = same as composeConvertLabel output (portrait short=1200, long=1748)
// We use the *portrait* canvas as the universal page so landscape labels get
// rotated to fit. Some labels are A6 (1240×1748) per the converter update —
// pdf-lib will scale-to-fit them onto the page.
const LABEL_W_PT = (1240 / DPI) * PT_PER_IN;   // 297.6
const LABEL_H_PT = (1748 / DPI) * PT_PER_IN;   // 419.5

// Final QR page is A6 too, with a centered large QR + text below.
const QR_SIZE_PX = 900;          // 3" at 300 DPI — easy to scan from a tablet
const QR_PT      = (QR_SIZE_PX / DPI) * PT_PER_IN;

/**
 * @param {{ orders: Array<{id, system_id, convert_label, shipping_label}>,
 *           scanUrl: string,
 *           name: string,
 *           onProgress?: (p: {done: number, total: number, system_id?: string}) => void }} opts
 * @returns {Promise<{ blob: Blob, filename: string, pageCount: number, skipped: string[] }>}
 */
export async function buildMergedLabelPdf({ orders, scanUrl, name, onProgress }) {
  const pdf = await PDFDocument.create();
  const skipped = [];
  let done = 0;
  const total = orders.length + 1; // +1 for the QR page

  for (const o of orders) {
    onProgress?.({ done, total, system_id: o.system_id });
    if (!o.convert_label) {
      skipped.push(`${o.system_id} (no convert_label)`);
      done++;
      continue;
    }

    try {
      // Fetch via backend proxy — avoids B2 CORS issues from Electron renderer.
      // Backend streams the bytes back with original content-type.
      const bytes = await fetchOrderConvertLabel(o.id);
      const image = await embedSmart(pdf, bytes);
      const page = pdf.addPage([LABEL_W_PT, LABEL_H_PT]);
      // Scale-to-fit on the page, centered.
      const { width: iw, height: ih } = image.scale(1);
      const scale = Math.min(LABEL_W_PT / iw, LABEL_H_PT / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      page.drawImage(image, {
        x: (LABEL_W_PT - dw) / 2,
        y: (LABEL_H_PT - dh) / 2,
        width: dw,
        height: dh,
      });
    } catch (err) {
      const reason = err?.response?.status ? `HTTP ${err.response.status}` : (err?.message || 'load failed');
      console.warn('[merged-label] failed page for', o.system_id, err);
      skipped.push(`${o.system_id} (${reason})`);
    }
    done++;
  }

  // Final QR page — system_id list summarized + big QR at center
  onProgress?.({ done, total, system_id: 'QR page' });
  await addQrPage(pdf, scanUrl, orders.length);
  done++;
  onProgress?.({ done, total });

  const pdfBytes = await pdf.save();
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const safeName = (name || 'merged_labels').replace(/[^a-zA-Z0-9._-]/g, '_');
  return {
    blob,
    filename: `${safeName}.pdf`,
    pageCount: pdf.getPageCount(),
    skipped,
  };
}

async function addQrPage(pdf, scanUrl, orderCount) {
  // Render QR to PNG data URL.
  const qrDataUrl = await QRCode.toDataURL(scanUrl, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: QR_SIZE_PX,
  });
  const qrBytes = dataUrlToBytes(qrDataUrl);
  const qrImage = await pdf.embedPng(qrBytes);

  const page = pdf.addPage([LABEL_W_PT, LABEL_H_PT]);
  // Title at top
  const font = await pdf.embedStandardFont('Helvetica-Bold');
  const titleSize = 16;
  const title = `Merged ${orderCount} orders — scan to complete all`;
  const titleW = font.widthOfTextAtSize(title, titleSize);
  page.drawText(title, {
    x: (LABEL_W_PT - titleW) / 2,
    y: LABEL_H_PT - 40,
    size: titleSize,
    font,
  });

  // Centered QR
  const qrPt = Math.min(QR_PT, LABEL_W_PT - 40, LABEL_H_PT - 120);
  page.drawImage(qrImage, {
    x: (LABEL_W_PT - qrPt) / 2,
    y: (LABEL_H_PT - qrPt) / 2,
    width: qrPt,
    height: qrPt,
  });

  // URL text below QR (small, monospace-ish via Courier)
  const courier = await pdf.embedStandardFont('Courier');
  const urlSize = 9;
  const urlW = courier.widthOfTextAtSize(scanUrl, urlSize);
  page.drawText(scanUrl, {
    x: Math.max(10, (LABEL_W_PT - urlW) / 2),
    y: 30,
    size: urlSize,
    font: courier,
  });
}

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Fetch a single order's convert_label via backend proxy. Backend streams
 * image bytes with original content-type — same-origin so no CORS issues.
 */
async function fetchOrderConvertLabel(orderId) {
  const res = await api.get(`/orders/${orderId}/convert-label-blob`, {
    responseType: 'arraybuffer',
  });
  return new Uint8Array(res.data);
}

async function embedSmart(pdf, bytes) {
  // Magic-number sniffing — pdf-lib's embedJpg/embedPng require correct type.
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (isPng) return pdf.embedPng(bytes);
  return pdf.embedJpg(bytes);
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',', 2)[1];
  const binary = atob(base64);
  const len = binary.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}
