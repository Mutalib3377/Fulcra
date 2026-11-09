import { z } from 'zod';

/**
 * The standard message shapes every channel converts to and from (rule 3). Channel adapters
 * in `@fulcra/channels` build these; Core stores them; the agent reads and writes them and
 * never knows which platform it is on. Defined here because Core receives and sends them
 * (packages import Core, never the other way round); `@fulcra/channels` re-exports them.
 */

const text = (max: number) => z.string().max(max);

export const inboundMessage = z.object({
  /** The platform's message id (dedupes webhooks delivered twice). */
  externalId: z.string().min(1).max(200),
  /** The customer as the platform knows them. */
  from: z.object({
    externalUserId: z.string().min(1).max(200),
    displayName: text(120).default(''),
    /** E.164 when the platform tells us (WhatsApp does). */
    phone: z
      .string()
      .regex(/^\+[1-9]\d{7,14}$/)
      .optional(),
  }),
  sentAt: z.coerce.date(),
  type: z.enum([
    'text',
    'image',
    'audio',
    'video',
    'document',
    'location',
    'button_reply',
    'unsupported',
  ]),
  text: text(4096).default(''),
  media: z
    .object({
      providerMediaId: z.string().max(200).optional(),
      mimeType: z.string().max(100).optional(),
      caption: text(1024).optional(),
      /** Our stored copy of a photo (channels download it before queuing; see storeImage). */
      image: z
        .object({
          path: z.string().max(200),
          width: z.number().int().positive(),
          height: z.number().int().positive(),
        })
        .optional(),
    })
    .optional(),
  location: z
    .object({ latitude: z.number(), longitude: z.number(), name: text(200).optional() })
    .optional(),
  /** The id of the button or list row the customer tapped. */
  replyId: z.string().max(200).optional(),
});

export type InboundMessage = z.infer<typeof inboundMessage>;
export type InboundMessageInput = z.input<typeof inboundMessage>;

const button = z.object({ id: z.string().min(1).max(200), title: z.string().min(1).max(20) });

export const outboundMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().trim().min(1).max(4096) }),
  z.object({
    type: z.literal('image'),
    imageUrl: z.url(),
    caption: text(1024).optional(),
  }),
  /** Up to 3 quick-reply buttons (WhatsApp limit); channels without buttons send numbered text. */
  z.object({
    type: z.literal('buttons'),
    text: z.string().trim().min(1).max(1024),
    buttons: z.array(button).min(1).max(3),
  }),
  /** A pick-list of up to 10 rows (WhatsApp limit). */
  z.object({
    type: z.literal('list'),
    text: z.string().trim().min(1).max(1024),
    buttonLabel: z.string().min(1).max(20),
    rows: z
      .array(button.extend({ description: text(72).optional() }))
      .min(1)
      .max(10),
  }),
]);

export type OutboundMessage = z.infer<typeof outboundMessage>;
