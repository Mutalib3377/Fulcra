import { addToCart, parseCart, CART_COOKIE } from '@fulcra/core/rules';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { fromSameSite, writeCart } from '@/lib/cart';
import { storeUrl } from '@/lib/urls';

type Context = { params: Promise<{ subdomain: string }> };

const input = z.object({
  variantId: z.uuid(),
  quantity: z.coerce.number().int().min(1).max(20).catch(1),
});

/** "Add to cart" (a plain form on the product page): adds, then shows the cart. */
export async function POST(request: NextRequest, { params }: Context) {
  const { subdomain } = await params;
  if (!fromSameSite(request)) return new NextResponse('Forbidden', { status: 403 });
  const form = await request.formData();
  const parsed = input.safeParse({
    variantId: form.get('variantId'),
    quantity: form.get('quantity') ?? 1,
  });
  if (!parsed.success) return NextResponse.redirect(storeUrl(subdomain, '/cart'), 303);
  const lines = addToCart(
    parseCart(request.cookies.get(CART_COOKIE)?.value),
    parsed.data.variantId,
    parsed.data.quantity,
  );
  const response = NextResponse.redirect(storeUrl(subdomain, '/cart?added=1'), 303);
  writeCart(response, lines);
  return response;
}
