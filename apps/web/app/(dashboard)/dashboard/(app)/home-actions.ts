'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getActionContext } from '@/lib/auth';
import { setupHiddenCookie } from '@/lib/setup';

/** Hides the "Get set up" card on this phone or computer, for the current business. */
export async function hideSetupAction(): Promise<void> {
  const context = await getActionContext();
  if (!context) return;
  const cookieStore = await cookies();
  cookieStore.set(setupHiddenCookie(context.actor.businessId), '1', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath('/dashboard');
}

/** Shows the "Get set up" card again. */
export async function showSetupAction(): Promise<void> {
  const context = await getActionContext();
  if (!context) return;
  const cookieStore = await cookies();
  // Overwritten rather than deleted: the page drawn right after the action reads the new value.
  cookieStore.set(setupHiddenCookie(context.actor.businessId), '0', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath('/dashboard');
}
