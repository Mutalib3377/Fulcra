'use server';

import { saveAgentSettings, type AgentSettingsInput } from '@fulcra/core';
import { revalidatePath } from 'next/cache';
import { toActionError, type ActionResult } from '@/lib/action-result';
import { getActionContext, SESSION_ENDED } from '@/lib/auth';

export async function saveAgentSettingsAction(input: AgentSettingsInput): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await saveAgentSettings(context.actor, input);
    revalidatePath('/dashboard/settings');
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}
