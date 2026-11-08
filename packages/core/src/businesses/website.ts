import { schema, withTenant } from '@fulcra/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireMember, type ActorContext } from '../members/access';

/** Adds https:// when the owner types "mystore.com". */
function normaliseWebsite(value: string): string {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export const storeChoiceInput = z.discriminatedUnion('choice', [
  /** Customers shop on our simple store. */
  z.object({ choice: z.literal('store') }),
  /** The business already has a website; products are imported from it later. */
  z.object({
    choice: z.literal('website'),
    websiteUrl: z
      .string()
      .trim()
      .min(4, 'Enter your website address.')
      .max(300)
      .transform(normaliseWebsite)
      .pipe(
        z
          .url({ message: 'Enter a website address like mystore.com.' })
          .refine(
            (url) => /^https?:\/\/[^/]+\.[^/]+/.test(url),
            'Enter a website address like mystore.com.',
          ),
      ),
  }),
]);

export type StoreChoiceInput = z.input<typeof storeChoiceInput>;

/** "Use our store" or "Connect my website" (onboarding and settings). Owner only. */
export async function setStoreChoice(actor: ActorContext, input: StoreChoiceInput): Promise<void> {
  const data = storeChoiceInput.parse(input);
  await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner']);
    await tx
      .update(schema.businesses)
      .set(
        data.choice === 'website'
          ? { hasExternalWebsite: true, websiteUrl: data.websiteUrl }
          : { hasExternalWebsite: false },
      )
      .where(eq(schema.businesses.id, actor.businessId));
  });
}
