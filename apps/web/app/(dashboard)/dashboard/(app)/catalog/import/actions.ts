'use server';

import { cancelImport, confirmImport, setImportItemsDecision } from '@fulcra/core';
import { revalidatePath } from 'next/cache';
import { toActionError, type ActionResult } from '@/lib/action-result';
import { getActionContext, SESSION_ENDED } from '@/lib/auth';

const importPath = (importId: string) => `/dashboard/catalog/import/${importId}`;

export async function setImportItemsDecisionAction(
  importId: string,
  approved: boolean,
  itemIds?: string[],
): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await setImportItemsDecision(context.actor, importId, { approved, itemIds });
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

export async function confirmImportAction(importId: string): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await confirmImport(context.actor, importId);
    revalidatePath(importPath(importId));
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

export async function cancelImportAction(
  importId: string,
): Promise<ActionResult<{ redirectTo: string }>> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await cancelImport(context.actor, importId);
    return { ok: true, data: { redirectTo: '/catalog/import' } };
  } catch (error) {
    return toActionError(error);
  }
}
