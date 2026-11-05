# Working agreement for this repository

This is a full-stack e-commerce platform built in phases. Before doing anything, read `PROJECT_STATUS.md` (current phase, open questions, next step) and the relevant parts of `ARCHITECTURE.md` and `IMPLEMENTATION_PLAN.md`.

## Rules

- Inspect existing files before changing them; never overwrite work you have not read.
- "Implement the next feature" means the first feature in `IMPLEMENTATION_PLAN.md` whose status is not ✅.
- A feature is ✅ only when it meets the definition of done at the top of `IMPLEMENTATION_PLAN.md`. Never mark something done, or say it works, without running the tests that prove it.
- No mock or placeholder functionality in the product. Test doubles are allowed only inside tests, and only at integration boundaries (Razorpay HTTP, SMTP, storage).
- After each feature: run lint, typecheck and the full test suite; update `API_DOCUMENTATION.md` statuses and `PROJECT_STATUS.md`.
- Commit at milestone boundaries (and after significant features) with clear messages.
- Ask the owner when a business decision materially changes architecture or behaviour; otherwise choose a sensible default and record it in `PROJECT_STATUS.md` → Decision log.

## Conventions

- Money is always integer paise. Format only in the UI with the shared helper.
- Validation schemas live in `shared/` and are used by both the API and the forms.
- Server layering: routes → controllers (HTTP only) → services (business logic, transactions) → models. Third-party calls live in `server/src/integrations`.
- Files are named by domain: `order.model.ts`, `order.service.ts`, `order.controller.ts`, `order.routes.ts`.
- Never return raw Mongoose documents; use the serializers.
- Never call external services (Razorpay, email, storage) inside a database transaction.
- Secrets come from environment variables only; update `.env.example` when adding one.

## Environment notes

- Windows 11 development machine; the project path contains a space — always quote paths in scripts.
- Package manager: npm workspaces (`shared`, `server`, `client`). Node 24.
- Run everything with `npm start` (local MongoDB replica set on :27027, API on :4000, web on :5173). Reset demo data: `npm run seed -- -- --reset`.
- Tests: `npm test` (in-memory MongoDB), `node tests/e2e/walkthrough.mjs` (needs the app running; uses installed Edge).
- Payments use the DemoPay simulator (virtual money) by the owner's decision; do not wire a real gateway without asking.
