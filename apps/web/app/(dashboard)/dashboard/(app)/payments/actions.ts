'use server';

import { assignPayment, dismissPayment } from '@fulcra/core';
import { revalidatePath } from 'next/cache';
import { toActionError, type ActionResult } from '@/lib/action-result';
import { getActionContext, SESSION_ENDED } from '@/lib/auth';

function refresh() {
  revalidatePath('/dashboard/payments');
  revalidatePath('/dashboard/orders');
  revalidatePath('/dashboard');
}

export async function assignPaymentAction(
  paymentId: string,
  orderId: string,
): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await assignPayment(context.actor, paymentId, orderId);
    refresh();
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

export async function dismissPaymentAction(paymentId: string, note: string): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await dismissPayment(context.actor, paymentId, note);
    refresh();
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}
