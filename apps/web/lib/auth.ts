import 'server-only';
import { listMyBusinesses, type ActorContext, type Membership } from '@fulcra/core';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createSupabaseServerClient } from './supabase/server';

export type CurrentUser = { id: string; email: string };

const ACTIVE_BUSINESS_COOKIE = 'fulcra_business';

/** The signed-in user (verified with Supabase Auth), or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email) return null;
  return { id: data.user.id, email: data.user.email.toLowerCase() };
});

/** The signed-in user, or a redirect to the sign-in page. */
export async function requireUser(next?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in');
  return user;
}

export type DashboardContext = {
  user: CurrentUser;
  membership: Membership;
  memberships: Membership[];
  actor: ActorContext;
};

/**
 * Who is signed in and which business they are working in. Sends users with no
 * business to onboarding. The chosen business is remembered in a cookie, but is always
 * checked against the user's real memberships.
 */
export const getDashboardContext = cache(async (): Promise<DashboardContext> => {
  const user = await requireUser();
  const context = await resolveContext(user);
  if (!context) redirect('/onboarding');
  return context;
});

/**
 * Same as `getDashboardContext`, for Server Actions: returns null instead of redirecting
 * (a redirect inside a Server Action would skip proxy.ts; see lib/navigation.ts).
 */
export async function getActionContext(): Promise<DashboardContext | null> {
  const user = await getCurrentUser();
  return user ? resolveContext(user) : null;
}

/** Message for Server Actions when the session has ended. */
export const SESSION_ENDED = {
  ok: false,
  message: 'Your session has ended. Please refresh the page and sign in again.',
} as const;

async function resolveContext(user: CurrentUser): Promise<DashboardContext | null> {
  const memberships = await listMyBusinesses(user.id);
  if (memberships.length === 0) return null;

  const cookieStore = await cookies();
  const chosen = cookieStore.get(ACTIVE_BUSINESS_COOKIE)?.value;
  const membership = memberships.find((m) => m.businessId === chosen) ?? memberships[0]!;

  return {
    user,
    membership,
    memberships,
    actor: { businessId: membership.businessId, userId: user.id },
  };
}

/** Remembers which business the user is working in (only from Server Actions). */
export async function setActiveBusiness(businessId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_BUSINESS_COOKIE, businessId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
}
