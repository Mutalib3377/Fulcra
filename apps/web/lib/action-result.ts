import { isCoreError } from '@fulcra/core';
import { z } from 'zod';

/** What a Server Action returns to a form. */
export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; message: string; field?: string };

/** Turns expected errors into a friendly result. Unexpected errors are rethrown. */
export function toActionError(error: unknown): { ok: false; message: string; field?: string } {
  if (isCoreError(error)) {
    return error.field
      ? { ok: false, message: error.message, field: error.field }
      : { ok: false, message: error.message };
  }
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    const field = issue?.path[0];
    return typeof field === 'string'
      ? { ok: false, message: issue?.message ?? 'Please check this field.', field }
      : { ok: false, message: issue?.message ?? 'Please check the form.' };
  }
  throw error;
}
