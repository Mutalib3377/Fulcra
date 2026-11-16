'use server';

import { cancelPlan, choosePlan, type ChoosePlanResult } from '@fulcra/core';
import { revalidatePath } from 'next/cache';
import { toActionError, type ActionResult } from '@/lib/action-result';
import { getActionContext, SESSION_ENDED } from '@/lib/auth';

export async function choosePlanAction(
  plan: 'starter' | 'growth' | 'pro',
  interval: 'monthly' | 'annual',
): Promise<ActionResult<ChoosePlanResult>> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    const result = await choosePlan(context.actor, { plan, interval });
    revalidatePath('/dashboard/settings/billing');
    return { ok: true, data: result };
  } catch (error) {
    return toActionError(error);
  }
}

export async function cancelPlanAction(): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await cancelPlan(context.actor);
    revalidatePath('/dashboard/settings/billing');
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}
