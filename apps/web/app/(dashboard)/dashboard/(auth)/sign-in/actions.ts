'use server';

import { z } from 'zod';
import type { ActionResult } from '@/lib/action-result';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/urls';

const emailSchema = z.email('Enter a valid email address.').trim().toLowerCase();
const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from the email.');

function friendlyAuthError(message: string): string {
  if (/rate limit|security purposes|too many/i.test(message)) {
    return 'Please wait a minute before asking for another code.';
  }
  if (/expired|invalid/i.test(message)) {
    return 'That code is wrong or has expired. Check the email or ask for a new code.';
  }
  return 'Something went wrong. Please try again.';
}

/** Step 1: email the user a sign-in code. Creates the account on first sign-in. */
export async function sendSignInCode(email: string): Promise<ActionResult<{ email: string }>> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]!.message, field: 'email' };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { shouldCreateUser: true },
  });
  if (error) return { ok: false, message: friendlyAuthError(error.message), field: 'email' };
  return { ok: true, data: { email: parsed.data } };
}

/** Step 2: check the code, sign in and go to the requested page. */
export async function verifySignInCode(
  email: string,
  code: string,
  next: string | null,
): Promise<ActionResult<{ redirectTo: string }>> {
  const parsedEmail = emailSchema.safeParse(email);
  const parsedCode = codeSchema.safeParse(code);
  if (!parsedEmail.success) return { ok: false, message: 'Start again with your email.' };
  if (!parsedCode.success) {
    return { ok: false, message: parsedCode.error.issues[0]!.message, field: 'code' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({
    email: parsedEmail.data,
    token: parsedCode.data,
    type: 'email',
  });
  if (error) return { ok: false, message: friendlyAuthError(error.message), field: 'code' };

  return { ok: true, data: { redirectTo: safeNextPath(next) } };
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
}
