'use server';

import { createBusiness, type CreateBusinessInput } from '@fulcra/core';
import { toActionError, type ActionResult } from '@/lib/action-result';
import { getCurrentUser, SESSION_ENDED, setActiveBusiness } from '@/lib/auth';

export async function createBusinessAction(
  input: CreateBusinessInput,
): Promise<ActionResult<{ redirectTo: string }>> {
  const user = await getCurrentUser();
  if (!user) return SESSION_ENDED;
  let businessId: string;
  try {
    const business = await createBusiness({ userId: user.id, email: user.email }, input);
    businessId = business.id;
  } catch (error) {
    return toActionError(error);
  }
  await setActiveBusiness(businessId);
  // Next: "Use our store" or "Connect my website".
  return { ok: true, data: { redirectTo: '/settings/store?welcome=1' } };
}
