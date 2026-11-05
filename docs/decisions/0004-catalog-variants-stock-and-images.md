# 0004 — Catalog: variants, stock history, archiving and images

Status: accepted (C2)

## Decisions

- **Every product has at least one variant.** A product without sizes or colours gets one hidden default variant (`is_default = true`) that holds its stock. Orders (C3) always point at a variant, so stock logic has one path.
- **Stock changes go through Core only** (`applyStockChange` / `adjustStock`). Each change locks the variant row (`SELECT … FOR UPDATE`), refuses to go below zero, and writes a row to `stock_movements` (reason: initial, adjustment, sale, cancellation, return, import). Order services in C3 reuse `applyStockChange` inside their own transaction.
- **Archive, never delete.** "Delete" sets `archived_at` on products (and removed variants), so old orders and receipts keep working. Archived rows are hidden everywhere.
- **Cross-business safety at the database level.** Variants reference `(product_id, business_id)` and stock movements reference `(variant_id, business_id)` with composite foreign keys, so a row can never point at another business's data even if code had a bug. This is on top of RLS.
- **Images.** The browser shrinks photos (max 1600px JPEG) before upload to save data. The server (`sharp`) fixes rotation, strips metadata such as GPS, and stores three WebP sizes (200/600/1200px) under `<businessId>/<imageId>/{sm,md,lg}.webp`. Files are immutable and cached for a year. Storage is reached over the S3 API: Supabase Storage locally, Cloudflare R2 in production (only `STORAGE_*` variables change). Product photo references are checked to belong to the business.
- **Prices** are entered in naira and stored as integer kobo. Wholesale price needs a minimum quantity of at least 2; wholesale and minimum price cannot exceed the retail price.

## Not done yet

- Images removed from a product stay in storage (a duplicated product shares the same files, so deleting them immediately could break the copy). A clean-up job can remove unreferenced files later.
- The `stock.low` event and owner alert arrive with the `events` table (C3) and alerts (A4). Until then, low stock shows as a badge and a filter.
