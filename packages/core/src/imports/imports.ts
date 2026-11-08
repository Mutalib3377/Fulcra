import { schema, withTenant, type Tx } from '@fulcra/db';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { saveImportedProductInTx } from '../catalog/products';
import { canUse } from '../entitlements/can-use';
import { recordEvent, userActor } from '../events/events';
import { enqueueCatalogImport } from '../jobs/queue';
import { requireMember, type ActorContext } from '../members/access';
import { CoreError } from '../shared/errors';
import { parseCatalogCsv, type ParsedImportItem } from './csv';
import { importPhotos } from './photos';

const EDITORS = ['owner', 'staff'] as const;
const t = schema.catalogImports;
const it = schema.catalogImportItems;
const hasError = sql<boolean>`${it.problems} @> '[{"level":"error"}]'::jsonb`;

async function requireImportAccess(tx: Tx, actor: ActorContext) {
  await requireMember(tx, actor, EDITORS);
  if (!(await canUse(actor.businessId, 'catalog_import'))) {
    throw new CoreError('forbidden', 'Importing products is not part of your plan.');
  }
}

async function loadImport(tx: Tx, importId: string, lock = false) {
  const query = tx.select().from(t).where(eq(t.id, importId)).limit(1);
  const [row] = lock ? await query.for('update') : await query;
  if (!row) throw new CoreError('not_found', 'This import no longer exists.');
  return row;
}

/** Saves parsed products as an import waiting for the seller's review. */
async function createReviewImport(
  tx: Tx,
  actor: ActorContext,
  kind: schema.CatalogImportKind,
  label: string,
  items: ParsedImportItem[],
): Promise<schema.CatalogImport> {
  const [created] = await tx
    .insert(t)
    .values({
      businessId: actor.businessId,
      kind,
      status: 'review',
      label,
      totalItems: items.length,
      createdBy: actor.userId,
    })
    .returning();
  if (!created) throw new Error('Import insert returned no row');
  for (let i = 0; i < items.length; i += 500) {
    await tx.insert(it).values(
      items.slice(i, i + 500).map((item) => ({
        businessId: actor.businessId,
        importId: created.id,
        position: item.position,
        sourceRef: item.sourceRef,
        data: item.data,
        problems: item.problems,
        // Products without errors start ticked; the seller unticks what they do not want.
        decision: item.problems.some((p) => p.level === 'error')
          ? ('skipped' as const)
          : ('approved' as const),
      })),
    );
  }
  return created;
}

export const csvImportInput = z.object({
  fileName: z.string().trim().max(200).default(''),
  text: z.string(),
});

/** Reads a CSV file and opens the review screen. Owner or staff. */
export async function startCsvImport(
  actor: ActorContext,
  input: z.input<typeof csvImportInput>,
): Promise<schema.CatalogImport> {
  const { fileName, text } = csvImportInput.parse(input);
  const parsed = parseCatalogCsv(text);
  return withTenant(actor.businessId, async (tx) => {
    await requireImportAccess(tx, actor);
    if (!parsed.ok) throw new CoreError('validation', parsed.message, 'file');
    return createReviewImport(tx, actor, 'csv', fileName || 'CSV file', parsed.items);
  });
}

export type ImportItemView = Pick<
  schema.CatalogImportItem,
  | 'id'
  | 'position'
  | 'sourceRef'
  | 'data'
  | 'problems'
  | 'decision'
  | 'result'
  | 'resultMessage'
  | 'productId'
>;

export type ImportView = { import: schema.CatalogImport; items: ImportItemView[] };

/** An import with its products, for the review and progress screens. */
export async function getImport(actor: ActorContext, importId: string): Promise<ImportView> {
  const id = z.uuid().parse(importId);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, EDITORS);
    const row = await loadImport(tx, id);
    const items = await tx
      .select({
        id: it.id,
        position: it.position,
        sourceRef: it.sourceRef,
        data: it.data,
        problems: it.problems,
        decision: it.decision,
        result: it.result,
        resultMessage: it.resultMessage,
        productId: it.productId,
      })
      .from(it)
      .where(eq(it.importId, id))
      .orderBy(asc(it.position));
    return { import: row, items };
  });
}

/** The latest imports, newest first. */
export async function listImports(
  actor: ActorContext,
  limit = 10,
): Promise<schema.CatalogImport[]> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, EDITORS);
    return tx
      .select()
      .from(t)
      .orderBy(desc(t.createdAt))
      .limit(Math.min(Math.max(limit, 1), 50));
  });
}

export const importDecisionInput = z.object({
  /** Omit to apply to every product of the import. */
  itemIds: z.array(z.uuid()).max(5000).optional(),
  approved: z.boolean(),
});

/** Ticks or unticks products on the review screen. Products with errors cannot be ticked. */
export async function setImportItemsDecision(
  actor: ActorContext,
  importId: string,
  input: z.input<typeof importDecisionInput>,
): Promise<void> {
  const id = z.uuid().parse(importId);
  const { itemIds, approved } = importDecisionInput.parse(input);
  await withTenant(actor.businessId, async (tx) => {
    await requireImportAccess(tx, actor);
    const row = await loadImport(tx, id, true);
    if (row.status !== 'review') {
      throw new CoreError('conflict', 'This import has already started.');
    }
    const conditions = [eq(it.importId, id)];
    if (itemIds) conditions.push(inArray(it.id, itemIds));
    if (approved) conditions.push(sql`not ${hasError}`);
    await tx
      .update(it)
      .set({ decision: approved ? 'approved' : 'skipped' })
      .where(and(...conditions));
  });
}

/** Saves the ticked products in the background. Progress shows on the import page. */
export async function confirmImport(actor: ActorContext, importId: string): Promise<void> {
  const id = z.uuid().parse(importId);
  await withTenant(actor.businessId, async (tx) => {
    await requireImportAccess(tx, actor);
    const row = await loadImport(tx, id, true);
    if (row.status !== 'review')
      throw new CoreError('conflict', 'This import has already started.');
    const [counts] = await tx
      .select({
        approved: sql<number>`count(*) filter (where ${it.decision} = 'approved')::int`,
        all: sql<number>`count(*)::int`,
      })
      .from(it)
      .where(eq(it.importId, id));
    const approved = counts?.approved ?? 0;
    if (approved === 0) {
      throw new CoreError('validation', 'Tick at least one product to import.');
    }
    await tx
      .update(t)
      .set({
        status: 'saving',
        totalItems: approved,
        processedItems: 0,
        skippedCount: (counts?.all ?? 0) - approved,
        startedAt: new Date(),
      })
      .where(eq(t.id, id));
  });
  try {
    await enqueueCatalogImport(actor.businessId, id);
  } catch (error) {
    console.error('[imports] could not queue import', error);
    await withTenant(actor.businessId, (tx) =>
      tx.update(t).set({ status: 'review', startedAt: null }).where(eq(t.id, id)),
    );
    throw new CoreError('conflict', 'We could not start the import. Please try again.');
  }
}

/** Throws away an import that has not started. */
export async function cancelImport(actor: ActorContext, importId: string): Promise<void> {
  const id = z.uuid().parse(importId);
  await withTenant(actor.businessId, async (tx) => {
    await requireImportAccess(tx, actor);
    const row = await loadImport(tx, id, true);
    if (row.status !== 'review')
      throw new CoreError('conflict', 'This import has already started.');
    await tx.update(t).set({ status: 'cancelled', finishedAt: new Date() }).where(eq(t.id, id));
  });
}

export type ImportRunResult = 'done' | 'not_saving' | 'not_found';

/**
 * Worker job: saves the approved products of an import one by one, updating progress.
 * Safe to run again after a crash: products already saved are skipped.
 */
export async function processCatalogImport(
  businessId: string,
  importId: string,
): Promise<ImportRunResult> {
  const head = await withTenant(businessId, async (tx) => {
    const [row] = await tx.select().from(t).where(eq(t.id, importId)).limit(1);
    return row ?? null;
  });
  if (!head) return 'not_found';
  if (head.status !== 'saving' || !head.createdBy) return 'not_saving';
  const actor: ActorContext = { businessId, userId: head.createdBy };
  const source = head.kind;

  for (;;) {
    const [item] = await withTenant(businessId, (tx) =>
      tx
        .select({ id: it.id, data: it.data })
        .from(it)
        .where(and(eq(it.importId, importId), eq(it.decision, 'approved'), isNull(it.result)))
        .orderBy(asc(it.position))
        .limit(1),
    );
    if (!item) break;

    const { photos, failed } = await importPhotos(businessId, item.data.photoUrls);
    const photoNote =
      failed > 0 ? `${failed} ${failed === 1 ? 'photo' : 'photos'} could not be downloaded.` : null;
    try {
      await withTenant(businessId, async (tx) => {
        const saved = await saveImportedProductInTx(tx, actor, source, item.data, photos);
        await tx
          .update(it)
          .set({ result: saved.result, productId: saved.productId, resultMessage: photoNote })
          .where(eq(it.id, item.id));
        await tx
          .update(t)
          .set({
            processedItems: sql`${t.processedItems} + 1`,
            ...(saved.result === 'created'
              ? { createdCount: sql`${t.createdCount} + 1` }
              : { updatedCount: sql`${t.updatedCount} + 1` }),
          })
          .where(eq(t.id, importId));
      });
    } catch (error) {
      const message = failureMessage(error);
      await withTenant(businessId, async (tx) => {
        await tx
          .update(it)
          .set({ result: 'failed', resultMessage: message })
          .where(eq(it.id, item.id));
        await tx
          .update(t)
          .set({
            processedItems: sql`${t.processedItems} + 1`,
            failedCount: sql`${t.failedCount} + 1`,
          })
          .where(eq(t.id, importId));
      });
    }
  }

  await withTenant(businessId, async (tx) => {
    const [row] = await tx
      .update(t)
      .set({ status: 'done', finishedAt: new Date() })
      .where(and(eq(t.id, importId), eq(t.status, 'saving')))
      .returning();
    if (row?.sourceId) {
      // A shop that failed before works again (unless it was disconnected meanwhile).
      await tx
        .update(schema.catalogSources)
        .set({ status: 'connected', lastSyncedAt: new Date(), lastError: null })
        .where(
          and(
            eq(schema.catalogSources.id, row.sourceId),
            ne(schema.catalogSources.status, 'disconnected'),
          ),
        );
    }
    if (row) {
      await recordEvent(tx, businessId, {
        type: 'catalog.imported',
        actor: userActor(actor),
        payload: {
          importId,
          kind: row.kind,
          created: row.createdCount,
          updated: row.updatedCount,
          failed: row.failedCount,
        },
      });
    }
  });
  return 'done';
}

function failureMessage(error: unknown): string {
  if (error instanceof CoreError) return error.message;
  if (error instanceof z.ZodError)
    return error.issues[0]?.message ?? 'This product could not be saved.';
  console.error('[imports] product failed', error);
  return 'This product could not be saved.';
}
