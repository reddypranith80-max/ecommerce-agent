# Architecture

> **Status:** Revision 2, **implemented as a demo build** · **Last updated:** 2026-11-05
> Requirements and assumptions: [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md). Endpoints: [API_DOCUMENTATION.md](API_DOCUMENTATION.md). Roadmap: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## 0. Demo build: what differs from this document

The owner asked for a demonstration with virtual money and no setup. The design below is implemented as written, with these substitutions:

| Designed | Built | Effect on the design |
|---|---|---|
| Razorpay | **DemoPay** simulator in `server/src/integrations/demopay/` with its own collections (`demopay_orders`, `demopay_payments`) standing in for the provider's side | None to the store's logic: one gateway order per store order, HMAC checkout signature verified with `timingSafeEqual`, provider fetch before recording, signed webhooks with retry, event de-duplication in the effect's transaction, refund queue with `notes.refundId` idempotency, reconciliation before expiry |
| Hosted MongoDB / Docker | `npm start` launches a single-node replica set from the `mongodb-memory-server` binary, data in `.data/db` | Transactions and validators work as designed |
| SMTP | Demo inbox (`EmailMessage` collection, 7-day TTL) | Same best-effort, after-commit sending |
| Cloudinary | Local disk storage driver | Storage keys, not URLs, are stored (D12), so a different driver is a configuration change |
| pnpm | npm workspaces | — |
| Migration runner (D20) | Validators and `syncIndexes()` applied at API start | Fine for a single instance; the runner is still needed for multi-instance production |
| Mongoose `sanitizeFilter` (D19) | Not enabled | It also neutralises the app's own operators; every route parses input with Zod, so strings cannot become query objects |
| Access-token revocation by `iat` (seconds) | `iatMs` claim (milliseconds) | Fixes tokens issued in the same second as a password reset staying valid (found by a test) |
| Playwright test runner | `playwright-core` driving the installed Microsoft Edge (`tests/e2e/walkthrough.mjs`) | No browser download |

## 1. System overview

```
                    ┌──────────────────────── Browser ─────────────────────────┐
                    │  React SPA (Vite)  ── storefront routes                  │
                    │                    ── /admin routes (lazy-loaded chunk)  │
                    │  Razorpay Checkout.js (iframe, loaded on payment step)   │
                    └──────────────┬───────────────────────────────┬───────────┘
                                   │ same origin: /  and  /api/v1  │ card/UPI data goes
                                   ▼                               │ straight to Razorpay
                    ┌──────────────────────────────┐               ▼
                    │ Reverse proxy (nginx)        │      ┌──────────────────┐
                    │  static SPA + /api → API     │      │ Razorpay         │
                    └──────────────┬───────────────┘      │  Orders/Payments │
                                   ▼                      │  Refunds API     │
                    ┌──────────────────────────────┐ ◄────┤  Webhooks        │
                    │ API: Node 24 + Express 5     │ ───► └──────────────────┘
                    │  routes → controllers →      │
                    │  services → models           │ ───► SMTP provider (email)
                    │  in-process jobs (expiry,    │ ───► Image storage
                    │  reconciliation, refunds,    │      (local disk / Cloudinary)
                    │  aggregates, media cleanup)  │
                    └──────────────┬───────────────┘
                                   ▼
                    ┌──────────────────────────────┐
                    │ MongoDB (replica set,        │
                    │ required for transactions)   │
                    └──────────────────────────────┘
```

The SPA and API are served from **one origin** (nginx in production, the Vite dev proxy in development). This keeps the refresh-token cookie first-party, removes CORS from the normal path and simplifies the Content Security Policy.

## 2. Key decisions

| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| D1 | Repository | pnpm workspace monorepo: `client`, `server`, `shared` | Two repos; no shared package | One place for docs, CI and versions. `shared` holds Zod schemas, enums, the pricing function, state machines and the permission map, so these rules exist once |
| D2 | Client state | TanStack Query for server state, Zustand for client-only state | Redux Toolkit | Server data is most of the state and belongs in Query's cache; the rest (session, guest cart, UI) fits a ~1 KB store |
| D3 | HTTP client | Small typed `fetch` wrapper | axios | One fewer dependency; handles JSON, errors, refresh-and-retry |
| D4 | Auth | 15-minute access JWT held in memory + rotating opaque refresh token in an `httpOnly` cookie; one `sessions` document per sign-in | JWT in localStorage; server sessions only | XSS cannot read either token; sessions can be revoked; refresh-token reuse is detected; multi-tab safe (§7.1) |
| D5 | JWT library | `jose` | `jsonwebtoken` | Zero dependencies, maintained, standards-complete |
| D6 | Money | Integer **paise** everywhere; formatted only in the UI | Decimal/float rupees | No rounding errors; Razorpay's API takes paise |
| D7 | Stock | Separate `inventory` collection with three counters (`available`, `reserved`, `allocated`) and an append-only `inventoryMovements` ledger; each order records its own `stockState` | Stock embedded in product variants | Atomic conditional updates on small documents; every unit is accounted for; reversals are exact |
| D8 | Consistency | Multi-document transactions for checkout, payment confirmation, cancellation, expiry and refunds, **plus** conditional updates and a collection validator that forbids negative counters. Mongoose `transactionAsyncLocalStorage` so a forgotten `{ session }` cannot escape the transaction | Conditional updates only | Several documents change together; the validator is a last line of defence |
| D9 | Payment truth | One Razorpay order per store order. Server verifies the Checkout signature **and** fetches the payment from Razorpay; webhooks and reconciliation jobs cover lost callbacks; one idempotent `recordCapturedPayment` routine. **Any captured payment that cannot move a `pending_payment` order forward is refunded automatically** | Trusting the client callback; re-reserving stock for late payments | The client can lie or disappear; customers can pay twice or after cancelling. "Always refund" is simple and never loses money |
| D10 | Refunds | Explicit `refunds` collection with its own lifecycle, written inside the transaction that decides the refund, executed by a job that is idempotent against Razorpay | Calling the Refunds API inline | A crash between deciding and calling cannot lose or duplicate a refund |
| D11 | Search | MongoDB `$text` index + word-prefix autocomplete on normalized name tokens | Atlas Search, Meilisearch, Elasticsearch | Adequate for ~10k products with no extra infrastructure; typo tolerance is a later upgrade |
| D12 | Images | `multer` (memory, small limits) → `sharp` (pixel limit, auto-rotate, strip metadata, resize, WebP) → `StorageDriver` (local disk for dev/test, Cloudinary for prod pending your answer). Documents store **storage keys**; URLs are built when responses are serialized | Uploading originals; storing absolute URLs | Re-encoding defeats malicious files and EXIF leaks; keys make switching storage a configuration change |
| D13 | Admin UI | Same SPA under `/admin`, lazy-loaded | Separate admin app | One build and design system; customers never download admin code; the API enforces access |
| D14 | Authorization | `requirePermission(...)` with a role → permissions map in `shared`; MVP roles `customer` and `admin` | A single `requireRole('admin')` | The brief asks for role-based access; adding a Staff role becomes a map change |
| D15 | Jobs | In-process scheduler: each job reschedules itself only after finishing (no overlap), and claims documents with a `jobLockedUntil` conditional update (safe across instances) | Redis + BullMQ | No Redis at target scale; claims make jobs idempotent |
| D16 | Rate limiting | `express-rate-limit`, in-memory store; generous per-IP limits (Indian mobile networks share IPs) and strict per-account limits | Redis store | Correct for one instance; store swappable later |
| D17 | Logging | `pino` + `pino-http`, JSON, request IDs, redaction | winston, morgan | Fast, structured, built-in redaction |
| D18 | Validation | Zod schemas from `shared` applied to `body`, `query`, `params`; unknown keys rejected | express-validator, Joi | One schema language on both sides; forms reuse them |
| D19 | NoSQL injection | Zod type enforcement + Mongoose `sanitizeFilter` + `strictQuery` | `express-mongo-sanitize` | That package mutates `req.query`, which is read-only in Express 5 |
| D20 | Schema management | Versioned migration runner (creates collections and validators, runs `syncIndexes`) executed on deploy and in test setup | Mongoose `autoIndex` | Mongoose does not manage `$jsonSchema` validators; production indexes must not depend on app start-up |
| D21 | Concurrent admin edits | Mongoose `optimisticConcurrency` on products, categories, coupons and settings; PATCH requests carry `version` | Last write wins | Two admins cannot silently overwrite each other |
| D22 | Testing | Vitest; Supertest + `mongodb-memory-server` replica set; Playwright from M1 (smoke test grows each milestone) | Jest; Cypress | One runner; real transactions in tests; viewports and axe in Playwright |
| D23 | UI building blocks | Tailwind CSS v4, Headless UI, lucide-react, sonner, Recharts (admin only) | MUI, Chakra | Accessible primitives without a heavy visual framework |

Versions are pinned by the lockfile at Phase 3 using current stable majors (expected: React 19, Vite 7+, Tailwind 4, React Router 7 data router, TanStack Query 5, Zustand 5, React Hook Form 7, Zod 4, Express 5, Mongoose 8.4+). Compatibility is checked before install, not assumed.

## 3. Repository layout

```
ecommerce agent/
├── client/                      React SPA  (@shop/client)
│   └── src/
│       ├── app/                 router, providers, error boundaries, layouts
│       ├── components/          ui/ (Button, Input, Modal, DataTable, Pagination, Skeleton,
│       │                        EmptyState, ErrorState, PriceTag, RatingStars…), layout/
│       ├── features/            auth, catalog, cart, wishlist, checkout, orders, account, reviews,
│       │                        admin/{dashboard,products,categories,inventory,orders,refunds,
│       │                        customers,coupons,reviews,reports,settings,audit}
│       ├── pages/               route-level components (lazy-loaded); static/ legal pages
│       ├── hooks/               cross-feature hooks
│       ├── services/            api client (fetch wrapper, refresh with Web Locks), query keys, razorpay loader
│       ├── store/               Zustand: session, guestCart, recentlyViewed, ui
│       ├── lib/                 formatting (money, dates), constants
│       └── types/               client-only types (API types come from shared)
├── server/                      Express API  (@shop/server)
│   └── src/
│       ├── config/              env schema (fail-fast), db connection, logger
│       ├── db/migrations/       versioned migrations + runner
│       ├── models/              Mongoose schemas + indexes
│       ├── controllers/         HTTP in/out only
│       ├── services/            business logic and transactions (no Express objects)
│       ├── routes/              routers per resource under /api/v1
│       ├── middleware/          authenticate, requirePermission, validate, rateLimit, upload, error, requestId
│       ├── validators/          server-only schemas; re-exports from shared
│       ├── integrations/        razorpay, mailer, storage drivers (thin wrappers, stubbed in tests)
│       ├── jobs/                scheduler, reservation expiry, payment reconciliation, refunds,
│       │                        product aggregates repair, media cleanup
│       ├── scripts/             create-admin, seed, migrate
│       └── utils/               AppError, pagination, crypto, serializers, CSV
├── shared/                      @shop/shared: schemas, enums, DTO types, pricing, state machines, permissions
├── tests/e2e/                   Playwright specs
├── docs/                        REQUIREMENTS.md, decisions/, runbooks/
├── docker/                      nginx.conf, mongo replica-set init
├── .github/workflows/ci.yml
├── docker-compose.yml
├── pnpm-workspace.yaml · package.json · tsconfig.base.json · eslint.config.js · .prettierrc
└── CLAUDE.md · PROJECT_STATUS.md · IMPLEMENTATION_PLAN.md · ARCHITECTURE.md · API_DOCUMENTATION.md · README.md
```

Deviations from the layout in the brief: `shared/` (D1), `server/src/{db,integrations,jobs,scripts}` (migrations, third-party calls and background work kept out of request services), `client/src/{app,lib}`. Server files are named by domain (`order.model.ts`, `order.service.ts`, `order.controller.ts`, `order.routes.ts`) so a feature is easy to find across layered folders.

## 4. Backend design

**Request lifecycle:** `requestId` → `pino-http` → `helmet` → (`cors` only if a separate client origin is configured) → body parsers (`express.raw` for the webhook route only, `express.json({ limit: '100kb' })` elsewhere) → `cookie-parser` → route → `rateLimit` → `authenticate` / `optionalAuth` → `requirePermission` → `validate(schemas)` → controller → service → error handler.

- **Layers.** Controllers never touch Mongoose; services never touch `req`/`res`. Services receive an explicit `actor` (`{ type, id, permissions }`) for authorization-relevant logic and audit logging.
- **Validation output.** Express 5 makes `req.query` read-only, so parsed input is placed on `req.valid = { body, query, params }`.
- **Errors.** `AppError(code, httpStatus, message, details?)`. The handler maps Zod errors to 400, `CastError` to 400, duplicate keys to 409 (except where a service handles them, such as idempotency keys), optimistic-concurrency failures to `409 STALE_VERSION`, and anything unknown to a generic 500 (stack logged, never returned). Every error includes the `requestId`.
- **Serialization.** Explicit serializers per audience (`toPublicUser`, `toCustomerOrder`, `toAdminOrder`…). Raw documents are never sent. Image URLs are built from storage keys here.
- **Configuration.** `config/env.ts` parses `process.env` with Zod and exits with a readable message if anything is missing or malformed.
- **Transactions.** `withTransaction(fn)` wraps `session.withTransaction` (retries transient errors). `transactionAsyncLocalStorage` is enabled. External calls never run inside a transaction.
- **Post-commit work.** Emails, product aggregate recomputation and refund execution run after commit. Each has a job-based fallback, so a crash after commit delays them but does not lose them (aggregates: nightly repair; refunds: refund job; email: best effort, logged).
- **Health.** `GET /api/v1/health/live` and `GET /api/v1/health/ready` (database ping).
- **Shutdown.** On SIGTERM/SIGINT: stop accepting connections, stop scheduling jobs, wait for in-flight work (10 s cap), close Mongo.

## 5. Frontend design

- **Routing.** React Router data router, lazy pages, route error boundaries, `RequireAuth` / `RequirePermission` guards (UX only; the API enforces access).
- **URL is state** for listings: `/products?category=shoes&minPrice=50000&sort=price_asc&page=2`.
- **Server state** via TanStack Query with a query-key factory per feature and precise invalidation.
- **Session.** Access token and user live in memory (Zustand). On load the app calls `/auth/refresh`. Refreshes are serialized across tabs with the Web Locks API; the tab that refreshes shares the new access token with the others over `BroadcastChannel`, so tabs never race on the refresh cookie. The fetch wrapper refreshes once on `401 TOKEN_EXPIRED` and retries.
- **Guest cart** persists to `localStorage` (try/catch), is priced through `POST /cart/preview`, and merges via `POST /cart/merge` after sign-in.
- **Forms.** React Hook Form + `zodResolver` with the shared schemas; server field errors map back onto fields.
- **States.** Every data view renders loading (skeleton), empty, error (with retry) and success states through a shared `QueryState` component; mutations show toasts and disable their buttons while pending.
- **Design system.** Tailwind v4 theme tokens as CSS variables; primitives in `components/ui`; mobile-first; images with explicit dimensions, lazy loading and `srcset`.
- **Payments.** Razorpay `checkout.js` loads only on the payment step; its `timeout` is the remaining payment window.
- **Recently viewed** products are kept client-side and shown on the home and product pages.
- **SEO.** Per-route `<title>`/meta (React 19 document metadata), `/sitemap.xml`, semantic markup. Legal pages are static content in the client.

## 6. Data model

Conventions: `timestamps: true` everywhere; money in integer paise; references are `ObjectId`; enums and transition tables come from `shared`. **Snapshot** = a deliberate copy so history does not change when the source changes. Partial unique indexes filter with `{ field: { $type: 'string' } }` (not `$exists`, which also matches `null`), and optional fields are left unset rather than stored as `null`.

```
users 1──* sessions         users 1──* addresses        users 1──1 carts      users 1──* wishlistItems *──1 products
categories 1──* categories (parent)        categories 1──* products
products 1──* inventory (one per variant SKU) 1──* inventoryMovements
users 1──* orders 1──* payments 1──* refunds          orders *──0..1 coupons (via couponRedemptions)
products 1──* reviews *──1 users                      users(admin) 1──* auditLogs
```

### users
| Field | Type / rule |
|---|---|
| name | string, 2–80 |
| email | lowercase, trimmed, **unique** |
| passwordHash | bcrypt cost 12, `select: false` |
| phone | `+91` + 10 digits, optional on the account (addresses carry their own phone) |
| role | `customer` \| `admin` |
| status | `active` \| `blocked` |
| tokensValidAfter | Date; access tokens with an earlier `iat` are rejected (set on password change/reset and block) |
| passwordChangedAt, lastLoginAt | Date |

Indexes: `{ email: 1 }` unique · `{ role: 1, createdAt: -1 }` · text `{ name, email }` for admin search.

### sessions (one document per sign-in, i.e. per refresh-token family)
`userId`, `currentHash` **unique** (SHA-256 of the current 32-byte refresh token), `previousHash`, `previousValidUntil` (30-second grace after rotation), `expiresAt` (customers: 30 days sliding, 90 days absolute; admins: 12 hours absolute), `absoluteExpiresAt`, `lastUsedAt`, `revokedAt`, `userAgent`, `ip`.
Indexes: `{ currentHash: 1 }` unique · `{ previousHash: 1 }` · `{ userId: 1 }` · `{ expiresAt: 1 }` TTL.

### passwordResetTokens
`userId`, `tokenHash` **unique**, `expiresAt` (30 min, TTL), `usedAt`.

### addresses
`userId`, `label`, `fullName`, `phone` (required), `line1`, `line2`, `landmark`, `city`, `state` (enum of Indian states and union territories), `postalCode` (`^[1-9][0-9]{5}$`), `country: 'IN'`, `isDefault`.
Indexes: `{ userId: 1 }` · partial unique `{ userId: 1 }` where `isDefault: true`. Changing the default unsets the old one and sets the new one in one transaction; deleting the default promotes the most recently updated address. Max 10 per user.

### categories
`name`, `slug` **unique**, `description`, `imageKey`, `parentId`, `ancestors: ObjectId[]`, `depth` (0–2), `sortOrder`, `isActive`.
Indexes: `{ slug: 1 }` unique · `{ parentId: 1, sortOrder: 1 }` · `{ ancestors: 1 }`.
Rules: a category with children or products cannot be deleted or moved to another parent (MVP); renaming and reordering are always allowed.

### products
| Field | Type / rule |
|---|---|
| name, slug (**unique**), description (plain text ≤ 5,000), brand, tags[] | strings |
| searchTokens[] | lowercase, accent-stripped words of name and brand (word-prefix autocomplete) |
| categoryId, categoryPath[] | primary category and its ancestors + itself |
| images[] | `{ mediaId, key, alt, width, height }`, max 10, first is primary |
| options[] | `{ name, values[] }`, max 3 |
| variants[] | `{ _id, sku, optionValues: { Size: 'M' }, price, compareAtPrice?, isActive }`, 1–100; SKUs unique within the product (Zod) and across products (index + `inventory.sku` unique) |
| hsnCode?, gstRate? | stored now for future GST invoices; `gstRate` falls back to the store default |
| status | `draft` \| `active` \| `archived` |
| isFeatured, everOrdered | booleans; `everOrdered` set on first order, decides archive-vs-delete |
| **aggregates** | `priceMin`, `priceMax`, `maxDiscountPct`, `stockStatus` (`in_stock` \| `low_stock` \| `out_of_stock`), `ratingAvg`, `ratingCount`, `soldCount90d`, `publishedAt` |

All aggregates are written by one function, `recomputeProductAggregates(productIds)`, called after commit by every writer and by a nightly repair job. It is never called inside the checkout transaction, so orders for sibling variants do not contend on the product document.
Indexes: `{ slug: 1 }` unique · `{ 'variants.sku': 1 }` unique · text `{ name: 10, brand: 5, tags: 5, description: 1 }` · `{ searchTokens: 1 }` · `{ status: 1, publishedAt: -1 }` · `{ status: 1, soldCount90d: -1 }` · `{ status: 1, ratingAvg: -1 }` · `{ status: 1, priceMin: 1 }` (serves both price sorts) · `{ status: 1, maxDiscountPct: -1 }` · `{ status: 1, isFeatured: 1, publishedAt: -1 }` · the same four sorts prefixed with `categoryPath`: `{ status: 1, categoryPath: 1, publishedAt: -1 }`, `{ status: 1, categoryPath: 1, soldCount90d: -1 }`, `{ status: 1, categoryPath: 1, priceMin: 1 }`, `{ status: 1, categoryPath: 1, ratingAvg: -1 }`. Each is checked with `explain()` against seeded data; unused ones are dropped.
Rules: SKU immutable; ordered variants are deactivated, not removed; `everOrdered` products are archived, not deleted; `compareAtPrice > price` when present. Admin edits while stock is reserved are allowed: prices apply to future orders only, and deactivating a variant does not affect orders already placed.

### inventory (one document per SKU)
| Counter | Meaning | Changes |
|---|---|---|
| `available` | Can be sold | − on order placement; + on restock, release, cancellation, undelivered return |
| `reserved` | Held by `pending_payment` orders | + on online order placement; − on payment, expiry, cancellation |
| `allocated` | Sold, not yet shipped | + on payment (online) or placement (COD); − on shipment or cancellation |

Physical stock in the warehouse = `available + reserved + allocated`, which can be checked against a physical count. Also `lowStockThreshold` and `isLowStock` (set by `recomputeProductAggregates`).
Indexes: `{ sku: 1 }` unique · `{ productId: 1 }` · `{ isLowStock: 1, available: 1 }`.
**Collection validator:** all three counters are integers ≥ 0. Every decrement is also conditional (`{ sku, available: { $gte: qty } }`), so an oversell matches zero documents instead of going negative.

### inventoryMovements (append-only)
`sku`, `productId`, `type`, `delta: { available, reserved, allocated }`, `orderId?`, `actorId?`, `reason?`, `createdAt`.

| type | available | reserved | allocated | When |
|---|---|---|---|---|
| `initial`, `restock` | + | | | Product creation, goods received |
| `adjustment` | ± | | | Count corrections, damage (reason required) |
| `reserve` | − | + | | Online order placed |
| `release` | + | − | | Unpaid order expired or cancelled |
| `allocate` | | − | + | Online payment captured |
| `allocate_direct` | − | | + | COD order placed |
| `deallocate` | + | | − | Confirmed or processing order cancelled |
| `ship` | | | − | Order shipped |
| `return_restock` | + | | | Undelivered order returned to the warehouse |

Indexes: `{ sku: 1, createdAt: -1 }` · `{ orderId: 1 }`.

### carts
`userId` **unique**, `items[]: { _id, productId, variantId, sku, quantity (1–10), addedAt, unitPriceAtAdd }`, max 50 lines. `unitPriceAtAdd` only drives a non-blocking "price changed" notice; it is updated when the customer views a quote. Purchased lines are removed when the order is confirmed (COD: at placement; online: at payment), not when it is placed, so an abandoned payment does not lose the cart.

### wishlistItems
`userId`, `productId`, `createdAt`. Indexes `{ userId: 1, productId: 1 }` unique · `{ userId: 1, createdAt: -1 }`. Max 200 per user.

### orders
| Field | Type / rule |
|---|---|
| orderNumber | `ORD-YYMMDD-XXXXXX` (6 random Crockford base32 characters), **unique**, regenerated on collision |
| userId, customer | ref + snapshot `{ name, email, phone }` (admin search without a join) |
| items[] (snapshot) | `{ productId, variantId, sku, name, variantLabel, imageKey, unitPrice, compareAtPrice, quantity, lineSubtotal, discountShare, lineTotal, hsnCode, gstRate }` |
| shippingAddress | snapshot |
| pricing | `{ subtotal, discount, shippingFee, total, currency: 'INR', taxInclusive: true }` |
| coupon | `{ couponId, code, discount }` or unset |
| paymentMethod | `razorpay` \| `cod` |
| razorpayOrderId | one per store order, reused for every payment attempt |
| status | see §8 |
| paymentStatus | `unpaid` \| `paid` \| `refund_pending` \| `partially_refunded` \| `refunded` \| `refund_failed` |
| stockState | `reserved` \| `allocated` \| `shipped` \| `released` \| `restocked` \| `written_off` — what this order currently holds, so reversals are exact |
| statusHistory[] | `{ status, at, actor: { type: 'customer' \| 'admin' \| 'system', id? }, note? }` |
| fulfilment | `{ carrier, trackingNumber, trackingUrl, undeliveredReason? }` |
| timestamps | `confirmedAt`, `paidAt`, `processingAt`, `shippedAt`, `deliveredAt`, `cancelledAt`, `expiredAt`, `undeliveredAt`, `refundedAt` |
| reservationExpiresAt | payment window end while `pending_payment` |
| reconcileUntil | set to +72 h when an online order is cancelled or expires; the reconciliation job checks Razorpay until then |
| jobLockedUntil | job claim |
| needsReview | `{ reason, at }` (for example the customer was blocked with an open COD order) |
| cancellation | `{ reason, actorType, actorId? }` |
| idempotencyKey, requestHash | duplicate-submit protection |

`discountShare` allocates the coupon discount across lines (proportional, floor, remainder to the largest line), stored now so partial refunds later need no migration.
Indexes: `{ orderNumber: 1 }` unique · `{ userId: 1, createdAt: -1 }` · `{ status: 1, createdAt: -1 }` · `{ paymentStatus: 1, createdAt: -1 }` · `{ 'customer.email': 1 }` · partial unique `{ razorpayOrderId: 1 }` · partial `{ reservationExpiresAt: 1 }` where `status: 'pending_payment'` · partial `{ reconcileUntil: 1 }` · partial unique `{ userId: 1, idempotencyKey: 1 }` · `{ userId: 1, 'items.productId': 1, status: 1 }` (review eligibility) · `{ confirmedAt: 1 }`, `{ paidAt: 1 }`, `{ refundedAt: 1 }` partial (reports) · partial `{ needsReview: 1 }`.

### payments (one document per Razorpay payment, or per COD collection)
`orderId`, `userId`, `provider` (`razorpay` \| `cod`), `providerPaymentId` (`pay_…`), `razorpayOrderId`, `amount`, `currency`, `method`, `status`, `capturedAt`, `error: { code, description, reason, source, step }`, `disposition` (`applied` — moved the order to paid; `refund_required` — captured but could not apply, see D9), `refundedAmount`.
Status only moves forward along the table in `shared`: `created → authorized → captured → partially_refunded → refunded`; `created/authorized → failed`. A late `payment.failed` for a captured payment is ignored and logged.
Indexes: `{ orderId: 1 }` · partial unique `{ providerPaymentId: 1 }` · `{ razorpayOrderId: 1 }`.

### refunds
`orderId`, `paymentId`, `providerPaymentId`, `amount`, `reason` (`order_cancelled` \| `undelivered` \| `late_payment` \| `duplicate_payment` \| `manual`), `source` (`system` \| `admin` \| `razorpay_dashboard`), `status` (`requested` → `initiated` → `processed` \| `failed`), `providerRefundId`, `attempts`, `lastError`, `requestedAt`, `initiatedAt`, `processedAt`, `jobLockedUntil`.
Indexes: `{ status: 1, jobLockedUntil: 1 }` · `{ orderId: 1 }` · partial unique `{ providerRefundId: 1 }`.

### webhookEvents
`provider`, `eventId` **unique** (`x-razorpay-event-id`), `type`, `receivedAt`, `outcome`. Inserted **in the same transaction as the event's effect**, so a failed handler leaves no record and the redelivery is processed. TTL 90 days.

### coupons
`code` (`^[A-Z0-9-]{3,20}$`) **unique**, `description`, `type` (`percentage` \| `fixed`), `value`, `maxDiscount?`, `minOrderValue`, `startsAt`, `endsAt`, `usageLimit?`, `perUserLimit` (default 1), `usedCount`, `isActive`, `createdBy`, `version`.
Indexes: `{ code: 1 }` unique · `{ isActive: 1, endsAt: 1 }`. Used coupons are deactivated, not deleted; `code`, `type` and `value` are locked once used.

### couponRedemptions
`couponId`, `userId`, `orderId` **unique**, `discount`, `status` (`active` \| `released`). Released when an order expires or is cancelled before shipment; kept for delivered and undelivered orders.
Index `{ couponId: 1, userId: 1, status: 1 }` · `{ couponId: 1, createdAt: -1 }` (admin usage list).

### reviews
`productId`, `userId`, `orderId`, `rating` (1–5), `title` (≤ 120), `body` (≤ 2,000), `status` (`published` \| `hidden`), `moderatedBy?`, `moderatedAt?`.
Indexes: `{ productId: 1, userId: 1 }` unique · `{ productId: 1, status: 1, createdAt: -1 }` · `{ status: 1, createdAt: -1 }`. Ratings are recomputed by aggregation on every review change.

### media
`key`, `width`, `height`, `bytes`, `uploadedBy`, `attachedTo?`. Removing an image from a product or category detaches it; a cleanup job deletes unattached media older than 24 hours from storage and the database.

### settings (single document, `_id: 'store'`, optimistic concurrency)
`storeName`, `supportEmail`, `supportPhone`, `codEnabled`, `codMaxOrderValue`, `codMaxOpenOrders`, `shippingFlatFee`, `freeShippingThreshold`, `paymentWindowMinutes` (15), `paymentGraceMinutes` (10), `defaultLowStockThreshold`, `defaultGstRate`, `homepage: { hero: { title, subtitle, imageKey, ctaLabel, ctaHref }, banners: [{ title, imageKey, href }] (max 3) }`.

### auditLogs
`actorId`, `action`, `entityType`, `entityId`, `changes`, `ip`, `createdAt`. Indexes `{ entityType: 1, entityId: 1, createdAt: -1 }` · `{ actorId: 1, createdAt: -1 }` · `{ createdAt: -1 }`.

### migrations
`version`, `name`, `appliedAt` — written by the migration runner (D20).

**On "normalized" schemas in MongoDB:** independent entities are separate collections linked by reference. Data that must not change after the fact is snapshotted into the order. A few aggregates are denormalized onto products for listing filters and sorts; one function writes them and a nightly job repairs drift.

## 7. Critical flows

### 7.1 Sign-in, refresh and revocation
1. `POST /auth/login` → per-IP (generous) and per-email (strict) rate limits → user looked up; for a missing user a dummy bcrypt comparison runs so timing does not reveal account existence → blocked users are told so only after a correct password.
2. Issue an access JWT (`sub`, `role`, `sid`, `iat`, `iss`, `aud`, 15 min, HS256) and a refresh token (32 random bytes; only the hash is stored). Cookie `rt`: `httpOnly`, `Secure` in production, `SameSite=Strict`, `Path=/api/v1/auth`.
3. `POST /auth/refresh` (requires `X-Requested-With: fetch` and an allowed `Origin`):
   - token matches `currentHash` → rotate (`previousHash = currentHash`, new `currentHash`, `previousValidUntil = now + 30 s`), set the new cookie;
   - token matches `previousHash` within the grace window → issue an access token **without** rotating or setting a cookie (the browser already holds the successor);
   - token matches `previousHash` after the grace window → reuse detected → revoke the session;
   - otherwise → `401 INVALID_REFRESH_TOKEN`.
   Clients serialize refreshes across tabs with Web Locks, so the grace path is a safety net, not the normal path.
4. `authenticate` verifies the JWT and loads the user: blocked users and tokens issued before `tokensValidAfter` are rejected, and role changes apply immediately.
5. Logout revokes the session. Password change/reset and blocking revoke every session and set `tokensValidAfter = now`.

### 7.2 Pricing (one function in `shared`, used by cart, quote and order placement)
1. `lineSubtotal = unitPrice × quantity`; `subtotal = Σ lineSubtotal`.
2. Coupon: eligible if active, within its window, `subtotal ≥ minOrderValue`, under its global and per-customer limits. Percentage: `floor(subtotal × value / 100)` capped at `maxDiscount`; fixed: `value`. The discount is capped so that `subtotal − discount ≥ 100` (₹1, Razorpay's minimum).
3. Allocate the discount across lines (`discountShare`).
4. `itemsTotal = subtotal − discount`. Shipping is free if `itemsTotal ≥ freeShippingThreshold`, otherwise `shippingFlatFee`.
5. `total = itemsTotal + shippingFee`.
6. COD is available if enabled, `total ≤ codMaxOrderValue` and the customer has fewer than `codMaxOpenOrders` open COD orders.

### 7.3 Place order
1. While the customer reviews the order, the client calls `POST /checkout/quote` (lines, issues, warnings such as price changes, coupon result, totals, COD eligibility).
2. The client calls `POST /orders` with `Idempotency-Key` (UUID created when the checkout page opens) and `expectedTotal`. `POST /orders` is rate-limited per user.
3. Existing order for this user + key → return it (or `422 IDEMPOTENCY_KEY_REUSED` if the payload hash differs). A duplicate-key error from a concurrent identical request is resolved the same way.
4. In one transaction:
   1. Recompute everything from the database with the pricing function; validate address ownership, COD eligibility, coupon.
   2. `total ≠ expectedTotal` → abort with `409 PRICE_CHANGED` and the new quote.
   3. If the customer already has a `pending_payment` order, cancel it (release its reservation and coupon). An in-flight payment on it will be refunded automatically if it is later captured (D9).
   4. Stock, per line: online → `available −qty, reserved +qty` (`reserve`); COD → `available −qty, allocated +qty` (`allocate_direct`), each conditional on `available ≥ qty`. Zero matched → abort with `409 OUT_OF_STOCK` naming the SKUs.
   5. Coupon: conditional `usedCount` increment, per-user count check, redemption insert. Every redemption writes the coupon document, so concurrent redemptions of one coupon conflict and retry, which makes the per-user check safe.
   6. Insert the order: online → `pending_payment`, `stockState: reserved`, `reservationExpiresAt = now + paymentWindowMinutes`; COD → `confirmed`, `stockState: allocated`, `confirmedAt`; set `everOrdered` on the products. COD also removes the purchased lines from the cart.
   7. Insert inventory movements.
5. After commit: recompute product aggregates. Online → create the Razorpay order (`amount`, `currency`, `receipt: orderNumber`, `notes.orderId`) and save `razorpayOrderId`; if Razorpay is unreachable, respond `201` with `payment: null` and `paymentError`, and the client offers **Retry payment** (`POST /orders/:orderNumber/payment`, which creates the Razorpay order if it is missing or returns the existing one). COD → confirmation email.

### 7.4 Record a captured payment (`recordCapturedPayment`, idempotent)
Entry points: `POST /payments/razorpay/verify` (Checkout success handler), webhooks `payment.captured` and `order.paid`, and both reconciliation jobs.
1. Authenticate the source. Verify endpoint: HMAC-SHA256(`razorpay_order_id|razorpay_payment_id`, key secret) compared with `crypto.timingSafeEqual`, and the Razorpay order must belong to this customer's order. Webhooks: HMAC of the **raw body** with the webhook secret.
2. Fetch the payment from Razorpay: `order_id`, `amount`, `currency` must match the order. Status `authorized` → capture it (auto-capture is expected, A9); `captured` → continue.
3. Transaction:
   1. Upsert the `payments` document by `providerPaymentId`, moving status forward only.
   2. If the order is `pending_payment`: order → `confirmed`, `paymentStatus: paid`, `paidAt`, `confirmedAt`, `stockState: allocated`; inventory `reserved −qty, allocated +qty` (`allocate`); remove purchased lines from the cart; `disposition: applied`.
   3. Otherwise (order expired, cancelled, or already paid by another payment): `disposition: refund_required`, insert a `refunds` record (`reason: late_payment` or `duplicate_payment`), and flag the customer notification.
   4. For webhooks, insert the `webhookEvents` record.
4. After commit: recompute aggregates; send the confirmation or "your payment is being refunded" email; nudge the refund job.

`payment.failed` records the failure on the payment document (forward-only) and leaves the order in `pending_payment` so the customer can retry against the same Razorpay order.

### 7.5 Payment window, expiry and reconciliation (jobs)
- **Payment window.** The customer sees a 15-minute countdown. New Checkout openings are refused in the last 2 minutes (`409 PAYMENT_WINDOW_CLOSED`). After the window, the order page shows "checking payment status".
- **Expiry job (every minute).** Claims orders with `status: 'pending_payment'` and `reservationExpiresAt + paymentGraceMinutes < now`. For each: fetch the Razorpay order's payments → a captured payment → `recordCapturedPayment`; otherwise a transaction sets `expired`, `expiredAt`, `stockState: released`, releases the reservation (`release`) and the coupon redemption, and sets `reconcileUntil = now + 72 h`.
- **Reconciliation job (every 5 minutes).** For orders with `reconcileUntil > now`, fetch their Razorpay payments; any captured payment not yet recorded goes through `recordCapturedPayment` (and is therefore refunded).
- **Refund job (every minute).** See §7.6.
- **Aggregates repair (nightly).** Recomputes product aggregates (including `soldCount90d`) for all products.
- **Media cleanup (hourly).**
- All jobs reschedule only after finishing and claim documents with `jobLockedUntil`, so they never overlap on one instance and never double-process across instances.

### 7.6 Cancellation, undelivered orders and refunds
- **Cancellation** (allowed by §8). One transaction: status `cancelled`, `cancelledAt` → stock reversed according to `stockState` (`reserved` → `release`; `allocated` → `deallocate`) → `stockState` updated → coupon redemption released → online orders get `reconcileUntil` → paid orders get `paymentStatus: refund_pending` and a `refunds` record (`requested`).
- **Undelivered** (`shipped → undelivered`, admin, reason `returned_to_origin` \| `refused` \| `lost_in_transit`). Transaction: `undeliveredAt`; returned or refused → `return_restock` and `stockState: restocked`; lost → `stockState: written_off` (no restock). Prepaid → refund requested; COD stays `unpaid`.
- **Refund job.** Claims `requested` refunds. Before creating a refund, it lists the payment's existing refunds on Razorpay and looks for one whose `notes.refundId` equals this record's ID (so a crash after the API call does not refund twice); otherwise it creates the refund with that note. → `initiated`. Webhook `refund.processed` → `processed`, `payments.refundedAmount` and the order's `paymentStatus` (`refunded` or `partially_refunded`) and `refundedAt` updated. `refund.failed` or a terminal API error → `failed`, order `paymentStatus: refund_failed`, shown on the admin attention panel with **Retry**. Refunds created in the Razorpay Dashboard arrive as `refund.processed` for an unknown refund and are recorded with `source: razorpay_dashboard`.
- Payments that are authorized but never captured cannot be refunded through the Refunds API; with auto-capture they become captured and follow the path above. (Razorpay's behaviour for uncaptured authorizations is to be confirmed in the sandbox run, F-608.)

### 7.7 Image upload
`POST /admin/media` (multipart, ≤ 10 files, ≤ 5 MB each) → files processed **one at a time** with `sharp` (`limitInputPixels` ≈ 40 MP, concurrency 1) → anything that is not JPEG/PNG/WebP/AVIF is rejected regardless of extension or declared type → auto-rotate, strip metadata, resize to max 1600 px plus a 400 px thumbnail, encode WebP → `StorageDriver.put` → `media` document → IDs, keys and URLs returned.

### 7.8 Blocking a customer
Admins can block customers only (not other admins or themselves). One transaction: `status: blocked`, `tokensValidAfter = now`, sessions revoked, `pending_payment` orders cancelled, open COD orders flagged `needsReview` for an admin decision.

## 8. Order state machine

| From | To | Who | Side effects |
|---|---|---|---|
| — | `pending_payment` | customer (online) | `reserve` |
| — | `confirmed` | customer (COD) | `allocate_direct`; cart lines removed; email |
| `pending_payment` | `confirmed` | system (payment captured) | `allocate`; cart lines removed; email |
| `pending_payment` | `expired` | system (window + grace passed, no payment found) | `release`; coupon released |
| `pending_payment` | `cancelled` | customer, admin, system (newer order placed, customer blocked) | `release`; coupon released |
| `confirmed` | `processing` | admin | — |
| `confirmed` | `cancelled` | customer, admin | `deallocate`; coupon released; refund if paid |
| `processing` | `shipped` | admin (carrier + tracking number required) | `ship`; email |
| `processing` | `cancelled` | admin | `deallocate`; coupon released; refund if paid |
| `shipped` | `delivered` | admin | COD → `paymentStatus: paid` + COD payment record; email; reviews unlocked |
| `shipped` | `undelivered` | admin (reason required) | restock or write-off; refund if prepaid |

Every other transition is rejected with `409 INVALID_STATUS_TRANSITION`. Payment captures that arrive for an order in any state other than `pending_payment` are refunded (§7.4). The table lives in `shared` and drives the API checks and which buttons the admin UI shows. Returns after delivery are post-MVP (handled as manual refunds in the Razorpay Dashboard, which the system records).

## 9. Security controls

| Threat | Control |
|---|---|
| Credential stuffing, brute force | Per-IP limits sized for shared mobile IPs (e.g. 100 login attempts / 15 min) plus strict per-email limits (10 / 15 min), keyed by the submitted email whether or not it exists; bcrypt cost 12. No hard account lockout (it would let anyone lock a customer out) |
| bcrypt 72-byte truncation | Passwords limited to 8–72 bytes in the shared schema |
| User enumeration | Login and forgot-password give identical responses and timing. **Accepted leak:** registration reports `EMAIL_TAKEN` (standard UX); rate-limited, and removable later with email-verification-first sign-up |
| Token theft via XSS | No tokens in web storage; access token in memory; refresh token `httpOnly` |
| CSRF | `SameSite=Strict` cookie scoped to `/api/v1/auth`; custom header and `Origin` check on cookie-authenticated endpoints; everything else uses the `Authorization` header |
| Session revocation | Sessions collection; user loaded per request; `tokensValidAfter`; admin sessions capped at 12 hours |
| Broken access control / IDOR | Customer queries scoped by `userId`; admin routers behind `requirePermission`; an authorization test for every route |
| Mass assignment | Zod schemas list allowed fields; `role`, `status`, prices and counters never accepted from customer input |
| Price tampering | Totals computed on the server; the client sends IDs, quantities and a coupon code only |
| Payment forgery | Signature verification (constant-time), provider fetch with amount/currency/order match, webhook signature over the raw body, event de-duplication inside the effect's transaction |
| Checkout abuse (stock hoarding) | One open unpaid order per customer; open-COD-order cap; COD limit; per-user rate limits on order placement and payment retries |
| NoSQL injection | Zod types, `sanitizeFilter`, `strictQuery`; no user input in `$where` or raw pipeline stages |
| XSS | React escaping; no `dangerouslySetInnerHTML`; plain-text descriptions; CSP |
| Malicious uploads | Re-encoding, pixel limit, sequential processing, size/count limits, generated keys |
| Spreadsheet formula injection | CSV cells beginning with `=`, `+`, `-`, `@`, tab or carriage return are prefixed with `'` |
| Token leakage in logs | Reset tokens travel in the URL fragment (`/reset-password#token=…`), which browsers never send to servers |
| Security headers | `helmet` on the API; nginx CSP allowing self plus the Razorpay hosts observed in the sandbox run, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'` |
| Sensitive data in logs | pino redaction paths for `authorization`, `cookie`, `password`, `currentPassword`, `newPassword`, `token`, `accessToken`, `razorpaySignature`, `razorpay_signature` |
| Information leakage | Generic 500 messages; explicit serializers |
| Denial of service | Body limit 100 KB; capped page sizes; `maxTimeMS` on queries; upload limits; rate limits on search and suggestions |
| Dependencies | Lockfile, `pnpm audit` in CI, minimal dependency set |
| IP spoofing behind proxies | `trust proxy` set to the exact proxy count |

## 10. Performance and scalability

- Listing: one indexed query plus `countDocuments` in parallel; card-field projections; `maxTimeMS` everywhere.
- Product page: product, inventory and first page of reviews fetched in parallel.
- `/home` (not personalized) and catalog GETs: `Cache-Control: public, max-age=60, stale-while-revalidate=300`. Personalized endpoints (`/home/recommended`, cart, account): `private, no-store`.
- Client: route-level code splitting; admin chunk separate; lazy images at fixed dimensions; tuned `staleTime`.
- **Known limits and upgrade paths:** offset pagination (cursor pagination beyond ~10k results) · `$text` search (Atlas Search) · in-memory rate limits (Redis store) · in-process jobs (separate worker; logic is already claim-based) · analytics on raw orders (daily roll-ups) · hot coupons serialize their redemptions (sharded counters) · `sharp` on the API CPU (worker).

## 11. Testing strategy

| Level | Tooling | Covers |
|---|---|---|
| Unit | Vitest | Pricing function (ordering, caps, rounding, ₹1 minimum), discount allocation, state machines (order, payment, refund), permission map, signature verification, CSV escaping |
| API integration | Supertest + `mongodb-memory-server` replica set | Every endpoint: success, validation, unauthenticated, missing permission, another user's resource |
| Concurrency | Same | Parallel orders for the last unit (exactly one wins, counters never negative); parallel single-use coupon redemptions; verify callback vs webhook; duplicate idempotency keys; two jobs claiming the same order; two tabs refreshing |
| Payments and refunds | Signed fixtures; Razorpay HTTP stubbed at the integration boundary | Bad signatures, amount mismatch, duplicate and out-of-order webhooks, capture after cancel/expiry, second payment on a paid order, refund crash-recovery, dashboard refunds |
| Payment sandbox | Real Razorpay test mode via a tunnel | Prepaid purchase, failure and retry, cancellation refund, late payment refund; CSP host list captured |
| Client components | Vitest + React Testing Library | Forms, cart stepper, variant picker, query states, refresh single-flight |
| End-to-end | Playwright (set up in M1, extended every milestone) | Register → browse → cart → COD checkout → history; admin catalog/orders/inventory; 375/768/1280/1536 px; axe |

Target ≥ 80% line coverage on `server/src/services` and `shared`. CI runs lint, typecheck, migrations, unit/integration tests, build and the Playwright suite.

## 12. Environments and deployment

- **Development:** Vite proxying `/api` and `/sitemap.xml` to the API on port 4000; MongoDB single-node replica set (per Q1); console or Mailpit email; webhooks via a tunnel when testing payments.
- **Test:** in-memory replica set; migrations applied in global setup; Razorpay, SMTP and storage stubbed.
- **Production:** `server` image (multi-stage, `node:24-slim`, non-root, `pnpm deploy --prod`; runs migrations as a release step before starting) and `web` image (`nginx:alpine`, SPA fallback, gzip, immutable hashed assets, CSP, `/api` proxy). MongoDB Atlas or a self-hosted replica set with backups. TLS at the platform or a Caddy/nginx edge. Staging with Razorpay test keys recommended.
- **Configuration:** environment variables only, validated at start-up; `.env.example` documents each; secrets in the platform's secret store.
- **Operations:** health checks; JSON logs to stdout; an admin **attention panel** (refunds failed or stuck, orders needing review, webhook processing failures, low stock); log-based alerts on the same conditions; runbooks for refunds, webhook outages, backup restore (with a tested restore drill) and the Razorpay go-live checklist (live keys, webhook URL and secret, auto-capture setting, policy pages).

## 13. Design review: what the first draft got wrong (self-review)

| # | First-draft choice | Problem | Revision | Trade-off accepted |
|---|---|---|---|---|
| R1 | Stock on each variant, taken when payment succeeds | Two customers can pay for the last unit; no history | Reserve at placement in `inventory` with a ledger | Abandoned checkouts hold stock for the payment window |
| R2 | Trust the browser's "payment succeeded" | Forgeable, or never sent | Signature + provider fetch + webhooks + reconciliation | More moving parts; tunnel needed in development |
| R3 | JWT in `localStorage` | Readable by XSS; not revocable | Memory access token + rotating `httpOnly` refresh cookie | Refresh request on page load; same-site deployment |
| R4 | Stateless JWT checks only | Blocked users keep access | Load the user per request | One indexed read per request |
| R5 | Decimal rupees | Rounding errors | Integer paise | Formatting helper everywhere |
| R6 | One order `status` | Mixes payment and fulfilment | Separate `status`, `paymentStatus`, `stockState` | More fields to filter on |
| R7 | Check coupon usage, then increment | Exceeds limits under concurrency | Conditional increment in the order transaction | Hot coupons serialize |
| R8 | No double-submit protection | Duplicate orders | `Idempotency-Key` + unique index | Client keeps a key per checkout |
| R9 | Wishlist array on the user | Unbounded, hard to paginate | `wishlistItems` collection | One more collection |
| R10 | Hard deletes | Breaks history | Archive/deactivate referenced records | Status filters in admin lists |
| R11 | `express-mongo-sanitize` | Breaks on Express 5 | Zod + `sanitizeFilter` | Every route declares schemas |
| R12 | Redux Toolkit, axios, date library | Weight without benefit | Zustand, fetch wrapper, `Intl` | Small hand-written refresh logic |
| R13 | Separate admin app | Duplicated setup | One SPA, admin lazy-loaded | Deployed together |
| R14 | Emails inside the transaction | Mail outage fails checkout | After commit, best effort | An email can be lost (outbox later) |
| R15 | `$inc` for ratings | Drift | Recompute on change | Small cost per review write |
| R16 | Reviews from anyone | Fake reviews | Verified buyers only | New products start empty |
| R17 | Original images stored | EXIF leaks, oversized, polyglots | Re-encode with `sharp` | CPU at upload |
| R18 | Layered folders as given | Features scatter | Kept, with domain-named files | Slightly more navigation |
| R19 | SPA as specified | Weaker SEO | Metadata, sitemap, clean URLs | Lower organic ranking than SSR |

## 14. Independent architecture review (revision 2)

A separate reviewer examined revision 1 and found the following. All findings were accepted except where noted.

| ID | Severity | Finding | Resolution |
|---|---|---|---|
| C1 | Critical | Captures on cancelled, expired or already-paid orders took money without an order or a refund (retries created extra Razorpay orders; reconciliation only scanned unpaid orders) | One Razorpay order per store order; any capture that cannot advance a `pending_payment` order is refunded; 72-hour reconciliation of expired/cancelled orders (D9, §7.4, §7.5) |
| H1 | High | One payment document per attempt could not hold several Razorpay payments; out-of-order webhooks could downgrade status | `payments` keyed by Razorpay payment ID; forward-only status (§6) |
| H2 | High | Webhooks acknowledged and de-duplicated even when processing failed | Event record written in the effect's transaction; 5xx on failure so Razorpay redelivers; refund reconciliation via the refund job (§6, §7.6) |
| H3 | High | Refund state ambiguous; crash between commit and API call unrecoverable; dashboard refunds and `refund.failed` unmodelled | `refunds` collection with lifecycle, idempotent job using `notes.refundId`, `refund_failed` status, dashboard refunds recorded (D10, §7.6) |
| H4 | High | Cancellation reversed stock by payment state, which is wrong for COD | Per-order `stockState` and exact reversal per movement type (§6 inventory, §7.6) |
| H5 | High | Unlimited unpaid/COD orders could hoard stock; the cart was lost on abandoned payment | One open unpaid order per customer, COD open-order cap, rate limits, cart cleared on confirmation (§7.3) |
| H6 | High | No path for shipped orders that are never delivered | `undelivered` status with restock or write-off and refund (§7.6, §8) |
| H7 | High | Strict refresh rotation would log out multi-tab users; one document per rotation; access tokens valid after reset | Web Locks + 30-second grace without rotation; one session per sign-in; `tokensValidAfter` (§7.1) |
| M1 | Medium | Re-confirmed late payments under-counted coupon usage | Late payments always refunded (D9) |
| M2 | Medium | Expiry raced slow UPI payments; job overlap; no claim field | Grace period, closed window for new attempts, self-rescheduling jobs, `jobLockedUntil` (§7.5) |
| M3 | Medium | Product aggregates in the checkout transaction caused contention; forgotten sessions; idempotency race; lost admin updates | Aggregates after commit + nightly repair; `transactionAsyncLocalStorage`; duplicate key returns the existing order; optimistic concurrency (D8, D21, §7.3) |
| M4 | Medium | Confirmed-but-unshipped units vanished from the counters | `allocated` counter; movement table (§6) |
| M5 | Medium | Pricing order undefined; negative totals; permanent price-changed block | Ordered pricing function with ₹1 floor; price change is a warning (§7.2) |
| M6 | Medium | Reports needed timestamps the schema lacked | Status timestamps on orders, `capturedAt` on payments (§6) |
| M7 | Medium | No tax data stored for future GST invoices | `hsnCode`/`gstRate` on products, snapshotted into orders (§6) |
| M8 | Medium | Partial-index filters matching `null`; in-document SKU duplicates; default-address semantics | `$type` filters, unset optionals, Zod SKU check, transactional default switching (§6) |
| M9 | Medium | Listing sorts without a category, low stock, "ever ordered", email search and word-prefix search lacked indexes | Added indexes and fields (§6) |
| M10 | Medium | Indexes and validators not managed in production | Migration runner on deploy and in tests (D20) |
| M11 | Medium | Aggregates written from many places; absolute image URLs | One recompute function; storage keys (D12, §6) |
| M12 | Medium | Enumeration via register/lockout; CGNAT-hostile IP limits; missing rate limits | No hard lockout; per-email strict, per-IP generous; registration leak accepted and documented; more endpoints rate-limited (§9) |
| M13 | Medium | Image decompression bombs | Pixel limit, concurrency 1, sequential processing (§7.7) |
| M14 | Medium | Single role check; long admin sessions; admins blocking admins; blocking ignored open orders | Permission map, 12-hour admin sessions, customers-only blocking with order handling (D14, §7.8) |
| M15 | Medium | Missing endpoints for guest cart pricing, coupon usage, customer orders, homepage content | Added (API_DOCUMENTATION.md) |
| M16 | Medium | Plan ordering broke the definition of done | Plan reordered; Playwright from M1 (IMPLEMENTATION_PLAN.md) |
| M17 | Medium | No alerting, restore drill, deploy migrations or go-live checklist | Added to M9 and §12 |
| L1 | Low | Mixed `:id`/`:orderNumber`; 502 body with an order; sitemap under `/api` | `orderNumber` everywhere; `201` with `paymentError`; `/sitemap.xml` at the site root |
| L2 | Low | Order-number collisions | 6 random characters per day + retry |
| L3 | Low | CSV injection; personalized `/home` cached publicly; reset token in logs; unverified CSP; redaction keys | All fixed (§9, §10) |
| L4 | Low | MVP cuts suggested | Accepted: no category subtree moves, no per-entity audit panel, legal pages static in the client, no re-reservation for late payments. **Not accepted:** dropping recommendations entirely — the brief requires them; they are rule-based and personalized ones are built after order data exists (F-803) |

## 15. Technical risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| No local MongoDB or Docker yet | Certain | Blocks running the app (tests still run on the in-memory replica set) | Decide Q1 before F-107 |
| Razorpay test account and webhook tunnel | Medium | Payment flow unverifiable end to end | Signed-fixture tests meanwhile; cloudflared/ngrok for live runs |
| Razorpay behaviours assumed, not yet observed (webhook retry policy, event-ID header, refund notes, uncaptured authorizations, CSP hosts) | Medium | Edge cases handled wrongly | Sandbox verification run (F-608) before M6 is marked done; adjust design if behaviour differs |
| Razorpay's checkout iframe is brittle to automate | High | Flaky prepaid E2E | API-level payment tests + COD E2E + documented sandbox run |
| `mongodb-memory-server` downloads a ~100 MB binary on first run | Certain | Slow first run; needs internet | Cache in CI |
| `sharp` binaries differ between Windows and Linux | Medium | Docker build failure | Install inside the Linux build stage |
| Project path contains a space | Low | Some tools mishandle unquoted paths | Quote paths; rename if a tool fails |
| Email deliverability | Medium | Password resets not received | Transactional provider with SPF/DKIM |
| Scope is large | High | Breadth over quality | Vertical slices with quality gates |
