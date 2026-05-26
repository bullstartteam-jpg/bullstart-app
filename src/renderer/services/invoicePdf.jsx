import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import logoUrl from '../assets/logo.png';

// US Letter portrait, units in pt.
const PAGE_W = 612;
const ORANGE = [240, 140, 50];
const ORANGE_LIGHT = [255, 200, 150];

// Cache the logo data URL so subsequent invoice exports skip the fetch.
let logoDataUrlCache = null;
async function loadLogoDataUrl() {
  if (logoDataUrlCache) return logoDataUrlCache;
  try {
    const res = await fetch(logoUrl);
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    logoDataUrlCache = dataUrl;
    return dataUrl;
  } catch {
    return null; // header still renders without logo
  }
}

/**
 * Build a commercial invoice PDF from the JSON payload returned by
 * `GET /api/orders/invoice-data`. Async because we lazy-load the logo PNG.
 */
export async function buildInvoicePdf(payload, opts = {}) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const margin = 40;

  // ── Header band — logo on the far left, brand block right of it ──
  const logo = await loadLogoDataUrl();
  const logoSize = 55;
  const logoY = margin - 8;
  if (logo) {
    doc.addImage(logo, 'PNG', margin, logoY, logoSize, logoSize);
  }

  doc.setFont('helvetica', 'bold').setFontSize(13);
  doc.text('BULLSTART- PRINT ON DEMAND SERVICE', PAGE_W / 2, margin, { align: 'center' });

  doc.setFont('helvetica', 'normal').setFontSize(9);
  const brandX = margin + logoSize + 12;
  const brandY = margin + 25;
  doc.text('Address: 4353 Saddle Horn W, Oceanside CA 92057', brandX, brandY);
  doc.text('Email: bullstartteam@gmail.com', brandX, brandY + 12);
  doc.text('Phone: 619-666-5123', brandX, brandY + 24);

  // Document title — orange, underlined center
  doc.setFont('helvetica', 'bold').setFontSize(20);
  doc.setTextColor(...ORANGE);
  const titleY = brandY + 60;
  doc.text('OFFICIAL COMMERCIAL INVOICE', PAGE_W / 2, titleY, { align: 'center' });
  const titleWidth = doc.getTextWidth('OFFICIAL COMMERCIAL INVOICE');
  doc.setDrawColor(...ORANGE).setLineWidth(1);
  doc.line((PAGE_W - titleWidth) / 2, titleY + 3, (PAGE_W + titleWidth) / 2, titleY + 3);
  doc.setTextColor(0, 0, 0);

  // ── Meta block (top-left) ──
  doc.setFont('helvetica', 'bold').setFontSize(10);
  const metaY = titleY + 30;
  doc.text(`Invoice #: ${payload.invoice_number || '—'}`, margin, metaY);
  doc.text(`Date: ${payload.date_label || '—'}`, margin, metaY + 14);
  doc.text(`Customer ID: ${payload.customer?.name || '—'}`, margin, metaY + 36);

  // ── Line items table ──
  const head = [[
    'Item',
    'SKU\nNumber',
    'Product Name',
    'Brand',
    'Materials',
    'Total\nItems',
    'Print Cost\n(USD)',
    'Subtotal\n(USD)',
  ]];

  const body = (payload.line_items || []).map((row) => [
    row.item,
    row.sku || '',
    row.product_name || '',
    row.brand || '',
    row.materials || '',
    row.total_items,
    formatMoney(row.print_cost),
    formatMoney(row.subtotal),
  ]);

  // Pad to at least 8 rows so the printed invoice keeps the template look
  // even with only 1-2 actual lines.
  while (body.length < 8) body.push(['', '', '', '', '', '', '', '']);

  autoTable(doc, {
    startY: metaY + 60,
    head,
    body,
    theme: 'grid',
    headStyles: {
      fillColor: ORANGE,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
      fontSize: 9,
    },
    bodyStyles: { fontSize: 9, halign: 'center', valign: 'middle', minCellHeight: 22 },
    columnStyles: {
      0: { cellWidth: 35 },
      1: { cellWidth: 60 },
      2: { cellWidth: 140, halign: 'left' },
      3: { cellWidth: 60 },
      4: { cellWidth: 95 },
      5: { cellWidth: 50 },
      6: { cellWidth: 55, halign: 'right' },
      7: { cellWidth: 60, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });

  // ── Totals block — wider so labels + values don't collide ──
  // Right-aligned, 2 sub-cells: label (60% width) | value (40%).
  const afterTable = doc.lastAutoTable.finalY + 2;
  const totalsW = 240;
  const totalsX = PAGE_W - margin - totalsW;
  const labelW = Math.round(totalsW * 0.6);
  const valueW = totalsW - labelW;
  const rowH = 22;

  drawTotalRow(doc, totalsX, afterTable,            labelW, valueW, rowH,
    'PRINT COST',    formatMoney(payload.totals?.print_cost),    ORANGE_LIGHT);
  drawTotalRow(doc, totalsX, afterTable + rowH,     labelW, valueW, rowH,
    'SHIPPING COST', formatMoney(payload.totals?.shipping_cost), [255, 255, 255]);
  drawTotalRow(doc, totalsX, afterTable + rowH * 2, labelW, valueW, rowH,
    'TOTAL AMOUNT',  formatMoney(payload.totals?.total),         ORANGE, true);

  // ── Footer block ──
  const footY = afterTable + rowH * 3 + 30;
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(0, 0, 0);
  doc.text('Payment Method: ' + (opts.paymentMethod || 'Pipo'), margin, footY);
  doc.text('Status: ' + (opts.status || ''), margin, footY + 14);

  doc.setFont('helvetica', 'bolditalic').setFontSize(11);
  doc.text('THANK YOU FOR YOUR ORDER', PAGE_W / 2, footY + 40, { align: 'center' });
  doc.setFont('helvetica', 'bold').setFontSize(10);
  doc.text('BULLSTART LLC - PRINT ON DEMAND SERVICE', PAGE_W / 2, footY + 54, { align: 'center' });

  return doc.output('blob');
}

function drawTotalRow(doc, x, y, labelW, valueW, h, label, value, fillColor, bold = false) {
  const totalW = labelW + valueW;
  doc.setFillColor(...fillColor);
  doc.rect(x, y, totalW, h, 'F');
  doc.setDrawColor(180, 180, 180).setLineWidth(0.5);
  // Outer border + separator between label and value cells
  doc.rect(x, y, totalW, h);
  doc.line(x + labelW, y, x + labelW, y + h);

  doc.setFont('helvetica', 'bold').setFontSize(bold ? 11 : 10);
  doc.setTextColor(bold ? 255 : 0, bold ? 255 : 0, bold ? 255 : 0);
  doc.text(label, x + 8, y + h / 2 + 4);
  doc.text(value, x + labelW + valueW - 8, y + h / 2 + 4, { align: 'right' });
  doc.setTextColor(0, 0, 0);
}

function formatMoney(n) {
  const v = Number(n ?? 0);
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
