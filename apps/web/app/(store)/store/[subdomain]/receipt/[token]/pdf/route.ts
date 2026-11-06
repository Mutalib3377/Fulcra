import { getReceipt } from '@fulcra/core';
import { receiptPdf } from '@/lib/receipt-pdf';

type Context = { params: Promise<{ subdomain: string; token: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { subdomain, token } = await params;
  const receipt = await getReceipt(subdomain, token);
  if (!receipt?.isPaid) return new Response('Receipt not found', { status: 404 });
  const bytes = await receiptPdf(receipt);
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="receipt-${receipt.order.orderNumber}.pdf"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
}
