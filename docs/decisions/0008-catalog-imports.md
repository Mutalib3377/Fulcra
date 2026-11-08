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

## Update (I1b): Shopify and WooCommerce

- A business connects each shop once (`catalog_sources`, one per kind). Keys are encrypted with AES-256-GCM (`ENCRYPTION_KEY`) and never sent to the browser. Disconnecting deletes them; imported products stay.
- **Shopify** connects through our own Shopify app (OAuth): the seller approves read-only access to products and stock. The callback checks Shopify's signature, our signed `state` (business, user, shop, 10-minute expiry) and a cookie nonce so it must return to the same browser. Products are read with the Admin GraphQL API in small pages, retrying when Shopify throttles. Only active products are read. When the app is removed (`app/uninstalled`, `shop/redact`) the keys are forgotten; privacy webhooks are recorded (we keep no Shopify customer data).
- **WooCommerce** uses read-only REST keys the seller creates. The website must use https. Requests go through `safeFetch` (the address comes from the seller); the keys are only sent to the same site, never after a redirect elsewhere. Some hosts strip the Authorization header, so on 401 the keys are retried in the query string.
- Only shops that sell in Naira are imported. Options map to size and colour (other options are added to the size). The lowest option price becomes the product price; other prices become option prices. Stock that the shop does not track is left at 0 (new products) or unchanged, with a note to the seller.
- Shop imports skip the review step (the data is structured); products that break our rules are left out and listed. The worker reads the shop, then saves products as for CSV. Reading the shop lives in `@fulcra/integrations`; Core only stores and saves (rule 4).

## Update (I1c): website link

- The seller gives a link (usually their shop page). We read that page and up to 24 same-site product pages it links to, through `safeFetch`.
- Pages with schema.org Product data (JSON-LD, which most shop software adds for Google) are read directly, with no AI. Other pages are sent to Claude as plain text (scripts and menus removed, images kept as markers), in at most 3 calls per import, with a structured-output schema. The prompt treats page content as data, not instructions. Photo links the model returns are kept only if they appear on that page, so it cannot invent them.
- Prices must be in Naira. A product without a clear Naira price is shown on the review screen but cannot be ticked. Stock always starts at 0 (websites rarely show it).
- Website imports always go through the review screen, with a note that AI read them. Re-importing the same page updates products by their page address (`external_id`).
- Without `ANTHROPIC_API_KEY`, only pages with JSON-LD can be read; otherwise the seller is told to use a CSV.
- A retried job reads the website again (and may call the AI again); retries are limited to 5.
