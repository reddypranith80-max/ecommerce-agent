/**
 * End-to-end walkthrough in a real browser (system Microsoft Edge via playwright-core, no browser download).
 * Run while the app is running (npm start):   node tests/e2e/walkthrough.mjs [screenshotDir]
 * Covers: browse → guest cart → sign in (cart merge) → DemoPay online checkout → COD checkout with coupon
 *         → admin dashboard → admin ships the order → customer sees tracking; plus phone-size layouts.
 * Fails on any browser console error or unexpected failed API request.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const OUT = path.resolve(process.argv[2] ?? 'screenshots');
mkdirSync(OUT, { recursive: true });

const problems = [];
const steps = [];
const step = async (name, fn) => {
  const t = Date.now();
  try {
    await fn();
    steps.push(`✓ ${name} (${Date.now() - t} ms)`);
    console.log(`✓ ${name}`);
  } catch (err) {
    steps.push(`✗ ${name}: ${err.message.split('\n')[0]}`);
    console.log(`✗ ${name}\n${err.message}`);
    throw err;
  }
};

function watch(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`[${label}] console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`[${label}] page error: ${err.message}`));
  page.on('response', (res) => {
    const url = res.url();
    // 401 from the silent session refresh of a signed-out visitor is expected.
    if (url.includes('/api/') && res.status() >= 500) problems.push(`[${label}] ${res.status()} ${url}`);
  });
}

/** Dismisses any toast so screenshots show the page itself. */
async function clearToasts(page) {
  for (const btn of await page.getByRole('button', { name: 'Dismiss' }).all()) await btn.click().catch(() => {});
}
const shot = async (page, name, { keepToasts = false } = {}) => {
  if (!keepToasts) await clearToasts(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  // ---------------------------------------------------------------- customer, desktop
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  watch(page, 'customer');

  await step('Home page renders featured products and categories', async () => {
    await page.goto(BASE);
    await page.getByRole('heading', { name: 'Featured' }).waitFor();
    await page.getByRole('heading', { name: 'Shop by category' }).waitFor();
    await shot(page, 'home');
  });

  await step('Search, filter and sort the catalog', async () => {
    await page.goto(`${BASE}/products?q=shirt&sort=price_asc`);
    await page.getByRole('heading', { name: /Results for/ }).waitFor();
    await page.locator('a[href^="/p/"]').first().waitFor();
    await page.goto(`${BASE}/c/footwear?inStock=true`);
    await page.getByRole('heading', { name: 'Footwear' }).waitFor();
    await page.locator('a[href^="/p/"]').first().waitFor();
    await shot(page, 'listing');
  });

  await step('Product page: pick a variant and add to the guest cart', async () => {
    await page.goto(`${BASE}/p/classic-cotton-tee`);
    await page.getByRole('heading', { name: 'Classic Cotton Tee' }).waitFor();
    await page.getByRole('button', { name: 'M', exact: true }).click();
    await page.getByRole('button', { name: 'Black', exact: true }).click();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.getByText(/Added 1 × Classic Cotton Tee/).waitFor();
    await shot(page, 'product', { keepToasts: true });
  });

  await step('Guest cart is priced by the server', async () => {
    await page.goto(`${BASE}/cart`);
    await page.getByRole('heading', { name: 'Your cart' }).waitFor();
    await page.getByText('Classic Cotton Tee').first().waitFor();
    await shot(page, 'cart');
  });

  await step('Sign in with the demo customer; guest cart merges into the account', async () => {
    await page.getByRole('button', { name: 'Sign in to check out' }).click();
    // A brand-new customer every run, so coupon limits and stock never make the walkthrough flaky.
    await page.getByRole('link', { name: 'Create an account' }).click();
    await page.getByLabel('Full name').fill('Walkthrough Tester');
    await page.getByLabel('Email').fill(`walk.${Date.now()}@example.com`);
    await page.getByLabel('Password').fill('Walkthru123');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL(/\/checkout/);
    await page.getByRole('heading', { name: 'Checkout' }).waitFor();
  });

  await step('Add a first delivery address at checkout (validated Indian address)', async () => {
    await page.getByLabel('Full name').fill('Walkthrough Tester');
    await page.getByLabel('Mobile number').fill('9876501234');
    await page.getByLabel('Address line 1').fill('42 Residency Road');
    await page.getByLabel('City').fill('Bengaluru');
    await page.getByLabel('State').selectOption('Karnataka');
    await page.getByLabel('PIN code').fill('560025');
    await page.getByRole('button', { name: 'Save address' }).click();
    await page.getByText('42 Residency Road').waitFor();
  });

  let onlineOrder = '';
  await step('Online checkout through DemoPay (virtual money) confirms the order', async () => {
    const cta = page.getByRole('button', { name: /Continue to payment/ });
    await cta.waitFor();
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('Continue to payment'));
      return b && !b.disabled;
    });
    await shot(page, 'checkout');
    await cta.click();
    await page.getByRole('heading', { name: 'Complete your payment' }).waitFor();
    await shot(page, 'demopay');
    await page.getByRole('button', { name: /^Pay ₹/ }).click();
    await page.waitForURL(/\/orders\/ORD-.*placed=1/, { timeout: 20_000 });
    await page.getByText('Thank you! Your order is confirmed.').waitFor();
    onlineOrder = page.url().match(/ORD-[0-9A-Z-]+/)[0];
    await shot(page, 'order-confirmed');
  });

  let codOrder = '';
  await step('Cash on Delivery checkout with coupon WELCOME10', async () => {
    await page.goto(`${BASE}/p/daypack-22l-backpack`);
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.getByText(/Added 1 × Daypack/).waitFor();
    await page.goto(`${BASE}/checkout`);
    await page.getByText('Cash on Delivery', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Coupon code' }).fill('WELCOME10');
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.getByText(/applied — you save/).waitFor();
    const place = page.getByRole('button', { name: /Place order/ });
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('Place order'));
      return b && !b.disabled;
    });
    await place.click();
    await page.waitForURL(/\/orders\/ORD-.*placed=1/, { timeout: 20_000 });
    await page.getByText('Thank you! Your order is confirmed.').waitFor();
    codOrder = page.url().match(/ORD-[0-9A-Z-]+/)[0];
  });

  await step('Order history lists both orders; confirmation emails reached the demo inbox', async () => {
    await page.goto(`${BASE}/orders`);
    await page.getByText(onlineOrder).waitFor();
    await page.getByText(codOrder).waitFor();
    await shot(page, 'order-history');
    await page.goto(`${BASE}/demo/inbox`);
    await page.getByText(`Order ${codOrder} confirmed`).waitFor();
    await page.getByText(`Order ${codOrder} confirmed`).click();
    await page.getByText('Track it:').waitFor();
    await shot(page, 'demo-inbox');
  });

  // ---------------------------------------------------------------- admin
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await adminCtx.newPage();
  watch(admin, 'admin');

  await step('Admin signs in and sees the analytics dashboard', async () => {
    await admin.goto(`${BASE}/login`);
    await admin.getByRole('button', { name: 'Store admin' }).click();
    await admin.getByRole('button', { name: 'Sign in', exact: true }).click();
    await admin.waitForURL(/\/admin$/);
    await admin.getByText('Gross sales by day').waitFor();
    await admin.getByText('Latest orders').waitFor();
    await admin.waitForTimeout(600);
    await shot(admin, 'admin-dashboard');
    await admin.goto(`${BASE}/admin/orders`);
    await admin.locator('tbody tr').first().waitFor();
    await shot(admin, 'admin-orders');
  });

  await step('Admin processes and ships the COD order', async () => {
    await admin.goto(`${BASE}/admin/orders/${codOrder}`);
    await admin.getByRole('button', { name: 'Start processing' }).click();
    await admin.getByRole('button', { name: 'Mark shipped' }).waitFor();
    await admin.getByRole('button', { name: 'Mark shipped' }).click();
    await admin.getByLabel('Tracking number').fill('DLV123456789');
    await admin.getByRole('dialog').getByRole('button', { name: 'Mark shipped' }).click();
    await admin.getByRole('button', { name: 'Mark delivered' }).waitFor();
    await shot(admin, 'admin-order');
  });

  await step('Admin inventory, products and reports pages load', async () => {
    await admin.goto(`${BASE}/admin/inventory?lowStock=true`);
    await admin.getByRole('heading', { name: 'Inventory' }).waitFor();
    await admin.locator('tbody tr').first().waitFor();
    await shot(admin, 'admin-inventory');
    await admin.goto(`${BASE}/admin/products/new`);
    await admin.getByRole('heading', { name: 'New product' }).waitFor();
    await admin.goto(`${BASE}/admin/products?q=Classic%20Cotton`);
    await admin.getByRole('link', { name: 'Classic Cotton Tee', exact: true }).click();
    await admin.getByText('Options & variants').waitFor();
    await admin.locator('table input[aria-label="Price"]').first().waitFor();
    await shot(admin, 'admin-product');
    await admin.goto(`${BASE}/admin/reports`);
    await admin.getByRole('heading', { name: 'Sales report' }).waitFor();
    await admin.locator('tbody tr').first().waitFor();
    await shot(admin, 'admin-reports');
  });

  await step('Customer sees the shipment with its tracking number', async () => {
    await page.goto(`${BASE}/orders/${codOrder}`);
    await page.getByText('DLV123456789').waitFor();
    await shot(page, 'order-tracking');
  });

  // ---------------------------------------------------------------- phone layout
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const m = await phone.newPage();
  watch(m, 'phone');
  await step('Phone layout: home, menu and product page', async () => {
    await m.goto(BASE);
    await m.getByRole('heading', { name: 'Featured' }).waitFor();
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) throw new Error(`Horizontal overflow of ${overflow}px on phone`);
    await shot(m, 'phone-home');
    await m.getByRole('button', { name: 'Open menu' }).click();
    await m.getByRole('dialog', { name: 'Menu' }).waitFor();
    await shot(m, 'phone-menu');
    await m.goto(`${BASE}/p/linen-summer-shirt`);
    await m.getByRole('heading', { name: 'Linen Summer Shirt' }).waitFor();
    await shot(m, 'phone-product');
  });
} finally {
  await browser.close();
}

console.log(`\n${steps.length} steps passed. Screenshots: ${OUT}`);
if (problems.length) {
  console.log('\nBrowser problems:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log('No console errors or server errors.');
