# 0008 — Catalog imports: review first, save in the background

Status: accepted (I1a: CSV; Shopify, WooCommerce and website links follow in I1b and I1c)

## Context

Sellers who already sell elsewhere should not retype their catalog. Imports can be large (hundreds of products, each with photos to download), sellers are on slow phone connections, and data from files or other sites is often messy.

## Decision

- Every import is a `catalog_imports` row with one `catalog_import_items` row per product, holding the product as read (`ImportedProduct`, amounts in kobo) and its problems in plain words. Problems are `error` (cannot be saved) or `warning` (saved, but worth checking).
- **Review first** for CSV and website imports: products without errors start ticked, products with errors cannot be ticked. Nothing reaches the catalog until the seller confirms. Shopify and WooCommerce data is structured, so those imports will save directly.
- **Saving runs in the worker** (`catalog-import` job). Products are saved one at a time, each in its own transaction, so one bad product never stops the rest, progress is visible, and a retried job continues where it stopped (items with a result are skipped).
- **Same rules as the product form**: imported products are validated with `productInput` and saved by `saveImportedProductInTx` in Core. Stock is set through stock movements with reason `import`.
- **No duplicates**: products are matched by `source` + `external_id` (the CSV "product code" column; the shop's product id later). Options match by their own external id, else by size and colour. Options missing from the source are archived. The owner's choices (hidden, featured) are kept; existing photos are kept when the source has none; unknown stock leaves stock as it is.
- **Photos** are downloaded and processed like uploads. A photo that fails is skipped and reported; the product still saves.
- **Safe fetching**: every link a seller gives us goes through `safeFetch`, which only allows http(s) to public addresses (checked after DNS lookup and on every redirect), with size, time and redirect limits. `FETCH_ALLOW_PRIVATE_HOSTS=true` allows local addresses for development only.

## Consequences

- Imported products reach the storefront within a minute (the worker cannot refresh the web cache; see the storefront notes in CLAUDE.md).
- DNS can change between the check and the request (DNS rebinding). The risk is low for public photo links; if it matters later, pin the checked address when connecting.
