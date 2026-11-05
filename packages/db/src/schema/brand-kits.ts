import { sql } from 'drizzle-orm';
import { check, jsonb, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, tenantPolicy, timestamps, type StoredImage } from './_shared';
import { businesses } from './businesses';

export const brandFonts = ['clean', 'modern', 'friendly', 'elegant', 'bold'] as const;
export const brandFont = pgEnum('brand_font', brandFonts);

export const brandVoices = ['friendly', 'professional', 'playful'] as const;
export const brandVoice = pgEnum('brand_voice', brandVoices);

const hexColour = (column: string) => sql.raw(`${column} ~ '^#[0-9a-f]{6}$'`);

/** One per business: how the store and the assistant look and sound. */
export const brandKits = pgTable(
  'brand_kits',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .unique()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    logo: jsonb('logo').$type<StoredImage>(),
    /** Lowercase hex, e.g. #0f6b55. */
    primaryColour: text('primary_colour').notNull().default('#0f6b55'),
    accentColour: text('accent_colour').notNull().default('#f5a524'),
    font: brandFont('font').notNull().default('clean'),
    voice: brandVoice('voice').notNull().default('friendly'),
    /** Extra guidance for the assistant's tone, in the owner's words. */
    voiceNotes: text('voice_notes').notNull().default(''),
    description: text('description').notNull().default(''),
    ...timestamps,
  },
  (t) => [
    check('brand_kits_primary_colour_hex', hexColour('primary_colour')),
    check('brand_kits_accent_colour_hex', hexColour('accent_colour')),
    tenantPolicy('brand_kits', t.businessId),
  ],
).enableRLS();

export type BrandKit = typeof brandKits.$inferSelect;
export type BrandFont = (typeof brandFonts)[number];
export type BrandVoice = (typeof brandVoices)[number];
