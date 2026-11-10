'use server';

import { saveOwnerAlertSettings, sendTestAlert, type OwnerAlertSettingsInput } from '@fulcra/core';
import { revalidatePath } from 'next/cache';
import { toActionError, type ActionResult } from '@/lib/action-result';
import { getActionContext, SESSION_ENDED } from '@/lib/auth';

export async function saveAlertSettingsAction(
  input: OwnerAlertSettingsInput,
): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await saveOwnerAlertSettings(context.actor, input);
    revalidatePath('/dashboard/settings/alerts');
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

export async function sendTestAlertAction(): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await sendTestAlert(context.actor);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}
