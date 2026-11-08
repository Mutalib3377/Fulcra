import type { CatalogImportKind, CatalogImportStatus } from '@fulcra/core/rules';
import type { BadgeProps } from '@fulcra/ui';

export const IMPORT_STATUS: Record<
  CatalogImportStatus,
  { label: string; tone: NonNullable<BadgeProps['tone']> }
> = {
  queued: { label: 'Waiting', tone: 'neutral' },
  fetching: { label: 'Fetching', tone: 'info' },
  review: { label: 'Ready to review', tone: 'warning' },
  saving: { label: 'Importing', tone: 'info' },
  done: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const IMPORT_KIND_LABEL: Record<CatalogImportKind, string> = {
  csv: 'Spreadsheet (CSV)',
  shopify: 'Shopify',
  woocommerce: 'WooCommerce',
  url: 'Website link',
};
