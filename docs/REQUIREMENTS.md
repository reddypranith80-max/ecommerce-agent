# Requirements & Discovery (Phase 1)

> **Status:** Draft for approval · **Last updated:** 2026-11-05
> Nothing described here is implemented yet.
> **[Assumption]** = a default I will build to unless you say otherwise. **[Question]** = needs your decision (collected in §8).

## 1. Product summary

A single-vendor, business-to-consumer online store for the Indian market. Customers browse a catalog of products with variants (for example size and colour), pay online through Razorpay or choose Cash on Delivery, and track their orders. Store administrators manage the catalog, stock, orders, customers, coupons and reviews from an admin dashboard and see sales analytics.

## 2. User roles

| Role | How the role is obtained | Capabilities |
|---|---|---|
| Guest | Anyone visiting | Browse, search, filter, view products and reviews, build a cart stored in the browser |
| Customer | Self-registration | Everything a guest can do, plus a saved cart, wishlist, checkout, order history and tracking, cancellation, reviews, profile and addresses |
| Admin | Created with a server-side CLI command, never through public sign-up | The full admin dashboard |
| System | Background jobs and payment webhooks | Expire unpaid orders, confirm payments, record refunds |

Later: a restricted **Staff** role (orders and inventory only). Authorization is written as permission checks so that adding Staff does not require a rewrite.

## 3. Core workflows

| # | Workflow | Steps |
|---|---|---|
| W1 | Sign up and sign in | Register with name, email and password → signed in immediately → session survives page reloads → sign-out revokes the session |
| W2 | Password recovery | "Forgot password" → email with a single-use link valid for 30 minutes → set a new password → every existing session is signed out. The response never reveals whether an email is registered |
| W3 | Discover | Home (hero, categories, featured, offers, new arrivals, recommendations) → listing with keyword search, filters (category, price range, minimum rating, in stock) and sort (price, popularity, newest, rating) → product page (gallery, description, variant picker, price, stock, reviews, related products) |
| W4 | Cart | Add a variant and quantity (guests too; guest carts are priced by the server) → change quantity or remove → a guest cart merges into the account cart on sign-in → unavailable items block checkout; price changes are shown as a notice |
| W5 | Checkout, online payment | Choose or add an address → apply a coupon → review the price breakdown → place the order (stock is reserved for a 15-minute payment window) → Razorpay Checkout → payment verified on the server → order confirmed, purchased items leave the cart → confirmation page and email. A failed or abandoned payment can be retried until the window closes; the cart is kept meanwhile. After the window (plus a short grace period for slow UPI payments) the order expires and the stock is released. A payment that arrives after expiry or cancellation, or a second payment for the same order, is refunded automatically |
| W6 | Checkout, Cash on Delivery | As W5 up to placing the order. If COD is enabled, the total is within the COD limit and the customer has fewer than the allowed number of open COD orders, the order is confirmed immediately and the stock is allocated |
| W7 | After purchase | Order history → order detail with status timeline, tracking number and refund status → cancel before processing starts (online payments are refunded in full automatically) |
| W8 | Reviews | A customer whose order containing the product was delivered can leave one rating and review per product. It is published immediately and admins can hide it |
| W9 | Admin catalog | Categories up to 3 levels deep; products with images, options, variants, prices and opening stock; draft / active / archived lifecycle |
| W10 | Admin fulfilment | Order queue filtered by status → processing → shipped (carrier and tracking number required) → delivered, or undelivered (returned to origin, refused, lost) with restock or write-off; cancel and refund; resolve orders flagged for review; retry failed refunds |
| W11 | Admin inventory | Available and reserved stock per SKU, low-stock view, adjustments with a reason, movement history |
| W12 | Admin customers | Search, view profile and orders, block or unblock |
| W13 | Admin coupons | Percentage or fixed-amount coupons with minimum order value, discount cap, validity window and usage limits; usage visible |
| W14 | Admin analytics | KPI tiles, revenue over time, orders by status, top products, sales report with CSV export |

## 4. Gaps in the brief and how I propose to close them

| # | Gap | Why it matters | Proposed resolution |
|---|---|---|---|
| G1 | Market, currency and tax are unspecified | Drives money handling, address format and tax display | [Assumption] India only, INR only, prices **inclusive of GST** (shown as "inclusive of all taxes"). GST invoices are out of MVP, but HSN code and GST rate are stored per product and copied into each order now, so invoices can be generated later. [Question] Is the business GST-registered? (A registered seller generally must issue tax invoices; please confirm with your accountant) |
| G2 | Shipping charges | Changes checkout totals | [Assumption] Flat shipping fee with a free-shipping threshold, both editable in admin settings. No courier API or PIN-code serviceability check in MVP |
| G3 | Guest checkout | Affects auth, order ownership and tracking | [Assumption] Guests can build a cart, but checkout requires an account (order history and tracking depend on it) |
| G4 | What a "variant" is | Shapes the product, cart and inventory schemas | [Assumption] Up to 3 options per product (e.g. Size, Colour); each combination is a variant with its own SKU, price, compare-at price (MRP) and stock |
| G5 | When stock is taken | Overselling versus stock locked by abandoned checkouts | Reserve at order placement for 15 minutes (configurable); commit on payment; release on expiry or cancellation |
| G6 | Cancellations, refunds, returns, failed deliveries | An order lifecycle is incomplete without them | Customer cancels before processing starts, admin cancels before shipment; online payments are refunded in full through Razorpay. Shipped orders that are not delivered (returned to origin, refused, lost) are closed as `undelivered` with restock or write-off and a refund if prepaid. Returns after delivery and partial refunds are post-MVP (a refund made manually in the Razorpay Dashboard is still recorded) |
| G7 | COD rules and checkout abuse | Fraud, cash-collection risk, stock hoarding by fake accounts | [Assumption] Store-wide on/off switch, maximum COD order value (default ₹10,000), at most 2 open COD orders per customer, phone number required on every address. One unpaid online order per customer at a time (a new one replaces the old). Order placement is rate-limited. COD orders are marked paid when delivered |
| G8 | Payment failure handling | Customers will hit failed, slow and duplicate payments | Retry within the payment window against the same Razorpay order; a grace period and a server-side check with Razorpay before an order expires; any payment that arrives for an expired, cancelled or already-paid order is refunded automatically |
| G9 | Who can change order status | Fulfilment integrity | Explicit state machine (see ARCHITECTURE.md §8); only listed transitions are allowed, each recorded with actor and time |
| G10 | Review eligibility and moderation | Fake reviews | [Assumption] Verified buyers only (a delivered order containing the product), one review per product per customer, published immediately, admin can hide or delete |
| G11 | Coupon rules | Abuse and pricing correctness | One coupon per order, applied to the item subtotal (not shipping). Global and per-customer usage limits, validity window, minimum order value, cap for percentage coupons. Category/product-scoped coupons are post-MVP |
| G12 | Notifications | Password reset is impossible without email | Transactional email for password reset, order confirmation, shipped, delivered, cancelled and refund. Email failure never fails the business operation |
| G13 | Account lifecycle | Security and privacy | Admin can block a customer account: immediate sign-out, unpaid orders cancelled, open COD orders flagged for review. Admins cannot block other admins. Registration tells a visitor when an email is already registered (accepted trade-off for usability; removable later with email verification). Email verification and self-service account deletion are post-MVP |
| G14 | Admin accountability | Multiple admins changing data | Audit log of admin write actions; inventory movement ledger; order status history |
| G15 | Deleting products that appear in orders | Breaks order history | Products that have ever been ordered are archived instead of deleted; never-ordered products can be deleted permanently. SKUs are immutable once created |
| G16 | Search quality | Expectations around typos and partial words | MVP uses MongoDB text search (word stems, no typo tolerance) plus prefix autocomplete on product names. A search engine is a later upgrade |
| G17 | Legal pages | Razorpay requires Terms, Privacy, Refund & Cancellation, Shipping and Contact pages before live activation | Static pages are built; **you supply the wording** before go-live |
| G18 | Scale | Determines whether caching, queues or a search engine are needed | [Assumption] Up to ~10,000 products, ~1,000 orders per day, a single API instance at launch |
| G19 | SEO | A client-rendered SPA ranks worse than server-rendered pages | Accepted trade-off of the specified stack; mitigated with per-page titles/meta, a sitemap and clean URLs. Server rendering is a later option |

## 5. Assumptions (defaults pending your confirmation)

- **A1** Single store, single vendor. Not a marketplace.
- **A2** India only; INR; all amounts stored as integer paise.
- **A3** Prices include GST; no tax line at checkout.
- **A4** Shipping: flat ₹49, free above ₹999 (both editable in admin settings).
- **A5** Account required to check out; guest cart allowed and merged on sign-in.
- **A6** Maximum 10 units per cart line and 50 lines per cart.
- **A7** Payment window: 15 minutes, plus a 10-minute grace period before an unpaid order expires.
- **A8** COD enabled by default with a ₹10,000 limit and at most 2 open COD orders per customer.
- **A9** Online payments are captured automatically (auto-capture enabled in the Razorpay Dashboard).
- **A10** Customer may cancel while the order is `pending_payment` or `confirmed`; admin may cancel up to `processing`.
- **A11** Reviews are post-moderated and limited to verified buyers.
- **A12** One coupon per order; it does not apply to shipping.
- **A13** Categories up to 3 levels deep.
- **A14** Up to 10 images per product, 5 MB each, JPEG/PNG/WebP/AVIF; converted to WebP on upload.
- **A15** Admin accounts are created only with a CLI command on the server.
- **A16** Reports use the Asia/Kolkata time zone; timestamps are stored in UTC.
- **A17** English-only UI.
- **A18** Supported browsers: current and previous major versions of Chrome, Edge, Firefox and Safari, including iOS Safari.
- **A19** One unpaid online order per customer at a time; placing a new one cancels the previous unpaid order.
- **A20** Late or duplicate online payments are always refunded rather than re-attached to an order.
- **A21** Admin sessions last at most 12 hours; customer sessions 30 days of inactivity (90 days maximum).
- **A22** Homepage recommendations: best sellers and recently viewed for everyone; personalized ("from categories you buy") for signed-in customers once order data exists.

## 6. Scope

### MVP (everything in the brief)
All 20 customer features and 13 admin features from the brief, plus: legal/static pages (G17), transactional email (G12), audit log (G14), customer-initiated cancellation with automatic refund (G6), undelivered-order handling (G6), payment reconciliation and automatic refunds of late or duplicate payments (G8), checkout abuse controls (G7), an admin attention panel for failed refunds and flagged orders.

### After MVP
Returns and partial refunds · GST invoices (PDF) · courier integration and PIN-code serviceability · email verification · account deletion and data export · Staff role · admin two-factor authentication · category/product-scoped coupons · abandoned-cart emails · social sign-in · typo-tolerant search (Atlas Search or a search engine) · server rendering for SEO · SMS/WhatsApp notifications · multiple warehouses · multi-currency · product Q&A · loyalty and gift cards.

## 7. Non-functional requirements

| Area | Target |
|---|---|
| Security | OWASP Top 10 controls (ARCHITECTURE.md §9); no secrets in the repo; server-computed prices; verified payments |
| Performance | Catalog API p95 < 300 ms at target scale; listing page LCP < 2.5 s on a mid-range phone over 4G; JS for the storefront entry < 200 KB gzipped (admin code split out) |
| Accessibility | WCAG 2.1 AA: keyboard navigation, focus management, labels, contrast; automated axe checks on key pages |
| Responsiveness | Usable from 360 px phones to wide desktops |
| Reliability | No overselling under concurrent checkouts (tested); idempotent payment confirmation; graceful shutdown |
| Observability | Structured JSON logs with request IDs; health endpoints; sensitive fields redacted |
| Maintainability | Strict TypeScript, shared validation schemas, lint and format in CI, documented architecture |

## 8. Open questions (need your input)

1. **Local database.** Docker and MongoDB are not installed on this machine. Transactions (needed to prevent overselling) require a replica set. Options: (a) install Docker Desktop and run MongoDB in a container (recommended: it also lets me verify the Docker production setup); (b) a free MongoDB Atlas cluster; (c) install MongoDB Community natively and configure a single-node replica set. Automated tests use an in-memory replica set either way.
2. **Razorpay.** Do you have a Razorpay account with **test-mode** keys? Testing webhooks locally needs a tunnel (cloudflared or ngrok). Is that acceptable?
3. **Product image storage in production.** Cloudinary (recommended: free tier, CDN), Amazon S3 or compatible, or local disk on the server. Development uses local disk regardless.
4. **Email.** Which SMTP provider for production (for example Resend, Brevo, Amazon SES, Gmail SMTP)? Development uses a local mail catcher or the console.
5. **Business defaults.** Please confirm or correct assumptions A1–A22, especially A1 (single vendor), A3 (GST-inclusive), A4 (shipping), A5 (account required), A8 (COD limits) and A19 (one unpaid order at a time). Also: is the business GST-registered (G1)?
6. **Catalog and brand.** What does the store sell, and what is it called? This shapes the seed data, variant options and visual design. Default: a general lifestyle store (apparel, accessories, home) with the working name "Storefront" until you choose one.
7. **Deployment target** (needed by Phase 8, not now): a VPS running Docker Compose, or a managed platform (Render, Railway, Fly.io) with MongoDB Atlas?
