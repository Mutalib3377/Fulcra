import 'server-only';
import { adminFor, type AdminActor } from '@fulcra/core';
import { notFound } from 'next/navigation';
import { getCurrentUser } from './auth';

/**
 * The signed-in Fulcra admin (an email in ADMIN_EMAILS). Everyone else, signed in or not,
 * gets the normal "not found" page: the admin area never says it exists.
 */
export async function requireAdminPage(): Promise<AdminActor> {
  const admin = adminFor(await getCurrentUser());
  if (!admin) notFound();
  return admin;
}

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});
const usdSmall = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 4,
});

/** Dollar costs: cents for totals, more digits for tiny per-seller amounts. */
export function formatUsd(value: number): string {
  return value > 0 && value < 0.1 ? usdSmall.format(value) : usd.format(value);
}
