import { CoreError } from '../shared/errors';

/**
 * Fulcra's own staff (the admin area, AD1, docs/decisions/0027). Admins are the email
 * addresses in ADMIN_EMAILS (comma-separated), checked on every admin service call. Anyone
 * else gets "not found", so the admin area does not reveal that it exists.
 */
export type AdminActor = { userId: string; email: string; admin: true };

export function adminEmails(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes('@')),
  );
}

/** The admin actor for a signed-in user, or null when they are not on the list. */
export function adminFor(user: { id: string; email: string } | null): AdminActor | null {
  if (!user) return null;
  const email = user.email.trim().toLowerCase();
  return adminEmails().has(email) ? { userId: user.id, email, admin: true } : null;
}

/** Every admin service starts here: the list is read again, so removing an email takes effect at once. */
export function requireAdmin(actor: AdminActor | null | undefined): AdminActor {
  if (!actor?.admin || !adminEmails().has(actor.email.toLowerCase())) {
    throw new CoreError('not_found', 'Page not found.');
  }
  return actor;
}

/** Naira per US dollar for showing AI and WhatsApp costs (recorded in dollars). */
export function usdToNairaRate(env: NodeJS.ProcessEnv = process.env): number {
  const rate = Number(env.ADMIN_USD_NGN_RATE);
  return Number.isFinite(rate) && rate > 0 ? rate : 1600;
}
