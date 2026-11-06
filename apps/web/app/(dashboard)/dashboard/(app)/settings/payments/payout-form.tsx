'use client';

import { Button, Card, CardContent, FieldMessage, Input, Label, NativeSelect } from '@fulcra/ui';
import { CheckCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { checkAccountAction, savePayoutAction } from './actions';

export function PayoutForm({
  banks,
  hasAccount,
}: {
  banks: { name: string; code: string }[];
  hasAccount: boolean;
}) {
  const router = useRouter();
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setAccountName(null);
    setError(null);
    setSaved(false);
  };

  const check = () =>
    startTransition(async () => {
      reset();
      const result = await checkAccountAction({ bankCode, accountNumber });
      if (result.ok) setAccountName(result.data.accountName);
      else setError(result.message);
    });

  const save = () =>
    startTransition(async () => {
      setError(null);
      const result = await savePayoutAction({ bankCode, accountNumber });
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else setError(result.message);
    });

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-4 sm:pt-6">
        <p className="font-semibold">{hasAccount ? 'Change account' : 'Add your bank account'}</p>
        <div className="flex flex-col gap-2">
          <Label htmlFor="bank">Bank</Label>
          <NativeSelect
            id="bank"
            value={bankCode}
            onChange={(e) => {
              setBankCode(e.target.value);
              reset();
            }}
          >
            <option value="">Choose your bank</option>
            {banks.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="account">Account number</Label>
          <Input
            id="account"
            inputMode="numeric"
            maxLength={10}
            placeholder="10 digits"
            value={accountNumber}
            onChange={(e) => {
              setAccountNumber(e.target.value.replace(/\D/g, ''));
              reset();
            }}
          />
        </div>
        {accountName && (
          <p className="rounded-md bg-success-soft px-3 py-2 text-sm">
            Account name: <strong>{accountName}</strong>. Is this you?
          </p>
        )}
        {error && <FieldMessage error>{error}</FieldMessage>}
        {saved && (
          <p className="flex items-center gap-2 text-sm text-success" role="status">
            <CheckCircle2 className="size-4" aria-hidden /> Saved. You can now send payment links.
          </p>
        )}
        {accountName ? (
          <div className="flex gap-2">
            <Button type="button" loading={pending} onClick={save}>
              Yes, save this account
            </Button>
            <Button type="button" variant="ghost" onClick={reset}>
              No
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            loading={pending}
            disabled={!bankCode || accountNumber.length !== 10}
            onClick={check}
          >
            Check account
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
