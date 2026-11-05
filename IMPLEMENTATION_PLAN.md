# Implementation Plan

> **Status:** M0–M8 delivered as a demo build on 2026-11-05 (see PROJECT_STATUS.md for verification). M9 production-readiness items F-905–F-907 (containers, deployment, operations) are not built. Per-feature status markers below are from the plan and are superseded by PROJECT_STATUS.md.
> **Last updated:** 2026-11-05
> Work proceeds milestone by milestone, features in the order listed. "Implement the next feature" means the first feature in this file whose status is not ✅.

## How a feature is done

A feature is ✅ only when all of these that apply are true:

1. Backend endpoint(s), service logic and database integration (including migrations for new collections/indexes) are implemented.
2. Frontend screens use the real API, with loading, empty, error and success states.
3. Validation (shared Zod schema) and error handling are in place on both sides.
4. Authorization is enforced on the API and tested (unauthenticated, missing permission, another user's resource).
5. Unit and integration tests are written and pass; the full suite passes; the Playwright smoke suite passes.
6. `API_DOCUMENTATION.md` status and `PROJECT_STATUS.md` are updated; limitations recorded.
7. Lint and typecheck pass; a Git commit is made at least at each milestone boundary.

Status key: ⬜ not started · 🟡 in progress · ✅ done · ⛔ blocked

## Milestones overview

| Milestone | Goal | Depends on |
|---|---|---|
| M0 Planning | Requirements, architecture, API spec, plan approved | — |
| M1 Foundation | Monorepo, tooling, config, logging, errors, DB + migrations, test harness, Playwright, CI, client shell | M0; Q1 for F-108 |
| M2 Identity | Auth, sessions, password reset, profile, addresses, admin bootstrap, permissions | M1 |
| M3 Catalog | Admin shell, store settings, categories, media, products and inventory, seed data, storefront browsing, search, detail, home | M2 |
| M4 Cart & wishlist | Guest cart pricing, server cart, merge, wishlist | M3 |
| M5 Checkout & orders | Coupons, pricing, quote, COD orders, reservation path and expiry, history and tracking, cancellation of unpaid/COD orders | M4 |
| M6 Payments & refunds | Razorpay orders, verification, webhooks, refunds, reconciliation, sandbox verification | M5; Q2 (Razorpay test keys) |
| M7 Admin operations | Fulfilment (incl. undelivered), inventory management, customers, reviews and moderation, audit log, attention panel | M5 (M6 for refund paths) |
| M8 Analytics | Dashboard, reports, personalized recommendations | M7 |
| M9 Production readiness | Full E2E, responsive and accessibility, security and performance review, containers, deployment, operations, release report | M1–M8 |

## M0 — Planning

| ID | Feature | Status |
|---|---|---|
| F-000 | Requirements, architecture (revision 2), API specification, implementation plan, independent architecture review | 🟡 awaiting approval |

## M1 — Foundation

| ID | Feature | Scope | Status |
|---|---|---|---|
| F-101 | Workspace | `git init`, pnpm workspace (`client`, `server`, `shared`), `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`), ESLint flat config + Prettier, `.editorconfig`, `.gitignore`, root scripts (`dev`, `build`, `lint`, `typecheck`, `test`, `e2e`) | ⬜ |
| F-102 | Server skeleton | Express 5 app factory, env schema (fail-fast), pino with redaction, request ID, helmet, error classes and handler, 404, health endpoints, graceful shutdown | ⬜ |
| F-103 | Database and migrations | Mongoose connection with retry, `transactionAsyncLocalStorage`, `withTransaction`, migration runner (collections, validators, `syncIndexes`), `migrate` script | ⬜ |
| F-104 | Job scheduler | Self-rescheduling job runner, `jobLockedUntil` claim helper, start/stop with the server | ⬜ |
| F-105 | Test harness | Vitest projects, in-memory replica set with migrations applied, Supertest helpers, test data factories, Razorpay/SMTP/storage stubs at the integration boundary | ⬜ |
| F-106 | Shared package | Money helpers, enums, base schemas, permission map skeleton; consumed by client and server | ⬜ |
| F-107 | Client shell | Vite + React + Tailwind v4 tokens, router with lazy routes and error boundaries, Query client, fetch wrapper, layout (header, footer, mobile nav), base UI primitives, `QueryState`, 404 page | ⬜ |
| F-108 | Local environment | MongoDB replica set per Q1, `.env.example` files, `docker-compose.yml` (mongo, mailpit), README setup verified from a clean checkout | ⬜ |
| F-109 | Playwright smoke | Playwright config (desktop + phone viewports), smoke test (home renders, health OK), scripts to start API and client for tests | ⬜ |
| F-110 | CI | GitHub Actions: install (cached incl. `mongod` binary), lint, typecheck, test, build, Playwright smoke | ⬜ |

## M2 — Identity

| ID | Feature | Backend | Frontend | Status |
|---|---|---|---|---|
| F-201 | Register, login, refresh, logout | `users`, `sessions` (one per sign-in, rotation with 30 s grace, reuse detection), JWT, `tokensValidAfter`, rate limits | Login/register, session bootstrap, refresh single-flight with Web Locks + BroadcastChannel, account menu | ⬜ |
| F-202 | Authorization | `authenticate`, `optionalAuth`, `requirePermission`, permission map; reusable authorization test matrix | `RequireAuth`, `RequirePermission`, redirect back after sign-in | ⬜ |
| F-203 | Admin bootstrap | `create-admin` CLI (prompts for password, never logs it); 12-hour admin sessions | — | ⬜ |
| F-204 | Email integration | Mailer interface, SMTP and console drivers, templates | — | ⬜ |
| F-205 | Forgot and reset password | Reset tokens (single use, 30 min), link with token in URL fragment, revoke sessions | Forgot/reset pages | ⬜ |
| F-206 | Profile and password change | `/me`, `/me/password` | Profile and security pages | ⬜ |
| F-207 | Addresses | CRUD, transactional default switching, limit of 10, state list, PIN validation | Address book and reusable address form | ⬜ |

## M3 — Catalog

| ID | Feature | Backend | Frontend | Status |
|---|---|---|---|---|
| F-301 | Admin shell | — | Admin layout (sidebar, top bar, responsive drawer), shared `DataTable` (sort, filter, paginate, URL state), confirm dialogs | ⬜ |
| F-302 | Store settings and config | `settings` (optimistic concurrency), `/config`, `/admin/settings` incl. homepage hero/banners | Admin settings page | ⬜ |
| F-303 | Categories | Model, admin CRUD, delete/move guards, public tree | Admin category tree; storefront category navigation | ⬜ |
| F-304 | Media upload | `multer` + `sharp` (pixel limit, sequential), local storage driver, `media`, cleanup job | Image uploader with progress, reorder, alt text | ⬜ |
| F-305 | Admin products and inventory records | Product model, variants, inventory created in the same transaction, `recomputeProductAggregates`, archive vs delete, optimistic concurrency, audit entries | Product list (search, filters, pagination), create/edit form with options → variant matrix, prices, opening stock, images | ⬜ |
| F-306 | Seed data | Idempotent seed: categories, ~60 products with variants and images, coupons, demo customer | — | ⬜ |
| F-307 | Storefront listing and search | `/products` with filters, sorts, text search, price bounds; every index checked with `explain()` on seed data | Listing page, filter sidebar/drawer, sort, pagination, URL state, skeletons, empty state | ⬜ |
| F-308 | Search suggestions | `/products/suggest` on `searchTokens` | Header search combobox with debounced suggestions | ⬜ |
| F-309 | Product detail | Detail with inventory, related products, `/products/cards` | Gallery, variant picker (unavailable combinations disabled), stock, price/discount, recently viewed | ⬜ |
| F-310 | Home page | `/home` (hero/banners from settings, categories, featured, offers, new arrivals, trending) | Home page with rails and recently viewed | ⬜ |
| F-311 | Static pages and SEO | `/sitemap.xml` | Footer, legal pages (static content), per-route titles and meta | ⬜ |

## M4 — Cart and wishlist

| ID | Feature | Backend | Frontend | Status |
|---|---|---|---|---|
| F-401 | Guest cart | `/cart/preview` | Persisted guest cart, cart page and mini-cart drawer for guests | ⬜ |
| F-402 | Server cart | Cart CRUD, line limits, issues and warnings | Signed-in cart (same UI), quantity stepper, issue/warning badges | ⬜ |
| F-403 | Merge on sign-in | `/cart/merge` | Merge after sign-in with a summary of anything not merged | ⬜ |
| F-404 | Wishlist | Collection, idempotent add, ids endpoint, limit | Heart toggle on cards and detail, wishlist page, move to cart | ⬜ |

## M5 — Checkout and orders

| ID | Feature | Backend | Frontend | Status |
|---|---|---|---|---|
| F-501 | Coupons | Model, validation rules, redemptions, admin CRUD and usage list | Admin coupon list, form and usage page | ⬜ |
| F-502 | Pricing and quote | Shared pricing function (ordering, caps, ₹1 floor, allocation); `/checkout/quote` | Checkout page: address step, coupon field, summary, COD eligibility, price-change warnings | ⬜ |
| F-503 | COD orders | Transactional placement, idempotency (incl. concurrent duplicate keys), `allocate_direct`, coupon redemption, cart line removal, COD open-order cap, rate limit, confirmation email | Place order, confirmation page, out-of-stock / price-changed recovery | ⬜ |
| F-504 | Reservation path and expiry | `pending_payment` with `reserve`, one open unpaid order per customer, payment window, expiry job with grace (Razorpay check added in F-606) | Pending-payment state with countdown | ⬜ |
| F-505 | Order history and tracking | Customer order list/detail | Orders list, detail with status timeline and tracking link | ⬜ |
| F-506 | Cancel unpaid and COD orders | Cancellation transaction with exact stock reversal by `stockState`, coupon release | Cancel dialog with reason | ⬜ |
| F-507 | Concurrency tests | Last-unit race, single-use coupon race, idempotency replay, job claim race | — | ⬜ |

## M6 — Payments and refunds

| ID | Feature | Backend | Frontend | Status |
|---|---|---|---|---|
| F-601 | Razorpay orders | Integration client, one Razorpay order per store order, `/orders/:orderNumber/payment`, provider error handling, window closing | Load Checkout.js, open with prefill and timeout, retry button | ⬜ |
| F-602 | Verification | Signature check, provider fetch and match, capture of authorized payments, `recordCapturedPayment` (forward-only payments, `applied` vs `refund_required`) | Success → confirmation; failure → retry state | ⬜ |
| F-603 | Webhooks | Raw-body route, signature, event record in the effect's transaction, 5xx on failure, `payment.*`, `order.paid` | — | ⬜ |
| F-604 | Refunds | `refunds` collection and lifecycle, refund job (idempotent via `notes.refundId`), `refund.*` webhooks, dashboard refunds, `refund_failed` | Refund status on the customer order page | ⬜ |
| F-605 | Cancel paid orders | Cancellation of paid orders creates refunds | Cancel dialog shows refund notice | ⬜ |
| F-606 | Expiry reconciliation | Expiry job checks Razorpay before expiring | "Checking payment status" state | ⬜ |
| F-607 | Late and duplicate payments | 72-hour reconciliation job; refunds for captures on expired, cancelled or already-paid orders; customer email | Notice on the order page | ⬜ |
| F-608 | Sandbox verification | Live Razorpay test-mode run through a tunnel: success, failure + retry, cancellation refund, late payment, webhook redelivery; record observed behaviour and CSP hosts in `docs/runbooks/payments-sandbox.md`; fix any assumption that proved wrong | — | ⬜ |

## M7 — Admin operations and reviews

| ID | Feature | Backend | Frontend | Status |
|---|---|---|---|---|
| F-701 | Order management | Admin order list/detail, transitions incl. `undelivered` (restock or write-off, refund), cancel, `needsReview` resolution, emails on shipped/delivered/cancelled | Order queue with filters, detail with state-machine-driven actions | ⬜ |
| F-702 | Inventory management | Inventory list, adjustments, thresholds, ledger | Inventory table, low-stock filter, adjust dialog, movement history | ⬜ |
| F-703 | Customer management | List with stats, detail, block/unblock (customers only, with order handling) | Customer table and detail | ⬜ |
| F-704 | Reviews | Eligibility, create/edit/delete, rating recomputation, rate limit | Review form, list and rating distribution on product page | ⬜ |
| F-705 | Review moderation | Admin list, hide/publish/delete | Moderation table | ⬜ |
| F-706 | Refunds and attention panel | `/admin/refunds`, retry, `/admin/attention` | Refunds page, attention panel on the dashboard | ⬜ |
| F-707 | Audit log | `/admin/audit-logs` | Audit log page with filters | ⬜ |

## M8 — Analytics

| ID | Feature | Backend | Frontend | Status |
|---|---|---|---|---|
| F-801 | Dashboard | Aggregations with period comparison, Asia/Kolkata bucketing | KPI tiles, revenue chart, orders by status, top products, latest orders | ⬜ |
| F-802 | Reports | Sales and product reports, CSV streaming with formula escaping | Date-range picker, tables, CSV download | ⬜ |
| F-803 | Personalized recommendations | `/home/recommended` from order history | "Recommended for you" rail when signed in | ⬜ |

## M9 — Production readiness

| ID | Feature | Scope | Status |
|---|---|---|---|
| F-901 | End-to-end suites | Customer purchase (COD), prepaid where automatable, account flows, admin catalog/order/inventory flows | ⬜ |
| F-902 | Responsive and accessibility | 375 / 768 / 1280 / 1536 px; axe on key pages; keyboard walkthrough | ⬜ |
| F-903 | Security review | Independent review against ARCHITECTURE.md §9; `pnpm audit`; fixes | ⬜ |
| F-904 | Performance review | `explain()` on hot queries, bundle analysis, image sizes, Lighthouse on listing/detail | ⬜ |
| F-905 | Containers | Production Dockerfiles, nginx with CSP, compose for the full stack, health checks | ⬜ |
| F-906 | Deployment | Production config, Cloudinary/SMTP drivers (Q3/Q4), migrations as a release step, deployment runbook | ⬜ |
| F-907 | Operations | Log-based alerts (refunds, webhooks, jobs), backup and a tested restore drill, Razorpay go-live checklist | ⬜ |
| F-908 | Release report | Verified features, partial features, failed tests, vulnerabilities, outstanding issues, deployment readiness | ⬜ |

## External dependencies

| Needed | By | For |
|---|---|---|
| Local MongoDB replica set (Q1) | F-108 | Running the app locally |
| GitHub repository URL | F-110 | CI and remote copy of the code |
| Razorpay test keys + webhook secret (Q2) | M6 | Online payments |
| SMTP credentials (Q4) | F-906 (development uses console/Mailpit) | Production email |
| Image storage account (Q3) | F-906 (development uses local disk) | Production images |
| Legal page wording | Before go-live | Razorpay activation |

Technical risks: ARCHITECTURE.md §15.
