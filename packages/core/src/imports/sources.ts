import { schema, withTenant } from '@fulcra/db';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { canUse } from '../entitlements/can-use';
import { enqueueCatalogImport } from '../jobs/queue';
import { requireMember, type ActorContext } from '../members/access';
import { decryptSecret, encryptSecret } from '../shared/crypto';
import { CoreError } from '../shared/errors';
import { checkImportedProduct } from './check';

const EDITORS = ['owner', 'staff'] as const;
const s = schema.catalogSources;
const t = schema.catalogImports;

export const SHOPIFY_SHOP_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

const shopifyCredentials = z.object({
  accessToken: z.string().min(10),
  scopes: z.string().default(''),
});
const wooCredentials = z.object({
  consumerKey: z.string().regex(/^ck_[a-zA-Z0-9]+$/, 'The consumer key starts with ck_.'),
  consumerSecret: z.string().regex(/^cs_[a-zA-Z0-9]+$/, 'The consumer secret starts with cs_.'),
});

export const connectSourceInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('shopify'),
    shopUrl: z
      .string()
      .trim()
      .toLowerCase()
      .regex(SHOPIFY_SHOP_PATTERN, 'Enter your shop address, like mystore.myshopify.com.'),
    credentials: shopifyCredentials,
  }),
  z.object({
    kind: z.literal('woocommerce'),
    shopUrl: z
      .url({ message: 'Enter your website address, like https://mystore.com.' })
      .refine((u) => u.startsWith('https://'), 'Your website must use https:// to connect safely.')
      .transform((u) => u.replace(/\/+$/, '')),
    credentials: wooCredentials,
  }),
]);

export type ConnectSourceInput = z.input<typeof connectSourceInput>;
export type ShopifyCredentials = z.infer<typeof shopifyCredentials>;
export type WooCredentials = z.infer<typeof wooCredentials>;

export type SourceView = Pick<
  schema.CatalogSource,
  'id' | 'kind' | 'status' | 'shopUrl' | 'lastSyncedAt' | 'lastError'
>;

const sourceView = {
  id: s.id,
  kind: s.kind,
  status: s.status,
  shopUrl: s.shopUrl,
  lastSyncedAt: s.lastSyncedAt,
  lastError: s.lastError,
};

/**
 * Saves a shop connection with its keys encrypted. Connecting again (same kind) replaces
 * the old one. The caller has already checked the keys work.
 */
export async function connectCatalogSource(
  actor: ActorContext,
  input: ConnectSourceInput,
): Promise<SourceView> {
  const data = connectSourceInput.parse(input);
  const credentials = encryptSecret(JSON.stringify(data.credentials));
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, EDITORS);
    if (!(await canUse(actor.businessId, 'catalog_import'))) {
      throw new CoreError('forbidden', 'Importing products is not part of your plan.');
    }
    const values = {
      status: 'connected' as const,
      shopUrl: data.shopUrl,
      credentials,
      lastError: null,
      connectedBy: actor.userId,
    };
    const [row] = await tx
      .insert(s)
      .values({ businessId: actor.businessId, kind: data.kind, ...values })
      .onConflictDoUpdate({ target: [s.businessId, s.kind], set: values })
      .returning(sourceView);
    return row!;
  });
}

/** The business's shop connections (never the keys). */
export async function listCatalogSources(actor: ActorContext): Promise<SourceView[]> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, EDITORS);
    return tx.select(sourceView).from(s);
  });
}

/** Forgets the shop's keys. Products already imported stay. */
export async function disconnectCatalogSource(
  actor: ActorContext,
  kind: schema.CatalogSourceKind,
): Promise<void> {
  const k = z.enum(schema.catalogSourceKinds).parse(kind);
  await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, EDITORS);
    await tx
      .update(s)
      .set({ status: 'disconnected', credentials: null, lastError: null })
      .where(eq(s.kind, k));
  });
}

const RUNNING = ['queued', 'fetching', 'saving'] as const;

/** Starts bringing in products from a connected shop (in the background). */
export async function startSourceImport(
  actor: ActorContext,
  kind: schema.CatalogSourceKind,
): Promise<schema.CatalogImport> {
  const k = z.enum(schema.catalogSourceKinds).parse(kind);
  const created = await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, EDITORS);
    if (!(await canUse(actor.businessId, 'catalog_import'))) {
      throw new CoreError('forbidden', 'Importing products is not part of your plan.');
    }
    const [source] = await tx.select().from(s).where(eq(s.kind, k)).for('update').limit(1);
    if (!source || source.status === 'disconnected' || !source.credentials) {
      throw new CoreError('validation', 'Connect your shop first.');
    }
    const [running] = await tx
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.sourceId, source.id), inArray(t.status, RUNNING)))
      .limit(1);
    if (running) throw new CoreError('conflict', 'An import from this shop is already running.');
    const [row] = await tx
      .insert(t)
      .values({
        businessId: actor.businessId,
        kind: k,
        sourceId: source.id,
        status: 'queued',
        label: source.shopUrl.replace(/^https?:\/\//, ''),
        createdBy: actor.userId,
        startedAt: new Date(),
      })
      .returning();
    return row!;
  });
  try {
    await enqueueCatalogImport(actor.businessId, created.id);
  } catch (error) {
    console.error('[imports] could not queue shop import', error);
    await withTenant(actor.businessId, (tx) =>
      tx
        .update(t)
        .set({
          status: 'failed',
          error: 'We could not start the import. Please try again.',
          finishedAt: new Date(),
        })
        .where(eq(t.id, created.id)),
    );
    throw new CoreError('conflict', 'We could not start the import. Please try again.');
  }
  return created;
}

export type FetchTarget =
  | { kind: 'shopify'; shopUrl: string; credentials: ShopifyCredentials }
  | { kind: 'woocommerce'; shopUrl: string; credentials: WooCredentials }
  | { kind: 'url'; url: string };

/**
 * Worker: claims a queued shop import for fetching and returns the shop and its keys.
 * Null when there is nothing to fetch (already fetched, cancelled, not a shop import).
 */
export async function claimImportFetch(
  businessId: string,
  importId: string,
): Promise<FetchTarget | null> {
  return withTenant(businessId, async (tx) => {
    const [row] = await tx
      .select({
        status: t.status,
        importKind: t.kind,
        label: t.label,
        kind: s.kind,
        shopUrl: s.shopUrl,
        credentials: s.credentials,
      })
      .from(t)
      .leftJoin(s, eq(s.id, t.sourceId))
      .where(eq(t.id, importId))
      .for('update', { of: t })
      .limit(1);
    if (!row || (row.status !== 'queued' && row.status !== 'fetching')) return null;
    if (row.importKind === 'url') {
      await tx.update(t).set({ status: 'fetching' }).where(eq(t.id, importId));
      return { kind: 'url', url: row.label };
    }
    if (row.importKind === 'csv') return null;
    if (!row.credentials || !row.kind || !row.shopUrl) {
      await tx
        .update(t)
        .set({ status: 'failed', error: 'The shop was disconnected.', finishedAt: new Date() })
        .where(eq(t.id, importId));
      return null;
    }
    await tx.update(t).set({ status: 'fetching' }).where(eq(t.id, importId));
    const credentials: unknown = JSON.parse(decryptSecret(row.credentials));
    return row.kind === 'shopify'
      ? {
          kind: 'shopify',
          shopUrl: row.shopUrl,
          credentials: shopifyCredentials.parse(credentials),
        }
      : {
          kind: 'woocommerce',
          shopUrl: row.shopUrl,
          credentials: wooCredentials.parse(credentials),
        };
  });
}

/**
 * Worker: stores the products read from a shop or website.
 * Shop data is structured, so it moves straight on to saving; products that break our
 * rules (e.g. more than 100 options) are left out and listed in the summary.
 * Website imports (`review: true`) wait for the seller to check them first.
 */
export async function saveFetchedProducts(
  businessId: string,
  importId: string,
  products: schema.ImportedProduct[],
  notes: { position: number; message: string; level?: 'warning' | 'error' }[] = [],
  options: { review?: boolean; sourceRefs?: string[] } = {},
): Promise<void> {
  await withTenant(businessId, async (tx) => {
    const [row] = await tx
      .select({ status: t.status })
      .from(t)
      .where(eq(t.id, importId))
      .for('update')
      .limit(1);
    if (row?.status !== 'fetching') return;
    const items = products.map((data, position) => {
      const problems: schema.ImportProblem[] = [
        ...notes
          .filter((n) => n.position === position)
          .map((n) => ({ level: n.level ?? ('warning' as const), message: n.message })),
      ];
      // Our own clearer message replaces the generic form-rule one (e.g. a missing price).
      if (!problems.some((p) => p.level === 'error')) problems.push(...checkImportedProduct(data));
      const blocked = problems.some((p) => p.level === 'error');
      return {
        businessId,
        importId,
        position,
        sourceRef:
          options.sourceRefs?.[position] ??
          (data.externalId ? `#${data.externalId}` : `Product ${position + 1}`),
        data,
        problems,
        decision: blocked ? ('skipped' as const) : ('approved' as const),
        // In review, a blocked product is simply unticked; without review it is reported as failed.
        result: blocked && !options.review ? ('failed' as const) : null,
        resultMessage:
          blocked && !options.review ? problems.find((p) => p.level === 'error')!.message : null,
      };
    });
    for (let i = 0; i < items.length; i += 500) {
      await tx.insert(schema.catalogImportItems).values(items.slice(i, i + 500));
    }
    const approved = items.filter((i) => i.decision === 'approved').length;
    await tx
      .update(t)
      .set(
        options.review
          ? { status: 'review', totalItems: items.length, processedItems: 0 }
          : {
              status: 'saving',
              totalItems: approved,
              processedItems: 0,
              failedCount: items.length - approved,
            },
      )
      .where(eq(t.id, importId));
  });
}

/** Worker: the shop could not be read. Marks the import failed and the connection as needing attention. */
export async function failImportFetch(
  businessId: string,
  importId: string,
  message: string,
): Promise<void> {
  await withTenant(businessId, async (tx) => {
    const [row] = await tx
      .update(t)
      .set({ status: 'failed', error: message, finishedAt: new Date() })
      .where(and(eq(t.id, importId), inArray(t.status, ['queued', 'fetching'])))
      .returning({ sourceId: t.sourceId });
    if (row?.sourceId) {
      await tx.update(s).set({ status: 'error', lastError: message }).where(eq(s.id, row.sourceId));
    }
  });
}

export const urlImportInput = z.object({
  url: z
    .string()
    .trim()
    .min(4, 'Enter your website address.')
    .max(500)
    .transform((u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`))
    .pipe(
      z
        .url({ message: 'Enter a website address like mystore.com.' })
        .refine(
          (u) => /^https?:\/\/[^/]+\.[^/]+/.test(u),
          'Enter a website address like mystore.com.',
        ),
    ),
});

/**
 * Starts reading products from a website link (in the background). The products found
 * wait on the review screen; nothing is saved until the seller confirms.
 */
export async function startUrlImport(
  actor: ActorContext,
  input: z.input<typeof urlImportInput>,
): Promise<schema.CatalogImport> {
  const { url } = urlImportInput.parse(input);
  const created = await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, EDITORS);
    if (!(await canUse(actor.businessId, 'catalog_import'))) {
      throw new CoreError('forbidden', 'Importing products is not part of your plan.');
    }
    const [running] = await tx
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.kind, 'url'), inArray(t.status, ['queued', 'fetching'])))
      .limit(1);
    if (running) {
      throw new CoreError(
        'conflict',
        'We are already reading a website for you. Wait for it to finish.',
      );
    }
    const [row] = await tx
      .insert(t)
      .values({
        businessId: actor.businessId,
        kind: 'url',
        status: 'queued',
        label: url,
        createdBy: actor.userId,
        startedAt: new Date(),
      })
      .returning();
    return row!;
  });
  try {
    await enqueueCatalogImport(actor.businessId, created.id);
  } catch (error) {
    console.error('[imports] could not queue website import', error);
    await withTenant(actor.businessId, (tx) =>
      tx
        .update(t)
        .set({
          status: 'failed',
          error: 'We could not start reading your website. Please try again.',
          finishedAt: new Date(),
        })
        .where(eq(t.id, created.id)),
    );
    throw new CoreError('conflict', 'We could not start reading your website. Please try again.');
  }
  return created;
}
