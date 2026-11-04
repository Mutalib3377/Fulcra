import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { safeNextPath } from '@/lib/urls';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

type Props = { searchParams: Promise<{ next?: string }> };

export default async function SignInPage({ searchParams }: Props) {
  const { next } = await searchParams;
  if (await getCurrentUser()) redirect(safeNextPath(next));
  return <SignInForm next={next ?? null} />;
}
