import { getPayoutSettings, isCoreError, listBanks, type PaystackBank } from '@fulcra/core';
import { Card, CardContent, ErrorState } from '@fulcra/ui';
import { Landmark } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDashboardContext } from '@/lib/auth';
import { PayoutForm } from './payout-form';

export const metadata: Metadata = { title: 'Get paid' };

export default async function PaymentsSettingsPage() {
  const { actor, membership } = await getDashboardContext();
  const settings = await getPayoutSettings(actor);
  let banks: PaystackBank[] = [];
  let banksError: string | null = null;
  try {
    banks = await listBanks();
  } catch (error) {
    banksError = isCoreError(error) ? error.message : 'Could not load the list of banks.';
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <Link href="/settings" className="text-sm text-primary">
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold">Get paid</h1>
        <p className="text-muted-foreground">
          Where money from online payments goes. Paystack sends it straight to this account; Fulcra
          never holds your money. Paystack&apos;s fee is taken from each payment.
        </p>
      </div>

      {settings.configured && (
        <Card>
          <CardContent className="flex items-center gap-3 pt-4 sm:pt-6">
            <Landmark className="size-6 text-primary" aria-hidden />
            <div>
              <p className="font-medium">{settings.accountName}</p>
              <p className="text-sm text-muted-foreground">
                {settings.bankName} · ••••{settings.accountLast4}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {membership.role !== 'owner' ? (
        <p className="rounded-md bg-info-soft px-3 py-2 text-sm text-info">
          Only the business owner can change this.
        </p>
      ) : banksError ? (
        <ErrorState description={banksError} />
      ) : (
        <PayoutForm banks={banks} hasAccount={settings.configured} />
      )}
    </div>
  );
}
