import { formatNaira } from '@fulcra/config';
import type { PaymentClaimListItem } from '@fulcra/core';
import { CLAIM_FLAG_LABELS, CLAIM_STATUS_LABELS, CLAIM_WAIT_MINUTES } from '@fulcra/core/rules';
import { Badge, Card, EmptyState } from '@fulcra/ui';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { imageUrls } from '@/lib/images';
import { formatDateTime } from '@/lib/orders';
import { ClaimActions } from './claim-actions';

const tone = {
  waiting: 'neutral',
  not_received: 'danger',
  confirmed: 'success',
  dismissed: 'neutral',
} as const;

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right break-words">{value}</dd>
    </div>
  );
}

/**
 * Payment checks (F1): what a customer claimed (their screenshot, or "I've paid") next to
 * the money that actually arrived through Fulcra.
 */
export function ClaimsList({
  claims,
  show,
}: {
  claims: PaymentClaimListItem[];
  show: 'open' | 'recent';
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        When a customer sends a transfer screenshot or says they&apos;ve paid, Fulcra checks it
        against the money that actually arrives. Screenshots can be faked; the money can&apos;t.
        Don&apos;t send goods until a payment shows as received.
      </p>
      {claims.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck aria-hidden />}
          title={show === 'open' ? 'No payments to check' : 'No payment checks this week'}
          description="When a customer says they've paid, it shows here until the money arrives."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {claims.map((c) => {
            const owed = c.orderTotal !== null ? c.orderTotal - (c.orderAmountPaid ?? 0) : null;
            const received = c.receivedAmount ?? 0;
            return (
              <li key={c.id}>
                <Card className="flex flex-col gap-3 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{c.customerName || 'A customer'}</p>
                      <p className="text-sm text-muted-foreground">
                        {c.source === 'screenshot' ? 'Sent a payment screenshot' : 'Said they paid'}{' '}
                        · {formatDateTime(c.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone={tone[c.status]}>{CLAIM_STATUS_LABELS[c.status]}</Badge>
                      {c.orderId && c.orderNumber && (
                        <Link href={`/orders/${c.orderId}`} className="text-sm text-primary">
                          #{c.orderNumber}
                        </Link>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-3">
                    {c.image && (
                      <a
                        href={imageUrls(c.image).lg}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0"
                        aria-label="Open the screenshot"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- sizes are pre-made */}
                        <img
                          src={imageUrls(c.image).sm}
                          alt="The customer's payment screenshot"
                          className="h-24 w-16 rounded-md border object-cover"
                          loading="lazy"
                        />
                      </a>
                    )}
                    <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
                      <dl className="flex flex-col gap-1">
                        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                          They say
                        </p>
                        {c.source === 'screenshot' ? (
                          <Row
                            label="Amount"
                            value={
                              c.claimedAmount !== null
                                ? formatNaira(c.claimedAmount)
                                : 'Not readable'
                            }
                          />
                        ) : (
                          <Row label="Screenshot" value="None sent" />
                        )}
                        <Row label="Bank" value={c.bank} />
                        <Row label="From" value={c.senderName} />
                        <Row
                          label="Time on receipt"
                          value={c.claimedPaidAt ? formatDateTime(c.claimedPaidAt) : null}
                        />
                        <Row label="Reference" value={c.reference} />
                      </dl>
                      <dl className="flex flex-col gap-1">
                        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                          Actually arrived
                        </p>
                        <Row
                          label="Received"
                          value={
                            c.status === 'confirmed'
                              ? formatNaira(c.receivedAmount ?? c.claimedAmount ?? 0)
                              : received
                                ? `${formatNaira(received)} (part)`
                                : '₦0 so far'
                          }
                        />
                        {owed !== null && c.status !== 'confirmed' && (
                          <Row label="Order still needs" value={formatNaira(owed)} />
                        )}
                      </dl>
                    </div>
                  </div>

                  {c.flags.length > 0 && (
                    <ul className="flex flex-col gap-1 rounded-md bg-warning-soft p-2 text-sm text-warning">
                      {c.flags.map((f) => (
                        <li key={f} className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                          {CLAIM_FLAG_LABELS[f]}
                        </li>
                      ))}
                    </ul>
                  )}

                  {c.status === 'not_received' && (
                    <p className="text-sm">
                      Nothing arrived through Fulcra in {CLAIM_WAIT_MINUTES} minutes.{' '}
                      <strong>Don&apos;t send the goods yet.</strong> If they paid into your own
                      account, check your bank app; if the money is there, mark the order paid.
                    </p>
                  )}
                  {c.status === 'waiting' && (
                    <p className="text-sm text-muted-foreground">
                      Checking. Transfers usually land within minutes; you&apos;ll be told if
                      nothing arrives.
                    </p>
                  )}

                  {c.conversationId && (
                    <Link href={`/inbox/${c.conversationId}`} className="text-sm text-primary">
                      Open the chat
                    </Link>
                  )}
                  {(c.status === 'waiting' || c.status === 'not_received') && (
                    <ClaimActions claimId={c.id} />
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <Link
        href={show === 'open' ? '/payments?show=checks&range=recent' : '/payments?show=checks'}
        className="text-sm text-primary"
      >
        {show === 'open' ? 'Show all checks from the last 7 days' : 'Show only open checks'}
      </Link>
    </div>
  );
}
