import type { PaymentInit } from '@shop/shared';
import { withTransaction } from '../config/db';
import { logger } from '../config/logger';
import { demoPay, type GatewayPaymentInfo, type GatewayRefundInfo } from '../integrations/demopay/client';
import { Order, Payment, Refund, WebhookEvent, type OrderDoc } from '../models/order.model';
import { AppError, conflict, notFound } from '../utils/errors';
import { recomputeProductAggregates } from './catalog.service';
import { removePurchasedFromCart } from './cart.service';
import { canStartPayment, loadOrderDTO, moveStock, orderEmails, pushStatus } from './order.helpers';
import { getSettings } from './settings.service';

const CAPTURED = ['captured', 'partially_refunded', 'refunded'];

// ---------------------------------------------------------------- starting a payment

/** One gateway order per store order, reused for every payment attempt (so retries can never double-charge). */
export async function ensureGatewayOrder(order: OrderDoc): Promise<PaymentInit> {
  let gatewayOrderId = order.gatewayOrderId;
  if (!gatewayOrderId) {
    const created = await demoPay.createOrder({
      amount: order.pricing.total,
      currency: 'INR',
      receipt: order.orderNumber,
      notes: { orderId: order._id.toString() },
    });
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, gatewayOrderId: { $exists: false } },
      { $set: { gatewayOrderId: created.id } },
      { new: true },
    );
    gatewayOrderId = updated?.gatewayOrderId ?? (await Order.findById(order._id))!.gatewayOrderId!;
    order.gatewayOrderId = gatewayOrderId;
  }
  return {
    provider: 'demopay',
    keyId: demoPay.keyId,
    gatewayOrderId,
    amount: order.pricing.total,
    currency: 'INR',
    windowEndsAt: order.reservationExpiresAt!.toISOString(),
    prefill: { name: order.customer?.name ?? '', email: order.customer?.email ?? '', contact: order.customer?.phone ?? '' },
  };
}

export async function startPayment(userId: string, orderNumber: string): Promise<PaymentInit> {
  const [order, settings] = await Promise.all([Order.findOne({ orderNumber, userId }), getSettings()]);
  if (!order) throw notFound('Order not found.');
  if (!canStartPayment(order, settings.paymentWindowMinutes)) {
    throw conflict('PAYMENT_WINDOW_CLOSED', 'The payment window for this order has closed.');
  }
  try {
    return await ensureGatewayOrder(order);
  } catch (err) {
    logger.error({ err, orderNumber }, 'Could not create gateway order');
    throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'The payment service is not responding. Please try again in a moment.');
  }
}

// ---------------------------------------------------------------- recording payments

interface RecordOptions {
  eventId?: string;
  eventType?: string;
}

type CaptureOutcome = 'applied' | 'refund_required' | 'already_recorded' | 'unknown_order';

/**
 * Idempotent: called by the browser verification, the webhook and the reconciliation jobs.
 * A capture that cannot move a `pending_payment` order forward (late, duplicate, wrong amount) is refunded.
 */
export async function recordCapturedPayment(gp: GatewayPaymentInfo, opts: RecordOptions = {}) {
  const result = await withTransaction(async (session) => {
    const recordEvent = async (outcome: string) => {
      if (opts.eventId) {
        await WebhookEvent.create([{ provider: 'demopay', eventId: opts.eventId, type: opts.eventType ?? 'payment.captured', outcome }], { session });
      }
    };
    if (opts.eventId && (await WebhookEvent.exists({ eventId: opts.eventId }).session(session))) {
      return { outcome: 'already_recorded' as CaptureOutcome, order: null, amount: gp.amount };
    }
    const order = await Order.findOne({ gatewayOrderId: gp.orderId }).session(session);
    if (!order) {
      await recordEvent('unknown_order');
      return { outcome: 'unknown_order' as CaptureOutcome, order: null, amount: gp.amount };
    }

    let payment = await Payment.findOne({ gatewayPaymentId: gp.id }).session(session);
    if (payment && CAPTURED.includes(payment.status)) {
      await recordEvent('already_recorded');
      return { outcome: 'already_recorded' as CaptureOutcome, order, amount: gp.amount };
    }
    const now = new Date();
    if (!payment) {
      payment = new Payment({
        orderId: order._id,
        userId: order.userId,
        provider: 'demopay',
        gatewayPaymentId: gp.id,
        gatewayOrderId: gp.orderId,
        amount: gp.amount,
        currency: gp.currency,
        method: gp.method,
        status: 'captured',
        capturedAt: now,
      });
    } else {
      payment.status = 'captured';
      payment.capturedAt = now;
      payment.method = gp.method;
    }

    let outcome: CaptureOutcome;
    if (order.status === 'pending_payment' && gp.amount === order.pricing.total && gp.currency === 'INR') {
      await moveStock(session, order, 'allocate');
      order.paymentStatus = 'paid';
      order.stockState = 'allocated';
      order.paidAt = now;
      order.confirmedAt = now;
      order.reservationExpiresAt = undefined;
      pushStatus(order, 'confirmed', { type: 'system' }, `Payment received via ${gp.method.toUpperCase()} (virtual money)`);
      payment.disposition = 'applied';
      await removePurchasedFromCart(order.userId, order.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })), session);
      outcome = 'applied';
    } else {
      payment.disposition = 'refund_required';
      await payment.save({ session });
      await Refund.create(
        [{
          orderId: order._id,
          paymentId: payment._id,
          gatewayPaymentId: gp.id,
          amount: gp.amount,
          reason: order.paymentStatus === 'paid' ? 'duplicate_payment' : 'late_payment',
          requestedAt: now,
        }],
        { session },
      );
      if (order.paymentStatus === 'unpaid') order.paymentStatus = 'refund_pending';
      outcome = 'refund_required';
    }
    await payment.save({ session });
    await order.save({ session });
    await recordEvent(outcome);
    return { outcome, order, amount: gp.amount };
  });

  // Side effects after commit.
  if (result.order && result.outcome === 'applied') {
    void recomputeProductAggregates(result.order.items.map((i) => i.productId)).catch((err) => logger.error({ err }, 'aggregate recompute failed'));
    void orderEmails.confirmed(result.order);
  } else if (result.order && result.outcome === 'refund_required') {
    void orderEmails.paymentWillBeRefunded(result.order, result.amount);
    kickRefunds();
  }
  return result;
}

export async function recordFailedPayment(gp: GatewayPaymentInfo, opts: RecordOptions = {}) {
  await withTransaction(async (session) => {
    if (opts.eventId && (await WebhookEvent.exists({ eventId: opts.eventId }).session(session))) return;
    const order = await Order.findOne({ gatewayOrderId: gp.orderId }).session(session);
    if (order) {
      const existing = await Payment.findOne({ gatewayPaymentId: gp.id }).session(session);
      // Forward-only: a late "failed" never overrides a capture.
      if (!existing) {
        await Payment.create(
          [{
            orderId: order._id,
            userId: order.userId,
            provider: 'demopay',
            gatewayPaymentId: gp.id,
            gatewayOrderId: gp.orderId,
            amount: gp.amount,
            method: gp.method,
            status: 'failed',
            error: { code: gp.errorCode ?? undefined, description: gp.errorDescription ?? undefined },
          }],
          { session },
        );
      } else if (existing.status === 'created' || existing.status === 'authorized') {
        existing.status = 'failed';
        await existing.save({ session });
      }
    }
    if (opts.eventId) {
      await WebhookEvent.create([{ provider: 'demopay', eventId: opts.eventId, type: 'payment.failed', outcome: order ? 'recorded' : 'unknown_order' }], { session });
    }
  });
}

/** Called by the browser after DemoPay checkout reports success. Never trusts the browser alone. */
export async function verifyPayment(
  userId: string,
  input: { orderNumber: string; gatewayOrderId: string; gatewayPaymentId: string; signature: string },
) {
  const fail = () => new AppError(400, 'PAYMENT_VERIFICATION_FAILED', 'We could not verify this payment.');
  const order = await Order.findOne({ orderNumber: input.orderNumber, userId });
  if (!order || order.gatewayOrderId !== input.gatewayOrderId) throw fail();
  if (!demoPay.verifyCheckoutSignature(input.gatewayOrderId, input.gatewayPaymentId, input.signature)) throw fail();
  const gp = await demoPay.fetchPayment(input.gatewayPaymentId);
  if (!gp || gp.orderId !== order.gatewayOrderId || gp.currency !== 'INR' || !CAPTURED.includes(gp.status)) throw fail();
  await recordCapturedPayment(gp);
  const [fresh, settings] = await Promise.all([Order.findById(order._id), getSettings()]);
  return loadOrderDTO(fresh!, settings.paymentWindowMinutes);
}

// ---------------------------------------------------------------- webhooks

export async function handleWebhook(rawBody: Buffer, signature: string | undefined, eventId: string | undefined) {
  if (!signature || !demoPay.verifyWebhookSignature(rawBody, signature)) {
    throw new AppError(400, 'INVALID_SIGNATURE', 'Webhook signature mismatch.');
  }
  if (!eventId) throw new AppError(400, 'VALIDATION_ERROR', 'Missing event id.');
  if (await WebhookEvent.exists({ eventId })) return 'duplicate';

  const event = JSON.parse(rawBody.toString('utf8')) as { event: string; payload: Record<string, unknown> };
  const opts = { eventId, eventType: event.event };
  switch (event.event) {
    case 'payment.captured':
      await recordCapturedPayment(event.payload.payment as GatewayPaymentInfo, opts);
      return 'processed';
    case 'payment.failed':
      await recordFailedPayment(event.payload.payment as GatewayPaymentInfo, opts);
      return 'processed';
    case 'refund.processed':
      await recordRefundProcessed(event.payload.refund as GatewayRefundInfo, opts);
      return 'processed';
    case 'refund.failed':
      await recordRefundFailed(event.payload.refund as GatewayRefundInfo, opts);
      return 'processed';
    default:
      await WebhookEvent.create({ provider: 'demopay', eventId, type: event.event, outcome: 'ignored' });
      return 'ignored';
  }
}

// ---------------------------------------------------------------- refunds

export async function recordRefundProcessed(info: GatewayRefundInfo, opts: RecordOptions = {}) {
  const result = await withTransaction(async (session) => {
    const recordEvent = async (outcome: string) => {
      if (opts.eventId) {
        await WebhookEvent.create([{ provider: 'demopay', eventId: opts.eventId, type: 'refund.processed', outcome }], { session });
      }
    };
    if (opts.eventId && (await WebhookEvent.exists({ eventId: opts.eventId }).session(session))) return null;

    const payment = await Payment.findOne({ gatewayPaymentId: info.paymentId }).session(session);
    if (!payment) {
      await recordEvent('unknown_payment');
      return null;
    }
    let refund =
      (await Refund.findOne({ gatewayRefundId: info.id }).session(session)) ??
      (info.notes?.refundId ? await Refund.findById(info.notes.refundId).session(session) : null);
    const now = new Date();
    if (refund?.status === 'processed') {
      await recordEvent('already_recorded');
      return null;
    }
    if (!refund) {
      // A refund made directly in the gateway's dashboard: record it so the books stay right.
      refund = new Refund({
        orderId: payment.orderId,
        paymentId: payment._id,
        gatewayPaymentId: info.paymentId,
        amount: info.amount,
        reason: 'manual',
        source: 'gateway_dashboard',
        requestedAt: now,
      });
    }
    refund.status = 'processed';
    refund.gatewayRefundId = info.id;
    refund.processedAt = now;
    refund.jobLockedUntil = undefined;
    await refund.save({ session });

    payment.refundedAmount = (payment.refundedAmount ?? 0) + info.amount;
    payment.status = payment.refundedAmount >= payment.amount ? 'refunded' : 'partially_refunded';
    await payment.save({ session });

    const order = await Order.findById(payment.orderId).session(session);
    if (order) {
      if (payment.disposition === 'applied') {
        order.paymentStatus = payment.refundedAmount >= payment.amount ? 'refunded' : 'partially_refunded';
      } else if (order.paymentStatus === 'refund_pending' || order.paymentStatus === 'refund_failed') {
        const open = await Refund.countDocuments({ orderId: order._id, status: { $ne: 'processed' }, _id: { $ne: refund._id } }).session(session);
        if (open === 0) order.paymentStatus = 'refunded';
      }
      order.refundedAt = now;
      await order.save({ session });
    }
    await recordEvent('processed');
    return { order, amount: info.amount };
  });
  if (result?.order) void orderEmails.refundProcessed(result.order, result.amount);
}

export async function recordRefundFailed(info: GatewayRefundInfo, opts: RecordOptions = {}) {
  await withTransaction(async (session) => {
    if (opts.eventId && (await WebhookEvent.exists({ eventId: opts.eventId }).session(session))) return;
    const refund =
      (await Refund.findOne({ gatewayRefundId: info.id }).session(session)) ??
      (info.notes?.refundId ? await Refund.findById(info.notes.refundId).session(session) : null);
    if (refund && refund.status !== 'processed') {
      refund.status = 'failed';
      refund.lastError = 'Gateway reported the refund as failed';
      await refund.save({ session });
      await Order.updateOne({ _id: refund.orderId, paymentStatus: 'refund_pending' }, { $set: { paymentStatus: 'refund_failed' } }, { session });
    }
    if (opts.eventId) {
      await WebhookEvent.create([{ provider: 'demopay', eventId: opts.eventId, type: 'refund.failed', outcome: refund ? 'recorded' : 'unknown' }], { session });
    }
  });
}

const MAX_REFUND_ATTEMPTS = 5;

/**
 * Refund job: executes queued refunds. Before creating a refund it checks the gateway for one already
 * tagged with this refund's id, so a crash after the API call can never refund twice.
 */
export async function processRefundQueue(limit = 20): Promise<number> {
  let processed = 0;
  for (let i = 0; i < limit; i++) {
    const now = new Date();
    const claim = await Refund.findOneAndUpdate(
      { status: 'requested', $or: [{ jobLockedUntil: { $exists: false } }, { jobLockedUntil: null }, { jobLockedUntil: { $lt: now } }] },
      { $set: { jobLockedUntil: new Date(now.getTime() + 60_000) }, $inc: { attempts: 1 } },
      { new: true, sort: { requestedAt: 1 } },
    );
    if (!claim) break;
    try {
      const existing = (await demoPay.fetchRefunds(claim.gatewayPaymentId)).find((r) => r.notes?.refundId === claim.id);
      const gatewayRefund =
        existing ??
        (await demoPay.createRefund(claim.gatewayPaymentId, {
          amount: claim.amount,
          notes: { refundId: claim.id as string, orderId: claim.orderId.toString() },
        }));
      await Refund.updateOne(
        { _id: claim._id, status: 'requested' },
        { $set: { status: 'initiated', gatewayRefundId: gatewayRefund.id, initiatedAt: new Date() }, $unset: { jobLockedUntil: 1, lastError: 1 } },
      );
      if (gatewayRefund.status === 'processed') await recordRefundProcessed(gatewayRefund);
      processed++;
    } catch (err) {
      const message = (err as Error).message;
      logger.warn({ err: message, refundId: claim.id }, 'Refund attempt failed');
      if (claim.attempts >= MAX_REFUND_ATTEMPTS) {
        await Refund.updateOne({ _id: claim._id }, { $set: { status: 'failed', lastError: message }, $unset: { jobLockedUntil: 1 } });
        await Order.updateOne({ _id: claim.orderId, paymentStatus: 'refund_pending' }, { $set: { paymentStatus: 'refund_failed' } });
      } else {
        await Refund.updateOne(
          { _id: claim._id },
          { $set: { lastError: message, jobLockedUntil: new Date(Date.now() + claim.attempts * 30_000) } },
        );
      }
    }
  }
  return processed;
}

let refundRun: Promise<unknown> | null = null;
/** Runs the refund queue soon, without waiting for the next scheduled tick. */
export function kickRefunds() {
  if (refundRun) return;
  refundRun = new Promise((r) => setTimeout(r, 50))
    .then(() => processRefundQueue())
    .catch((err) => logger.error({ err }, 'Refund queue run failed'))
    .finally(() => {
      refundRun = null;
    });
}

export async function retryRefund(refundId: string) {
  const refund = await Refund.findOneAndUpdate(
    { _id: refundId, status: 'failed' },
    { $set: { status: 'requested', attempts: 0 }, $unset: { jobLockedUntil: 1, lastError: 1 } },
    { new: true },
  );
  if (!refund) throw conflict('INVALID_STATUS_TRANSITION', 'Only failed refunds can be retried.');
  await Order.updateOne({ _id: refund.orderId, paymentStatus: 'refund_failed' }, { $set: { paymentStatus: 'refund_pending' } });
  kickRefunds();
}

// ---------------------------------------------------------------- reconciliation

/** Asks the gateway for captured payments on this order that the store has not recorded (lost callbacks). */
export async function reconcileGatewayOrder(gatewayOrderId: string): Promise<boolean> {
  const payments = await demoPay.fetchOrderPayments(gatewayOrderId);
  let captured = false;
  for (const gp of payments) {
    if (!CAPTURED.includes(gp.status)) continue;
    captured = true;
    const known = await Payment.exists({ gatewayPaymentId: gp.id, status: { $in: CAPTURED } });
    if (!known) await recordCapturedPayment({ ...gp, status: 'captured' });
  }
  return captured;
}
