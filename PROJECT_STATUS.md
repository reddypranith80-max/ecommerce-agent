# Project Status

> **Last updated:** 2026-11-05
> **Current state:** Working demo build. Every customer and admin feature in the brief is implemented against the real database and API, and verified by automated tests and a browser walkthrough. Payments use the built-in **DemoPay** gateway with virtual money (owner's decision: this is a demonstration for an audience, not a live shop).
> **How to run:** `npm install` then `npm start` → http://localhost:5173 (see [README.md](README.md)).

## Session log

| Date | Work done |
|---|---|
| 2026-11-05 | Planning: requirements, architecture (revision 2 after an independent review), API specification, implementation plan. |
| 2026-11-05 | Owner direction: "temporary virtual money, explain it to a crowd, minimise setup, show it running." Built the full application in demo mode: zero-install local MongoDB replica set, DemoPay gateway simulator, demo inbox, generated product images, seed data. 39 automated tests and a 14-step browser walkthrough pass. |

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` (shared, server, client; strict) | ✅ passes |
| `npm test` — shared unit tests | ✅ 7 / 7 |
| `npm test` — API integration tests (real MongoDB replica set in memory) | ✅ 32 / 32 |
| `npm run build` (client production build) | ✅ passes; storefront entry ≈ 160 KB gzipped, admin code in separate chunks |
| `node tests/e2e/walkthrough.mjs` (Microsoft Edge) | ✅ 14 / 14 steps, no console or server errors |

Bugs found and fixed during verification: access tokens issued in the same second as a password reset stayed valid (now millisecond-precise revocation); an effect that returned `window.scrollTo`'s Promise crashed the layout in current Edge; a redirect race after admin sign-in; Mongoose auto-create racing the inventory validator; SVG seed art rejected by the (correct) upload validation.

## Requirement checklist

✅ = implemented end to end (UI + API + database) and covered by an automated test or the browser walkthrough. 🟡 = implemented, verified only partly (noted).

### Customer-facing
| # | Requirement | Status | Verified by |
|---|---|---|---|
| 1 | Home: hero, featured, categories, offers, recommendations | ✅ | walkthrough (home); personalised "Recommended for you" rail for signed-in buyers |
| 2 | Product listing pages | ✅ | walkthrough |
| 3 | Product detail: images, description, price, stock, variants | ✅ | walkthrough, admin test |
| 4 | Keyword search (stemmed text search + word-prefix fallback, autocomplete) | ✅ | walkthrough, manual API check |
| 5 | Filters: category, price, rating, availability | ✅ | walkthrough |
| 6 | Sorting: price, popularity, newest, rating | ✅ | walkthrough |
| 7 | Cart with quantity management (guest cart + merge on sign-in) | ✅ | walkthrough, API tests |
| 8 | Wishlist | 🟡 | implemented (heart toggle, wishlist page); not yet in an automated test |
| 9 | Registration and login | ✅ | API tests, walkthrough |
| 10 | Forgot / reset password | ✅ | API test (token single use, sessions revoked) |
| 11 | Profile and address management | ✅ | API tests, walkthrough (address at checkout) |
| 12 | Checkout | ✅ | API tests, walkthrough |
| 13 | Online payment | ✅ | DemoPay (virtual money), API tests + walkthrough; real Razorpay is not connected (by decision) |
| 14 | Cash on Delivery | ✅ | API tests, walkthrough |
| 15 | Order confirmation (page + email) | ✅ | walkthrough (demo inbox) |
| 16 | Order history | ✅ | walkthrough |
| 17 | Tracking and status updates | ✅ | API test, walkthrough |
| 18 | Reviews and ratings (verified buyers) | ✅ | API tests |
| 19 | Discount coupons | ✅ | API tests, walkthrough |
| 20 | Responsive navigation and footer | ✅ | walkthrough at 390 px (no horizontal overflow) and desktop |

### Admin
| # | Requirement | Status | Verified by |
|---|---|---|---|
| 1 | Admin authentication and permission-based access | ✅ | API tests (401/403 matrix) |
| 2 | Dashboard: sales, revenue, orders, customers | ✅ | walkthrough, API test |
| 3 | Product create, edit, delete (archive when ordered) | ✅ | API tests |
| 4 | Product image uploads (re-encoded with sharp) | ✅ | API test (incl. fake image rejected) |
| 5 | Category management | ✅ | API test |
| 6 | Inventory and stock management with ledger | ✅ | API tests, walkthrough |
| 7 | Order management | ✅ | API tests, walkthrough |
| 8 | Order status updates (incl. not delivered / returned) | ✅ | API tests, walkthrough |
| 9 | Customer management (block/unblock) | ✅ | API test |
| 10 | Coupon management | ✅ | API test |
| 11 | Review moderation | ✅ | API test |
| 12 | Sales reports and analytics (CSV export) | ✅ | API test, walkthrough |
| 13 | Pagination, filtering, search on admin lists | ✅ | used throughout; walkthrough |

### Final acceptance criteria
| Actor | Criterion | Status |
|---|---|---|
| Customer | Register and log in | ✅ |
| Customer | Browse and search products | ✅ |
| Customer | Filter and sort products | ✅ |
| Customer | View product details | ✅ |
| Customer | Add products to a cart | ✅ |
| Customer | Manage a wishlist | 🟡 works; no automated test yet |
| Customer | Complete checkout | ✅ |
| Customer | Make a sandbox payment or select COD | ✅ (DemoPay sandbox) |
| Customer | Receive a confirmed order | ✅ |
| Customer | View order history and tracking | ✅ |
| Admin | Log in securely | ✅ |
| Admin | Manage products and categories | ✅ |
| Admin | Manage inventory | ✅ |
| Admin | View and process orders | ✅ |
| Admin | Manage customers | ✅ |
| Admin | Manage coupons | ✅ |
| Admin | View business analytics | ✅ |

## Decisions made for the demo build

| Decision | Why | Where |
|---|---|---|
| DemoPay simulator instead of Razorpay | Owner: virtual money only, no accounts to set up. It reproduces Razorpay's flow (one gateway order per store order, HMAC checkout signature, signed webhooks with retries, refunds) so the audience sees how real gateways work | `server/src/integrations/demopay/` |
| MongoDB started from an npm-managed binary (`npm start`) | No Docker/MongoDB installation needed; still a real replica set with transactions | `server/scripts/local-db.ts` |
| Demo inbox instead of SMTP | Password reset and order emails are visible without a mail provider | `/demo/inbox`, `DEMO_MODE` |
| npm workspaces instead of pnpm | Avoids pnpm's build-script approval prompts; one less thing for the presenter | `package.json` |
| `bcryptjs` (bcrypt algorithm in pure JS) | No native build step on Windows | `auth.service.ts` |
| Previous stable majors (Mongoose 8, Vite 7, React Router 7, TypeScript 5, Vitest 3) | Newer majors were released after the libraries' behaviour I could rely on; stable and compatible | `package.json` files |
| Mongoose `sanitizeFilter` not enabled | It also wraps the app's own query operators; injection is prevented by Zod type enforcement on every route instead | ARCHITECTURE.md D19 |
| Schema setup runs at API start (`syncIndexes` + inventory validator) rather than a separate migration runner | Simpler for a demo; the planned migration runner remains for production | ARCHITECTURE.md D20 |

## Known limitations (honest list)

- **Not production-deployed.** Dockerfiles, CI workflow, real Razorpay/SMTP/Cloudinary drivers and the production runbooks from M9 are not built. The API refuses to start in `NODE_ENV=production` with demo secrets.
- **Wishlist** has no automated test yet (works in the UI).
- **Rate limiting** uses an in-memory store (single instance only).
- **Search** has no typo tolerance (MongoDB text search + prefix match).
- **Accessibility**: semantic markup, labels, focus styles and keyboard-operable controls are in place, but no automated axe audit has been run.
- **Returns after delivery** and partial refunds are out of scope (cancellation before shipment and undelivered orders are handled).
- Category moves are limited to empty categories; the admin product editor does not support drag-and-drop reordering (arrow buttons instead).

## Open questions

None blocking. If this demo becomes a real store: Razorpay keys, an SMTP provider, image storage, hosting target and GST registration (docs/REQUIREMENTS.md §8) would be needed.
