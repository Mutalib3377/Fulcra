'use client';

import { Button, FieldMessage, Input, Label, cn } from '@fulcra/ui';
import { Globe, Store } from 'lucide-react';
import { useState, useTransition } from 'react';
import { goTo } from '@/lib/navigation';
import { setStoreChoiceAction } from './actions';

type Choice = 'store' | 'website';

const OPTIONS: { value: Choice; title: string; description: string; icon: typeof Store }[] = [
  {
    value: 'store',
    title: 'Use our store',
    description:
      'We make a simple store for you. Customers see your products and order on WhatsApp.',
    icon: Store,
  },
  {
    value: 'website',
    title: 'Connect my website',
    description:
      'You already sell on your own website (Shopify, WooCommerce or another). Bring your products in from it.',
    icon: Globe,
  },
];

export function StoreChoiceForm({
  initialChoice,
  initialWebsite,
  canEdit,
}: {
  initialChoice: Choice;
  initialWebsite: string;
  canEdit: boolean;
}) {
  const [choice, setChoice] = useState<Choice>(initialChoice);
  const [website, setWebsite] = useState(initialWebsite);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await setStoreChoiceAction(
        choice === 'website' ? { choice, websiteUrl: website } : { choice },
      );
      if (result.ok) goTo(result.data.redirectTo);
      else setError(result.message);
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-3" disabled={!canEdit}>
        <legend className="sr-only">How will customers shop with you?</legend>
        {OPTIONS.map(({ value, title, description, icon: Icon }) => (
          <label
            key={value}
            className={cn(
              'flex cursor-pointer gap-3 rounded-lg border bg-card p-4 transition-colors',
              choice === value ? 'border-primary ring-1 ring-primary' : 'hover:bg-muted/50',
            )}
          >
            <input
              type="radio"
              name="choice"
              value={value}
              checked={choice === value}
              onChange={() => setChoice(value)}
              className="mt-1 size-4 accent-primary"
            />
            <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <span className="flex flex-col gap-1">
              <span className="font-semibold">{title}</span>
              <span className="text-sm text-muted-foreground">{description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {choice === 'website' && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="websiteUrl">Your website address</Label>
          <Input
            id="websiteUrl"
            inputMode="url"
            autoComplete="url"
            placeholder="mystore.com"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            disabled={!canEdit}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'websiteUrl-error' : undefined}
          />
          {error && <FieldMessage id="websiteUrl-error">{error}</FieldMessage>}
        </div>
      )}
      {choice === 'store' && error && <FieldMessage>{error}</FieldMessage>}

      {canEdit ? (
        <Button type="submit" loading={pending} className="self-start">
          Continue
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">Only the owner can change this.</p>
      )}
    </form>
  );
}
