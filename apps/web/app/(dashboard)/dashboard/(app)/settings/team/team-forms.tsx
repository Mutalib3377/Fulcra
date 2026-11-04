'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button, FieldMessage, Input, Label, cn } from '@fulcra/ui';
import { Check, Copy, MessageCircle } from 'lucide-react';
import { useState, useTransition } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { createInviteAction, revokeInviteAction } from '../actions';

const inviteSchema = z.object({
  email: z.email('Enter a valid email address.').trim(),
  role: z.enum(['staff', 'rider']),
});
type InviteValues = z.infer<typeof inviteSchema>;

const roleOptions = [
  { value: 'staff', label: 'Staff', hint: 'Helps with chats, orders and products' },
  { value: 'rider', label: 'Rider', hint: 'Delivers orders' },
] as const;

export function InviteForm() {
  const [pending, startTransition] = useTransition();
  const [created, setCreated] = useState<{ link: string; email: string } | null>(null);
  const form = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '', role: 'staff' },
  });
  const role = useWatch({ control: form.control, name: 'role' });
  const error = form.formState.errors.email?.message;

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await createInviteAction(values);
      if (result.ok) {
        setCreated(result.data);
        form.reset({ email: '', role: values.role });
      } else {
        form.setError('email', { message: result.message });
      }
    }),
  );

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="invite-email">Their email</Label>
          <Input
            id="invite-email"
            type="email"
            inputMode="email"
            placeholder="staff@example.com"
            aria-invalid={!!error}
            {...form.register('email')}
          />
          {error && <FieldMessage error>{error}</FieldMessage>}
        </div>
        <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-medium">Role</legend>
          {roleOptions.map((option) => (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2',
                role === option.value ? 'border-primary bg-secondary' : 'border-input bg-card',
              )}
            >
              <input
                type="radio"
                value={option.value}
                className="mt-1 accent-[var(--color-primary)]"
                {...form.register('role')}
              />
              <span>
                <span className="block font-medium">{option.label}</span>
                <span className="block text-sm text-muted-foreground">{option.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <Button type="submit" loading={pending}>
          Create invite link
        </Button>
      </form>

      {created && <InviteLink {...created} />}
    </div>
  );
}

function InviteLink({ link, email }: { link: string; email: string }) {
  const [copied, setCopied] = useState(false);
  const message = `You have been invited to join our team on Fulcra. Open this link and sign in with ${email}: ${link}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-success bg-success-soft p-3">
      <p className="text-sm font-medium">Invite link for {email} (valid for 7 days):</p>
      <p className="rounded bg-card px-2 py-1 font-mono text-xs break-all">{link}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        <Button asChild size="sm">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle aria-hidden /> Send on WhatsApp
          </a>
        </Button>
      </div>
    </div>
  );
}

export function RevokeInviteButton({ inviteId }: { inviteId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      loading={pending}
      onClick={() => startTransition(async () => void (await revokeInviteAction(inviteId)))}
    >
      Cancel
    </Button>
  );
}
