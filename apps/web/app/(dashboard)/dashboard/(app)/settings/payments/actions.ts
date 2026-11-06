'use server';

import { resolveBankAccount, savePayoutAccount, type PayoutAccountInput } from '@fulcra/core';
import { revalidatePath } from 'next/cache';
import { toActionError, type ActionResult } from '@/lib/action-result';
import { getActionContext, SESSION_ENDED } from '@/lib/auth';

export async function checkAccountAction(
  input: PayoutAccountInput,
): Promise<ActionResult<{ accountName: string }>> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    return { ok: true, data: await resolveBankAccount(context.actor, input) };
  } catch (error) {
    return toActionError(error);
  }
}

export async function savePayoutAction(input: PayoutAccountInput): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await savePayoutAccount(context.actor, input);
    revalidatePath('/dashboard/settings/payments');
    revalidatePath('/dashboard/settings');
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}
