'use server';

import { disconnectChannel } from '@fulcra/core';
import { revalidatePath } from 'next/cache';
import { toActionError, type ActionResult } from '@/lib/action-result';
import { getActionContext, SESSION_ENDED } from '@/lib/auth';

export async function disconnectInstagramAction(connectionId: string): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await disconnectChannel(context.actor, connectionId);
    revalidatePath('/dashboard/settings/instagram');
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}
