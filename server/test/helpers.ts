import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import { simulator } from '../src/integrations/demopay/simulator';
import { Category } from '../src/models/catalog.model';
import { User } from '../src/models/user.model';
import { createProduct } from '../src/services/adminCatalog.service';

export const app = createApp();
export const api = () => request(app);
export const V1 = '/api/v1';

// Deliver DemoPay webhooks in-process through the real HTTP route, with near-zero delays.
simulator.webhookDelays = [0, 5, 5];
simulator.refundDelayMs = 0;
simulator.transport = async (body, headers) => {
  const res = await request(app).post(`${V1}/webhooks/demopay`).set(headers).send(body);
  return res.status;
};

let counter = 0;

export interface TestUser {
  id: string;
  email: string;
  token: string;
  cookie: string;
  auth: { Authorization: string };
}

export async function makeUser(role: 'customer' | 'admin' = 'customer'): Promise<TestUser> {
  const email = `user${++counter}_${randomUUID().slice(0, 6)}@test.dev`;
  const password = 'Passw0rd!x';
  const reg = await api().post(`${V1}/auth/register`).send({ name: `Test User ${counter}`, email, password }).expect(201);
  if (role === 'admin') await User.updateOne({ email }, { $set: { role: 'admin' } });
  const login = await api().post(`${V1}/auth/login`).send({ email, password }).expect(200);
  const cookie = String(login.headers['set-cookie']?.[0] ?? '').split(';')[0]!;
  return { id: reg.body.data.user.id, email, token: login.body.data.accessToken, cookie, auth: { Authorization: `Bearer ${login.body.data.accessToken}` } };
}

export async function makeAddress(user: TestUser): Promise<string> {
  const res = await api()
    .post(`${V1}/me/addresses`)
    .set(user.auth)
    .send({ fullName: 'Test Person', phone: '9876543210', line1: '12 Test Street', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001' })
    .expect(201);
  return res.body.data.id;
}

export async function makeProduct(admin: TestUser, opts: { stock: number[]; price?: number; name?: string }) {
  let cat = await Category.findOne({ slug: 'test-cat' });
  if (!cat) cat = await Category.create({ name: 'Test Category', slug: 'test-cat' });
  const n = ++counter;
  const created = await createProduct(
    { type: 'admin', id: admin.id },
    {
      name: opts.name ?? `Test Product ${n}`,
      description: 'A product used by tests.',
      tags: [],
      categoryId: cat.id as string,
      status: 'active',
      isFeatured: false,
      options: [{ name: 'Size', values: opts.stock.map((_, i) => `S${i}`) }],
      variants: opts.stock.map((s, i) => ({
        sku: `T${n}-S${i}`,
        optionValues: { Size: `S${i}` },
        price: opts.price ?? 50_000,
        compareAtPrice: null,
        isActive: true,
        initialStock: s,
      })),
      images: [],
    },
  );
  const detail = await api().get(`${V1}/products/${created.slug}`).expect(200);
  return { id: created.id, slug: created.slug, variants: detail.body.data.variants as { id: string; sku: string }[] };
}

export async function addToCart(user: TestUser, productId: string, variantId: string, quantity = 1) {
  return api().post(`${V1}/cart/items`).set(user.auth).send({ productId, variantId, quantity }).expect(200);
}

export async function quote(user: TestUser, couponCode?: string) {
  const res = await api().post(`${V1}/checkout/quote`).set(user.auth).send(couponCode ? { couponCode } : {}).expect(200);
  return res.body.data;
}

export function place(
  user: TestUser,
  body: { addressId: string; paymentMethod: 'online' | 'cod'; couponCode?: string; expectedTotal: number },
  key = randomUUID(),
) {
  return api().post(`${V1}/orders`).set(user.auth).set('Idempotency-Key', key).send(body);
}
