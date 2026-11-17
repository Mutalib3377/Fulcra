# 0020 — Design system

Status: accepted (L1)

## Context

Before launch the app needed one clear visual language: calm, premium and readable on cheap Android phones, in the spirit of Apple's interfaces (quiet surfaces, strong typography, generous space). The owner also asked for dark mode.

## Decision

- **Tokens first** (`packages/ui/src/styles/globals.css`): semantic colours, type scale (display sizes with tighter tracking), radii, shadows, easing and short animations. Components and pages use token names only, never raw colours.
- **One typeface: Inter**, self-hosted in `apps/web/public/fonts` (SIL Open Font License). One 48 KB variable Latin file (all weights, preloaded) plus a 1.2 KB file with only the Naira sign, which Inter keeps in its extended set; both share the family name through `unicode-range`. Cached for a year (`next.config.ts`); a new font version gets a new file name.
- **Surfaces:** grey page, white cards with a hairline border and a barely-there shadow, 20px corners, pill buttons, iOS-sized switch. New `tinted` button, `primary-soft` badge tone, `SegmentedControl` and `Sheet` (native `<dialog>`, bottom sheet on phones).
- **Dark mode** follows the phone's setting, for the dashboard only: pages opt in with `data-color-scheme="auto"` (set in the dashboard layout); dark tokens apply under `:root:has([data-color-scheme='auto'])`. Storefronts and receipts stay light because sellers' brand colours are chosen for light pages.
- **Motion in the app** is CSS only (150–280ms, ease-out, no bounce) and switched off with "reduce motion". GSAP and three.js are for the marketing site only.
- `/design` in the dashboard shows every token and component (hidden in production unless `SHOW_DESIGN_PAGE=true`).

## Consequences

- Restyling a component restyles every page; pages are moved to the new spacing in a follow-up.
- Any new colour must be added as a token with a dark value.
