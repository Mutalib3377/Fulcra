'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  BUSINESS_CATEGORIES,
  normalizePhoneNumber,
  suggestSubdomain,
  validateSubdomain,
  subdomainMessages,
  type BusinessCategory,
  type SubdomainProblem,
} from '@fulcra/core/rules';
import { Button, Card, CardContent, FieldMessage, Input, Label, cn } from '@fulcra/ui';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { goTo } from '@/lib/navigation';
import { createBusinessAction } from './actions';

const categoryLabels: Record<BusinessCategory, string> = {
  fashion: 'Fashion & clothing',
  beauty: 'Beauty & skincare',
  food: 'Food & drinks',
  gadgets: 'Phones & gadgets',
  other: 'Something else',
};

const formSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Enter your business name.')
    .max(80, 'Keep the name under 80 characters.'),
  category: z.enum(BUSINESS_CATEGORIES, { message: 'Choose what you sell.' }),
  whatsappNumber: z
    .string()
    .trim()
    .refine(
      (v) => normalizePhoneNumber(v) !== null,
      'Enter a valid WhatsApp number, for example 0801 234 5678.',
    ),
  subdomain: z
    .string()
    .trim()
    .toLowerCase()
    .superRefine((v, ctx) => {
      const problem = validateSubdomain(v);
      if (problem) ctx.addIssue({ code: 'custom', message: subdomainMessages[problem] });
    }),
});

type FormValues = z.input<typeof formSchema>;

type Availability =
  | { available: true; subdomain: string }
  | { available: false; subdomain: string; problem: SubdomainProblem; message: string };

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function OnboardingForm({ storeDomain }: { storeDomain: string }) {
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [subdomainEdited, setSubdomainEdited] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', category: undefined, whatsappNumber: '', subdomain: '' },
    mode: 'onTouched',
  });
  const { errors } = form.formState;
  const name = useWatch({ control: form.control, name: 'name' });
  const category = useWatch({ control: form.control, name: 'category' });
  const subdomain = (useWatch({ control: form.control, name: 'subdomain' }) ?? '')
    .trim()
    .toLowerCase();

  // Suggest a store address from the business name until the user edits it themselves.
  useEffect(() => {
    if (!subdomainEdited) form.setValue('subdomain', suggestSubdomain(name ?? ''));
  }, [name, subdomainEdited, form]);

  const checkValue = useDebounced(subdomain, 400);
  const formatProblem = checkValue ? validateSubdomain(checkValue) : null;
  const availability = useQuery({
    queryKey: ['subdomain-check', checkValue],
    enabled: checkValue.length > 0 && formatProblem === null,
    queryFn: async ({ signal }): Promise<Availability> => {
      const res = await fetch(`/api/subdomain-check?name=${encodeURIComponent(checkValue)}`, {
        signal,
      });
      if (!res.ok) throw new Error('check failed');
      return res.json() as Promise<Availability>;
    },
  });
  const settled = checkValue === subdomain;
  const taken =
    settled && availability.data && !availability.data.available ? availability.data.message : null;

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      setFormError(null);
      const result = await createBusinessAction(values);
      if (result.ok) return goTo(result.data.redirectTo);
      if (result.field && result.field in values) {
        form.setError(result.field as keyof FormValues, { message: result.message });
      } else {
        setFormError(result.message);
      }
    }),
  );

  return (
    <Card>
      <CardContent className="pt-4 sm:pt-6">
        <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Business name</Label>
            <Input
              id="name"
              autoComplete="organization"
              placeholder="e.g. Mama Ada's Kitchen"
              aria-invalid={!!errors.name}
              {...form.register('name')}
            />
            {errors.name && <FieldMessage error>{errors.name.message}</FieldMessage>}
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">What do you sell?</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {BUSINESS_CATEGORIES.map((value) => (
                <label
                  key={value}
                  className={cn(
                    'flex h-11 cursor-pointer items-center gap-3 rounded-md border px-3 text-base',
                    category === value
                      ? 'border-primary bg-secondary font-medium'
                      : 'border-input bg-card',
                  )}
                >
                  <input
                    type="radio"
                    value={value}
                    className="accent-[var(--color-primary)]"
                    {...form.register('category')}
                  />
                  {categoryLabels[value]}
                </label>
              ))}
            </div>
            {errors.category && <FieldMessage error>{errors.category.message}</FieldMessage>}
          </fieldset>

          <div className="flex flex-col gap-2">
            <Label htmlFor="whatsappNumber">WhatsApp number for your business</Label>
            <Input
              id="whatsappNumber"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="0801 234 5678"
              aria-invalid={!!errors.whatsappNumber}
              {...form.register('whatsappNumber')}
            />
            {errors.whatsappNumber ? (
              <FieldMessage error>{errors.whatsappNumber.message}</FieldMessage>
            ) : (
              <FieldMessage>Customers will message you here.</FieldMessage>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="subdomain">Your store address</Label>
            <div className="flex items-stretch overflow-hidden rounded-md border border-input bg-card focus-within:outline-2 focus-within:outline-ring">
              <input
                id="subdomain"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-base outline-none"
                aria-invalid={!!(errors.subdomain || taken)}
                {...form.register('subdomain', { onChange: () => setSubdomainEdited(true) })}
              />
              <span className="flex items-center bg-muted px-3 text-sm text-muted-foreground">
                .{storeDomain}
              </span>
            </div>
            <SubdomainStatus
              formError={
                errors.subdomain?.message ??
                (subdomain && formatProblem && settled
                  ? subdomainMessages[formatProblem]
                  : undefined)
              }
              checking={!settled || availability.isFetching}
              taken={taken}
              available={settled && availability.data?.available === true}
              failed={settled && availability.isError}
              empty={!subdomain}
            />
          </div>

          {formError && (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
              {formError}
            </p>
          )}

          <Button type="submit" size="lg" fullWidth loading={pending} disabled={!!taken}>
            Create my business
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SubdomainStatus(props: {
  formError: string | undefined;
  checking: boolean;
  taken: string | null;
  available: boolean;
  failed: boolean;
  empty: boolean;
}) {
  if (props.empty) return <FieldMessage>Letters, numbers and dashes only.</FieldMessage>;
  if (props.formError) return <FieldMessage error>{props.formError}</FieldMessage>;
  if (props.checking) {
    return (
      <FieldMessage className="flex items-center gap-1">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Checking…
      </FieldMessage>
    );
  }
  if (props.taken) {
    return (
      <FieldMessage error className="flex items-center gap-1">
        <XCircle className="size-4" aria-hidden /> {props.taken}
      </FieldMessage>
    );
  }
  if (props.available) {
    return (
      <p className="flex items-center gap-1 text-sm text-success">
        <CheckCircle2 className="size-4" aria-hidden /> This address is free.
      </p>
    );
  }
  if (props.failed)
    return <FieldMessage>We could not check this right now. You can still continue.</FieldMessage>;
  return null;
}
