# ShopStock

Multi-branch inventory and point of sale for a small retail chain: a keyboard-first POS, receipts,
returns, purchase orders, stock transfers between branches, dashboards and reports.
**MongoDB · Express · React · Node**, TypeScript end to end, one shared package for the money rules.

**Live demo:** see the repository's _About_ link. The first load can take ~40 s (free hosting sleeps).
Demo logins (one shared password, given on request):

| Role                | Email                            | What to try                                          |
| ------------------- | -------------------------------- | ---------------------------------------------------- |
| Owner               | `owner@demo.shopstock.dev`       | Overview of 3 branches, reports for the last 30 days |
| Manager (GUL)       | `manager.gul@demo.shopstock.dev` | Receive the ordered PO, low stock → PO               |
| Manager (DHN + UTT) | `manager.dhn@demo.shopstock.dev` | Branch switcher, receive the transfer in transit     |
| Cashier (GUL)       | `cashier.gul@demo.shopstock.dev` | Scan, F9, Enter: a sale and a receipt                |

## The hard problems

| Problem                                    | Solution                                                                                          | Proof                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Two cashiers sell the last bottle          | Conditional `$inc` (`quantity ≥ qty`) inside a transaction, plus a `$jsonSchema` validator        | `sales.concurrency.test.ts`: 10 cashiers, 3 bottles → 3 sales |
| The network drops after the sale committed | Client idempotency key + unique index; a retry replays                                            | 5 parallel replays → 1 sale                                   |
| Gapless invoice numbers                    | The counter `$inc` inside the sale transaction: a failed sale returns its number                  | 50 parallel sales → 1..50                                     |
| An audit trail you can prove               | One stock module, append-only movements, reconciliation after **every** test                      | `expectReconciled()` in `afterEach`                           |
| Cost of goods sold                         | Weighted average cost in one update pipeline; transfers carry the cost they left with             | WAC fixtures, transfer tests                                  |
| Branch isolation                           | The branch comes from the URL via `resolveBranch`, a query guard plugin, the same 404 everywhere  | `cross-branch.test.ts`                                        |
| Everything under load, at once             | 500 random concurrent operations per seed: no negative stock, units conserved in shelves + trucks | `invariants.test.ts` (TR-07)                                  |
| Money and rounding                         | Integer minor units, largest-remainder discounts, telescoping refunds; one engine for POS and API | 100% branch coverage, property tests                          |
| Reports                                    | `$unionWith`, `$densify`, `$setWindowFields`; returns count when they happen                      | a hand-calculated fixture                                     |

## Architecture

```
browser (React, TanStack Query)
   │  same origin: /api/*  (+ the built SPA from the same Express server in production)
   ▼
Express ── authenticate → loadActor → [resolveBranch] → authorize(permission) → validate(Zod) → service
                                                                                         │
                         withTransaction ── withStockChanges ── inventory (conditional $inc) + stockMovements
                                                                                         ▼
                                                                         MongoDB replica set (Atlas)
```

- `packages/shared`: Zod schemas, DTO types, permissions, the pricing engine (the POS previews with the exact
  function the API charges with).
- `apps/api`: Express 5, Mongoose 9, pino. Every route declares a permission (a test walks the router).
- `apps/web`: React 19, Vite, Tailwind, Recharts (lazy-loaded with the reports page).

## Run locally

Needs Node 26 (`.nvmrc`) and Docker. Copy `apps/api/.env.example` to `apps/api/.env` first.

```bash
npm install
npm run db:up && npm run seed -- --reset   # a local replica set + 60 days of demo history (drops the local DB)
npm run dev                                # API on :4000, web on :5173
```

`npm run seed -- --reset --days 7` is a quicker seed. Log in with any demo email above and `SEED_DEMO_PASSWORD`.

## Tests

| Kind               | Command                                                         | What                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit + integration | `npm test`                                                      | ~480 tests on an in-memory replica set: rules, RBAC matrix, cross-branch, concurrency, TR-07 invariants, report fixture, cost confidentiality, route guard |
| E2E + a11y         | `npm run e2e` (`PW_CHANNEL=msedge` to use an installed browser) | the setup wizard, a keyboard sale, receiving a PO, cashier refused reports; axe on 4 screens; CSP                                                          |
| Load               | `npm run load:pos` (against a seeded production build)          | 10 cashiers × 60 s at one branch                                                                                                                           |

Load test (TR-14), production build, seeded database, local machine: **2,003 completed sales in 60 s,
p50 51 ms, p95 158 ms, p99 267 ms, 0 unexpected errors, invoices gapless, reconciliation clean.**

## Operations

| Task                                             | Command                                                                                                                                |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Validators + indexes (release step)              | `npm run db:sync -w @shopstock/api`                                                                                                    |
| Check every branch's stock against its movements | `npm run reconcile` (exit code 1 on a mismatch)                                                                                        |
| Seed a production database                       | `SEED_ALLOW_PROD_RESET=yes-really` + the ops URI: refused otherwise                                                                    |
| Backup                                           | `mongodump --uri "$MONGODB_OPS_URI" --gzip --archive=shopstock.gz`; restore with `mongorestore --drop`, then `db:sync` and `reconcile` |

Security: strict CSP (`script-src 'self'`), HSTS, per-user API rate limit, login limit on failed attempts,
refresh-token rotation with reuse detection, `$`-key rejection, no cost fields for cashiers (tested),
`DEMO_MODE` lets demo logins run the shop (sell, return, order, receive, transfer, report) but refuses
password changes and any change to the shared setup (settings, branches, staff, catalog, suppliers).

## Trade-offs, and what I'd do at scale

- Gapless invoices serialize sales per branch (one counter document); fine at ≤ 10 registers, measured above.
- Returns count in the period they happen, not the sale's: last month's report never changes.
- No offline POS: a dropped connection is safe (idempotent retry) but the register waits.
- At scale: pre-aggregated daily rollups for reports, an `isLow` field with an index instead of an `$expr`
  scan, sharding by `branchId`, server push instead of 60 s polling.

## Known issues

- `npm audit` reports moderate findings in **dev-only** tooling (ESLint and typescript-eslint through
  `minimatch`, the shadcn CLI). No high or critical; production dependencies: 0. CI fails on high.

## Docs

The planning, design and the 20-day build guide live in a separate `shopstock-docs` folder
(1-planning, 2-design, 3-build-guide).
