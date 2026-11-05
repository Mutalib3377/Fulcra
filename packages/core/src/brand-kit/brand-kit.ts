import { schema, withTenant } from '@fulcra/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { deleteImages, isOwnImagePath } from '../media/images';
import { requireMember, type ActorContext } from '../members/access';
import { CoreError } from '../shared/errors';

export const BRAND_KIT_DEFAULTS = {
  logo: null,
  primaryColour: '#0f6b55',
  accentColour: '#f5a524',
  font: 'clean',
  voice: 'friendly',
  voiceNotes: '',
  description: '',
} as const satisfies Omit<BrandKitView, 'isSaved'>;

export type BrandKitView = {
  logo: schema.StoredImage | null;
  primaryColour: string;
  accentColour: string;
  font: schema.BrandFont;
  voice: schema.BrandVoice;
  voiceNotes: string;
  description: string;
  /** False until the owner saves the brand kit for the first time. */
  isSaved: boolean;
};

const hexColour = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, 'Choose a colour.');

export const brandKitInput = z.object({
  logo: z
    .object({
      path: z.string().min(1),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .nullable(),
  primaryColour: hexColour,
  accentColour: hexColour,
  font: z.enum(schema.brandFonts),
  voice: z.enum(schema.brandVoices),
  voiceNotes: z.string().trim().max(500, 'Keep this under 500 characters.').default(''),
  description: z.string().trim().max(1000, 'Keep this under 1,000 characters.').default(''),
});

export type BrandKitInput = z.input<typeof brandKitInput>;

/** The business's brand kit, or the defaults if it has not been saved yet. */
export async function getBrandKit(actor: ActorContext): Promise<BrandKitView> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor);
    const [kit] = await tx.select().from(schema.brandKits).limit(1);
    if (!kit) return { ...BRAND_KIT_DEFAULTS, isSaved: false };
    return {
      logo: kit.logo ?? null,
      primaryColour: kit.primaryColour,
      accentColour: kit.accentColour,
      font: kit.font,
      voice: kit.voice,
      voiceNotes: kit.voiceNotes,
      description: kit.description,
      isSaved: true,
    };
  });
}

/** Saves the brand kit. Owner only. A replaced logo is removed from storage. */
export async function saveBrandKit(
  actor: ActorContext,
  input: BrandKitInput,
): Promise<BrandKitView> {
  const data = brandKitInput.parse(input);
  if (data.logo && !isOwnImagePath(actor.businessId, data.logo.path)) {
    throw new CoreError(
      'validation',
      'The logo could not be found. Please upload it again.',
      'logo',
    );
  }

  const { saved, oldLogo } = await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner']);
    const [current] = await tx
      .select({ logo: schema.brandKits.logo })
      .from(schema.brandKits)
      .where(eq(schema.brandKits.businessId, actor.businessId))
      .limit(1);
    const values = { ...data, businessId: actor.businessId };
    const [row] = await tx
      .insert(schema.brandKits)
      .values(values)
      .onConflictDoUpdate({ target: schema.brandKits.businessId, set: data })
      .returning();
    if (!row) throw new Error('Brand kit upsert returned no row');
    return { saved: row, oldLogo: current?.logo ?? null };
  });

  if (oldLogo && oldLogo.path !== saved.logo?.path) await deleteImages([oldLogo]);

  return {
    logo: saved.logo ?? null,
    primaryColour: saved.primaryColour,
    accentColour: saved.accentColour,
    font: saved.font,
    voice: saved.voice,
    voiceNotes: saved.voiceNotes,
    description: saved.description,
    isSaved: true,
  };
}
