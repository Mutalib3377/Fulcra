import { csvTemplate } from '@fulcra/core';

/** The CSV template with example products, opened in Excel or Google Sheets. */
export function GET() {
  return new Response(csvTemplate(), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="fulcra-products-template.csv"',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
