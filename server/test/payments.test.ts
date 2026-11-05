import { describe, expect, it } from 'vitest';
import { simulator } from '../src/integrations/demopay/simulator';
import { demoPay } from '../src/integrations/demopay/client';
import { expireUnpaidOrders } from '../src/jobs';
import { Inventory } from '../src/models/catalog.model';
import { Order, Payment, Refund, WebhookEvent } from '../src/models/order.model';
import { processRefundQueue } from '../src/services/payment.service';
import { api, addToCart, makeAddress, makeProduct, makeUser, place, quote, V1, type TestUser } from './helpers';

const stockOf = async (sku: string) => (await Inventory.findOne({ sku }).lean())!;

async function onlineOrder(qty = 1, stock = 5) {
  const admin = await makeUser('admin');
  const customer = await makeUser();
  const addressId = await makeAddress(customer);
  const p = await makeProduct(admin, { stock: [stock], price: 70_000 });
  await addToCart(customer, p.id, p.variants[0]!.id, qty);
  const q = await quote(customer);
  const res = await place(customer, { addressId, paymentMethod: 'online', expectedTotal: q.total }).expect(201);
  return { admin, customer, addressId, p, sku: p.variants[0]!.sku, order: res.body.data.order, payment: res.body.data.payment };
}

const verify = (customer: TestUser, body: object) => api().post(`${V1}/payments/verify`).set(customer.auth).send(body);

describe('online payment (DemoPay)', () => {
  it('reserves stock, verifies the signed payment server-side, confirms once', async () => {
    const { customer, sku, order, payment } = await onlineOrder(2);
    expect(order).toMatchObject({ status: 'pending_payment', paymentStatus: 'unpaid', canPay: true });
    expect(payment).toMatchObject({ provider: 'demopay', amount: order.pricing.total, currency: 'INR' });
    expect(await stockOf(sku)).toMatchObject({ available: 3, reserved: 2, allocated: 0 });

    const paid = await simulator.pay(payment.gatewayOrderId, 'upi', 'success');
    if (paid.closed) throw new Error('unexpected');
    const body = { orderNumber: order.orderNumber, gatewayOrderId: paid.gatewayOrderId, gatewayPaymentId: paid.gatewayPaymentId, signature: paid.signature };

    // A forged signature is rejected.
    const forged = await verify(customer, { ...body, signature: 'f'.repeat(64) }).expect(400);
    expect(forged.body.error.code).toBe('PAYMENT_VERIFICATION_FAILED');

    const ok = await verify(customer, body).expect(200);
    expect(ok.body.data).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });
    expect(await stockOf(sku)).toMatchObject({ available: 3, reserved: 0, allocated: 2 });

    // The browser callback and the webhook both arrive: still exactly one payment applied, no refund.
    await simulator.flush();
    await verify(customer, body).expect(200);
    expect(await Payment.countDocuments({ orderId: order.id, disposition: 'applied' })).toBe(1);
    expect(await Refund.countDocuments({ orderId: order.id })).toBe(0);
    expect(await stockOf(sku)).toMatchObject({ allocated: 2 });
  });

  it('confirms from the webhook alone when the shopper closes the tab', async () => {
    const { sku, order, payment } = await onlineOrder(1);
    const res = await simulator.pay(payment.gatewayOrderId, 'card', 'success_close');
    expect(res.closed).toBe(true);
    await simulator.flush();
    const fresh = await Order.findById(order.id).lean();
    expect(fresh).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });
    expect(await stockOf(sku)).toMatchObject({ reserved: 0, allocated: 1 });
    expect(await WebhookEvent.countDocuments({ type: 'payment.captured' })).toBeGreaterThan(0);
  });

  it('rejects webhooks with a bad signature and ignores duplicates', async () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: {} });
    await api().post(`${V1}/webhooks/demopay`).set('content-type', 'application/json').set('x-demopay-signature', 'bad').set('x-demopay-event-id', 'evt_x').send(body).expect(400);
    const signed = demoPay.webhookSignature(JSON.stringify({ event: 'something.else', payload: {} }));
    const send = () =>
      api()
        .post(`${V1}/webhooks/demopay`)
        .set('content-type', 'application/json')
        .set('x-demopay-signature', signed)
        .set('x-demopay-event-id', 'evt_dupe_1')
        .send(JSON.stringify({ event: 'something.else', payload: {} }));
    expect((await send().expect(200)).body.data.outcome).toBe('ignored');
    expect((await send().expect(200)).body.data.outcome).toBe('duplicate');
  });

  it('keeps the order payable after a failed attempt (same gateway order)', async () => {
    const { customer, order, payment } = await onlineOrder(1);
    await expect(simulator.pay(payment.gatewayOrderId, 'upi', 'failure')).rejects.toMatchObject({ code: 'PAYMENT_DECLINED' });
    await simulator.flush();
    const retry = await api().post(`${V1}/orders/${order.orderNumber}/payment`).set(customer.auth).expect(200);
    expect(retry.body.data.gatewayOrderId).toBe(payment.gatewayOrderId);
    expect((await Order.findById(order.id).lean())!.status).toBe('pending_payment');
    expect(await Payment.countDocuments({ orderId: order.id, status: 'failed' })).toBe(1);
  });

  it('refunds a paid order that is cancelled, exactly once', async () => {
    const { customer, sku, order, payment } = await onlineOrder(1);
    const paid = await simulator.pay(payment.gatewayOrderId, 'netbanking', 'success');
    if (paid.closed) throw new Error('unexpected');
    await verify(customer, { orderNumber: order.orderNumber, gatewayOrderId: paid.gatewayOrderId, gatewayPaymentId: paid.gatewayPaymentId, signature: paid.signature }).expect(200);
    await simulator.flush();

    const cancelled = await api().post(`${V1}/orders/${order.orderNumber}/cancel`).set(customer.auth).send({ reason: 'No longer needed' }).expect(200);
    expect(cancelled.body.data.paymentStatus).toBe('refund_pending');
    expect(await stockOf(sku)).toMatchObject({ available: 5, reserved: 0, allocated: 0 });

    await processRefundQueue();
    await processRefundQueue(); // running the job again must not refund twice
    await simulator.flush();
    const refunds = await Refund.find({ orderId: order.id }).lean();
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ status: 'processed', amount: order.pricing.total, reason: 'order_cancelled' });
    expect((await Order.findById(order.id).lean())!.paymentStatus).toBe('refunded');
    const gatewayRefunds = await demoPay.fetchRefunds(paid.gatewayPaymentId);
    expect(gatewayRefunds).toHaveLength(1);
  });

  it('automatically refunds money that arrives after the order was cancelled', async () => {
    const { customer, order, payment } = await onlineOrder(1);
    await api().post(`${V1}/orders/${order.orderNumber}/cancel`).set(customer.auth).send({ reason: 'Cancel first' }).expect(200);
    // The shopper still had the payment page open and paid anyway.
    await simulator.pay(payment.gatewayOrderId, 'upi', 'success_close');
    await simulator.flush();
    await processRefundQueue();
    await simulator.flush();
    const fresh = await Order.findById(order.id).lean();
    expect(fresh).toMatchObject({ status: 'cancelled', paymentStatus: 'refunded' });
    const refund = await Refund.findOne({ orderId: order.id }).lean();
    expect(refund).toMatchObject({ reason: 'late_payment', status: 'processed' });
  });

  it('expires unpaid orders after the window and releases the reservation', async () => {
    const { sku, order } = await onlineOrder(2);
    expect(await stockOf(sku)).toMatchObject({ reserved: 2 });
    await Order.updateOne({ _id: order.id }, { $set: { reservationExpiresAt: new Date(Date.now() - 60 * 60_000) } });
    const expired = await expireUnpaidOrders();
    expect(expired).toBeGreaterThanOrEqual(1);
    expect((await Order.findById(order.id).lean())!.status).toBe('expired');
    expect(await stockOf(sku)).toMatchObject({ available: 5, reserved: 0 });
  });

  it('does not expire an order whose payment was captured but never reported (reconciliation)', async () => {
    const { sku, order, payment } = await onlineOrder(1);
    const saved = simulator.webhooksEnabled;
    simulator.webhooksEnabled = false; // the webhook is "lost"
    await simulator.pay(payment.gatewayOrderId, 'upi', 'success_close');
    simulator.webhooksEnabled = saved;
    await Order.updateOne({ _id: order.id }, { $set: { reservationExpiresAt: new Date(Date.now() - 60 * 60_000) } });
    await expireUnpaidOrders();
    expect((await Order.findById(order.id).lean())!.status).toBe('confirmed');
    expect(await stockOf(sku)).toMatchObject({ reserved: 0, allocated: 1 });
  });

  it('lets a new online order replace the previous unpaid one', async () => {
    const { customer, addressId, p, sku, order } = await onlineOrder(1);
    await addToCart(customer, p.id, p.variants[0]!.id, 1); // cart still holds the first item; now 2 units
    const q = await quote(customer);
    const second = await place(customer, { addressId, paymentMethod: 'online', expectedTotal: q.total }).expect(201);
    expect((await Order.findById(order.id).lean())!.status).toBe('cancelled');
    expect(second.body.data.order.status).toBe('pending_payment');
    expect(await stockOf(sku)).toMatchObject({ available: 3, reserved: 2 });
  });
});
