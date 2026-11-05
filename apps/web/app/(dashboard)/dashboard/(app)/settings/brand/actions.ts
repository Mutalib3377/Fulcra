'use server';

import { saveBrandKit, type BrandKitInput } from '@fulcra/core';
import { revalidatePath } from 'next/cache';
import { toActionError, type ActionResult } from '@/lib/action-result';
import { getActionContext, SESSION_ENDED } from '@/lib/auth';

export async function saveBrandKitAction(input: BrandKitInput): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await saveBrandKit(context.actor, input);
    revalidatePath('/dashboard/settings/brand');
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}
