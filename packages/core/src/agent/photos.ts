import { schema, withTenant } from '@fulcra/db';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { imageUrl, type StoredImage } from '../media/images';

const clip = (max: number) =>
  z
    .string()
    .default('')
    .transform((s) => s.trim().slice(0, max));

/**
 * What a customer's photo shows, written once by the assistant (a cheap vision call) and
 * kept on the message, so later turns read text instead of sending the photo again
 * (see docs/decisions/0012).
 */
export const photoDescription = z.object({
  /** A product (to find in the catalog), a payment proof (never trusted), or anything else. */
  kind: z.enum(['product', 'payment_proof', 'other']).catch('other'),
  description: clip(600),
  /** Words written on the photo (prices, names, bank details) exactly as seen. */
  textInPhoto: clip(600),
  /** Short catalog search words: product type, colour, pattern, material. */
  searchTerms: z
    .array(z.string())
    .default([])
    .transform((terms) =>
      [...new Set(terms.map((t) => t.trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(
        0,
        8,
      ),
    ),
});
export type PhotoDescription = z.output<typeof photoDescription>;
export type PhotoDescriptionInput = z.input<typeof photoDescription>;

/** Saves what a customer's photo shows on its message. */
export async function savePhotoDescription(
  businessId: string,
  messageId: string,
  input: PhotoDescriptionInput,
): Promise<PhotoDescription> {
  const photo = photoDescription.parse(input);
  await withTenant(businessId, (tx) =>
    tx
      .update(schema.messages)
      .set({
        payload: sql`${schema.messages.payload} || jsonb_build_object('photo', ${JSON.stringify(photo)}::jsonb)`,
      })
      .where(
        and(
          eq(schema.messages.id, z.uuid().parse(messageId)),
          eq(schema.messages.direction, 'inbound'),
        ),
      ),
  );
  return photo;
}

/** The large stored copy of a customer's photo, for the AI to look at (null if missing). */
export async function loadPhotoForAi(
  image: Pick<StoredImage, 'path'>,
): Promise<{ data: string; mediaType: 'image/webp' } | null> {
  try {
    const response = await fetch(imageUrl(image, 'lg'));
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return { data: bytes.toString('base64'), mediaType: 'image/webp' };
  } catch {
    return null;
  }
}
