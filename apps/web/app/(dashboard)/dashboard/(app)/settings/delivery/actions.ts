'use server';

import {
  archiveDeliveryZone,
  createDeliveryZone,
  updateDeliveryZone,
  type DeliveryZoneInput,
} from '@fulcra/core';
import { revalidatePath } from 'next/cache';
import { toActionError, type ActionResult } from '@/lib/action-result';
import { getActionContext, SESSION_ENDED } from '@/lib/auth';

const PATH = '/dashboard/settings/delivery';

export async function saveZoneAction(
  zoneId: string | null,
  input: DeliveryZoneInput,
): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    if (zoneId) await updateDeliveryZone(context.actor, zoneId, input);
    else await createDeliveryZone(context.actor, input);
    revalidatePath(PATH);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

export async function removeZoneAction(zoneId: string): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await archiveDeliveryZone(context.actor, zoneId);
    revalidatePath(PATH);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}
