'use server';

import {
  archiveProduct,
  createProduct,
  duplicateProduct,
  setProductActive,
  updateProduct,
  type ProductInput,
} from '@fulcra/core';
import { revalidatePath } from 'next/cache';
import { toActionError, type ActionResult } from '@/lib/action-result';
import { getActionContext, SESSION_ENDED } from '@/lib/auth';
import { refreshStore } from '@/lib/store';
import { toFormValues } from './form-data';
import type { ProductFormValues } from './form-types';

const CATALOG_PATH = '/dashboard/catalog';

export async function createProductAction(
  input: ProductInput,
): Promise<ActionResult<{ productId: string }>> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    const { product } = await createProduct(context.actor, input);
    revalidatePath(CATALOG_PATH);
    await refreshStore(context.actor);
    return { ok: true, data: { productId: product.id } };
  } catch (error) {
    return toActionError(error);
  }
}

/** Saves and returns fresh form values (new options get their ids). */
export async function updateProductAction(
  productId: string,
  input: ProductInput,
): Promise<ActionResult<{ values: ProductFormValues }>> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    const saved = await updateProduct(context.actor, productId, input);
    revalidatePath(CATALOG_PATH);
    await refreshStore(context.actor);
    return { ok: true, data: { values: toFormValues(saved) } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function setProductActiveAction(
  productId: string,
  isActive: boolean,
): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await setProductActive(context.actor, productId, isActive);
    revalidatePath(CATALOG_PATH);
    await refreshStore(context.actor);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

export async function archiveProductAction(
  productId: string,
): Promise<ActionResult<{ redirectTo: string }>> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await archiveProduct(context.actor, productId);
    revalidatePath(CATALOG_PATH);
    await refreshStore(context.actor);
    return { ok: true, data: { redirectTo: '/catalog' } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function duplicateProductAction(
  productId: string,
): Promise<ActionResult<{ redirectTo: string }>> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    const { product } = await duplicateProduct(context.actor, productId);
    revalidatePath(CATALOG_PATH);
    await refreshStore(context.actor);
    return { ok: true, data: { redirectTo: `/catalog/${product.id}` } };
  } catch (error) {
    return toActionError(error);
  }
}
