import { getBusiness, listCatalogSources, listImports, type SourceView } from '@fulcra/core';
import type { CatalogSourceKind } from '@fulcra/core/rules';
import { getShopifyAppConfig } from '@fulcra/integrations';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Button,
} from '@fulcra/ui';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Globe,
  Store,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDashboardContext } from '@/lib/auth';
import { timeAgo } from '@/lib/orders';
import { CsvUpload } from './csv-upload';
import { ShopButtons, UrlImportForm, WooConnectForm } from './shop-actions';
import { IMPORT_KIND_LABEL, IMPORT_STATUS } from './status';

export const metadata: Metadata = { title: 'Import products' };

const MESSAGES: Record<string, string> = {
  shopify_not_set_up:
    'Shopify connections are not switched on yet. Use a CSV export from Shopify for now.',
  shopify_bad_shop: 'Enter your Shopify shop address, like mystore.myshopify.com.',
  shopify_cancelled: 'Shopify was not connected.',
  shopify_failed: 'We could not connect your Shopify store. Please try again.',
  not_allowed: 'Only the owner and staff can connect a shop.',
};

type Props = { searchParams: Promise<{ connected?: string; error?: string }> };

export default async function ImportPage({ searchParams }: Props) {
  const { actor, membership } = await getDashboardContext();
  if (membership.role === 'rider') {
    return <p className="text-muted-foreground">Only the owner and staff can import products.</p>;
  }
  const [imports, sources, business, params] = await Promise.all([
    listImports(actor),
    listCatalogSources(actor),
    getBusiness(actor),
    searchParams,
  ]);
  const now = new Date();
  const source = (kind: CatalogSourceKind) =>
    sources.find((s) => s.kind === kind && s.status !== 'disconnected') ?? null;
  const shopify = source('shopify');
  const woo = source('woocommerce');
  const shopifyReady = getShopifyAppConfig() !== null;
  const notice =
    params.connected === 'shopify'
      ? 'Shopify is connected. You can import your products now.'
      : null;
  const problem = params.error ? (MESSAGES[params.error] ?? MESSAGES.shopify_failed) : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <Link href="/catalog" className="text-sm text-primary">
          ← Catalog
        </Link>
        <h1 className="text-2xl font-bold">Import products</h1>
        <p className="text-muted-foreground">
          Bring in the products you already have, instead of adding them one by one.
        </p>
      </div>

      {notice && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-md bg-success-soft px-3 py-2 text-sm text-success"
        >
          <CheckCircle2 className="size-4 shrink-0" aria-hidden /> {notice}
        </p>
      )}
      {problem && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          <AlertCircle className="size-4 shrink-0" aria-hidden /> {problem}
        </p>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Store className="size-5 text-primary" aria-hidden />
            <CardTitle>From Shopify</CardTitle>
          </div>
          <CardDescription>
            Brings in your products, options, prices, stock and photos.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {shopify && shopify.status !== 'error' ? (
            <>
              <ShopStatus source={shopify} now={now} />
              <ShopButtons kind="shopify" />
            </>
          ) : shopifyReady ? (
            <>
              {shopify && (
                <>
                  <ShopStatus source={shopify} now={now} />
                  <ShopButtons kind="shopify" />
                </>
              )}
              {/* A plain GET form: works even before the page's scripts load. */}
              <form
                action="/api/integrations/shopify/start"
                method="get"
                className="flex flex-col gap-3"
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="shop">Your Shopify shop address</Label>
                  <Input
                    id="shop"
                    name="shop"
                    placeholder="mystore.myshopify.com"
                    defaultValue={shopify?.shopUrl ?? ''}
                    autoCapitalize="none"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Shopify will ask you to approve Fulcra. We can only read your products and
                    stock.
                  </p>
                </div>
                <Button type="submit" className="self-start">
                  Connect Shopify
                </Button>
              </form>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Connecting Shopify is not switched on yet. Meanwhile, export your products from
              Shopify (Products → Export → CSV) and upload the file below.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Store className="size-5 text-primary" aria-hidden />
            <CardTitle>From WooCommerce</CardTitle>
          </div>
          <CardDescription>For WordPress websites with WooCommerce.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {woo && woo.status !== 'error' ? (
            <>
              <ShopStatus source={woo} now={now} />
              <ShopButtons kind="woocommerce" />
            </>
          ) : (
            <>
              {woo && (
                <>
                  <ShopStatus source={woo} now={now} />
                  <ShopButtons kind="woocommerce" />
                </>
              )}
              <details className="rounded-md bg-muted/60 px-3 py-2 text-sm">
                <summary className="cursor-pointer font-medium">
                  How to get your keys (2 minutes)
                </summary>
                <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5">
                  <li>
                    In your WordPress admin, go to WooCommerce → Settings → Advanced → REST API.
                  </li>
                  <li>
                    Click &quot;Add key&quot;. Description: Fulcra. Permissions:{' '}
                    <strong>Read</strong>.
                  </li>
                  <li>
                    Click &quot;Generate API key&quot; and copy the consumer key and consumer secret
                    here.
                  </li>
                </ol>
              </details>
              <WooConnectForm defaultUrl={woo?.shopUrl ?? business.websiteUrl ?? ''} />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Globe className="size-5 text-primary" aria-hidden />
            <CardTitle>From your website</CardTitle>
          </div>
          <CardDescription>
            For any other website. We read your product pages and show you what we found. Nothing is
            added until you check it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UrlImportForm defaultUrl={business.websiteUrl ?? ''} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="size-5 text-primary" aria-hidden />
            <CardTitle>From a spreadsheet (CSV)</CardTitle>
          </div>
          <CardDescription>
            Works with Excel, Google Sheets, or an export from another shop.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
            <li>
              <a
                href="/api/imports/csv-template"
                className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
              >
                <Download className="size-4" aria-hidden /> Download our template
              </a>{' '}
              and fill it in, one row per product. For sizes or colours, use one row for each, with
              the same name.
            </li>
            <li>
              Only <strong>name</strong> and <strong>price</strong> are needed. Photos can be links
              to pictures online.
            </li>
            <li>Save it as CSV and upload it. You check everything before it is added.</li>
          </ol>
          <CsvUpload />
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Keeping your own website?{' '}
        <Link
          href="/settings/whatsapp-buttons"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Add WhatsApp buttons to it
        </Link>{' '}
        so customers can order in one tap.
      </p>

      {imports.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent imports</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 p-0 pb-2">
            {imports.map((row) => {
              const status = IMPORT_STATUS[row.status];
              return (
                <Link
                  key={row.id}
                  href={`/catalog/import/${row.id}`}
                  className="flex items-center gap-3 px-6 py-3 hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {row.label || IMPORT_KIND_LABEL[row.kind]}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {IMPORT_KIND_LABEL[row.kind]} · {timeAgo(row.createdAt, now)}
                      {row.status === 'done'
                        ? ` · ${row.createdCount} added, ${row.updatedCount} updated`
                        : ''}
                    </p>
                  </div>
                  <Badge tone={status.tone}>{status.label}</Badge>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </Link>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ShopStatus({ source, now }: { source: SourceView; now: Date }) {
  const address = source.shopUrl.replace(/^https?:\/\//, '');
  if (source.status === 'error') {
    return (
      <p className="flex gap-2 text-sm text-danger">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {address}: {source.lastError ?? 'the last import could not read your shop.'} Connect again
          below.
        </span>
      </p>
    );
  }
  return (
    <p className="text-sm">
      <span className="font-medium">Connected to {address}</span>
      <span className="text-muted-foreground">
        {' · '}
        {source.lastSyncedAt
          ? `last imported ${timeAgo(source.lastSyncedAt, now)}`
          : 'not imported yet'}
      </span>
    </p>
  );
}
