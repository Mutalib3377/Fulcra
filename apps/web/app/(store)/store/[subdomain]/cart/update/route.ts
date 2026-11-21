import { parseCart, setCartQuantity, CART_COOKIE } from '@fulcra/core/rules';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { fromSameSite, writeCart } from '@/lib/cart';
import { storeUrl } from '@/lib/urls';

type Context = { params: Promise<{ subdomain: string }> };

const input = z.object({
  variantId: z.uuid(),
  quantity: z.coerce.number().int().min(0).max(20),
});

/** Cart page buttons (−, +, Remove): sets one line's quantity (0 removes it). */
export async function POST(request: NextRequest, { params }: Context) {
  const { subdomain } = await params;
  if (!fromSameSite(request)) return new NextResponse('Forbidden', { status: 403 });
  const form = await request.formData();
  const response = NextResponse.redirect(storeUrl(subdomain, '/cart'), 303);
  const parsed = input.safeParse({
    variantId: form.get('variantId'),
    quantity: form.get('quantity'),
  });
  if (parsed.success) {
    writeCart(
      response,
      setCartQuantity(
        parseCart(request.cookies.get(CART_COOKIE)?.value),
        parsed.data.variantId,
        parsed.data.quantity,
      ),
    );
  }
  return response;
}
