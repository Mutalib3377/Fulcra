# Fulcra

An AI sales agent for small product sellers in Nigeria. It answers customers, sells, takes orders, confirms payments and reports to the owner, across WhatsApp, Instagram DMs and the seller's website.

- What we are building and why: [`docs/PRODUCT_PLAN.md`](docs/PRODUCT_PLAN.md)
- Build order and task lists: [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md)
- Rules for working in this repo: [`CLAUDE.md`](CLAUDE.md)
- Important decisions: [`docs/decisions/`](docs/decisions)

## Getting started

Needs Node 22 (see `.nvmrc`), pnpm 10 (`corepack enable`) and Docker.

```bash
pnpm install
cp .env.example .env
pnpm db:up        # start local Postgres (Docker) on port 54322
pnpm db:migrate   # apply database migrations
pnpm dev          # web on http://localhost:3000 + worker
```

Open:

- http://localhost:3000 — marketing site
- http://app.localhost:3000 — owner dashboard
- http://test.localhost:3000 — a store (any name works)

`*.localhost` works out of the box in Chrome, Edge and Firefox. If your browser or OS does not resolve it, add lines like `127.0.0.1 app.localhost` to your hosts file.

## Repo layout

```
apps/web        Next.js app: marketing, dashboard and storefronts (routed by host in proxy.ts)
apps/worker     Background jobs on pg-boss
packages/core   All business logic
packages/db     Drizzle schema, migrations, db client
packages/ui     Shared UI kit and design tokens
packages/config Shared TypeScript, ESLint, Vitest config and app constants
packages/agent, channels, integrations, modules, widget   Filled in by later phases
```

## Docker

Both apps build from the repo root:

```bash
docker build -f apps/web/Dockerfile -t fulcra-web .
docker build -f apps/worker/Dockerfile -t fulcra-worker .
```
