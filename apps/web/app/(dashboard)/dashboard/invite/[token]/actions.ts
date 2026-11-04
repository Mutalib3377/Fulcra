'use server';

import { acceptInvite } from '@fulcra/core';
import { toActionError, type ActionResult } from '@/lib/action-result';
import { getCurrentUser, SESSION_ENDED, setActiveBusiness } from '@/lib/auth';

export async function acceptInviteAction(
  token: string,
): Promise<ActionResult<{ redirectTo: string }>> {
  const user = await getCurrentUser();
  if (!user) return SESSION_ENDED;
  let businessId: string;
  try {
    ({ businessId } = await acceptInvite({ token, userId: user.id, email: user.email }));
  } catch (error) {
    return toActionError(error);
  }
  await setActiveBusiness(businessId);
  return { ok: true, data: { redirectTo: '/' } };
}
