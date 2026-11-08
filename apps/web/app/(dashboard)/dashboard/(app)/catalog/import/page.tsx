import { listImports } from '@fulcra/core';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@fulcra/ui';
import { ChevronRight, Download, FileSpreadsheet } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDashboardContext } from '@/lib/auth';
import { timeAgo } from '@/lib/orders';
import { CsvUpload } from './csv-upload';
import { IMPORT_KIND_LABEL, IMPORT_STATUS } from './status';

export const metadata: Metadata = { title: 'Import products' };

export default async function ImportPage() {
  const { actor, membership } = await getDashboardContext();
  if (membership.role === 'rider') {
    return <p className="text-muted-foreground">Only the owner and staff can import products.</p>;
  }
  const imports = await listImports(actor);
  const now = new Date();

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
