import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { Inventory } from '../src/models/catalog.model';
import { api, addToCart, makeAddress, makeProduct, makeUser, place, quote, V1 } from './helpers';

describe('admin catalog over HTTP', () => {
  it('uploads an image, creates a product with variants and stock, edits it with optimistic concurrency', async () => {
    const admin = await makeUser('admin');
    const png = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#0f766e' } }).png().toBuffer();
    const upload = await api().post(`${V1}/admin/media`).set(admin.auth).attach('files', png, 'photo.png').expect(201);
    const media = upload.body.data[0];
    expect(media.url).toMatch(/\.webp$/);
    expect(media.width).toBe(900);

    // A text file pretending to be an image is rejected after inspection.
    await api().post(`${V1}/admin/media`).set(admin.auth).attach('files', Buffer.from('not an image'), { filename: 'x.png', contentType: 'image/png' }).expect(415);

    const cat = await api().post(`${V1}/admin/categories`).set(admin.auth).send({ name: 'Admin Test Cat' }).expect(201);
    const body = {
      name: 'Admin Made Mug',
      description: 'Made through the admin API.',
      categoryId: cat.body.data.id,
      status: 'active',
      options: [{ name: 'Colour', values: ['Red', 'Blue'] }],
      variants: [
        { sku: 'ADM-MUG-RED', optionValues: { Colour: 'Red' }, price: 34900, compareAtPrice: 49900, initialStock: 7 },
        { sku: 'ADM-MUG-BLU', optionValues: { Colour: 'Blue' }, price: 34900, initialStock: 0 },
      ],
      images: [{ mediaId: media.id, alt: 'Red mug' }],
    };
    const created = await api().post(`${V1}/admin/products`).set(admin.auth).send(body).expect(201);
    const id = created.body.data.id;
    expect(await Inventory.findOne({ sku: 'ADM-MUG-RED' }).lean()).toMatchObject({ available: 7 });

    // Duplicate SKUs within a product are rejected by validation.
    await api().post(`${V1}/admin/products`).set(admin.auth).send({ ...body, name: 'Dup', variants: [body.variants[0], body.variants[0]] }).expect(400);

    const detail = await api().get(`${V1}/admin/products/${id}`).set(admin.auth).expect(200);
    const product = detail.body.data;
    const variants = product.variants.map((v: { id: string; sku: string; optionValues: object; price: number }) => ({ id: v.id, sku: v.sku, optionValues: v.optionValues, price: 29900 }));
    const update = { ...body, version: product.version, variants, images: [{ mediaId: media.id, alt: 'Red mug' }] };
    await api().patch(`${V1}/admin/products/${id}`).set(admin.auth).send(update).expect(200);
    // The same (now stale) version again → someone else changed it.
    const stale = await api().patch(`${V1}/admin/products/${id}`).set(admin.auth).send(update).expect(409);
    expect(stale.body.error.code).toBe('STALE_VERSION');

    const pub = await api().get(`${V1}/products/${created.body.data.slug}`).expect(200);
    expect(pub.body.data.priceMin).toBe(29900);
    expect(pub.body.data.variants.find((v: { sku: string }) => v.sku === 'ADM-MUG-BLU').inStock).toBe(false);

    // Never ordered → can be deleted; the category is then empty and can be deleted too.
    await api().delete(`${V1}/admin/categories/${cat.body.data.id}`).set(admin.auth).expect(409);
    await api().delete(`${V1}/admin/products/${id}`).set(admin.auth).expect(204);
    await api().delete(`${V1}/admin/categories/${cat.body.data.id}`).set(admin.auth).expect(204);
  });

  it('refuses to delete a product that has been ordered', async () => {
    const admin = await makeUser('admin');
    const customer = await makeUser();
    const addressId = await makeAddress(customer);
    const p = await makeProduct(admin, { stock: [3] });
    await addToCart(customer, p.id, p.variants[0]!.id, 1);
    const q = await quote(customer);
    await place(customer, { addressId, paymentMethod: 'cod', expectedTotal: q.total }).expect(201);
    const res = await api().delete(`${V1}/admin/products/${p.id}`).set(admin.auth).expect(409);
    expect(res.body.error.message).toMatch(/Archive it instead/);
  });
});

describe('admin operations over HTTP', () => {
  it('adjusts inventory with a ledger and never below zero', async () => {
    const admin = await makeUser('admin');
    const p = await makeProduct(admin, { stock: [2] });
    const sku = p.variants[0]!.sku;
    await api().post(`${V1}/admin/inventory/${sku}/adjust`).set(admin.auth).send({ type: 'restock', delta: 5, reason: 'Delivery' }).expect(200);
    await api().post(`${V1}/admin/inventory/${sku}/adjust`).set(admin.auth).send({ type: 'adjustment', delta: -100, reason: 'Oops' }).expect(409);
    await api().post(`${V1}/admin/inventory/${sku}/adjust`).set(admin.auth).send({ type: 'adjustment', delta: -1, reason: 'Damaged' }).expect(200);
    expect(await Inventory.findOne({ sku }).lean()).toMatchObject({ available: 6 });
    const moves = await api().get(`${V1}/admin/inventory/${sku}/movements`).set(admin.auth).expect(200);
    expect(moves.body.data.map((m: { type: string }) => m.type)).toEqual(['adjustment', 'restock', 'initial']);
  });

  it('manages coupons and locks the terms once used', async () => {
    const admin = await makeUser('admin');
    const now = Date.now();
    const created = await api()
      .post(`${V1}/admin/coupons`)
      .set(admin.auth)
      .send({ code: 'save50', type: 'fixed', value: 5000, minOrderValue: 0, startsAt: new Date(now - 1000).toISOString(), endsAt: new Date(now + 86_400_000).toISOString() })
      .expect(201);
    expect(created.body.data).toMatchObject({ code: 'SAVE50', state: 'active', usedCount: 0 });
    await api().post(`${V1}/admin/coupons`).set(admin.auth).send({ code: 'BAD', type: 'percentage', value: 95, startsAt: new Date().toISOString(), endsAt: new Date(now + 1000).toISOString() }).expect(400);

    const customer = await makeUser();
    const addressId = await makeAddress(customer);
    const p = await makeProduct(admin, { stock: [3], price: 60_000 });
    await addToCart(customer, p.id, p.variants[0]!.id, 1);
    const q = await quote(customer, 'SAVE50');
    expect(q.discount).toBe(5000);
    await place(customer, { addressId, paymentMethod: 'cod', couponCode: 'SAVE50', expectedTotal: q.total }).expect(201);

    const c = (await api().get(`${V1}/admin/coupons?q=SAVE50`).set(admin.auth).expect(200)).body.data[0];
    expect(c.usedCount).toBe(1);
    await api().patch(`${V1}/admin/coupons/${c.id}`).set(admin.auth).send({ code: 'SAVE50', type: 'fixed', value: 9999, minOrderValue: 0, startsAt: c.startsAt, endsAt: c.endsAt, version: c.version }).expect(409);
    await api().delete(`${V1}/admin/coupons/${c.id}`).set(admin.auth).expect(409);
    const usage = await api().get(`${V1}/admin/coupons/${c.id}/redemptions`).set(admin.auth).expect(200);
    expect(usage.body.data).toHaveLength(1);
  });

  it('moderates reviews and recalculates the rating', async () => {
    const admin = await makeUser('admin');
    const customer = await makeUser();
    const addressId = await makeAddress(customer);
    const p = await makeProduct(admin, { stock: [3] });
    await addToCart(customer, p.id, p.variants[0]!.id, 1);
    const q = await quote(customer);
    const { orderNumber } = (await place(customer, { addressId, paymentMethod: 'cod', expectedTotal: q.total }).expect(201)).body.data.order;
    for (const body of [{ status: 'processing' }, { status: 'shipped', carrier: 'Ekart', trackingNumber: 'T1' }, { status: 'delivered' }]) {
      await api().post(`${V1}/admin/orders/${orderNumber}/status`).set(admin.auth).send(body).expect(200);
    }
    const review = await api().post(`${V1}/products/${p.slug}/reviews`).set(customer.auth).send({ rating: 2, title: 'Meh', body: 'Not great, not terrible.' }).expect(201);
    expect((await api().get(`${V1}/products/${p.slug}`).expect(200)).body.data.ratingCount).toBe(1);
    await api().patch(`${V1}/admin/reviews/${review.body.data.id}`).set(admin.auth).send({ status: 'hidden' }).expect(200);
    const after = (await api().get(`${V1}/products/${p.slug}`).expect(200)).body.data;
    expect(after).toMatchObject({ ratingCount: 0, ratingAvg: 0 });
  });

  it('updates settings with a version check, reports sales as CSV and records an audit trail', async () => {
    const admin = await makeUser('admin');
    const s = (await api().get(`${V1}/admin/settings`).set(admin.auth).expect(200)).body.data;
    await api().patch(`${V1}/admin/settings`).set(admin.auth).send({ version: s.version, shippingFlatFee: 5900 }).expect(200);
    await api().patch(`${V1}/admin/settings`).set(admin.auth).send({ version: s.version, shippingFlatFee: 6900 }).expect(409);
    expect((await api().get(`${V1}/config`).expect(200)).body.data.shippingFlatFee).toBe(5900);

    const today = new Date().toISOString().slice(0, 10);
    const csv = await api().get(`${V1}/admin/reports/sales?from=${today}&to=${today}&format=csv`).set(admin.auth).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\r\n')[0]).toMatch(/^Date,Orders,Gross sales/);

    const audit = await api().get(`${V1}/admin/audit-logs?q=settings`).set(admin.auth).expect(200);
    expect(audit.body.data[0]).toMatchObject({ action: 'settings.update', entityType: 'settings' });
    const dash = await api().get(`${V1}/admin/dashboard?range=7d`).set(admin.auth).expect(200);
    expect(dash.body.data.series).toHaveLength(7);
  });
});
