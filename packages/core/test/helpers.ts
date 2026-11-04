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
