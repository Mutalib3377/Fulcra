'use server';

import {
  cancelImport,
  confirmImport,
  connectCatalogSource,
  disconnectCatalogSource,
  setImportItemsDecision,
  startSourceImport,
  startUrlImport,
} from '@fulcra/core';
import type { CatalogSourceKind } from '@fulcra/core/rules';
import { ImportFetchError, verifyWooConnection } from '@fulcra/integrations';
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

export async function connectWooAction(input: {
  shopUrl: string;
  consumerKey: string;
  consumerSecret: string;
}): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  const raw = input.shopUrl.trim().replace(/\/+$/, '');
  const shopUrl = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const credentials = {
    consumerKey: input.consumerKey.trim(),
    consumerSecret: input.consumerSecret.trim(),
  };
  try {
    // Check the keys work and the shop sells in Naira before saving anything.
    const { currency } = await verifyWooConnection({ shopUrl, credentials });
    if (currency !== 'NGN') {
      return {
        ok: false,
        message: `Your WooCommerce shop sells in ${currency}. Fulcra works in Naira (NGN) only for now.`,
      };
    }
    await connectCatalogSource(context.actor, { kind: 'woocommerce', shopUrl, credentials });
    revalidatePath('/dashboard/catalog/import');
    return { ok: true, data: undefined };
  } catch (error) {
    if (error instanceof ImportFetchError) return { ok: false, message: error.message };
    return toActionError(error);
  }
}

export async function startShopImportAction(
  kind: CatalogSourceKind,
): Promise<ActionResult<{ redirectTo: string }>> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    const run = await startSourceImport(context.actor, kind);
    return { ok: true, data: { redirectTo: `/catalog/import/${run.id}` } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function disconnectShopAction(kind: CatalogSourceKind): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await disconnectCatalogSource(context.actor, kind);
    revalidatePath('/dashboard/catalog/import');
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

export async function startUrlImportAction(
  url: string,
): Promise<ActionResult<{ redirectTo: string }>> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    const run = await startUrlImport(context.actor, { url });
    return { ok: true, data: { redirectTo: `/catalog/import/${run.id}` } };
  } catch (error) {
    return toActionError(error);
  }
}
