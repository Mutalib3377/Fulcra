'use server';

import { randomInt } from 'node:crypto';
import {
  exchangeEmbeddedSignupCode,
  lookupWhatsAppNumber,
  registerWhatsAppNumber,
  subscribeWhatsAppApp,
  WhatsAppApiError,
} from '@fulcra/channels';
import {
  disconnectChannel,
  saveWhatsAppConnection,
  whatsAppConnectionInput,
  type WhatsAppConnectionInput,
} from '@fulcra/core';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
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

const signupInput = z.object({
  code: z.string().min(10).max(2000),
  phoneNumberId: z.string().regex(/^\d{5,25}$/),
  businessAccountId: z.string().regex(/^\d{5,25}$/),
});

/**
 * Finishes "Connect WhatsApp" (Embedded Signup): the popup gave a code and the chosen
 * number. We exchange the code for the seller's business token, register the number with
 * a PIN we keep (encrypted), subscribe our app, check the number and save the connection.
 */
export async function completeEmbeddedSignupAction(
  input: z.input<typeof signupInput>,
): Promise<ActionResult<{ id: string; displayName: string }>> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  if (context.membership.role !== 'owner')
    return { ok: false, message: 'Only the business owner can connect WhatsApp.' };
  const parsed = signupInput.safeParse(input);
  if (!parsed.success)
    return { ok: false, message: 'WhatsApp did not finish connecting. Please try again.' };
  const { code, phoneNumberId, businessAccountId } = parsed.data;
  let accessToken: string;
  try {
    accessToken = await exchangeEmbeddedSignupCode(code);
  } catch (error) {
    console.error('[whatsapp] code exchange failed', error);
    return {
      ok: false,
      message: 'Meta did not confirm the connection. Please try “Connect WhatsApp” again.',
    };
  }
  const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
  try {
    await registerWhatsAppNumber(phoneNumberId, accessToken, pin);
  } catch (error) {
    // Already registered numbers (or Meta's test number) can refuse; sending still works.
    console.warn('[whatsapp] number registration', error instanceof Error ? error.message : error);
  }
  await subscribeWhatsAppApp(businessAccountId, accessToken).catch((error: unknown) =>
    console.warn('[whatsapp] could not subscribe the app', error),
  );
  try {
    const number = await lookupWhatsAppNumber(phoneNumberId, accessToken);
    const displayName = [number.verifiedName, number.displayPhoneNumber]
      .filter(Boolean)
      .join(' · ');
    const saved = await saveWhatsAppConnection(context.actor, {
      phoneNumberId,
      businessAccountId,
      accessToken,
      pin,
      displayName,
    });
    revalidatePath('/dashboard/settings');
    return { ok: true, data: { id: saved.id, displayName } };
  } catch (error) {
    if (error instanceof WhatsAppApiError)
      return { ok: false, message: 'Meta did not accept the connection. Please try again.' };
    return toActionError(error);
  }
}
