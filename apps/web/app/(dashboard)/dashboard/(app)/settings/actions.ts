'use server';

import { createInvite, listMyBusinesses, revokeInvite, type CreateInviteInput } from '@fulcra/core';
import { revalidatePath } from 'next/cache';
import { toActionError, type ActionResult } from '@/lib/action-result';
import { getActionContext, getCurrentUser, SESSION_ENDED, setActiveBusiness } from '@/lib/auth';
import { dashboardUrl } from '@/lib/urls';

export async function switchBusinessAction(businessId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const memberships = await listMyBusinesses(user.id);
  if (memberships.some((m) => m.businessId === businessId)) {
    await setActiveBusiness(businessId);
  }
}

export async function createInviteAction(
  input: CreateInviteInput,
): Promise<ActionResult<{ link: string; email: string }>> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  const { actor } = context;
  try {
    const { invite, token } = await createInvite(actor, input);
    revalidatePath('/dashboard/settings/team');
    return { ok: true, data: { link: dashboardUrl(`/invite/${token}`), email: invite.email } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function revokeInviteAction(inviteId: string): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  const { actor } = context;
  try {
    await revokeInvite(actor, inviteId);
    revalidatePath('/dashboard/settings/team');
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}
