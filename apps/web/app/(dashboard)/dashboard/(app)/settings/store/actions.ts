'use server';

import { setStoreChoice, type StoreChoiceInput } from '@fulcra/core';
import { revalidatePath } from 'next/cache';
import { toActionError, type ActionResult } from '@/lib/action-result';
import { getActionContext, SESSION_ENDED } from '@/lib/auth';

export async function setStoreChoiceAction(
  input: StoreChoiceInput,
): Promise<ActionResult<{ redirectTo: string }>> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await setStoreChoice(context.actor, input);
    revalidatePath('/dashboard/settings');
    // Sellers with a website bring their products in next; others add them by hand.
    return {
      ok: true,
      data: { redirectTo: input.choice === 'website' ? '/catalog/import' : '/catalog/new' },
    };
  } catch (error) {
    return toActionError(error);
  }
}
