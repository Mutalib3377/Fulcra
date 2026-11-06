'use server';

import { updateCustomer, type UpdateCustomerInput } from '@fulcra/core';
import { revalidatePath } from 'next/cache';
import { toActionError, type ActionResult } from '@/lib/action-result';
import { getActionContext, SESSION_ENDED } from '@/lib/auth';

export async function updateCustomerAction(
  customerId: string,
  input: UpdateCustomerInput,
): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await updateCustomer(context.actor, customerId, input);
    revalidatePath(`/dashboard/customers/${customerId}`);
    revalidatePath('/dashboard/customers');
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}
