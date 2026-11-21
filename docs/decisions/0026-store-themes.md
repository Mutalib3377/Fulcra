# 0026 — Store themes

Status: accepted (T1a home, cards, header and picker; T1b product, cart and checkout pages). Free in every plan, moved ahead of launch at the owner's request.

## Context

Every store looked the same apart from colours and heading font. Sellers want their store to feel like their brand: a fashion boutique, a cake shop and a provisions seller need different looks.

## Decision

- **Six themes**, stored as `brand_kits.store_theme` (`classic` default, `minimal`, `boutique`, `bold`, `market`, `playful`), chosen in Settings → Brand kit (`ThemePicker`, small drawings in the seller's colours). `saveBrandKit` keeps the saved theme when a caller leaves it out. `StoreInfo.brand.theme` gives it to the store.
- **A theme is design choices, not separate pages.** `apps/web/lib/store-themes.ts` (browser-safe) holds each theme's hero layout, card shape, phone columns and corner style; page colours (`--store-bg`, `--store-surface`, `--store-fg`, `--store-muted`, `--store-subtle`, `--store-line`) are CSS in `globals.css` under `.store[data-store-theme=…]`, and store components use those variables instead of fixed colours, so Bold can be dark. Tints and the brand ink are mixed from the page colour. `themeTypography` adjusts headings (Boutique uses a serif when the font is the default; Bold makes headings heavier). No new fonts or files.
- **Preview before saving.** `/preview-theme/<theme>` on the store sets a one-hour cookie on that phone only (`PREVIEW_THEME_COOKIE`, read by `storeThemeFor`) with a banner and a way back (`/preview-theme/off`). Customers never see a preview.

- **Every page (T1b).** Product pages, cart, checkout and receipts use the same variables, plus status colours (`--store-success`, `--store-warning`, `--store-danger` and their soft backgrounds, brighter on the dark theme) and button corners (`--store-button-radius`: square on Minimal and Boutique). Page headings carry `store-title` (capitals on Bold).

## Consequences

- New store pieces should use the `--store-*` variables, never fixed colours, so they work in every theme (including the dark one).
- Store cached data includes the theme; `CACHE_VERSION` was bumped.
