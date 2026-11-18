import type { PaymentClaimFlag, PaymentClaimStatus } from '@fulcra/db/schema';

/**
 * Fake alert protection (F1, docs/decisions/0024): browser-safe rules. A customer's "I've
 * paid" or transfer screenshot is checked against the money that actually arrived.
 */

/** How long a claim waits for the money before the owner is told nothing arrived. */
export const CLAIM_WAIT_MINUTES = 20;

/** A receipt dated this long before the order was placed is flagged. */
export const CLAIM_BEFORE_ORDER_MINUTES = 30;

/** A receipt time this far ahead of now is flagged as "in the future". */
export const CLAIM_FUTURE_MINUTES = 15;

export const CLAIM_STATUS_LABELS: Record<PaymentClaimStatus, string> = {
  waiting: 'Checking',
  confirmed: 'Money arrived',
  not_received: 'Nothing arrived',
  dismissed: 'Closed',
};

/** Plain words for the owner. */
export const CLAIM_FLAG_LABELS: Record<PaymentClaimFlag, string> = {
  amount_mismatch: "The amount on the screenshot isn't what the order costs",
  dated_before_order: 'The screenshot is dated before the order was placed',
  future_date: 'The screenshot shows a time in the future',
  reused_reference: 'The same receipt was sent before for another order',
};

/**
 * A receipt reference as compared between claims: letters and digits only, upper case.
 * Short ones (under 6 characters) are too likely to repeat by chance and are ignored.
 */
export function normalizeReference(reference: string | null | undefined): string | null {
  const clean = (reference ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return clean.length >= 6 ? clean.slice(0, 80) : null;
}

/**
 * The time on a Nigerian bank receipt ("YYYY-MM-DD" or "YYYY-MM-DDTHH:MM", Lagos time, as
 * the photo reader writes it). `hasTime` is false when only the date was readable.
 */
export function parseReceiptTime(value: string | null | undefined): {
  at: Date;
  hasTime: boolean;
} | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec((value ?? '').trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  const hasTime = h !== undefined && mi !== undefined;
  // Nigeria is UTC+1 all year (no daylight saving).
  const at = new Date(`${y}-${mo}-${d}T${hasTime ? `${h}:${mi}` : '12:00'}:00+01:00`);
  if (Number.isNaN(at.getTime())) return null;
  // Reject impossible dates that Date silently rolls over (e.g. 2026-02-31).
  const lagos = new Date(at.getTime() + 3_600_000).toISOString().slice(0, 10);
  if (lagos !== `${y}-${mo}-${d}`) return null;
  return { at, hasTime };
}

/** The local (Lagos) calendar day of a time, "YYYY-MM-DD". */
export function lagosDay(at: Date): string {
  return new Date(at.getTime() + 3_600_000).toISOString().slice(0, 10);
}

/**
 * Red flags on a claim, worked out once when it is made. They are hints for the owner;
 * whether the money arrived is what decides.
 */
export function claimFlags(input: {
  claimedAmount: number | null;
  receipt: { at: Date; hasTime: boolean } | null;
  order: { total: number; amountPaid: number; createdAt: Date } | null;
  referenceUsedElsewhere: boolean;
  now: Date;
}): PaymentClaimFlag[] {
  const flags: PaymentClaimFlag[] = [];
  const { order, receipt, now } = input;
  if (order && input.claimedAmount !== null) {
    const owed = order.total - order.amountPaid;
    if (input.claimedAmount !== owed && input.claimedAmount !== order.total)
      flags.push('amount_mismatch');
  }
  if (order && receipt) {
    const before = receipt.hasTime
      ? receipt.at.getTime() < order.createdAt.getTime() - CLAIM_BEFORE_ORDER_MINUTES * 60_000
      : lagosDay(receipt.at) < lagosDay(order.createdAt);
    if (before) flags.push('dated_before_order');
  }
  if (receipt) {
    const future = receipt.hasTime
      ? receipt.at.getTime() > now.getTime() + CLAIM_FUTURE_MINUTES * 60_000
      : lagosDay(receipt.at) > lagosDay(now);
    if (future) flags.push('future_date');
  }
  if (input.referenceUsedElsewhere) flags.push('reused_reference');
  return flags;
}
