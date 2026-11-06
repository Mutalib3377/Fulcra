import 'server-only';
import { paymentMethodLabel, type Receipt } from '@fulcra/core';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

// The built-in PDF fonts have no ₦ sign, so amounts show as "NGN 15,000.00".
const money = (kobo: number) =>
  `NGN ${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Keep to characters the built-in fonts can draw.
const safe = (text: string) => text.replace(/[^\x20-\x7E]/g, '?');
const date = (d: Date | null) =>
  d
    ? d.toLocaleString('en-NG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Africa/Lagos',
      })
    : '-';

function hexToRgb(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** A one-page A5 receipt. */
export async function receiptPdf(receipt: Receipt): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Receipt ${receipt.order.orderNumber} - ${receipt.business.name}`);
  const page = doc.addPage([420, 595]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const grey = rgb(0.4, 0.42, 0.45);
  const left = 32;
  const right = 388;
  let y = 595;

  page.drawRectangle({
    x: 0,
    y: y - 80,
    width: 420,
    height: 80,
    color: hexToRgb(receipt.brand.primaryColour),
  });
  page.drawText(safe(receipt.business.name).slice(0, 40), {
    x: left,
    y: y - 40,
    size: 18,
    font: bold,
    color: rgb(1, 1, 1),
  });
  page.drawText(`Receipt  -  Order #${receipt.order.orderNumber}`, {
    x: left,
    y: y - 62,
    size: 11,
    font: regular,
    color: rgb(1, 1, 1),
  });
  y -= 115;

  const row = (label: string, value: string, opts: { bold?: boolean; size?: number } = {}) => {
    const size = opts.size ?? 10;
    const font = opts.bold ? bold : regular;
    page.drawText(safe(label), { x: left, y, size, font, color: opts.bold ? rgb(0, 0, 0) : grey });
    page.drawText(value, { x: right - font.widthOfTextAtSize(value, size), y, size, font });
    y -= size + 8;
  };

  const method = receipt.order.paymentMethod;
  row('Customer', safe(receipt.customerName || '-'));
  row('Date paid', date(receipt.order.paidAt));
  row('Payment', paymentMethodLabel(method) || '-');
  y -= 6;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: grey });
  y -= 18;

  for (const item of receipt.items) {
    const name = `${item.quantity} x ${item.productName}${item.variantLabel ? ` (${item.variantLabel})` : ''}`;
    const value = money(item.lineTotal);
    page.drawText(safe(name).slice(0, 52), { x: left, y, size: 10, font: regular });
    page.drawText(value, {
      x: right - regular.widthOfTextAtSize(value, 10),
      y,
      size: 10,
      font: regular,
    });
    y -= 18;
    if (y < 140) break;
  }
  page.drawLine({
    start: { x: left, y: y + 6 },
    end: { x: right, y: y + 6 },
    thickness: 0.5,
    color: grey,
  });
  y -= 10;

  row('Items', money(receipt.order.subtotal));
  if (receipt.order.fulfilment === 'delivery')
    row(`Delivery (${receipt.order.deliveryZoneName})`, money(receipt.order.deliveryFee));
  if (receipt.order.discount > 0) row('Discount', `- ${money(receipt.order.discount)}`);
  row('Total', money(receipt.order.total), { bold: true, size: 12 });
  row('Paid', money(receipt.order.amountPaid), { bold: true, size: 12 });

  page.drawText(safe(`Thank you for shopping with ${receipt.business.name}.`), {
    x: left,
    y: 40,
    size: 9,
    font: regular,
    color: grey,
  });
  return doc.save();
}
