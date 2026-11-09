'use server';

import { lookupWhatsAppNumber, subscribeWhatsAppApp, WhatsAppApiError } from '@fulcra/channels';
import {
  disconnectChannel,
  saveWhatsAppConnection,
  whatsAppConnectionInput,
  type WhatsAppConnectionInput,
} from '@fulcra/core';
import { revalidatePath } from 'next/cache';
import { toActionError, type ActionResult } from '@/lib/action-result';
import { getActionContext, SESSION_ENDED } from '@/lib/auth';

/**
 * Connects a WhatsApp number with its Meta details: checked with Meta first (the number
 * exists and the token can use it), then saved by Core with the token encrypted.
 */
export async function connectWhatsAppAction(
  input: WhatsAppConnectionInput,
): Promise<ActionResult<{ id: string; displayName: string }>> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  const parsed = whatsAppConnectionInput.safeParse(input);
  if (!parsed.success) return toActionError(parsed.error);
  const { phoneNumberId, businessAccountId, accessToken } = parsed.data;
  let displayName: string;
  try {
    const number = await lookupWhatsAppNumber(phoneNumberId, accessToken);
    displayName = [number.verifiedName, number.displayPhoneNumber].filter(Boolean).join(' · ');
  } catch (error) {
    if (error instanceof WhatsAppApiError) {
      return {
        ok: false,
        message:
          error.status === 0
            ? 'We could not reach WhatsApp. Check your connection and try again.'
            : 'Meta did not accept these details. Check the phone number ID and that the access token is current and has WhatsApp permissions.',
      };
    }
    return toActionError(error);
  }
  try {
    // So Meta sends this number's messages to us (already on for Meta's test number).
    await subscribeWhatsAppApp(businessAccountId, accessToken).catch((error: unknown) =>
      console.warn('[whatsapp] could not subscribe the app', error),
    );
    const saved = await saveWhatsAppConnection(context.actor, { ...parsed.data, displayName });
    revalidatePath('/dashboard/settings');
    return { ok: true, data: { id: saved.id, displayName } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function disconnectWhatsAppAction(connectionId: string): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await disconnectChannel(context.actor, connectionId);
    revalidatePath('/dashboard/settings');
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}
