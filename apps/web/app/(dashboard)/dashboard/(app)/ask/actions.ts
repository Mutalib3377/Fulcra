'use server';

import { sendOwnerDashboardMessage } from '@fulcra/core';
import type { StoredImage } from '@fulcra/core/rules';
import { toActionError, type ActionResult } from '@/lib/action-result';
import { getActionContext, SESSION_ENDED } from '@/lib/auth';

export async function sendOwnerMessageAction(input: {
  text: string;
  image: StoredImage | null;
}): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await sendOwnerDashboardMessage(context.actor, input);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}
