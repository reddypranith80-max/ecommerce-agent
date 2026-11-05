# API Documentation

> **Status:** Implemented (demo build). The tables below are the agreed specification; the section *As built* lists every place the running API differs. Route definitions live in `server/src/routes/index.ts`. The ⬜ markers in the tables predate the build and are superseded by this note and by PROJECT_STATUS.md → Verification.
> **Last updated:** 2026-11-05 · Architecture: [ARCHITECTURE.md](ARCHITECTURE.md)

## As built (demo build) — differences from the specification below

| Area | Specification | As built |
|---|---|---|
| Payment provider | Razorpay | **DemoPay** simulator (virtual money) with the same flow. `paymentMethod` is `'online'` or `'cod'` |
| Payment init payload | `PaymentInit` with `razorpayOrderId` | `{ provider: 'demopay', keyId, gatewayOrderId, amount, currency, windowEndsAt, prefill }` |
| Verify | `POST /payments/razorpay/verify` | `POST /payments/verify` `{ orderNumber, gatewayOrderId, gatewayPaymentId, signature }`; failure is `400 PAYMENT_VERIFICATION_FAILED` |
| Webhook | `POST /webhooks/razorpay`, `X-Razorpay-*` headers | `POST /api/v1/webhooks/demopay`, headers `X-DemoPay-Signature` (HMAC-SHA256 of the raw body) and `X-DemoPay-Event-Id` |
| Hosted checkout | Razorpay Checkout.js | `GET /demopay/checkout/:gatewayOrderId` and `POST /demopay/checkout/:gatewayOrderId/pay` `{ method: upi\|card\|netbanking\|wallet, outcome: success\|failure\|success_close }` — the simulated gateway's own endpoints; a decline returns `402 PAYMENT_DECLINED` |
| Refresh without a cookie | `401` | `204 No Content` (no session to restore is not an error); an invalid or reused cookie is still `401 INVALID_REFRESH_TOKEN` |
| Demo-only | — | `GET /demo/inbox?email=` (emails the store "sent"; only when `DEMO_MODE=true`), `POST /admin/demo/gateway-outage` (next gateway order creation fails, to demo the retry path) |
| Attention panel | `GET /admin/attention` | Included in `GET /admin/dashboard` as `attention` |
| Not built | `GET /sitemap.xml`, `GET /admin/reports/products` | Product ranking is in the dashboard's `topProducts` |
| Static pages | client-side | As specified: `/pages/:slug` is a client route with fixed content |

## 1. Conventions

| Topic | Rule |
|---|---|
| Base URL | `/api/v1` (same origin as the web app). Exception: `/sitemap.xml` at the site root |
| Format | JSON, UTF-8, camelCase fields |
| Money | Integers in **paise** (`49900` = ₹499.00), currency `INR` |
| Dates | ISO 8601, UTC |
| IDs | 24-character hex ObjectIds; products and categories also have slugs; **orders are addressed by `orderNumber`** in every route |
| Auth | `Authorization: Bearer <accessToken>`. The refresh token is the `rt` cookie, sent only to `/api/v1/auth/*` |
| Access levels | `public`, `optional` (token used if present), `customer` (any signed-in user), `admin:<permission>` (see §9) |
| Unknown fields | Rejected with `400 VALIDATION_ERROR` |
| Concurrent edits | Admin `PATCH` bodies for products, categories, coupons and settings include `version` (from the last GET); a mismatch returns `409 STALE_VERSION` |
| Request ID | Every response has `X-Request-Id`; error bodies repeat it |

### Success responses
```json
{ "data": { } }
{ "data": [ ], "meta": { "page": 1, "limit": 24, "total": 132, "totalPages": 6 } }
```
`204 No Content` for deletes and actions without a body.

### Error responses
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Some fields are invalid.",
    "details": [{ "path": "email", "message": "Enter a valid email address." }],
    "requestId": "b3f1c2…"
  }
}
```

| HTTP | Codes |
|---|---|
| 400 | `VALIDATION_ERROR` |
| 401 | `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS`, `INVALID_REFRESH_TOKEN` |
| 403 | `FORBIDDEN`, `ACCOUNT_BLOCKED` (only after a correct password) |
| 404 | `NOT_FOUND` |
| 409 | `EMAIL_TAKEN`, `OUT_OF_STOCK`, `PRICE_CHANGED`, `INVALID_STATUS_TRANSITION`, `ORDER_NOT_CANCELLABLE`, `PAYMENT_WINDOW_CLOSED`, `CATEGORY_NOT_EMPTY`, `STALE_VERSION`, `DUPLICATE` |
| 413 / 415 | `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE` |
| 422 | `CART_EMPTY`, `COUPON_INVALID` (`details.reason`), `COD_NOT_AVAILABLE` (`details.reason`), `REVIEW_NOT_ALLOWED`, `IDEMPOTENCY_KEY_REUSED`, `LIMIT_REACHED` |
| 429 | `RATE_LIMITED` (with `Retry-After`) |
| 500 | `INTERNAL_ERROR` |
| 502 | `PAYMENT_VERIFICATION_FAILED` |

### Pagination, sorting, filtering
`?page=1&limit=24` (storefront default 24, max 48; admin default 20, max 100). `sort` takes a named value per endpoint. Filters are explicit, schema-validated query parameters.

### Rate limits
| Endpoint | Limit |
|---|---|
| `POST /auth/login` | 100 / 15 min per IP; 10 / 15 min per submitted email |
| `POST /auth/register` | 10 / hour per IP |
| `POST /auth/forgot-password` | 10 / hour per IP; 3 / hour per submitted email |
| `POST /auth/reset-password` | 20 / hour per IP |
| `POST /orders` | 10 / hour per user |
| `POST /orders/:orderNumber/payment` | 20 / hour per user |
| `POST /payments/razorpay/verify` | 30 / hour per user |
| Review create/edit | 20 / day per user |
| `GET /products`, `/products/suggest` | 120 / min per IP |
| Everything else | 600 / min per IP |

Per-IP limits are deliberately generous because many Indian mobile users share public IPs.

## 2. Health and site

| Status | Method | Path | Access | Notes |
|---|---|---|---|---|
| ⬜ | GET | `/health/live` | public | `{ status: "ok" }` |
| ⬜ | GET | `/health/ready` | public | 200 when the database answers, else 503 |
| ⬜ | GET | `/sitemap.xml` (site root) | public | Active products and categories |

## 3. Auth and account

| Status | Method | Path | Access | Body | Response |
|---|---|---|---|---|---|
| ⬜ | POST | `/auth/register` | public | `{ name, email, password }` | `201 { user, accessToken }` + `rt` cookie |
| ⬜ | POST | `/auth/login` | public | `{ email, password }` | `{ user, accessToken }` + `rt` cookie |
| ⬜ | POST | `/auth/refresh` | cookie | header `X-Requested-With: fetch` | `{ user, accessToken }` (+ rotated cookie, except within the grace window) |
| ⬜ | POST | `/auth/logout` | cookie | header `X-Requested-With: fetch` | `204`, cookie cleared, session revoked |
| ⬜ | POST | `/auth/forgot-password` | public | `{ email }` | always `202` |
| ⬜ | POST | `/auth/reset-password` | public | `{ token, password }` (token read from the link's URL fragment by the client) | `204`; all sessions revoked |
| ⬜ | GET | `/me` | customer | — | `{ user }` |
| ⬜ | PATCH | `/me` | customer | `{ name?, phone? }` | `{ user }` |
| ⬜ | POST | `/me/password` | customer | `{ currentPassword, newPassword }` | `204`; other sessions revoked |
| ⬜ | GET | `/me/addresses` | customer | — | `Address[]` |
| ⬜ | POST | `/me/addresses` | customer | `AddressInput` | `201 Address` (`422 LIMIT_REACHED` after 10) |
| ⬜ | PATCH | `/me/addresses/:id` | customer | partial `AddressInput` | `Address` |
| ⬜ | DELETE | `/me/addresses/:id` | customer | — | `204` (a new default is chosen if needed) |
| ⬜ | POST | `/me/addresses/:id/default` | customer | — | `Address` |

Password: 8–72 bytes, at least one letter and one digit. Email normalized to lowercase. `EMAIL_TAKEN` on registration is an accepted enumeration trade-off (ARCHITECTURE.md §9).

```ts
type PublicUser = { id: string; name: string; email: string; phone: string | null; role: 'customer' | 'admin';
                    permissions: Permission[]; createdAt: string };
type AddressInput = { label?: string; fullName: string; phone: string; line1: string; line2?: string; landmark?: string;
                      city: string; state: IndianState; postalCode: string; isDefault?: boolean };
```

## 4. Storefront

| Status | Method | Path | Access | Notes |
|---|---|---|---|---|
| ⬜ | GET | `/config` | public | `{ storeName, currency, codEnabled, codMaxOrderValue, shippingFlatFee, freeShippingThreshold, paymentWindowMinutes, razorpayKeyId, supportEmail, supportPhone }` |
| ⬜ | GET | `/home` | public (cacheable) | `{ hero, banners[], categories[], featured[], offers[], newArrivals[], trending[] }` |
| ⬜ | GET | `/home/recommended` | customer (`private`) | Up to 12 cards from categories the customer has bought from, excluding purchased products; falls back to trending |
| ⬜ | GET | `/categories` | public | Active category tree |
| ⬜ | GET | `/categories/:slug` | public | Category with breadcrumb and children |
| ⬜ | GET | `/products` | public | Listing (below) |
| ⬜ | GET | `/products/suggest?q=` | public | Up to 8 `{ name, slug, imageUrl }` by word prefix (min 2 characters) |
| ⬜ | POST | `/products/cards` | public | `{ ids: string[] }` (max 20) → cards, used for "recently viewed" |
| ⬜ | GET | `/products/:slug` | public | Product detail (below) |
| ⬜ | GET | `/products/:slug/related` | public | Up to 8 cards from the same category |
| ⬜ | GET | `/products/:slug/reviews?page&sort=newest\|highest\|lowest` | public | Published reviews + `{ ratingAvg, ratingCount, distribution }` |

### GET /products
| Param | Type | Notes |
|---|---|---|
| `q` | string 1–100 | Keyword search (text index); default sort becomes relevance |
| `category` | slug | Includes subcategories |
| `minPrice`, `maxPrice` | int paise | Compared with `priceMin` |
| `rating` | 1–4 | Minimum average rating |
| `inStock` | boolean | Excludes `out_of_stock` |
| `sort` | `relevance` \| `newest` \| `popular` \| `price_asc` \| `price_desc` \| `rating` | Default `newest` (`relevance` with `q`) |
| `page`, `limit` | int | See conventions |

```ts
type ProductCard = { id: string; slug: string; name: string; brand: string | null; imageUrl: string | null;
                     priceMin: number; priceMax: number; compareAtPrice: number | null; maxDiscountPct: number;
                     ratingAvg: number; ratingCount: number; stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock' };
```
Response: `{ data: ProductCard[], meta: { page, limit, total, totalPages, priceBounds: { min, max } } }`.

### GET /products/:slug
```ts
type ProductDetail = ProductCard & {
  description: string; tags: string[];
  images: { url: string; thumbUrl: string; alt: string; width: number; height: number }[];
  category: { id: string; name: string; slug: string }; breadcrumb: { name: string; slug: string }[];
  options: { name: string; values: string[] }[];
  variants: { id: string; sku: string; optionValues: Record<string, string>; price: number;
              compareAtPrice: number | null; available: number /* capped at 10 for display */; inStock: boolean }[];
};
```
Draft and archived products return 404 to customers.

## 5. Cart and wishlist

| Status | Method | Path | Access | Body | Response |
|---|---|---|---|---|---|
| ⬜ | POST | `/cart/preview` | public | `{ items: { productId, variantId, quantity }[] }` (max 50) | `Cart` (prices a guest cart; nothing stored) |
| ⬜ | GET | `/cart` | customer | — | `Cart` |
| ⬜ | POST | `/cart/items` | customer | `{ productId, variantId, quantity }` (adds to an existing line, capped at 10) | `Cart` |
| ⬜ | PATCH | `/cart/items/:itemId` | customer | `{ quantity }` (1–10) | `Cart` |
| ⬜ | DELETE | `/cart/items/:itemId` | customer | — | `Cart` |
| ⬜ | DELETE | `/cart` | customer | — | `Cart` (empty) |
| ⬜ | POST | `/cart/merge` | customer | `{ items: { productId, variantId, quantity }[] }` (max 50) | `{ cart, notMerged: { productId, variantId, reason }[] }` |
| ⬜ | GET | `/wishlist?page` | customer | — | `ProductCard[]` + meta |
| ⬜ | GET | `/wishlist/ids` | customer | — | `string[]` (for heart icons) |
| ⬜ | PUT | `/wishlist/:productId` | customer | — | `204` (idempotent add; `422 LIMIT_REACHED` after 200) |
| ⬜ | DELETE | `/wishlist/:productId` | customer | — | `204` |

```ts
type CartLineIssue = 'out_of_stock' | 'insufficient_stock' | 'unavailable';   // block checkout
type CartLineWarning = 'price_changed';                                        // informational
type Cart = {
  items: { id: string; productId: string; variantId: string; sku: string; slug: string; name: string; variantLabel: string;
           imageUrl: string | null; unitPrice: number; previousUnitPrice: number | null; compareAtPrice: number | null;
           quantity: number; lineTotal: number; available: number; issues: CartLineIssue[]; warnings: CartLineWarning[] }[];
  subtotal: number; itemCount: number;
};
```

## 6. Checkout, orders and payments

| Status | Method | Path | Access | Body | Response |
|---|---|---|---|---|---|
| ⬜ | POST | `/checkout/quote` | customer | `{ addressId?, couponCode?, paymentMethod? }` | `Quote` (acknowledges price-change warnings) |
| ⬜ | POST | `/orders` | customer | header `Idempotency-Key`; `{ addressId, paymentMethod: 'razorpay' \| 'cod', couponCode?, expectedTotal }` | `201 { order, payment, paymentError }` |
| ⬜ | POST | `/orders/:orderNumber/payment` | customer | — | `{ payment }` for a `pending_payment` order (creates the Razorpay order if missing, otherwise returns it); `409 PAYMENT_WINDOW_CLOSED` in the last 2 minutes |
| ⬜ | GET | `/orders?page&status` | customer | — | `OrderSummary[]` + meta |
| ⬜ | GET | `/orders/:orderNumber` | customer | — | `Order` (own orders only; others → 404) |
| ⬜ | POST | `/orders/:orderNumber/cancel` | customer | `{ reason }` | `Order`; allowed in `pending_payment` and `confirmed`, otherwise `409 ORDER_NOT_CANCELLABLE` |
| ⬜ | POST | `/payments/razorpay/verify` | customer | `{ orderNumber, razorpayOrderId, razorpayPaymentId, razorpaySignature }` | `{ order }`; `502 PAYMENT_VERIFICATION_FAILED` if the signature or provider check fails |
| ⬜ | POST | `/webhooks/razorpay` | signature | raw body; headers `X-Razorpay-Signature`, `X-Razorpay-Event-Id` | `200` once processed (or already processed); `400` bad signature; `500` processing failure (Razorpay redelivers) |

```ts
type Quote = {
  lines: Cart['items']; subtotal: number; discount: number; shippingFee: number; total: number;
  coupon: null | { code: string; discount: number }; couponError: null | { reason: CouponRejection };
  cod: { available: boolean; reason: null | 'disabled' | 'over_limit' | 'open_orders_limit' };
  issues: { sku: string; issue: CartLineIssue }[];      // must be empty to place an order
  warnings: { sku: string; warning: CartLineWarning; previousUnitPrice: number }[];
};
type PaymentInit = { provider: 'razorpay'; keyId: string; razorpayOrderId: string; amount: number; currency: 'INR';
                     windowEndsAt: string; prefill: { name: string; email: string; contact: string } };
type CouponRejection = 'not_found' | 'inactive' | 'not_started' | 'expired' | 'min_order_value'
                     | 'usage_limit_reached' | 'per_user_limit_reached';
```

`POST /orders` returns `payment: null` for COD, and `payment: null` with `paymentError: { code: 'PAYMENT_PROVIDER_ERROR', message }` when Razorpay is unreachable (the order exists in `pending_payment`; retry with `/orders/:orderNumber/payment`). Errors: `422 CART_EMPTY`, `409 OUT_OF_STOCK` (`details.skus`), `409 PRICE_CHANGED` (`details.quote`), `422 COUPON_INVALID`, `422 COD_NOT_AVAILABLE`, `422 IDEMPOTENCY_KEY_REUSED`. Placing an online-payment order cancels the customer's previous `pending_payment` order, if any.

`Order` includes `status`, `paymentStatus`, `statusHistory`, `fulfilment` (carrier, tracking number and URL), `pricing`, `items`, `shippingAddress`, `windowEndsAt` while unpaid, and `refunds: { amount, status, processedAt }[]`.

Webhook events handled: `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`. Others are acknowledged and ignored.

## 7. Reviews

| Status | Method | Path | Access | Body | Response |
|---|---|---|---|---|---|
| ⬜ | GET | `/products/:slug/reviews/eligibility` | customer | — | `{ canReview, reason?, existingReviewId? }` |
| ⬜ | POST | `/products/:slug/reviews` | customer | `{ rating, title, body }` | `201 Review` or `422 REVIEW_NOT_ALLOWED` |
| ⬜ | PATCH | `/reviews/:id` | customer (author) | partial | `Review` |
| ⬜ | DELETE | `/reviews/:id` | customer (author) | — | `204` |

## 8. Admin

All routes require a signed-in admin with the listed permission. Admin sessions last at most 12 hours.

### Dashboard, attention panel and reports (`reports:read`)
| Status | Method | Path | Notes |
|---|---|---|---|
| ⬜ | GET | `/admin/dashboard?range=today\|7d\|30d\|90d` | KPIs vs the previous period: gross sales, net revenue, orders, average order value, new customers, orders awaiting fulfilment, low-stock SKUs; revenue series; orders by status; top 5 products; 10 latest orders |
| ⬜ | GET | `/admin/attention` | Counts and lists: refunds `failed` or `requested` > 30 min, orders `needsReview`, webhook failures in the last 24 h, low-stock SKUs |
| ⬜ | GET | `/admin/reports/sales?from&to&groupBy=day\|week\|month&format=json\|csv` | Per period: orders, gross sales, discounts, shipping, refunds, net revenue, AOV, split by payment method. CSV cells are escaped against formula injection |
| ⬜ | GET | `/admin/reports/products?from&to&sort=revenue\|units&limit&format=json\|csv` | Product sales ranking |

Metric definitions (Asia/Kolkata periods): **gross sales** = Σ `pricing.total` of orders with `confirmedAt` in the period. **Net revenue** = Σ captured online payments (`capturedAt`) + COD collections (`paidAt`) in the period − Σ refunds processed (`processedAt`) in the period. **Orders** = orders with `confirmedAt` in the period.

### Catalog (`catalog:write`)
| Status | Method | Path | Notes |
|---|---|---|---|
| ⬜ | GET | `/admin/products?q&status&category&stockStatus&page&limit&sort` | `q` matches name words or an exact SKU |
| ⬜ | POST | `/admin/products` | Product with options, variants (`sku`, `optionValues`, `price`, `compareAtPrice`, `initialStock`, `lowStockThreshold`), `mediaIds`, optional `hsnCode`/`gstRate`; inventory created in the same transaction |
| ⬜ | GET | `/admin/products/:id` | Includes inventory per variant and `version` |
| ⬜ | PATCH | `/admin/products/:id` | Partial + `version`; SKUs immutable; removing an ordered variant → `409`, deactivate it instead |
| ⬜ | DELETE | `/admin/products/:id` | Hard delete if never ordered; otherwise `409` with a hint to archive |
| ⬜ | POST | `/admin/media` | `multipart/form-data`, field `files` (≤ 10, ≤ 5 MB each) → `{ id, url, thumbUrl, width, height }[]` |
| ⬜ | GET | `/admin/categories` | Full tree including inactive |
| ⬜ | POST | `/admin/categories` | `{ name, slug?, parentId?, description?, mediaId?, sortOrder?, isActive? }` |
| ⬜ | PATCH | `/admin/categories/:id` | Partial + `version`; changing `parentId` only for categories without children or products |
| ⬜ | DELETE | `/admin/categories/:id` | `409 CATEGORY_NOT_EMPTY` if it has children or products |

### Inventory (`inventory:write`)
| Status | Method | Path | Notes |
|---|---|---|---|
| ⬜ | GET | `/admin/inventory?q&lowStock&page&limit` | Per SKU: product, variant label, available, reserved, allocated, on hand, threshold |
| ⬜ | POST | `/admin/inventory/:sku/adjust` | `{ type: 'restock' \| 'adjustment', delta (non-zero int), reason }`; cannot take `available` below 0 |
| ⬜ | PATCH | `/admin/inventory/:sku` | `{ lowStockThreshold }` |
| ⬜ | GET | `/admin/inventory/:sku/movements?page` | Ledger |

### Orders and refunds (`orders:write`)
| Status | Method | Path | Notes |
|---|---|---|---|
| ⬜ | GET | `/admin/orders?q&status&paymentStatus&paymentMethod&userId&needsReview&from&to&page&limit` | `q` = order number or customer email |
| ⬜ | GET | `/admin/orders/:orderNumber` | Order + payments + refunds + customer summary + allowed transitions |
| ⬜ | POST | `/admin/orders/:orderNumber/status` | `{ status, note?, carrier?, trackingNumber?, trackingUrl?, undeliveredReason? }`; validated against the state machine |
| ⬜ | POST | `/admin/orders/:orderNumber/cancel` | `{ reason }`; paid orders get a refund |
| ⬜ | POST | `/admin/orders/:orderNumber/review` | `{ resolution: 'keep' \| 'cancel', note }` clears `needsReview` |
| ⬜ | GET | `/admin/refunds?status&page` | Refund records |
| ⬜ | POST | `/admin/refunds/:id/retry` | Only for `failed` refunds; re-queues them |

### Customers (`customers:write`)
| Status | Method | Path | Notes |
|---|---|---|---|
| ⬜ | GET | `/admin/customers?q&status&page&limit` | With order count and lifetime spend |
| ⬜ | GET | `/admin/customers/:id` | Profile, addresses, recent orders |
| ⬜ | PATCH | `/admin/customers/:id` | `{ status: 'active' \| 'blocked' }`; customers only; blocking revokes sessions, cancels unpaid orders and flags open COD orders |

### Coupons (`coupons:write`)
| Status | Method | Path | Notes |
|---|---|---|---|
| ⬜ | GET | `/admin/coupons?q&state=active\|scheduled\|expired\|inactive&page` | Includes `usedCount` |
| ⬜ | POST | `/admin/coupons` | `{ code, description, type, value, maxDiscount?, minOrderValue, startsAt, endsAt, usageLimit?, perUserLimit, isActive }` |
| ⬜ | PATCH | `/admin/coupons/:id` | Partial + `version`; `code`, `type`, `value` locked once used |
| ⬜ | DELETE | `/admin/coupons/:id` | Only if never used; otherwise `409`, deactivate instead |
| ⬜ | GET | `/admin/coupons/:id/redemptions?page` | Order number, customer, discount, status, date |

### Reviews, settings, audit
| Status | Method | Path | Permission | Notes |
|---|---|---|---|---|
| ⬜ | GET | `/admin/reviews?status&rating&product&page` | `reviews:moderate` | Moderation list |
| ⬜ | PATCH | `/admin/reviews/:id` | `reviews:moderate` | `{ status: 'published' \| 'hidden' }` |
| ⬜ | DELETE | `/admin/reviews/:id` | `reviews:moderate` | Recomputes product rating |
| ⬜ | GET | `/admin/settings` | `settings:write` | Store settings incl. homepage hero and banners, `version` |
| ⬜ | PATCH | `/admin/settings` | `settings:write` | Partial + `version` |
| ⬜ | GET | `/admin/audit-logs?entityType&entityId&actorId&from&to&page` | `audit:read` | Read-only |

## 9. Permissions

Defined in `shared/permissions.ts`. MVP roles: `customer` (none) and `admin` (all).

`catalog:write` · `inventory:write` · `orders:write` · `customers:write` · `coupons:write` · `reviews:moderate` · `reports:read` · `settings:write` · `audit:read`

A future Staff role would get `orders:write`, `inventory:write` and `reports:read`.

## 10. Example: placing an online-payment order

```http
POST /api/v1/orders
Authorization: Bearer eyJ…
Idempotency-Key: 6f1c0e0a-6d6c-4b8e-9b5c-1f0d1a7c2b11
Content-Type: application/json

{ "addressId": "6729…", "paymentMethod": "razorpay", "couponCode": "WELCOME10", "expectedTotal": 134010 }
```
```json
201
{
  "data": {
    "order": { "orderNumber": "ORD-261105-7KQ2M9", "status": "pending_payment", "paymentStatus": "unpaid",
               "pricing": { "subtotal": 148900, "discount": 14890, "shippingFee": 0, "total": 134010, "currency": "INR" },
               "windowEndsAt": "2026-11-05T16:45:00.000Z" },
    "payment": { "provider": "razorpay", "keyId": "rzp_test_…", "razorpayOrderId": "order_P…", "amount": 134010,
                 "currency": "INR", "windowEndsAt": "2026-11-05T16:45:00.000Z",
                 "prefill": { "name": "Asha Rao", "email": "asha@example.com", "contact": "+919800000000" } },
    "paymentError": null
  }
}
```
The client opens Razorpay Checkout with this payload and, on success, posts the three `razorpay_*` values with the order number to `/payments/razorpay/verify`. If the browser never returns, the webhook or the expiry job records the payment instead.
