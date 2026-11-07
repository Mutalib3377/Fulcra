'use server';

import {
  cancelOrder,
  createOrder,
  createPaymentLink,
  markOrderPaid,
  prepareAccountDetails,
  updateOrderStatus,
  type CreateOrderInput,
  type ManualPaymentMethod,
} from '@fulcra/core';
import { revalidatePath } from 'next/cache';
import { toActionError, type ActionResult } from '@/lib/action-result';
import { getActionContext, SESSION_ENDED } from '@/lib/auth';
import { refreshStore } from '@/lib/store';

function refresh(orderId?: string) {
  revalidatePath('/dashboard/orders');
  if (orderId) revalidatePath(`/dashboard/orders/${orderId}`);
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/catalog');
}

export async function createOrderAction(
  input: CreateOrderInput,
): Promise<ActionResult<{ redirectTo: string }>> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    const { order } = await createOrder(context.actor, input);
    // Stock went down: keep "Only N left" / "Sold out" on the store up to date.
    await refreshStore(context.actor);
    refresh();
    return { ok: true, data: { redirectTo: `/orders/${order.id}` } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function moveOrderAction(
  orderId: string,
  to: 'awaiting_payment' | 'dispatched' | 'delivered',
): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await updateOrderStatus(context.actor, orderId, to);
    refresh(orderId);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

export async function markPaidAction(
  orderId: string,
  method: ManualPaymentMethod,
  note: string,
): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await markOrderPaid(context.actor, orderId, { method, note });
    refresh(orderId);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

export async function cancelOrderAction(orderId: string, reason: string): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await cancelOrder(context.actor, orderId, { reason });
    await refreshStore(context.actor);
    refresh(orderId);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

export async function createPaymentLinkAction(
  orderId: string,
): Promise<ActionResult<{ url: string; reused: boolean }>> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    const { url, reused } = await createPaymentLink(context.actor, orderId);
    refresh(orderId);
    return { ok: true, data: { url, reused } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function prepareAccountDetailsAction(
  orderId: string,
): Promise<
  ActionResult<{ message: string; accountNumber: string; bankName: string; accountName: string }>
> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    const { account, message } = await prepareAccountDetails(context.actor, orderId);
    refresh(orderId);
    return { ok: true, data: { message, ...account } };
  } catch (error) {
    return toActionError(error);
  }
}
