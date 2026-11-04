'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FieldMessage,
  Input,
  Label,
} from '@fulcra/ui';
import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { goTo } from '@/lib/navigation';
import { sendSignInCode, verifySignInCode } from './actions';

const emailForm = z.object({ email: z.email('Enter a valid email address.').trim() });
const codeForm = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from the email.'),
});

export function SignInForm({ next }: { next: string | null }) {
  const [email, setEmail] = useState<string | null>(null);
  return email ? (
    <CodeStep email={email} next={next} onBack={() => setEmail(null)} />
  ) : (
    <EmailStep onSent={setEmail} />
  );
}

function EmailStep({ onSent }: { onSent: (email: string) => void }) {
  const [pending, startTransition] = useTransition();
  const form = useForm({ resolver: zodResolver(emailForm), defaultValues: { email: '' } });
  const error = form.formState.errors.email?.message;

  const onSubmit = form.handleSubmit(({ email }) =>
    startTransition(async () => {
      const result = await sendSignInCode(email);
      if (result.ok) onSent(result.data.email);
      else form.setError('email', { message: result.message });
    }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>We will email you a 6-digit code. No password needed.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              aria-invalid={!!error}
              {...form.register('email')}
            />
            {error && <FieldMessage error>{error}</FieldMessage>}
          </div>
          <Button type="submit" fullWidth loading={pending}>
            Send code
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function CodeStep({
  email,
  next,
  onBack,
}: {
  email: string;
  next: string | null;
  onBack: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [resent, setResent] = useState(false);
  const form = useForm({ resolver: zodResolver(codeForm), defaultValues: { code: '' } });
  const error = form.formState.errors.code?.message;

  const onSubmit = form.handleSubmit(({ code }) =>
    startTransition(async () => {
      const result = await verifySignInCode(email, code, next);
      if (result.ok) goTo(result.data.redirectTo);
      else form.setError('code', { message: result.message });
    }),
  );

  const resend = () =>
    startTransition(async () => {
      const result = await sendSignInCode(email);
      if (result.ok) setResent(true);
      else form.setError('code', { message: result.message });
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Check your email</CardTitle>
        <CardDescription>
          We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="code">Code</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              className="text-center text-xl tracking-[0.5em]"
              aria-invalid={!!error}
              autoFocus
              {...form.register('code')}
            />
            {error && <FieldMessage error>{error}</FieldMessage>}
            {resent && !error && <FieldMessage>A new code is on its way.</FieldMessage>}
          </div>
          <Button type="submit" fullWidth loading={pending}>
            Sign in
          </Button>
          <div className="flex justify-between">
            <Button type="button" variant="link" size="sm" className="px-0" onClick={onBack}>
              Use another email
            </Button>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="px-0"
              onClick={resend}
              disabled={pending}
            >
              Send a new code
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
