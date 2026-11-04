import { describe, expect, it } from 'vitest';
import { createBusiness } from '../src/businesses/create-business';
import { getBusiness } from '../src/businesses/get-business';
import { checkSubdomainAvailable } from '../src/businesses/subdomain';
import { listMyBusinesses } from '../src/members/memberships';
import { newBusiness, newUser, uniq } from './helpers';

describe('createBusiness', () => {
  it('creates the business, normalises inputs and makes the user owner', async () => {
    const owner = newUser();
    const subdomain = `Glow-${uniq()}`;
    const business = await createBusiness(owner, {
      name: '  Glow Beauty  ',
      category: 'beauty',
      whatsappNumber: '0803 123 4567',
      subdomain,
    });

    expect(business.name).toBe('Glow Beauty');
    expect(business.whatsappNumber).toBe('+2348031234567');
    expect(business.subdomain).toBe(subdomain.toLowerCase());
    expect(business.timezone).toBe('Africa/Lagos');

    const memberships = await listMyBusinesses(owner.userId);
    expect(memberships).toEqual([
      expect.objectContaining({ businessId: business.id, role: 'owner' }),
    ]);
  });

  it('rejects an invalid WhatsApp number on the right field', async () => {
    await expect(
      createBusiness(newUser(), {
        name: 'Shop',
        category: 'food',
        whatsappNumber: '12345',
        subdomain: `s-${uniq()}`,
      }),
    ).rejects.toMatchObject({ code: 'validation', field: 'whatsappNumber' });
  });

  it('rejects reserved and taken store addresses', async () => {
    await expect(
      createBusiness(newUser(), {
        name: 'Shop',
        category: 'food',
        whatsappNumber: '08012345678',
        subdomain: 'admin',
      }),
    ).rejects.toMatchObject({ code: 'validation', field: 'subdomain' });

    const { business } = await newBusiness();
    await expect(
      createBusiness(newUser(), {
        name: 'Copycat',
        category: 'food',
        whatsappNumber: '08012345678',
        subdomain: business.subdomain.toUpperCase(),
      }),
    ).rejects.toMatchObject({ code: 'conflict', field: 'subdomain' });
  });
});

describe('checkSubdomainAvailable', () => {
  it('reports taken, reserved, invalid and free names', async () => {
    const { business } = await newBusiness();
    expect(await checkSubdomainAvailable(business.subdomain)).toMatchObject({
      available: false,
      problem: 'taken',
    });
    expect(await checkSubdomainAvailable('www')).toMatchObject({
      available: false,
      problem: 'reserved',
    });
    expect(await checkSubdomainAvailable('a b')).toMatchObject({
      available: false,
      problem: 'invalid',
    });
    expect(await checkSubdomainAvailable(`free-${uniq()}`)).toMatchObject({ available: true });
  });
});

describe('getBusiness', () => {
  it('returns the actor business', async () => {
    const { business, actor } = await newBusiness();
    expect((await getBusiness(actor)).id).toBe(business.id);
  });
});
