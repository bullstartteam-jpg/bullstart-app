import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Layout constants mirror the Google Sheets template the user supplied.
// Page is US Letter portrait — easier to print on standard 8.5x11 paper.
const PAGE_W = 612;
const ORANGE = [240, 140, 50];
const ORANGE_LIGHT = [255, 200, 150];

/**
 * Build a commercial invoice PDF from the JSON payload returned by
 * `GET /api/orders/invoice-data`. Returns a Blob the caller can either save
 * to disk or attach to an upload.
 *
 * Expected payload shape:
 *   {
 *     invoice_number: 'RX2605261430',
 *     date_label: 'May 1 2026 – May 5 2026',
 *     customer: { name, email },
 *     line_items: [{ item, sku, product_name, brand, materials, total_items, print_cost, subtotal }],
 *     totals: { print_cost, shipping_cost, total },
 *   }
 */
export function buildInvoicePdf(payload, opts = {}) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const margin = 40;

  // ── Header band — brand block on left, document title on right ──
  doc.setFont('helvetica', 'bold').setFontSize(13);
  doc.text('BULLSTART- PRINT ON DEMAND SERVICE', PAGE_W / 2, margin, { align: 'center' });

  doc.setFont('helvetica', 'normal').setFontSize(9);
  const brandY = margin + 25;
  doc.text('Address: 4353 Saddle Horn W, Oceanside CA 92057', margin, brandY);
  doc.text('Email: bullstartteam@gmail.com', margin, brandY + 12);
  doc.text('Phone: 619-666-5123', margin, brandY + 24);

  // Document title — orange, underlined center
  doc.setFont('helvetica', 'bold').setFontSize(20);
  doc.setTextColor(...ORANGE);
  const titleY = brandY + 60;
  doc.text('OFFICIAL COMMERCIAL INVOICE', PAGE_W / 2, titleY, { align: 'center' });
  // Underline by drawing a line just below the baseline
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

  // Pad to at least 8 rows so the printed invoice looks like the template
  // even when there are only 1-2 actual lines.
  while (body.length < 8) {
    body.push(['', '', '', '', '', '', '', '']);
  }

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

  // ── Totals block — right-aligned, orange highlight rows ──
  const afterTable = doc.lastAutoTable.finalY + 2;
  const totalsX = margin + 410;
  const totalsW = PAGE_W - margin - totalsX;
  const rowH = 22;

  drawTotalRow(doc, totalsX, afterTable,            totalsW, rowH, 'PRINT COST',   formatMoney(payload.totals?.print_cost),   ORANGE_LIGHT);
  drawTotalRow(doc, totalsX, afterTable + rowH,     totalsW, rowH, 'SHIPPING COST', formatMoney(payload.totals?.shipping_cost), [255, 255, 255]);
  drawTotalRow(doc, totalsX, afterTable + rowH * 2, totalsW, rowH, 'TOTAL AMOUNT', formatMoney(payload.totals?.total),         ORANGE, true);

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

function drawTotalRow(doc, x, y, w, h, label, value, fillColor, bold = false) {
  doc.setFillColor(...fillColor);
  doc.rect(x, y, w, h, 'F');
  doc.setDrawColor(180, 180, 180).setLineWidth(0.5);
  doc.rect(x, y, w, h);

  doc.setFont('helvetica', 'bold').setFontSize(bold ? 11 : 10);
  doc.setTextColor(bold ? 255 : 0, bold ? 255 : 0, bold ? 255 : 0);
  // Label cell ~ 70% width, value cell ~ 30%
  doc.text(label, x + 8, y + h / 2 + 4);
  doc.text(value, x + w - 8, y + h / 2 + 4, { align: 'right' });
  doc.setTextColor(0, 0, 0);
}

function formatMoney(n) {
  const v = Number(n ?? 0);
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
