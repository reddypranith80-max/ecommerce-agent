# Storefront Demo

A complete, working e-commerce store built to **show and explain** how online shopping works end to end: catalog, search and filters, cart and wishlist, checkout, online payment, Cash on Delivery, order tracking, reviews, coupons, and an admin dashboard with inventory, order processing and sales analytics.

**All money is virtual.** Online payments go through **DemoPay**, a built-in gateway that behaves like Razorpay (gateway orders, signed callbacks, webhooks, refunds) but never touches a bank.

## Run it

Requirements: **Node.js 22 or newer** (already installed on this machine). Nothing else — no database, Docker or accounts to set up.

```bash
npm install      # first time only (also fetches a MongoDB binary automatically)
npm start        # starts the database, the API and the website together
```

Open **http://localhost:5173**. The first start loads demo data automatically (30 products, a month of orders, reviews, coupons).

Stop with `Ctrl+C`. Data is kept in `.data/` between runs. To start over with fresh demo data:

```bash
npm run seed -- -- --reset
```

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Customer | `asha@demo.store` | `Shop@1234` |
| Store admin | `admin@demo.store` | `Admin@1234` |

The sign-in page has one-click buttons for both.

### Demo coupons

| Code | What it does |
|---|---|
| `WELCOME10` | 10% off (max ₹200) on orders over ₹499, once per customer |
| `FLAT150` | ₹150 off orders over ₹1,499 |
| `FESTIVE25` | 25% off (max ₹750) on orders over ₹2,000, first 50 uses |
| `LASTUNIT` | ₹100 off, can be used **once in total** (shows usage limits) |
| `MONSOON20` | Expired (shows the error message) |

## A 10-minute demo script

1. **Browse** — home page → a category → search “shirt” → filter by price and rating → sort by price.
2. **Product page** — pick a size and colour; out-of-stock combinations are crossed out. Add to cart **without signing in** (the cart lives in the browser and is priced by the server).
3. **Sign in** as Asha → the guest cart merges into her account.
4. **Checkout** → choose an address → apply `WELCOME10` → *Continue to payment*. The DemoPay window opens; its right-hand panel shows each step as it happens: the gateway captures the money, the browser sends a signed result, the store verifies the signature **and asks DemoPay directly**, and the order is confirmed.
5. Try the other DemoPay buttons:
   - **Simulate a decline** — nothing is charged; the order stays payable.
   - **Pay & close the tab** — the browser never reports back; watch the order page confirm itself a moment later from DemoPay’s **webhook**.
6. **Cash on Delivery** — place a second order with COD; it is confirmed immediately.
7. **Demo inbox** (link in the top banner) — see the confirmation emails the store sent.
8. **Admin** — sign in as admin → dashboard (sales, revenue, orders, top products) → *Orders* → open the COD order → *Start processing* → *Mark shipped* (add a tracking number) → *Mark delivered*. Back as Asha, the order shows the tracking timeline and she can now **review** the product.
9. **Cancel & refund** — cancel a paid order as the customer: stock goes back, and a refund is queued, sent to DemoPay and confirmed by webhook (see *Admin → Refunds*).
10. **Inventory** — *Admin → Inventory* shows *available*, *reserved* (held by unpaid orders) and *allocated* (sold, not shipped). Open the history icon to see every stock movement.

Extra demos: set *Admin → Settings → Payment window* to 2 minutes and grace to 0, start an online order and don’t pay — the order expires and its stock returns. *Settings → Demo tools* simulates DemoPay being down for the next order.

## What is real and what is simulated

| Real (fully implemented) | Simulated for the demo |
|---|---|
| MongoDB database with transactions, indexes and a stock validator | MongoDB runs locally from an npm-managed binary instead of a hosted cluster |
| Accounts, JWT sessions with rotating refresh cookies, password reset | Emails go to the in-app **Demo inbox** instead of a mail provider |
| Server-side pricing, coupons, stock reservation, no overselling | Payments use **DemoPay** (virtual money) instead of Razorpay |
| Signature verification, webhooks, idempotent payment recording, refunds, reconciliation | Product images are generated illustrations |
| Admin dashboard, analytics, inventory ledger, audit log | Shipping/tracking numbers are entered by the admin (no courier API) |

## Tests

```bash
npm test                          # 39 unit + API tests (in-memory MongoDB, no setup)
node tests/e2e/walkthrough.mjs    # 14-step browser walkthrough using Microsoft Edge (app must be running)
npm run typecheck                 # strict TypeScript across all packages
```

The API tests cover, among others: 6 simultaneous buyers for the last 2 units (exactly 2 succeed), a single-use coupon raced by 3 buyers, forged payment signatures, duplicate and out-of-order webhooks, refunds that run twice but pay once, payments that arrive after cancellation (auto-refunded), expiry with reconciliation, token revocation after a password reset, and role/ownership checks.

## Project layout

```
client/   React + Vite + TypeScript + Tailwind storefront and /admin dashboard
server/   Express 5 + Mongoose API, DemoPay simulator, background jobs, seed data
shared/   Zod schemas, pricing rules, order state machine and types used by both
tests/    Browser walkthrough
docs/     Requirements and decisions
```

Further reading: [ARCHITECTURE.md](ARCHITECTURE.md) · [API_DOCUMENTATION.md](API_DOCUMENTATION.md) · [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) · [PROJECT_STATUS.md](PROJECT_STATUS.md)

## Configuration (optional)

Everything has working defaults. To override, create `server/.env` (see `server/.env.example`). In production (`NODE_ENV=production`) the secrets must be set or the server refuses to start.
