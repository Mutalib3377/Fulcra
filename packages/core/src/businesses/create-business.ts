import { schema, withSystem } from '@fulcra/db';
import { z } from 'zod';
import { CoreError, isUniqueViolation } from '../shared/errors';
import { normalizePhoneNumber } from '../shared/phone';
import { normalizeSubdomain, subdomainMessages, validateSubdomain } from './subdomain';

export const createBusinessInput = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Enter your business name.')
    .max(80, 'Keep the name under 80 characters.'),
  category: z.enum(schema.businessCategories, { message: 'Choose what you sell.' }),
  whatsappNumber: z.string().trim().min(1, 'Enter your WhatsApp number.'),
  subdomain: z.string().trim().min(1, 'Choose your store address.'),
});

export type CreateBusinessInput = z.input<typeof createBusinessInput>;

export type CreateBusinessOwner = { userId: string; email: string };

/**
 * Onboarding step 1: creates a business and makes the signed-in user its owner.
 * Runs as a system transaction because the business does not exist yet.
 */
export async function createBusiness(
  owner: CreateBusinessOwner,
  input: CreateBusinessInput,
): Promise<schema.Business> {
  const data = createBusinessInput.parse(input);

  const whatsappNumber = normalizePhoneNumber(data.whatsappNumber);
  if (!whatsappNumber) {
    throw new CoreError(
      'validation',
      'Enter a valid WhatsApp number, for example 0801 234 5678.',
      'whatsappNumber',
    );
  }

  const subdomain = normalizeSubdomain(data.subdomain);
  const problem = validateSubdomain(subdomain);
  if (problem) throw new CoreError('validation', subdomainMessages[problem], 'subdomain');

  try {
    return await withSystem(async (tx) => {
      const [business] = await tx
        .insert(schema.businesses)
        .values({ name: data.name, category: data.category, whatsappNumber, subdomain })
        .returning();
      if (!business) throw new Error('Business insert returned no row');

      await tx.insert(schema.members).values({
        businessId: business.id,
        userId: owner.userId,
        email: owner.email.toLowerCase(),
        role: 'owner',
      });
      return business;
    });
  } catch (error) {
    if (isUniqueViolation(error, 'businesses_subdomain_unique')) {
      throw new CoreError('conflict', subdomainMessages.taken, 'subdomain');
    }
    throw error;
  }
}
