import { randomUUID } from 'node:crypto';
import { createBusiness } from '../src/businesses/create-business';

export const uniq = () => Math.random().toString(36).slice(2, 8);

export function newUser(label = 'user') {
  return { userId: randomUUID(), email: `${label}-${uniq()}@example.com` };
}

/** Creates a business with a fresh owner. */
export async function newBusiness(label = 'shop') {
  const owner = newUser(`${label}-owner`);
  const business = await createBusiness(owner, {
    name: `${label} ${uniq()}`,
    category: 'fashion',
    whatsappNumber: '08012345678',
    subdomain: `${label}-${uniq()}`,
  });
  return { business, owner, actor: { businessId: business.id, userId: owner.userId } };
}

/** Adds a member with the given role to a business (through a real invite). */
export async function addMember(
  actor: { businessId: string; userId: string },
  role: 'staff' | 'rider',
): Promise<{ businessId: string; userId: string }> {
  const { createInvite, acceptInvite } = await import('../src/members/invites');
  const user = newUser(role);
  const { token } = await createInvite(actor, { email: user.email, role });
  await acceptInvite({ token, ...user });
  return { businessId: actor.businessId, userId: user.userId };
}

/** A minimal valid product input. */
export function productDraft(overrides: Record<string, unknown> = {}) {
  return {
    name: `Ankara dress ${uniq()}`,
    retailPrice: 1_500_000,
    options: { kind: 'simple' as const, stock: 5 },
    ...overrides,
  };
}

/** A business with one delivery zone and one product (stock 5 by default). */
export async function shopWithStock(stock = 5, overrides: Record<string, unknown> = {}) {
  const { createProduct } = await import('../src/catalog/products');
  const { createDeliveryZone } = await import('../src/delivery/zones');
  const shop = await newBusiness('shop');
  const zone = await createDeliveryZone(shop.actor, {
    name: 'Lekki',
    fee: 200_000,
    estimatedTime: 'Same day',
  });
  const { product, variants } = await createProduct(
    shop.actor,
    productDraft({
      name: 'Ankara dress',
      retailPrice: 1_500_000,
      options: { kind: 'simple', stock },
      ...overrides,
    }),
  );
  return { ...shop, zone, product, variant: variants[0]! };
}
