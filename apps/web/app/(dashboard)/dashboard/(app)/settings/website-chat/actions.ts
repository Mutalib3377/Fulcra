'use server';

import { setWebChatEnabled } from '@fulcra/core';
import { revalidatePath } from 'next/cache';
import { toActionError, type ActionResult } from '@/lib/action-result';
import { getActionContext, SESSION_ENDED } from '@/lib/auth';
import { refreshStore } from '@/lib/store';

export async function setWebChatAction(enabled: boolean): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await setWebChatEnabled(context.actor, enabled);
    // The store shows the chat bubble when it is on.
    await refreshStore(context.actor);
    revalidatePath('/dashboard/settings/website-chat');
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}
