import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Inventory } from '../src/models/catalog.model';
import { Coupon } from '../src/models/order.model';
import { api, addToCart, makeAddress, makeProduct, makeUser, place, quote, V1 } from './helpers';

const stockOf = async (sku: string) => (await Inventory.findOne({ sku }).lean())!;

describe('checkout with Cash on Delivery', () => {
  it('prices on the server, allocates stock, clears the cart and is idempotent', async () => {
    const admin = await makeUser('admin');
    const customer = await makeUser();
    const addressId = await makeAddress(customer);
    const p = await makeProduct(admin, { stock: [5], price: 40_000 });
    await addToCart(customer, p.id, p.variants[0]!.id, 2);

    const q = await quote(customer);
    expect(q).toMatchObject({ subtotal: 80_000, discount: 0, shippingFee: 4_900, total: 84_900 });
    expect(q.cod.available).toBe(true);

    const key = randomUUID();
    const body = { addressId, paymentMethod: 'cod' as const, expectedTotal: q.total };
    const first = await place(customer, body, key).expect(201);
    expect(first.body.data.order).toMatchObject({ status: 'confirmed', paymentStatus: 'unpaid', paymentMethod: 'cod' });
    expect(first.body.data.payment).toBeNull();

    const inv = await stockOf(p.variants[0]!.sku);
    expect(inv).toMatchObject({ available: 3, reserved: 0, allocated: 2 });

    // Same key again (double click / network retry) → the same order, no second stock movement.
    const replay = await place(customer, body, key).expect(201);
    expect(replay.body.data.order.orderNumber).toBe(first.body.data.order.orderNumber);
    expect((await stockOf(p.variants[0]!.sku)).available).toBe(3);
    // Same key with a different payload is refused.
    await place(customer, { ...body, expectedTotal: 1 }, key).expect(422);

    const cart = await api().get(`${V1}/cart`).set(customer.auth).expect(200);
    expect(cart.body.data.items).toHaveLength(0);
  });

  it('refuses a stale total and a tampered price', async () => {
    const admin = await makeUser('admin');
    const customer = await makeUser();
    const addressId = await makeAddress(customer);
    const p = await makeProduct(admin, { stock: [5], price: 120_000 });
    await addToCart(customer, p.id, p.variants[0]!.id, 1);
    const res = await place(customer, { addressId, paymentMethod: 'cod', expectedTotal: 100 }).expect(409);
    expect(res.body.error.code).toBe('PRICE_CHANGED');
    expect(res.body.error.details.total).toBe(120_000);
  });

  it('cancels and returns exactly the allocated stock', async () => {
    const admin = await makeUser('admin');
    const customer = await makeUser();
    const addressId = await makeAddress(customer);
    const p = await makeProduct(admin, { stock: [4] });
    await addToCart(customer, p.id, p.variants[0]!.id, 3);
    const q = await quote(customer);
    const order = (await place(customer, { addressId, paymentMethod: 'cod', expectedTotal: q.total }).expect(201)).body.data.order;
    expect(await stockOf(p.variants[0]!.sku)).toMatchObject({ available: 1, allocated: 3 });

    const cancelled = await api().post(`${V1}/orders/${order.orderNumber}/cancel`).set(customer.auth).send({ reason: 'Changed my mind' }).expect(200);
    expect(cancelled.body.data.status).toBe('cancelled');
    expect(await stockOf(p.variants[0]!.sku)).toMatchObject({ available: 4, reserved: 0, allocated: 0 });
    await api().post(`${V1}/orders/${order.orderNumber}/cancel`).set(customer.auth).send({ reason: 'Again' }).expect(409);
  });

  it('never oversells: 6 simultaneous orders for the last 2 units → exactly 2 succeed', async () => {
    const admin = await makeUser('admin');
    const p = await makeProduct(admin, { stock: [2], price: 30_000 });
    const buyers = await Promise.all(Array.from({ length: 6 }, () => makeUser()));
    const prepared = await Promise.all(
      buyers.map(async (b) => {
        const addressId = await makeAddress(b);
        await addToCart(b, p.id, p.variants[0]!.id, 1);
        const q = await quote(b);
        return { b, addressId, total: q.total };
      }),
    );
    const results = await Promise.all(prepared.map(({ b, addressId, total }) => place(b, { addressId, paymentMethod: 'cod', expectedTotal: total })));
    const ok = results.filter((r) => r.status === 201);
    const soldOut = results.filter((r) => r.status === 409 && r.body.error.code === 'OUT_OF_STOCK');
    expect(ok).toHaveLength(2);
    expect(soldOut).toHaveLength(4);
    expect(await stockOf(p.variants[0]!.sku)).toMatchObject({ available: 0, allocated: 2 });
  });
});

describe('coupons', () => {
  it('applies a coupon and enforces a single-use limit under concurrency', async () => {
    const admin = await makeUser('admin');
    const p = await makeProduct(admin, { stock: [20], price: 100_000 });
    await Coupon.create({
      code: 'ONCEONLY', type: 'percentage', value: 10, maxDiscount: 5_000, minOrderValue: 0, usageLimit: 1, perUserLimit: 1,
      startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 86_400_000),
    });
    const buyers = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const prepared = await Promise.all(
      buyers.map(async (b) => {
        const addressId = await makeAddress(b);
        await addToCart(b, p.id, p.variants[0]!.id, 1);
        const q = await quote(b, 'ONCEONLY');
        expect(q.discount).toBe(5_000); // 10% capped at ₹50
        return { b, addressId, total: q.total };
      }),
    );
    const results = await Promise.all(
      prepared.map(({ b, addressId, total }) => place(b, { addressId, paymentMethod: 'cod', couponCode: 'ONCEONLY', expectedTotal: total })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 422 && r.body.error.code === 'COUPON_INVALID')).toHaveLength(2);
    expect((await Coupon.findOne({ code: 'ONCEONLY' }))!.usedCount).toBe(1);
  });

  it('explains why a coupon does not apply', async () => {
    const customer = await makeUser();
    const admin = await makeUser('admin');
    const p = await makeProduct(admin, { stock: [3], price: 20_000 });
    await addToCart(customer, p.id, p.variants[0]!.id, 1);
    await Coupon.create({ code: 'BIGSPEND', type: 'fixed', value: 10_000, minOrderValue: 500_000, startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 86_400_000) });
    expect((await quote(customer, 'BIGSPEND')).couponError.reason).toBe('min_order_value');
    expect((await quote(customer, 'NOSUCHCODE')).couponError.reason).toBe('not_found');
  });
});

describe('admin fulfilment', () => {
  it('ships, delivers (COD becomes paid) and rejects invalid transitions', async () => {
    const admin = await makeUser('admin');
    const customer = await makeUser();
    const addressId = await makeAddress(customer);
    const p = await makeProduct(admin, { stock: [3] });
    await addToCart(customer, p.id, p.variants[0]!.id, 1);
    const q = await quote(customer);
    const { orderNumber } = (await place(customer, { addressId, paymentMethod: 'cod', expectedTotal: q.total }).expect(201)).body.data.order;
    const status = (body: object) => api().post(`${V1}/admin/orders/${orderNumber}/status`).set(admin.auth).send(body);

    await status({ status: 'delivered' }).expect(409);
    await status({ status: 'processing' }).expect(200);
    await status({ status: 'shipped' }).expect(400); // tracking required
    await status({ status: 'shipped', carrier: 'Delhivery', trackingNumber: 'TRK123' }).expect(200);
    expect(await stockOf(p.variants[0]!.sku)).toMatchObject({ available: 2, allocated: 0 });
    await status({ status: 'delivered' }).expect(200);

    const detail = await api().get(`${V1}/orders/${orderNumber}`).set(customer.auth).expect(200);
    expect(detail.body.data).toMatchObject({ status: 'delivered', paymentStatus: 'paid' });
    expect(detail.body.data.fulfilment.trackingNumber).toBe('TRK123');
    expect(detail.body.data.statusHistory.map((e: { status: string }) => e.status)).toEqual(['confirmed', 'processing', 'shipped', 'delivered']);

    // Verified buyer can now review, once.
    await api().post(`${V1}/products/${p.slug}/reviews`).set(customer.auth).send({ rating: 5, title: 'Great', body: 'Really good product.' }).expect(201);
    await api().post(`${V1}/products/${p.slug}/reviews`).set(customer.auth).send({ rating: 4, title: 'Again', body: 'Trying a second time.' }).expect(409);
    const other = await makeUser();
    await api().post(`${V1}/products/${p.slug}/reviews`).set(other.auth).send({ rating: 1, title: 'Fake', body: 'Never bought it.' }).expect(422);
  });

  it('restocks an order returned to origin', async () => {
    const admin = await makeUser('admin');
    const customer = await makeUser();
    const addressId = await makeAddress(customer);
    const p = await makeProduct(admin, { stock: [2] });
    await addToCart(customer, p.id, p.variants[0]!.id, 2);
    const q = await quote(customer);
    const { orderNumber } = (await place(customer, { addressId, paymentMethod: 'cod', expectedTotal: q.total }).expect(201)).body.data.order;
    const status = (body: object) => api().post(`${V1}/admin/orders/${orderNumber}/status`).set(admin.auth).send(body).expect(200);
    await status({ status: 'processing' });
    await status({ status: 'shipped', carrier: 'Ekart', trackingNumber: 'X1' });
    expect(await stockOf(p.variants[0]!.sku)).toMatchObject({ available: 0, allocated: 0 });
    await status({ status: 'undelivered', undeliveredReason: 'returned_to_origin' });
    expect(await stockOf(p.variants[0]!.sku)).toMatchObject({ available: 2 });
  });
});
