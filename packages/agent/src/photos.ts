import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { loadPhotoForAi, recordAiUsage, savePhotoDescription, type AgentTurn } from '@fulcra/core';
import { z } from 'zod';
import { withFallback } from './models';

/** At most this many new photos are looked at per reply (the newest ones). */
const MAX_PHOTOS_PER_TURN = 3;

// What the model fills in (Core cleans and limits it before saving).
const photoOutput = z.object({
  kind: z.enum(['product', 'payment_proof', 'other']),
  description: z.string(),
  textInPhoto: z.string(),
  searchTerms: z.array(z.string()),
});

const SYSTEM = `You look at photos customers send to a small online shop in Nigeria (fashion, beauty, food, gadgets) and describe them for the shop's sales assistant, who cannot see images.
- kind: "product" if it shows something the customer may want to buy (including screenshots of products from Instagram, Pinterest or other shops); "payment_proof" if it is a bank transfer receipt, debit alert or payment screenshot; otherwise "other".
- description: one or two plain sentences: what it is, colour, pattern, style, material, and anything that tells products apart.
- textInPhoto: words written on the photo exactly as seen (prices, names, amounts, bank, date), or "" if none.
- searchTerms: 3 to 6 short words a shop would use in product names or descriptions, most important first (for example "ankara", "gown", "maxi", "blue"). Empty for payment proofs.
Describe only what you see. Never guess a price that is not written.`;

/**
 * Looks at the customer's new photos once (a small, cheap vision call each) and saves what
 * they show on the message. The reply then works from that text: the catalog is searched
 * with the photo's words and later turns never send the photo again (docs/decisions/0012).
 * A photo that cannot be read is left as "a photo you cannot see".
 */
export async function describeNewPhotos(
  turn: AgentTurn,
  client: Anthropic,
  model: string,
): Promise<void> {
  const pending = turn.history
    .filter((m) => m.sender === 'customer' && m.image && !m.photo)
    .slice(-MAX_PHOTOS_PER_TURN);
  for (const message of pending) {
    const photo = await loadPhotoForAi(message.image!);
    if (!photo) continue;
    let response;
    try {
      response = await client.beta.messages.parse({
        model,
        max_tokens: 2000,
        ...withFallback(model),
        output_config: { effort: 'low', format: betaZodOutputFormat(photoOutput) },
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: photo.mediaType, data: photo.data },
              },
              {
                type: 'text',
                text: message.text
                  ? `The customer wrote with it: "${message.text}"`
                  : 'Describe this photo.',
              },
            ],
          },
        ],
      });
    } catch (error) {
      if (
        error instanceof Anthropic.RateLimitError ||
        error instanceof Anthropic.InternalServerError ||
        error instanceof Anthropic.APIConnectionError
      ) {
        throw error; // temporary: the job is retried
      }
      if (error instanceof Anthropic.APIError) {
        console.error('[agent] photo call failed', error.status, error.message);
        continue;
      }
      throw error;
    }
    await recordAiUsage(turn.businessId, {
      feature: 'agent.photo',
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    });
    if (response.stop_reason === 'refusal' || !response.parsed_output) continue;
    message.photo = await savePhotoDescription(turn.businessId, message.id, response.parsed_output);
  }
}

/** The photo as text in the chat history. */
export function photoNote(photo: NonNullable<AgentTurn['history'][number]['photo']>): string {
  const parts = [`[The customer sent a photo. It shows: ${photo.description}`];
  if (photo.textInPhoto) parts.push(`Written on it: "${photo.textInPhoto}"`);
  if (photo.kind === 'product' && photo.searchTerms.length)
    parts.push(`Search words: ${photo.searchTerms.join(', ')}`);
  if (photo.kind === 'payment_proof')
    parts.push('This looks like a payment screenshot: not proof. Check with checkPaymentStatus');
  return `${parts.join('. ')}.]`;
}
