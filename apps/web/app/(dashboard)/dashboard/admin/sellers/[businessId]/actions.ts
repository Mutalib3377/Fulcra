'use server';

import {
  adminExtendTrial,
  adminFor,
  adminGivePlan,
  adminSetFeature,
  adminSetLimit,
  adminSuspend,
  adminUnsuspend,
  type AdminActor,
} from '@fulcra/core';
import { revalidatePath } from 'next/cache';
import { toActionError, type ActionResult } from '@/lib/action-result';
import { getCurrentUser } from '@/lib/auth';
import { refreshStoreFor } from '@/lib/store';

/** Admin changes from the seller page. Core checks the admin list again and logs each change. */
async function run(
  businessId: string,
  change: (admin: AdminActor) => Promise<unknown>,
): Promise<ActionResult> {
  const admin = adminFor(await getCurrentUser());
  if (!admin) return { ok: false, message: 'Page not found.' };
  try {
    await change(admin);
    revalidatePath(`/dashboard/admin/sellers/${businessId}`);
    revalidatePath('/dashboard/admin');
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

export async function extendTrialAction(businessId: string, days: number, reason: string) {
  return run(businessId, (admin) => adminExtendTrial(admin, businessId, { days, reason }));
}

export async function givePlanAction(
  businessId: string,
  planCode: 'starter' | 'growth' | 'pro',
  months: number,
  reason: string,
) {
  return run(businessId, (admin) => adminGivePlan(admin, businessId, { planCode, months, reason }));
}

export async function setLimitAction(
  businessId: string,
  key: 'agent.conversations' | 'owner.messages',
  limit: number | null,
  reason: string,
) {
  return run(businessId, (admin) => adminSetLimit(admin, businessId, { key, limit, reason }));
}

export async function setFeatureAction(
  businessId: string,
  feature: string,
  enabled: boolean | null,
  reason: string,
) {
  return run(businessId, (admin) =>
    adminSetFeature(admin, businessId, { feature: feature as never, enabled, reason }),
  );
}

export async function suspendAction(businessId: string, suspend: boolean, reason: string) {
  return run(businessId, async (admin) => {
    const { subdomain } = suspend
      ? await adminSuspend(admin, businessId, { reason })
      : await adminUnsuspend(admin, businessId, { reason });
    refreshStoreFor(businessId, subdomain);
  });
}
